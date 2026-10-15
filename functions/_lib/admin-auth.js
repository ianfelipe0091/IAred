// Login do painel: usuário e senha nos secrets ADMIN_USER e ADMIN_PASSWORD,
// sessão em cookie assinado (HMAC).

const COOKIE = "kira_admin";
const SESSION_SECONDS = 8 * 60 * 60;
export const MIN_PASSWORD = 10;
const MAX_FAILS = 10;
const FAIL_WINDOW_SECONDS = 15 * 60;

const enc = new TextEncoder();

// O usuário não diferencia maiúsculas de minúsculas; a senha, sim.
const normalizeUser = (user) => String(user ?? "").trim().toLowerCase();

export const userConfigured = (env) => normalizeUser(env.ADMIN_USER) !== "";

export const adminName = (env) => normalizeUser(env.ADMIN_USER);

export const passwordConfigured = (env) =>
  typeof env.ADMIN_PASSWORD === "string" && env.ADMIN_PASSWORD.length >= MIN_PASSWORD;

export const credentialsConfigured = (env) => userConfigured(env) && passwordConfigured(env);

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromB64url = (text) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const digest = (text) => crypto.subtle.digest("SHA-256", enc.encode(text));

// A chave da sessão deriva do usuário e da senha: trocar qualquer um encerra todas as sessões.
const sessionKey = (env) =>
  crypto.subtle.importKey(
    "raw",
    enc.encode(`kira-admin:${normalizeUser(env.ADMIN_USER)}:${env.ADMIN_PASSWORD}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

// Compara os dois em tempo constante e sem revelar qual deles estava errado.
export async function checkCredentials(env, user, password) {
  const [givenUser, expectedUser, givenPass, expectedPass] = await Promise.all([
    digest(normalizeUser(user)),
    digest(normalizeUser(env.ADMIN_USER)),
    digest(String(password ?? "")),
    digest(env.ADMIN_PASSWORD),
  ]);
  const userOk = crypto.subtle.timingSafeEqual(givenUser, expectedUser);
  const passOk = crypto.subtle.timingSafeEqual(givenPass, expectedPass);
  return userOk && passOk;
}

const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/api/admin; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;

export async function createSessionCookie(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const sig = await crypto.subtle.sign("HMAC", await sessionKey(env), enc.encode(`session.${exp}`));
  return cookie(`${exp}.${b64url(sig)}`, SESSION_SECONDS);
}

export const clearSessionCookie = () => cookie("", 0);

function readCookie(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}

export async function isAdmin(request, env) {
  if (!credentialsConfigured(env)) return false;
  const match = /^(\d+)\.([A-Za-z0-9_-]+)$/.exec(readCookie(request, COOKIE));
  if (!match || Number(match[1]) < Date.now() / 1000) return false;
  try {
    return await crypto.subtle.verify("HMAC", await sessionKey(env), fromB64url(match[2]), enc.encode(`session.${match[1]}`));
  } catch {
    return false;
  }
}

// Limite de tentativas de login por IP (aproximado: o KV é eventualmente consistente).
const failKey = (ip) => `login-fail:${ip}`;

export async function tooManyAttempts(env, ip) {
  return (Number(await env.CONFIG.get(failKey(ip))) || 0) >= MAX_FAILS;
}

export async function recordFailure(env, ip) {
  const count = (Number(await env.CONFIG.get(failKey(ip))) || 0) + 1;
  await env.CONFIG.put(failKey(ip), String(count), { expirationTtl: FAIL_WINDOW_SECONDS });
}
