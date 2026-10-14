// Configuração da IA definida no painel administrativo, guardada no KV "CONFIG".
//   { provider, format, baseURL, apiKey, model, label, contextTokens, maxOutput, options, updatedAt }

const KEY = "ai";
const CACHE_MS = 15_000;
let cached = null;

export const hasStorage = (env) => Boolean(env.CONFIG);

export async function loadAIConfig(env) {
  if (!env.CONFIG) return null;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = await env.CONFIG.get(KEY, "json");
  cached = { at: Date.now(), value };
  return value;
}

export async function saveAIConfig(env, config) {
  await env.CONFIG.put(KEY, JSON.stringify(config));
  cached = { at: Date.now(), value: config };
}

export async function deleteAIConfig(env) {
  await env.CONFIG.delete(KEY);
  cached = { at: Date.now(), value: null };
}

// O que o painel pode ver: nunca devolve o token inteiro.
export function publicView(config) {
  if (!config) return null;
  const { apiKey, ...rest } = config;
  return { ...rest, tokenHint: apiKey ? `••••${apiKey.slice(-4)}` : "" };
}
