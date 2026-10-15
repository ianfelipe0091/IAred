// Conversas e personalização guardadas na conta (servidor do KIRA → banco).
import { apiHeaders } from "./auth.js";

async function call(path, method = "GET", body) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: await apiHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    // resposta sem JSON
  }
  if (!res.ok) {
    const err = new Error(data.error || `Erro HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Envia o histórico local em lotes de ~1,5 MB (o servidor aceita até 4 MB por vez).
// Devolve os ids que foram para a conta; o que faltar tenta de novo no próximo acesso.
async function importInBatches(chats) {
  const done = [];
  let imported = 0;
  let batch = [];
  let size = 0;
  const flush = async () => {
    if (!batch.length) return;
    const r = await call("conversations/import", "POST", { conversations: batch });
    imported += r.imported || 0;
    done.push(...batch.map((c) => c.id));
    batch = [];
    size = 0;
  };
  const pack = (chat) => ({
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messages: chat.messages.map(({ role, content, thinking, modelLabel, createdAt, error, stopped }) => ({
      role,
      content,
      thinking,
      modelLabel,
      createdAt,
      error,
      stopped,
    })),
  });
  try {
    for (const chat of chats) {
      const c = pack(chat);
      const bytes = JSON.stringify(c).length;
      if (bytes > 3_500_000) continue; // conversa grande demais: fica neste navegador
      if (size + bytes > 1_500_000) await flush();
      batch.push(c);
      size += bytes;
    }
    await flush();
  } catch (error) {
    return { imported, done, error };
  }
  return { imported, done };
}

export const cloud = {
  list: () => call("conversations").then((d) => d.conversations),
  load: (id) => call(`conversations/${id}`).then((d) => d.conversation),
  rename: (id, title) => call(`conversations/${id}`, "PATCH", { title }),
  remove: (id) => call(`conversations/${id}`, "DELETE"),
  removeAll: () => call("conversations", "DELETE"),
  importLocal: importInBatches,
  profile: () => call("profile").then((d) => d.profile),
  saveProfile: (profile) => call("profile", "PUT", profile).then((d) => d.profile),
};
