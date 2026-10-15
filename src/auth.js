// Cadastro e login dos usuários (Supabase Auth). Fica desligado se o admin não configurou.
import { AuthClient } from "@supabase/auth-js";

let client = null;

export async function initAuth() {
  try {
    const res = await fetch("/api/auth/config");
    const config = await res.json();
    if (!config.enabled) return null;
    // Mesmos cabeçalhos que o supabase-js usa, sem carregar banco, storage e realtime.
    client = {
      auth: new AuthClient({
        url: `${config.url}/auth/v1`,
        headers: { Authorization: `Bearer ${config.anonKey}`, apikey: config.anonKey },
        storageKey: "kira:auth",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      }),
    };
  } catch {
    client = null;
  }
  return client;
}

export const authClient = () => client;

export async function currentUser() {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.user ?? null;
}

// Cabeçalhos das chamadas à API, com o token de acesso quando há login.
export async function apiHeaders() {
  const headers = { "content-type": "application/json" };
  if (client) {
    const { data } = await client.auth.getSession();
    if (data.session) headers.authorization = `Bearer ${data.session.access_token}`;
  }
  return headers;
}

const MESSAGES = {
  invalid_credentials: "Email ou senha incorretos.",
  user_already_exists: "Este email já tem conta. Entre com a sua senha.",
  email_exists: "Este email já tem conta. Entre com a sua senha.",
  email_not_confirmed: "Confirme o seu email antes de entrar (veja a sua caixa de entrada).",
  weak_password: "Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.",
  signup_disabled: "Novos cadastros estão desativados no momento.",
  email_address_invalid: "Email inválido.",
  over_request_rate_limit: "Muitas tentativas. Aguarde um pouco e tente de novo.",
  over_email_send_rate_limit: "Muitos emails enviados. Aguarde um pouco e tente de novo.",
};

export function describeAuthError(error) {
  if (MESSAGES[error?.code]) return MESSAGES[error.code];
  if (/invalid login credentials/i.test(error?.message)) return MESSAGES.invalid_credentials;
  if (/already registered/i.test(error?.message)) return MESSAGES.user_already_exists;
  if (/password/i.test(error?.message) && /characters|weak/i.test(error?.message)) return MESSAGES.weak_password;
  if (/fetch|network/i.test(error?.message)) return "Sem conexão com o serviço de login. Tente de novo.";
  return error?.message || "Não foi possível entrar. Tente de novo.";
}
