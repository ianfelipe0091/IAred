// Configurações definidas no painel administrativo, guardadas no KV "CONFIG":
//   "models" lista de modelos { list: [ { id, provider, format, baseURL, apiKey, model, label, contextTokens, maxOutput, options } ], defaultId }
//   "prompt" instruções extras do admin { instructions, targets: "all" | [modelId], updatedAt }
//   "ai" / "free" formato antigo (IA principal / opção gratuita), migrados para "models" ao carregar.

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
const models = kvEntry("models");
const prompt = kvEntry("prompt");

export const hasStorage = (env) => Boolean(env.CONFIG);

export const saveModels = models.save;

export const loadPromptConfig = prompt.load;
export const savePromptConfig = prompt.save;
export const deletePromptConfig = prompt.remove;

// Campos de um modelo visíveis fora do servidor (sem baseURL interno além do provedor).
const MODEL_FIELDS = ["id", "provider", "format", "baseURL", "apiKey", "model", "label", "contextTokens", "maxOutput", "options"];

// id curto e estável a partir da URL + modelo, para a migração não trocar o id a cada carga.
function stableId(baseURL, model) {
  let h = 0x811c9dc5;
  for (const ch of `${baseURL}|${model}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return `m${(h >>> 0).toString(36)}`;
}

function toModel(cfg, id) {
  const out = { id: id || cfg.id || stableId(cfg.baseURL, cfg.model) };
  for (const k of MODEL_FIELDS) if (k !== "id" && cfg[k] !== undefined) out[k] = cfg[k];
  return out;
}

// Lista de modelos. Se "models" ainda não existe, monta a partir do formato antigo (ai + free da OpenRouter);
// a opção gratuita do Cloudflare não vira item (fica como reserva sem nome).
export async function loadModels(env) {
  const existing = await models.load(env);
  if (existing && Array.isArray(existing.list)) return existing;
  const [legacyAi, legacyFree] = await Promise.all([ai.load(env), free.load(env)]);
  const list = [];
  if (legacyAi?.model) list.push(toModel(legacyAi));
  if (legacyFree?.format) list.push(toModel({ ...legacyFree, label: legacyFree.label || "Modelo gratuito" }));
  return { list, defaultId: list[0]?.id || null };
}

export { stableId, toModel };

// Igual a loadModels, mas sem o token de cada modelo (para o painel).
export async function modelsView(env) {
  const { list, defaultId } = await loadModels(env);
  return { models: list.map(publicView), defaultId };
}

// O que o painel pode ver: nunca devolve o token inteiro.
export function publicView(config) {
  if (!config) return null;
  const { apiKey, ...rest } = config;
  return { ...rest, tokenHint: apiKey ? `••••${apiKey.slice(-4)}` : "" };
}
