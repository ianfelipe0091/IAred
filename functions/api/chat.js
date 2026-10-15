import { authenticate } from "../_lib/auth.js";
import { loadLimits, loadPromptConfig } from "../_lib/config.js";
import { buildContext, CHARS_PER_TOKEN, keepRecent, historyBudget, summarizeWith, ts } from "../_lib/context.js";
import {
  DB_UNAVAILABLE,
  DbError,
  checkLimits,
  createConversation,
  dbFor,
  deleteConversation,
  dbStatus,
  deleteMessagesFrom,
  insertMessages,
  isUuid,
  loadConversation,
  loadProfile,
  recordUsage,
  serverKey,
  updateConversation,
} from "../_lib/db.js";
import { json } from "../_lib/http.js";
import { buildSystemPrompt } from "../_lib/prompt.js";
import { resolveEngine } from "../_lib/providers.js";
import { generateTitle, provisionalTitle } from "../_lib/title.js";

const MAX_MESSAGES = 200;
const MAX_TOTAL_CHARS = 2_000_000;
const MAX_MESSAGE_CHARS = 200_000;

// Escreve eventos SSE sem nunca travar: se o usuário desconectar (parar, fechar a aba), a escrita
// fica pendente para sempre em vez de dar erro, e o Cloudflare encerraria o código antes de guardar a resposta.
// Por isso cada escrita desiste quando o pedido é cancelado ou quando fica 15 s parada.
function sseWriter(writable, controller) {
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const aborted = new Promise((resolve) => controller.signal.addEventListener("abort", resolve, { once: true }));
  let open = true;
  return {
    async send(event) {
      if (!open || controller.signal.aborted) return;
      let timer;
      const stalled = new Promise((resolve) => (timer = setTimeout(() => resolve("stalled"), 15_000)));
      try {
        const result = await Promise.race([writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)), aborted, stalled]);
        if (result === "stalled") throw new Error("cliente parado");
      } catch {
        open = false;
        controller.abort();
      } finally {
        clearTimeout(timer);
      }
    },
    async close() {
      if (!open) return;
      open = false;
      await Promise.race([writer.close(), aborted]).catch(() => {});
    },
  };
}

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-store",
  "x-accel-buffering": "no",
};

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  // Modelo escolhido pelo usuário (ou o padrão, se não houver escolha).
  const engine = await resolveEngine(env, body.model);
  if (!engine) {
    return json({ error: "Nenhum modelo de IA disponível. O administrador precisa configurar a IA no painel." }, 503);
  }

  // Com login e banco prontos, o histórico fica no servidor (como nos assistentes grandes):
  // o navegador manda só a mensagem nova e o servidor remonta o contexto.
  const status = auth.user ? await dbStatus(env) : { state: "off" };
  if (status.state === "ready") {
    // Aba aberta com a versão antiga do app (que manda o histórico inteiro).
    if (!body.conversationId && Array.isArray(body.messages)) {
      return json({ error: "O KIRA foi atualizado. Recarregue a página para continuar.", reload: true }, 409);
    }
    return cloudChat(context, auth, body, engine);
  }
  if (body.conversationId && !Array.isArray(body.messages)) {
    return json({ error: "O histórico na nuvem está indisponível agora. Recarregue a página.", reload: true }, 409);
  }
  return localChat(context, body, engine);
}

const instructionsFor = (config, engine) => ({ general: config.all?.text, specific: config.models[engine.id]?.text });

const profileFor = (profile, user) => ({ name: profile?.display_name || user?.name || "", about: profile?.about || "" });

// ---------------- Histórico no banco ----------------

