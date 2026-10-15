// Configurações definidas no painel administrativo, guardadas no KV "CONFIG":
//   "models" lista de modelos { list: [ { id, provider, format, baseURL, apiKey, model, label, contextTokens, maxOutput, options } ], defaultId }
//   "prompt" instruções do admin, um texto por escopo:
//            { all: { text, updatedAt }, models: { [modelId]: { text, updatedAt } } }
//            (o formato antigo { instructions, targets } é convertido ao carregar)
//   "limits" limites de mensagens por usuário { perHour, perDay } (0 = sem limite)
//   "db-key" chave do servidor para gravar no banco (o banco guarda só o SHA-256)
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
const limits = kvEntry("limits");

export const hasStorage = (env) => Boolean(env.CONFIG);

// Limites por usuário (só valem com o histórico no banco, onde o uso de cada conta é registrado).
export const DEFAULT_LIMITS = { perHour: 30, perDay: 150 };

export async function loadLimits(env) {
  return { ...DEFAULT_LIMITS, ...((await limits.load(env)) || {}) };
}

export const saveLimits = limits.save;

export const saveModels = models.save;

// Instruções do admin. "all" vale para todos os modelos; "models" guarda um texto próprio por modelo,
// separado do geral (escrever para um modelo nunca altera o texto de "todos os modelos").
function normalizePrompt(raw) {
  const out = { all: null, models: {} };
  if (!raw) return out;
  // Formato antigo: um texto só + para quem vale.
  if (typeof raw.instructions === "string") {
    if (!raw.instructions.trim()) return out;
    const entry = { text: raw.instructions, updatedAt: raw.updatedAt || null };
    if (Array.isArray(raw.targets)) for (const id of raw.targets) out.models[id] = entry;
    else out.all = entry;
    return out;
  }
  if (raw.all?.text) out.all = raw.all;
  for (const [id, entry] of Object.entries(raw.models || {})) if (entry?.text) out.models[id] = entry;
  return out;
}

export async function loadPromptConfig(env) {
  return normalizePrompt(await prompt.load(env));
}

export async function savePromptConfig(env, config) {
  const clean = normalizePrompt(config);
  if (!clean.all && !Object.keys(clean.models).length) return prompt.remove(env);
  return prompt.save(env, clean);
}

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
