// Configurações definidas no painel administrativo, guardadas no KV "CONFIG":
//   "ai"   IA principal  { provider, format, baseURL, apiKey, model, label, contextTokens, maxOutput, options, updatedAt }
//   "free" opção gratuita via OpenRouter (mesmo formato); sem ela, a gratuita é o Workers AI.
//   "prompt" instruções extras do admin para o modelo { instructions, updatedAt }

const CACHE_MS = 15_000;

function kvEntry(key) {
  let cached = null;
  return {
    async load(env) {
      if (!env.CONFIG) return null;
      if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
      const value = await env.CONFIG.get(key, "json");
      cached = { at: Date.now(), value };
      return value;
    },
    async save(env, config) {
      await env.CONFIG.put(key, JSON.stringify(config));
      cached = { at: Date.now(), value: config };
    },
    async remove(env) {
      await env.CONFIG.delete(key);
      cached = { at: Date.now(), value: null };
    },
  };
}

const ai = kvEntry("ai");
const free = kvEntry("free");
const prompt = kvEntry("prompt");

export const hasStorage = (env) => Boolean(env.CONFIG);

export const loadAIConfig = ai.load;
export const saveAIConfig = ai.save;
export const deleteAIConfig = ai.remove;

export const loadFreeConfig = free.load;
export const saveFreeConfig = free.save;
export const deleteFreeConfig = free.remove;

export const loadPromptConfig = prompt.load;
export const savePromptConfig = prompt.save;
export const deletePromptConfig = prompt.remove;

// O que o painel pode ver: nunca devolve o token inteiro.
export function publicView(config) {
  if (!config) return null;
  const { apiKey, ...rest } = config;
  return { ...rest, tokenHint: apiKey ? `••••${apiKey.slice(-4)}` : "" };
}