async function cloudChat(context, auth, body, engine) {
  const { request, env } = context;
  const db = dbFor(auth, auth.token, await serverKey(env));
  const regenerate = body.regenerate === true;
  const content = typeof body.content === "string" ? body.content.replace(/\r\n/g, "\n") : "";
  const conversationId = body.conversationId;
  if (!isUuid(conversationId)) return json({ error: "Conversa inválida." }, 400);
  if (!regenerate && !content.trim()) return json({ error: "Escreva uma mensagem." }, 400);
  if (content.length > MAX_MESSAGE_CHARS) return json({ error: "Mensagem grande demais. Reduza o texto e tente de novo." }, 413);

  const assistantId = isUuid(body.assistantMessageId) ? body.assistantMessageId : crypto.randomUUID();
  let conversation;
  let rows;
  let userRow = null;
  let instructions;
  let profile;
  let buildSystem;
  let created = false;
  try {
    let limit;
    [conversation, limit, profile, instructions] = await Promise.all([
      loadConversation(db, conversationId),
      loadLimits(env).then((limits) => checkLimits(db, limits)),
      loadProfile(db).catch(() => null),
      loadPromptConfig(env),
    ]);
    if (!limit.ok) {
      const unit = limit.scope === "hour" ? "por hora" : "por dia";
      return json(
        { error: `Você atingiu o limite de ${limit.limit} ${limit.limit === 1 ? "mensagem" : "mensagens"} ${unit}.`, limit: true, retryAt: limit.retryAt },
        429,
      );
    }
    if (!conversation && !body.newConversation) {
      return json({ error: "Esta conversa não existe mais (talvez tenha sido apagada em outro aparelho).", gone: true }, 404);
    }
    const user = profileFor(profile, auth.user);
    buildSystem = (summary) => buildSystemPrompt({ ...instructionsFor(instructions, engine), user, summary, timezone: body.timezone });
    // Instruções muito longas podem não caber no contexto do modelo escolhido.
    if (buildSystem(conversation?.summary).length / CHARS_PER_TOKEN > engine.contextTokens - engine.maxTokens - 4096) {
      return json(
        { error: "As instruções configuradas pelo administrador são grandes demais para este modelo. Escolha outro modelo ou avise o administrador." },
        413,
      );
    }
    rows = conversation?.kira_messages || [];

    // Apaga a partir de rows[cut] (editar ou gerar de novo). Se o resumo cobria o que foi apagado, descarta o resumo.
    const cutFrom = async (cut) => {
      if (cut >= rows.length) return;
      await deleteMessagesFrom(db, conversationId, rows[cut].created_at);
      if (conversation.summary_until && ts(rows[cut].created_at) <= ts(conversation.summary_until)) {
        conversation = { ...conversation, summary: null, summary_until: null };
        await updateConversation(db, conversationId, { summary: null, summary_until: null });
      }
      rows = rows.slice(0, cut);
    };

    if (regenerate) {
      // Gerar de novo: a resposta escolhida (ou as respostas depois da última pergunta) e tudo depois dela saem.
      let cut = body.fromMessageId ? rows.findIndex((m) => m.id === body.fromMessageId && m.role === "assistant") : -1;
      if (cut < 0) cut = rows.findLastIndex((m) => m.role === "user") + 1;
      if (cut < 1 || rows[cut - 1].role !== "user") return json({ error: "Não há mensagem para responder." }, 400);
      await cutFrom(cut);
    } else if (body.editMessageId) {
      // Editar: a mensagem editada e tudo depois dela saem.
      const index = rows.findIndex((m) => m.id === body.editMessageId && m.role === "user");
      if (index < 0) return json({ error: "Mensagem não encontrada. Recarregue a conversa." }, 404);
      await cutFrom(index);
    }

    // active_reply: a resposta que está sendo gerada agora (uma mais nova substitui a anterior).
    const writes = [recordUsage(db)];
    if (!conversation) {
      conversation = await createConversation(db, { id: conversationId, title: provisionalTitle(content), active_reply: assistantId });
      created = true;
    } else {
      writes.push(updateConversation(db, conversationId, { active_reply: assistantId }));
    }
    if (!regenerate) {
      const id = isUuid(body.userMessageId) ? body.userMessageId : crypto.randomUUID();
      writes.push(
        insertMessages(db, [{ id, conversation_id: conversationId, role: "user", content }]).then((r) => (userRow = r[0])),
      );
    }
    await Promise.all(writes);
    if (userRow) rows = [...rows, userRow];
  } catch (err) {
    if (created) await deleteConversation(db, conversationId).catch(() => {});
    if (err instanceof DbError) {
      return json({ error: err.status === 0 ? DB_UNAVAILABLE : `Erro no banco de dados: ${err.message}` }, 503);
    }
    throw err;
  }

  const isNew = !(conversation.kira_messages || []).length && !regenerate;
  // A pergunta que esta resposta responde: a resposta fica logo depois dela no histórico.
  const parent = rows[rows.length - 1];

  const { readable, writable } = new TransformStream();
  // O usuário saiu ou apertou parar: interrompe o modelo e guarda o que já veio.
  const controller = new AbortController();
  request.signal?.addEventListener?.("abort", () => controller.abort());
  const { send, close } = sseWriter(writable, controller);

  const work = (async () => {
    const started = Date.now();
    const result = { content: "", thinking: "", notices: [], status: "complete", error: null, usage: null };
    let thinkStart = 0;
    let thinkingMs = 0;
    await send({ type: "meta", conversationId, userMessageId: userRow?.id, assistantMessageId: assistantId, label: engine.label });

    // Título em paralelo com a resposta.
    const titled = isNew
      ? generateTitle(env, content).then(async (title) => {
          if (!title) return;
          await updateConversation(db, conversationId, { title }).catch(() => {});
          await send({ type: "title", title });
        })
      : null;

    try {
      const ctx = await buildContext({
        engine,
        conversation,
        rows,
        buildSystem,
        summarize: (previous, messages) => summarizeWith(engine, previous, messages, controller.signal),
        saveSummary: (patch) => updateConversation(db, conversationId, patch),
        notify: (text) => send({ type: "status", text }),
      });
      if (ctx.tooLarge) throw new UserFacingError("A mensagem é grande demais para este modelo. Reduza o texto e tente de novo.");
      if (ctx.dropped > 0) {
        const notice = `${ctx.dropped} mensagem(ns) antiga(s) ficaram de fora do contexto.`;
        result.notices.push(notice);
        await send({ type: "notice", text: notice });
      }
      for await (const event of engine.stream({ system: ctx.system, messages: ctx.messages, signal: controller.signal })) {
        if (event.type === "thinking") {
          if (!thinkStart) thinkStart = Date.now();
          result.thinking += event.text;
        } else if (event.type === "text") {
          if (thinkStart && !thinkingMs) thinkingMs = Date.now() - thinkStart;
          result.content += event.text;
        } else if (event.type === "notice") {
          result.notices.push(event.text);
        } else if (event.type === "usage") {
          result.usage = { input: event.input, output: event.output };
          continue;
        }
        await send(event);
      }
    } catch (err) {
      if (controller.signal.aborted) {
        result.status = "stopped";
      } else {
        result.status = "error";
        result.error = err instanceof UserFacingError ? err.message : engine.describeError(err);
        await send({ type: "error", message: result.error });
      }
    }
    if (thinkStart && !thinkingMs) thinkingMs = Date.now() - thinkStart;

    // Guarda a resposta, inteira ou parcial (parar também guarda o que já veio),
    // a menos que o usuário tenha editado a pergunta ou pedido outra resposta enquanto esta era gerada.
    try {
      if (await replyStillWanted(db, conversationId, parent, assistantId)) await insertMessages(db, [
        {
          id: assistantId,
          conversation_id: conversationId,
          role: "assistant",
          created_at: justAfter(parent.created_at),
          content: result.content,
          thinking: result.thinking,
          model: engine.label,
          status: result.status,
          meta: {
            modelId: engine.id,
            notices: result.notices,
            ...(result.error ? { error: result.error } : {}),
            ...(thinkingMs ? { thinkingMs } : {}),
            ...(result.usage ? { usage: result.usage } : {}),
            ms: Date.now() - started,
          },
        },
      ]);
    } catch {
      await send({ type: "notice", text: "Não foi possível salvar esta resposta no histórico." });
    }
    if (titled) await titled.catch(() => {});
    await send({ type: "done", ms: Date.now() - started });
    await close();
  })();

  // Garante que a resposta (inteira ou o que veio até parar) seja guardada mesmo se o usuário fechar a página.
  context.waitUntil?.(work);
  return new Response(readable, { headers: SSE_HEADERS });
}

