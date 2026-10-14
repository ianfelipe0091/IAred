import { availableModels, defaultModelId } from "../_lib/catalog.js";
import { buildSystemPrompt } from "../_lib/prompts.js";
import { checkAccess, json } from "../_lib/http.js";
import {
  describeAnthropicError,
  describeWorkersAIError,
  streamAnthropic,
  streamWorkersAI,
} from "../_lib/providers.js";

const MAX_MESSAGES = 200;
const MAX_TOTAL_CHARS = 1_500_000;
const CHARS_PER_TOKEN = 3.2;

export async function onRequestPost({ request, env }) {
  const denied = checkAccess(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON inválido." }, { status: 400 });
  }

  const models = availableModels(env);
  const spec = models.find((m) => m.id === body.model) || models.find((m) => m.id === defaultModelId(env));
  if (!spec) {
    return json({ error: "Nenhum modelo disponível. Verifique o binding AI do projeto." }, { status: 503 });
  }

  const messages = sanitizeMessages(body.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return json({ error: "A conversa precisa terminar com uma mensagem do usuário." }, { status: 400 });
  }
  const totalChars = messages.reduce((n, m) => n + m.content.length, 0);
  if (messages.length > MAX_MESSAGES || totalChars > MAX_TOTAL_CHARS) {
    return json({ error: "Conversa grande demais. Inicie uma nova conversa." }, { status: 413 });
  }

  const system = buildSystemPrompt({ agent: body.agent, customInstructions: body.customInstructions });
  const { kept, dropped } = fitToContext(messages, spec, system);
  if (!kept.length) {
    return json(
      { error: "Sua mensagem é grande demais para este modelo. Reduza o anexo ou escolha um modelo com mais contexto." },
      { status: 413 },
    );
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (event) => writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

  const run = async () => {
    const started = Date.now();
    try {
      await send({ type: "meta", model: spec.id, label: spec.label });
      if (dropped > 0) {
        await send({
          type: "notice",
          text: `${dropped} mensagem(ns) antiga(s) foram omitidas para caber no contexto do ${spec.label}.`,
        });
      }
      const args = { system, messages: kept, effort: body.effort, signal: request.signal };
      const events = spec.provider === "anthropic" ? streamAnthropic(env, spec, args) : streamWorkersAI(env, spec, args);
      for await (const event of events) {
        await send(event);
      }
      await send({ type: "done", ms: Date.now() - started });
    } catch (err) {
      const message = spec.provider === "anthropic" ? describeAnthropicError(err) : describeWorkersAIError(err);
      try {
        await send({ type: "error", message });
      } catch {
        // cliente já desconectou
      }
    } finally {
      try {
        await writer.close();
      } catch {
        // stream já encerrado
      }
    }
  };
  run();

  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
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

// Mantém as mensagens mais recentes que cabem na janela de contexto do modelo.
function fitToContext(messages, spec, system) {
  const budget = (spec.contextTokens - spec.maxTokens - 1024) * CHARS_PER_TOKEN - system.length;
  const kept = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const size = messages[i].content.length + 16;
    if (used + size > budget) break;
    kept.unshift(messages[i]);
    used += size;
  }
  while (kept.length && kept[0].role !== "user") kept.shift();
  return { kept, dropped: messages.length - kept.length };
}
