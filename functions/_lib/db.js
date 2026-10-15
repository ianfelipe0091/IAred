// Histórico das conversas, personalização e uso no banco da Supabase (PostgREST).
// Toda chamada vai com o token do próprio usuário (o banco aplica as regras de cada linha)
// e com a chave do servidor no cabeçalho x-kira-server (sem ela o banco só deixa ler).

import { authenticate, loadAuthConfig } from "./auth.js";
import { json } from "./http.js";
import { SCHEMA_VERSION } from "./schema.js";

const KEY_NAME = "db-key";
let keyCache = null;

// Chave do servidor: secret KIRA_DB_KEY, se existir; senão uma chave aleatória guardada no KV.
// Só o painel cria a chave (create), para não haver duas gravações concorrentes.
export async function serverKey(env, { create = false } = {}) {
  if (env.KIRA_DB_KEY) return env.KIRA_DB_KEY;
  if (keyCache) return keyCache;
  if (!env.CONFIG) return null;
  let key = await env.CONFIG.get(KEY_NAME);
  if (!key && create) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    key = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    await env.CONFIG.put(KEY_NAME, key);
  }
  if (key) keyCache = key;
  return key || null;
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class DbError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const DB_UNAVAILABLE = "O banco de dados está indisponível no momento. Tente de novo em instantes.";

// ---------- Situação do banco ----------
// off: login desligado · missing: falta rodar o SQL · outdated: SQL antigo · key: chave do servidor não confere
// error: a Supabase não respondeu · ready: pronto para usar

let statusCache = null;

export async function dbStatus(env, { fresh = false } = {}) {
  const auth = await loadAuthConfig(env);
  if (!auth.enabled) return { state: "off" };
  const key = await serverKey(env);
  const id = `${auth.url}|${key || ""}`;
  if (!fresh && statusCache?.id === id && Date.now() < statusCache.until) return statusCache.value;
  let value;
  try {
    value = await probe(auth, key);
  } catch {
    value = { state: "error", message: "Não foi possível falar com a Supabase." };
  }
  statusCache = { id, until: Date.now() + (value.state === "ready" ? 300_000 : 15_000), value };
  return value;
}

