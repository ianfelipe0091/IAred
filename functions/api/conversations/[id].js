import { deleteConversation, isUuid, loadConversation, toClientConversation, toClientMessage, updateConversation, withCloud } from "../../_lib/db.js";
import { json, readJson } from "../../_lib/http.js";

const notFound = () => json({ error: "Conversa não encontrada.", gone: true }, 404);

// GET: a conversa com as mensagens.
export async function onRequestGet({ request, env, params }) {
  return withCloud(request, env, async (db) => {
    const c = await loadConversation(db, params.id);
    if (!c) return notFound();
    return json({ conversation: { ...toClientConversation(c), messages: (c.kira_messages || []).map(toClientMessage) } });
  });
}

// PATCH { title }: renomeia.
export async function onRequestPatch({ request, env, params }) {
  const body = (await readJson(request)) || {};
  const title = String(body.title || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!title) return json({ error: "Informe um nome." }, 400);
  if (!isUuid(params.id)) return notFound();
  return withCloud(request, env, async (db) => {
    const c = await updateConversation(db, params.id, { title });
    return c ? json({ conversation: toClientConversation(c) }) : notFound();
  });
}

// DELETE: apaga a conversa (e as mensagens, em cascata).
export async function onRequestDelete({ request, env, params }) {
  if (!isUuid(params.id)) return notFound();
  return withCloud(request, env, async (db) => {
    await deleteConversation(db, params.id);
    return json({ ok: true });
  });
}