class UserFacingError extends Error {}

// Um microssegundo depois de outra mensagem (pelo relógio do banco, não do servidor): a resposta fica
// logo depois da pergunta mesmo que o usuário mande outra mensagem antes de ela terminar de ser gravada.
function justAfter(createdAt) {
  const micros = ts(createdAt) + 1;
  const ms = Math.floor(micros / 1000);
  return `${new Date(ms).toISOString().slice(0, 23)}${String(micros % 1000).padStart(3, "0")}Z`;
}

// A resposta ainda vale se a pergunta continua lá e ela é a resposta ativa da conversa,
// ou se o usuário já seguiu com outra mensagem (aí ela continua fazendo parte do histórico).
async function replyStillWanted(db, conversationId, parent, assistantId) {
  const [conv, questions] = await Promise.all([
    db.get(`kira_conversations?id=eq.${conversationId}&select=active_reply`),
    db.get(
      `kira_messages?conversation_id=eq.${conversationId}&role=eq.user&created_at=gte.${encodeURIComponent(parent.created_at)}&select=id&order=created_at.asc&limit=2`,
    ),
  ]);
  if (!conv?.length || !questions?.some((q) => q.id === parent.id)) return false; // conversa apagada ou pergunta editada
  return conv[0].active_reply === assistantId || questions.length > 1;
}

