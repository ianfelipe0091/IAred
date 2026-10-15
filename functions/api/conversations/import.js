import { checkLimits, isUuid, recordUsage, toClientConversation, withCloud } from "../../_lib/db.js";
import { json } from "../../_lib/http.js";

const MAX_BYTES = 4_000_000;
const MAX_CONVERSATIONS = 200;
const MAX_MESSAGES = 400;
const MAX_CHARS = 100_000;
const MAX_IMPORTS_PER_DAY = 10;

const iso = (ms, fallback) => {
  const n = Number(ms);
  const t = Number.isFinite(n) && n > 0 ? Math.min(n, Date.now()) : fallback;
  return new Date(t).toISOString();
};
const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

// POST { conversations }: leva para a conta as conversas que estavam só neste navegador.
// As respostas importadas ficam marcadas: o servidor não as gerou, então nunca voltam ao modelo como fala da IA.
export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return json({ error: "Histórico grande demais para importar de uma vez." }, 413);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }
  const input = Array.isArray(body?.conversations) ? body.conversations.slice(0, MAX_CONVERSATIONS) : [];
  if (!input.length) return json({ imported: 0, conversations: [] });

  return withCloud(request, env, async (db) => {
    const limit = await checkLimits(db, { perHour: 0, perDay: MAX_IMPORTS_PER_DAY }, "import");
    if (!limit.ok) return json({ error: "Muitas importações hoje. Tente amanhã." }, 429);

    const convs = [];
    const messagesByConv = new Map();
    for (const c of input) {
      const msgs = (Array.isArray(c?.messages) ? c.messages : [])
        .filter((m) => (m?.role === "user" || m?.role === "assistant") && (text(m.content, MAX_CHARS).trim() || m.error))
        .slice(0, MAX_MESSAGES);
      if (!msgs.length) continue;
      const id = isUuid(c.id) ? c.id.toLowerCase() : crypto.randomUUID();
      const created = iso(c.createdAt, Date.now());
      convs.push({ id, title: text(c.title, 120).trim() || "Conversa importada", created_at: created, updated_at: iso(c.updatedAt, Date.parse(created)) });
      let last = 0;
      messagesByConv.set(
        id,
        msgs.map((m) => {
          // Datas sempre crescentes, para manter a ordem.
          const t = Math.max(Date.parse(iso(m.createdAt, Date.parse(created))), last + 1);
          last = t;
          const status = m.stopped ? "stopped" : m.error && !String(m.content || "").trim() ? "error" : "complete";
          return {
            conversation_id: id,
            role: m.role,
            content: text(m.content, MAX_CHARS),
            thinking: text(m.thinking, MAX_CHARS) || null,
            model: text(m.modelLabel, 80) || null,
            status,
            meta: { imported: true, ...(m.error ? { error: text(m.error, 500) } : {}) },
            created_at: new Date(t).toISOString(),
          };
        }),
      );
    }
    if (!convs.length) return json({ imported: 0, conversations: [] });

    // Conversas que já estão na conta (importadas antes) são ignoradas.
    const inserted = (await db.post("kira_conversations", convs, "resolution=ignore-duplicates,return=representation")) || [];
    const rows = inserted.flatMap((c) => messagesByConv.get(c.id) || []);
    for (let i = 0; i < rows.length; i += 500) {
      await db.post("kira_messages", rows.slice(i, i + 500), "return=minimal");
    }
    await recordUsage(db, "import");
    return json({ imported: inserted.length, conversations: inserted.map(toClientConversation) });
  });
}
