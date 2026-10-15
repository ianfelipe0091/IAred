import { deleteAllConversations, listConversations, toClientConversation, withCloud } from "../../_lib/db.js";
import { json } from "../../_lib/http.js";

// GET: conversas do usuário (sem as mensagens), da mais recente para a mais antiga.
export async function onRequestGet({ request, env }) {
  return withCloud(request, env, async (db) => json({ conversations: (await listConversations(db)).map(toClientConversation) }));
}

// DELETE: apaga todas as conversas do usuário.
export async function onRequestDelete({ request, env }) {
  return withCloud(request, env, async (db) => {
    await deleteAllConversations(db);
    return json({ ok: true });
  });
}