async function probe(auth, key) {
  const headers = { apikey: auth.anonKey };
  const res = await fetch(`${auth.url}/rest/v1/kira_meta?select=key,value`, { headers, signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return { state: "missing" };
  if (!res.ok) return { state: "error", message: `A Supabase respondeu com erro (HTTP ${res.status}).` };
  const rows = await res.json();
  const version = Number(rows.find((r) => r.key === "schema")?.value || 0);
  if (version < SCHEMA_VERSION) return { state: "outdated", version };
  if (!key) return { state: "key", version };
  const check = await fetch(`${auth.url}/rest/v1/rpc/kira_is_server`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", "x-kira-server": key },
    body: "{}",
    signal: AbortSignal.timeout(10_000),
  });
  if (!check.ok || (await check.json()) !== true) return { state: "key", version };
  return { state: "ready", version };
}

// ---------- Cliente PostgREST ----------

export function dbFor(auth, token, key) {
  const base = `${auth.config.url}/rest/v1`;
  async function request(method, path, { body, prefer } = {}) {
    const headers = { apikey: auth.config.anonKey, authorization: `Bearer ${token}`, "x-kira-server": key };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (prefer) headers.prefer = prefer;
    let res;
    try {
      res = await fetch(`${base}/${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new DbError(0, DB_UNAVAILABLE);
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // corpo não é JSON
    }
    if (!res.ok) throw new DbError(res.status, data?.message || `HTTP ${res.status}`, data?.code);
    return data;
  }
  return {
    userId: auth.user.id,
    get: (path) => request("GET", path),
    post: (path, body, prefer = "return=representation") => request("POST", path, { body, prefer }),
    patch: (path, body) => request("PATCH", path, { body, prefer: "return=representation" }),
    del: (path) => request("DELETE", path, { prefer: "return=minimal" }),
  };
}

// ---------- Dados ----------

export const isUuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const MESSAGE_FIELDS = "id,role,content,thinking,model,status,meta,created_at";

export async function listConversations(db) {
  return (await db.get("kira_conversations?select=id,title,created_at,updated_at&order=updated_at.desc&limit=1000")) || [];
}

// Conversa com as mensagens em ordem (null se não existe ou é de outra pessoa).
export async function loadConversation(db, id) {
  if (!isUuid(id)) return null;
  const rows = await db.get(
    `kira_conversations?id=eq.${id}&select=id,title,summary,summary_until,created_at,updated_at,kira_messages(${MESSAGE_FIELDS})&kira_messages.order=created_at.asc`,
  );
  return rows?.[0] || null;
}

export async function createConversation(db, row) {
  return (await db.post("kira_conversations", row))[0];
}

export async function updateConversation(db, id, patch) {
  return (await db.patch(`kira_conversations?id=eq.${id}`, patch))?.[0] || null;
}

export const deleteConversation = (db, id) => db.del(`kira_conversations?id=eq.${id}`);
export const deleteAllConversations = (db) => db.del(`kira_conversations?user_id=eq.${db.userId}`);

// O PostgREST exige as mesmas colunas em todas as linhas de um lote.
const messageRow = (m) => ({
  id: m.id,
  conversation_id: m.conversation_id,
  role: m.role,
  content: m.content ?? "",
  thinking: m.thinking || null,
  model: m.model || null,
  status: m.status || "complete",
  meta: m.meta || {},
  ...(m.created_at ? { created_at: m.created_at } : {}),
});

export async function insertMessages(db, messages) {
  const rows = messages.map(messageRow);
  const withDate = rows.filter((r) => r.created_at);
  if (withDate.length && withDate.length !== rows.length) throw new Error("datas inconsistentes no lote");
  return db.post(`kira_messages?select=${MESSAGE_FIELDS}`, rows);
}

// Apaga a mensagem indicada e todas as seguintes (editar ou gerar de novo).
export const deleteMessagesFrom = (db, conversationId, createdAt) =>
  db.del(`kira_messages?conversation_id=eq.${conversationId}&created_at=gte.${encodeURIComponent(createdAt)}`);

// ---------- Perfil (personalização) ----------

const profiles = new Map();

export async function loadProfile(db) {
  const hit = profiles.get(db.userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const rows = await db.get("kira_profiles?select=display_name,about,updated_at");
  const value = rows?.[0] || null;
  if (profiles.size > 1000) profiles.clear();
  profiles.set(db.userId, { at: Date.now(), value });
  return value;
}

export async function saveProfile(db, { display_name, about }) {
  const rows = await db.post(
    "kira_profiles?on_conflict=user_id",
    { display_name, about, updated_at: new Date().toISOString() },
    "resolution=merge-duplicates,return=representation",
  );
  const value = rows?.[0] || null;
  profiles.set(db.userId, { at: Date.now(), value });
  return value;
}

// ---------- Uso e limites ----------

export async function recordUsage(db, kind = "message") {
  await db.post("kira_usage", { kind }, "return=minimal");
  // De vez em quando, apaga registros com mais de 2 dias (não contam para nenhum limite).
  if (Math.random() < 0.02) {
    const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
    db.del(`kira_usage?created_at=lt.${encodeURIComponent(old)}`).catch(() => {});
  }
}

// Confere os limites por hora e por dia. Devolve { ok } ou { ok: false, scope, limit, retryAt }.
export async function checkLimits(db, { perHour, perDay }, kind = "message") {
  const hour = Math.max(0, Number(perHour) || 0);
  const day = Math.max(0, Number(perDay) || 0);
  if (!hour && !day) return { ok: true };
  const windowMs = day ? 86_400_000 : 3_600_000;
  const since = new Date(Date.now() - windowMs).toISOString();
  const max = Math.max(hour, day);
  const rows =
    (await db.get(
      `kira_usage?select=created_at&kind=eq.${kind}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=${max}`,
    )) || [];
  const times = rows.map((r) => Date.parse(r.created_at));
  const hourAgo = Date.now() - 3_600_000;
  const inHour = times.filter((t) => t > hourAgo);
  if (hour && inHour.length >= hour) {
    return { ok: false, scope: "hour", limit: hour, retryAt: new Date(inHour[hour - 1] + 3_600_000).toISOString() };
  }
  if (day && times.length >= day) {
    return { ok: false, scope: "day", limit: day, retryAt: new Date(times[day - 1] + 86_400_000).toISOString() };
  }
  return { ok: true };
}

// Mensagem do banco no formato do app.
export function toClientMessage(m) {
  const meta = m.meta || {};
  return {
    id: m.id,
    role: m.role,
    content: m.content || "",
    thinking: m.thinking || "",
    thinkingMs: meta.thinkingMs || 0,
    modelLabel: m.model || "",
    notices: Array.isArray(meta.notices) ? meta.notices : [],
    error: meta.error || (m.status === "error" ? "Não foi possível gerar a resposta." : undefined),
    stopped: m.status === "stopped",
    createdAt: Date.parse(m.created_at),
  };
}

export function toClientConversation(c) {
  return { id: c.id, title: c.title, createdAt: Date.parse(c.created_at), updatedAt: Date.parse(c.updated_at) };
}

// ---------- Endpoints que só existem com o histórico no banco ----------

// Roda fn(db, auth) com o banco do usuário logado; responde 409 se o histórico na nuvem estiver desligado.
export async function withCloud(request, env, fn) {
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;
  if (!auth.user || (await dbStatus(env)).state !== "ready") {
    return json({ error: "O histórico na nuvem não está ativo. Recarregue a página.", cloud: false }, 409);
  }
  try {
    return await fn(dbFor(auth, auth.token, await serverKey(env)), auth);
  } catch (err) {
    if (err instanceof DbError) {
      return json({ error: err.status === 0 ? DB_UNAVAILABLE : `Erro no banco de dados: ${err.message}` }, err.status === 0 ? 503 : 502);
    }
    throw err;
  }
}
