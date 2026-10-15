// Cadastro e login dos usuários pela Supabase Auth.
// A URL e a chave pública (publishable/anon) vêm do painel (KV) ou das variáveis do projeto.
// Sem chave configurada, o app fica aberto como antes.

import { json } from "./http.js";

const KEY = "auth";
const CACHE_MS = 15_000;
let cached = null;

export async function loadAuthConfig(env) {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    const saved = env.CONFIG ? await env.CONFIG.get(KEY, "json") : null;
    cached = { at: Date.now(), value: saved };
  }
  const url = cached.value?.url || env.SUPABASE_URL || "";
  const anonKey = cached.value?.anonKey || env.SUPABASE_ANON_KEY || "";
  return { enabled: Boolean(url && anonKey), url, anonKey };
}

export async function saveAuthConfig(env, value) {
  await env.CONFIG.put(KEY, JSON.stringify(value));
  cached = { at: Date.now(), value };
}

export async function deleteAuthConfig(env) {
  await env.CONFIG.delete(KEY);
  cached = { at: Date.now(), value: null };
}

export class AuthConfigError extends Error {}

// Aceita só o projeto da Supabase (https://<ref>.supabase.co) e só chaves públicas:
// a chave secreta daria acesso total ao banco para qualquer visitante.
export function validateAuthConfig({ url, anonKey }) {
  let parsed;
  try {
    parsed = new URL(String(url || "").trim());
  } catch {
    throw new AuthConfigError("URL inválida. Exemplo: https://abcdefgh.supabase.co");
  }
  if (parsed.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname)) {
    throw new AuthConfigError("Use a URL do projeto da Supabase, no formato https://<projeto>.supabase.co");
  }
  const key = String(anonKey || "").trim();
  if (!key) throw new AuthConfigError("Cole a chave pública (publishable ou anon) do projeto.");
  if (key.startsWith("sb_secret_") || jwtRole(key) === "service_role") {
    throw new AuthConfigError("Essa é a chave secreta. Use a chave pública (publishable ou anon), que pode ir para o navegador.");
  }
  return { url: parsed.origin, anonKey: key };
}

function jwtRole(token) {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))).role || null;
  } catch {
    return null;
  }
}

// Confere com a própria Supabase se a URL e a chave funcionam.
export async function testAuthConfig({ url, anonKey }) {
  let res;
  try {
    res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new AuthConfigError("Não foi possível falar com a Supabase nessa URL.");
  }
  if (res.status === 401 || res.status === 403) throw new AuthConfigError("A Supabase recusou essa chave.");
  if (!res.ok) throw new AuthConfigError(`A Supabase respondeu com erro (HTTP ${res.status}).`);
  const settings = await res.json().catch(() => ({}));
  return { signupEnabled: settings.disable_signup !== true, emailEnabled: settings.external?.email !== false };
}

// Valida o token de acesso do usuário. Respostas ficam em cache por pouco tempo
// para não consultar a Supabase a cada mensagem.
const USER_CACHE_MS = 60_000;
const users = new Map();

async function getUser(request, config) {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "");
  if (!match) return null;
  const token = match[1];
  const hit = users.get(token);
  if (hit && Date.now() - hit.at < USER_CACHE_MS) return hit.user;

  const res = await fetch(`${config.url}/auth/v1/user`, {
    headers: { apikey: config.anonKey, authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const user = { id: data.id, email: data.email };
  if (users.size > 1000) users.clear();
  users.set(token, { at: Date.now(), user });
  return user;
}

// Devolve uma resposta de erro se o login for obrigatório e o usuário não estiver logado.
export async function requireUser(request, env) {
  const config = await loadAuthConfig(env);
  if (!config.enabled) return null;
  try {
    if (await getUser(request, config)) return null;
  } catch {
    return json({ error: "O serviço de login está indisponível. Tente de novo em instantes." }, 503);
  }
  return json({ error: "Entre na sua conta para usar o KIRA.", auth: true }, 401);
}