// ---------------- Histórico só no navegador (sem login ou sem banco) ----------------

async function localChat({ request, env }, body, engine) {
  const messages = sanitizeMessages(body.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return json({ error: "A conversa precisa terminar com uma mensagem do usuário." }, 400);
  }
  const totalChars = messages.reduce((n, m) => n + m.content.length, 0);
  if (messages.length > MAX_MESSAGES || totalChars > MAX_TOTAL_CHARS) {
    return json({ error: "Conversa grande demais. Inicie uma nova conversa." }, 413);
  }

  const system = buildSystemPrompt({ ...instructionsFor(await loadPromptConfig(env), engine), timezone: body.timezone });
  // Instruções muito longas podem não caber no contexto do modelo escolhido.
  if (system.length / CHARS_PER_TOKEN > engine.contextTokens - engine.maxTokens - 4096) {
    return json(
      { error: "As instruções configuradas pelo administrador são grandes demais para este modelo. Escolha outro modelo ou avise o administrador." },
      413,
    );
  }
  const kept = keepRecent(messages, historyBudget(engine, system.length));
  const dropped = messages.length - kept.length;
  if (!kept.length) {
    return json({ error: "Sua mensagem é grande demais. Reduza o texto e tente de novo." }, 413);
  }

  const { readable, writable } = new TransformStream();
  const controller = new AbortController();
  request.signal?.addEventListener?.("abort", () => controller.abort());
  const { send, close } = sseWriter(writable, controller);

  (async () => {
    const started = Date.now();
    try {
      await send({ type: "meta", model: engine.id, label: engine.label });
      if (dropped > 0) {
        await send({ type: "notice", text: `${dropped} mensagem(ns) antiga(s) foram omitidas para caber no contexto.` });
      }
      for await (const event of engine.stream({ system, messages: kept, signal: controller.signal })) {
        await send(event);
      }
      await send({ type: "done", ms: Date.now() - started });
    } catch (err) {
      if (!controller.signal.aborted) await send({ type: "error", message: engine.describeError(err) });
    } finally {
      await close();
    }
  })();

  return new Response(readable, { headers: SSE_HEADERS });
}

function sanitizeMessages(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const m of input) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    const content = typeof m.content === "string" ? m.content : "";
    if (!content.trim()) continue;
    out.push({ role: m.role, content });
  }
  return out;
}
