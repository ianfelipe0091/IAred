// Contexto das conversas: o que vai para o modelo a cada mensagem.
//
// Como os assistentes grandes fazem: o histórico fica no servidor e é remontado a cada mensagem.
// Quando a conversa passa do que cabe no modelo, o começo vira um resumo (guardado na conversa)
// e só as mensagens recentes vão inteiras. Sem resumo possível, as mais antigas são omitidas.

export const CHARS_PER_TOKEN = 3.2;
// Teto do histórico mesmo em modelos com contexto enorme: mensagens mais rápidas e baratas.
const HISTORY_CAP_TOKENS = 100_000;
// Depois de resumir, as mensagens recentes ocupam no máximo esta fração do espaço (evita resumir a cada mensagem).
const KEEP_RATIO = 0.5;
const MESSAGE_OVERHEAD = 16;

const size = (m) => m.content.length + MESSAGE_OVERHEAD;
const total = (list) => list.reduce((n, m) => n + size(m), 0);

// Espaço (em caracteres) para o histórico, descontando a resposta e o prompt de sistema.
export function historyBudget(engine, systemChars) {
  const tokens = Math.min(engine.contextTokens - engine.maxTokens - 2048, HISTORY_CAP_TOKENS);
  return Math.max(0, tokens * CHARS_PER_TOKEN - systemChars);
}

// Instante com microssegundos, para comparar created_at do Postgres sem perder a ordem.
export function ts(value) {
  const m = /\.(\d+)/.exec(String(value));
  const micros = m ? Number(m[1].padEnd(6, "0").slice(0, 6)) % 1000 : 0;
  return Date.parse(value) * 1000 + micros;
}

// Mensagens do banco → formato do modelo. Respostas importadas de um navegador (não geradas por este
// servidor) entram como texto citado do usuário, nunca como fala da própria IA.
export function toModelMessages(rows) {
  const out = [];
  for (const m of rows) {
    if (!String(m.content || "").trim()) continue;
    if (m.role === "assistant" && m.meta?.imported) {
      out.push({ role: "user", content: `[Resposta anterior da KIRA, importada de outro aparelho]\n${m.content}`, created_at: m.created_at });
    } else {
      out.push({ role: m.role, content: m.content, created_at: m.created_at });
    }
  }
  return out;
}

// Mantém as mensagens mais recentes que cabem no espaço; a primeira precisa ser do usuário.
export function keepRecent(messages, budget) {
  const kept = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (used + size(messages[i]) > budget) break;
    kept.unshift(messages[i]);
    used += size(messages[i]);
  }
  while (kept.length && kept[0].role !== "user") kept.shift();
  return kept;
}

/**
 * Monta o contexto de uma conversa guardada no banco.
 * buildSystem(summary) → prompt de sistema; summarize(previous, messages) → novo resumo;
 * saveSummary({ summary, summary_until }) grava na conversa; notify(text) mostra um aviso curto.
 * Devolve { system, messages, dropped, summarized } ou { tooLarge: true }.
 */
export async function buildContext({ engine, conversation, rows, buildSystem, summarize, saveSummary, notify }) {
  let summary = conversation?.summary || "";
  const until = conversation?.summary_until ? ts(conversation.summary_until) : null;
  const recent = toModelMessages(until ? rows.filter((m) => ts(m.created_at) > until) : rows);
  if (!recent.length) return { tooLarge: true };

  let system = buildSystem(summary);
  let budget = historyBudget(engine, system.length);
  if (total(recent) <= budget) return { system, messages: plain(recent), dropped: 0, summarized: false };

  // A última mensagem sozinha não cabe: não há o que resumir.
  if (size(recent[recent.length - 1]) > budget) return { tooLarge: true };

  // Resume o começo até as recentes ocuparem no máximo KEEP_RATIO do espaço.
  let kept = keepRecent(recent, budget * KEEP_RATIO);
  if (!kept.length) kept = keepRecent(recent, budget);
  const fold = recent.slice(0, recent.length - kept.length);
  if (kept.length && fold.length) {
    try {
      await notify("Resumindo o começo da conversa para caber no contexto…");
      const next = await summarize(summary, fold);
      const summaryUntil = fold[fold.length - 1].created_at;
      await saveSummary({ summary: next, summary_until: summaryUntil });
      summary = next;
      system = buildSystem(summary);
      budget = historyBudget(engine, system.length);
      const messages = keepRecent(kept, budget);
      return { system, messages: plain(messages), dropped: kept.length - messages.length, summarized: true };
    } catch {
      // Sem resumo: segue omitindo as mais antigas.
    }
  }
  const messages = keepRecent(recent, budget);
  if (!messages.length) return { tooLarge: true };
  return { system, messages: plain(messages), dropped: recent.length - messages.length, summarized: false };
}

const plain = (list) => list.map(({ role, content }) => ({ role, content }));

const SUMMARY_SYSTEM = `Você resume conversas entre um usuário e a KIRA, assistente de cibersegurança, para servir de memória da própria conversa.
Escreva no idioma da conversa, em tópicos curtos, com no máximo 400 palavras. Preserve:
- objetivo do usuário e o contexto declarado (ambiente, sistemas, versões, escopo e autorização dos testes);
- decisões tomadas, conclusões e o que já foi respondido;
- comandos, configurações, nomes, valores e trechos de código essenciais para continuar;
- pendências e próximos passos combinados.
Não invente nada, não comente a conversa e não responda às mensagens: devolva só o resumo.`;

const clip = (text, max) => (text.length > max ? `${text.slice(0, max / 2)}\n[…]\n${text.slice(-max / 2)}` : text);

// Gera o resumo com o próprio modelo da conversa.
export async function summarizeWith(engine, previous, messages, signal) {
  const transcript = messages.map((m) => `${m.role === "user" ? "Usuário" : "KIRA"}: ${clip(m.content, 6000)}`).join("\n\n");
  const room = Math.max(8000, historyBudget(engine, SUMMARY_SYSTEM.length) - 4000);
  const input = clip(`${previous ? `Resumo anterior:\n${previous}\n\n` : ""}Mensagens para incluir no resumo:\n\n${transcript}`, room);
  let out = "";
  const timeout = AbortSignal.timeout(90_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  for await (const event of engine.stream({ system: SUMMARY_SYSTEM, messages: [{ role: "user", content: input }], signal: combined })) {
    if (event.type === "text") out += event.text;
  }
  out = out.trim();
  if (!out) throw new Error("resumo vazio");
  return out.slice(0, 12_000);
}
