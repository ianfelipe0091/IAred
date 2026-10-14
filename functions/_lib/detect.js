import Anthropic from "@anthropic-ai/sdk";
import { ProviderError, describeAnthropicError, engineFromConfig, providerError } from "./providers.js";

// Reconhece o provedor a partir da URL e do token que o admin colou no painel.

export class ConfigError extends Error {}

const TIMEOUT_MS = 20_000;

// O host da URL (ou, sem URL, o prefixo do token) indica o provedor e o formato da API.
// A ordem importa para os prefixos: "sk-" genérico (OpenAI) fica por último.
const KNOWN = [
  { name: "Anthropic", format: "anthropic", host: /(^|\.)anthropic\.com$/, base: "https://api.anthropic.com", token: /^sk-ant-/ },
  { name: "OpenRouter", format: "openai", host: /(^|\.)openrouter\.ai$/, base: "https://openrouter.ai/api/v1", token: /^sk-or-/ },
  { name: "Groq", format: "openai", host: /(^|\.)groq\.com$/, base: "https://api.groq.com/openai/v1", token: /^gsk_/ },
  { name: "xAI", format: "openai", host: /(^|\.)x\.ai$/, base: "https://api.x.ai/v1", token: /^xai-/ },
  { name: "Perplexity", format: "openai", host: /(^|\.)perplexity\.ai$/, base: "https://api.perplexity.ai", token: /^pplx-/ },
  {
    name: "Google Gemini",
    format: "openai",
    host: /^generativelanguage\.googleapis\.com$/,
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    token: /^AIza/,
  },
  { name: "DeepSeek", format: "openai", host: /(^|\.)deepseek\.com$/, base: "https://api.deepseek.com/v1" },
  { name: "Mistral", format: "openai", host: /(^|\.)mistral\.ai$/, base: "https://api.mistral.ai/v1" },
  { name: "Together AI", format: "openai", host: /(^|\.)together\.(xyz|ai)$/, base: "https://api.together.xyz/v1" },
  { name: "Fireworks AI", format: "openai", host: /(^|\.)fireworks\.ai$/, base: "https://api.fireworks.ai/inference/v1" },
  { name: "Cerebras", format: "openai", host: /(^|\.)cerebras\.ai$/, base: "https://api.cerebras.ai/v1" },
  { name: "Maritaca AI", format: "openai", host: /(^|\.)maritaca\.ai$/, base: "https://chat.maritaca.ai/api" },
  { name: "OpenAI", format: "openai", host: /(^|\.)openai\.com$/, base: "https://api.openai.com/v1", token: /^sk-/ },
];

const FORMAT_LABEL = { anthropic: "API da Anthropic", openai: "compatível com OpenAI" };

// Modelos que aceitam o fallback automático do servidor em caso de recusa (só na API oficial).
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
const DEFAULT_CLAUDE = "claude-opus-5-5";

function parseURL(input) {
  let raw = String(input || "").trim();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError("URL inválida. Exemplo: https://api.openai.com/v1");
  }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new ConfigError("A URL da API precisa começar com https://");
  }
  if (url.username || url.password) {
    throw new ConfigError("Não coloque usuário ou senha na URL. Use o campo Token.");
  }
  // Aceita a URL do endpoint completo (…/chat/completions, …/messages) e guarda só a base.
  const path = url.pathname.replace(/\/+$/, "").replace(/\/(chat\/completions|completions|messages|models)$/i, "");
  return { host: url.hostname.toLowerCase(), origin: url.origin, path };
}

// Monta os candidatos (formato + URL base) a testar, do mais provável para o menos.
function candidates({ url, token, format }) {
  const parsed = parseURL(url);
  const known = parsed ? KNOWN.find((k) => k.host.test(parsed.host)) : KNOWN.find((k) => k.token?.test(token));
  if (!parsed && !known) {
    throw new ConfigError("Informe a URL da API: não deu para reconhecer o provedor só pelo token.");
  }
  const base = parsed ? (parsed.path || !known ? parsed.origin + parsed.path : known.base) : known.base;

  let formats;
  if (format === "anthropic" || format === "openai") formats = [format];
  else if (known) formats = [known.format];
  else if (/^sk-ant-/.test(token) || /anthropic/i.test(base)) formats = ["anthropic", "openai"];
  else formats = ["openai", "anthropic"];

  return formats.map((f) => ({
    format: f,
    provider: known?.name || "Personalizado",
    // O SDK da Anthropic acrescenta /v1 sozinho.
    baseURL: f === "anthropic" ? base.replace(/\/v1$/, "") : base,
  }));
}

async function listAnthropicModels(target, token) {
  const client = new Anthropic({ apiKey: token, baseURL: target.baseURL, maxRetries: 0, timeout: TIMEOUT_MS });
  const models = [];
  for await (const m of client.models.list({ limit: 100 })) {
    models.push({ id: m.id, name: m.display_name || m.id, context: m.max_input_tokens || null });
    if (models.length >= 300) break;
  }
  return models;
}

async function listOpenAIModels(target, token) {
  const res = await fetch(`${target.baseURL}/models`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw await providerError(res);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new ProviderError(res.status, "a URL respondeu, mas não parece ser uma API de IA");
  }
  const list = Array.isArray(data) ? data : data?.data || data?.models;
  if (!Array.isArray(list)) throw new ProviderError(res.status, "a URL respondeu, mas não parece ser uma API de IA");
  return list
    .filter((m) => m && typeof m.id === "string")
    .slice(0, 1000)
    .map((m) => ({ id: m.id, name: m.name || m.id, context: m.context_length || m.context_window || null }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

const statusOf = (err) => (err instanceof ProviderError || err instanceof Anthropic.APIError ? err.status : null);

// Descobre o formato da API e a lista de modelos. Lança ConfigError com uma mensagem para o admin.
export async function detectProvider({ url, token, format = "auto" }) {
  token = String(token || "").trim();
  if (!token) throw new ConfigError("Informe o token da IA.");

  const tries = candidates({ url, token, format });
  const failures = [];
  for (const target of tries) {
    try {
      const models = target.format === "anthropic" ? await listAnthropicModels(target, token) : await listOpenAIModels(target, token);
      return { ...target, formatLabel: FORMAT_LABEL[target.format], models, suggested: suggestModel(target, models) };
    } catch (err) {
      failures.push({ target, err });
    }
  }

  const auth = failures.find((f) => [401, 403].includes(statusOf(f.err)));
  if (auth) throw new ConfigError(`O provedor recusou o token (HTTP ${statusOf(auth.err)}). Confira o token e a URL.`);

  // Formato conhecido ou escolhido, mas sem lista de modelos: segue com o modelo digitado.
  const first = failures[0];
  if (tries.length === 1 && statusOf(first.err) === 404) {
    return {
      ...first.target,
      formatLabel: FORMAT_LABEL[first.target.format],
      models: [],
      suggested: "",
      warning: "O provedor não informou a lista de modelos. Digite o nome do modelo.",
    };
  }
  const detail = String(first.err?.message || first.err).slice(0, 200);
  throw new ConfigError(
    `Não consegui falar com a API nessa URL (${detail}). Confira a URL ou escolha o formato em "Avançado".`,
  );
}

function suggestModel(target, models) {
  if (target.format === "anthropic") {
    return models.find((m) => m.id === DEFAULT_CLAUDE)?.id || models[0]?.id || "";
  }
  return models.length === 1 ? models[0].id : "";
}

// Monta a configuração final do modelo escolhido (limites e recursos que ele aceita).
export async function buildConfig(detected, { token, model, label }) {
  const base = {
    provider: detected.provider,
    format: detected.format,
    baseURL: detected.baseURL,
    apiKey: token,
    model,
    updatedAt: new Date().toISOString(),
  };

  if (detected.format === "anthropic") {
    const profile = await anthropicProfile(detected, token, model);
    return { ...base, ...profile, label: label || profile.label };
  }

  const listed = detected.models.find((m) => m.id === model);
  return {
    ...base,
    label: label || listed?.name || model,
    contextTokens: listed?.context || 128000,
    maxOutput: 8192,
    options: {},
  };
}

async function anthropicProfile(detected, token, model) {
  const official = /(^|\.)anthropic\.com$/.test(new URL(detected.baseURL).hostname);
  const client = new Anthropic({ apiKey: token, baseURL: detected.baseURL, maxRetries: 0, timeout: TIMEOUT_MS });
  let info = null;
  try {
    info = await client.models.retrieve(model);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new ConfigError(describeAnthropicError(err));
    }
    if (official && err instanceof Anthropic.NotFoundError) {
      throw new ConfigError(`O modelo "${model}" não existe ou não está disponível para este token.`);
    }
    // Proxies sem a rota de modelos: segue com o mínimo que qualquer modelo aceita.
  }

  const caps = info?.capabilities || {};
  return {
    label: info?.display_name || model,
    contextTokens: info?.max_input_tokens || 200000,
    maxOutput: Math.min(info?.max_tokens || 16000, 64000),
    options: {
      thinking: caps.thinking?.types?.adaptive?.supported === true,
      effort: caps.effort?.supported === true && caps.effort?.high?.supported === true ? "high" : null,
      cache: official,
      fallbacks: official && FALLBACK_MODELS.has(model),
    },
  };
}

// Faz uma pergunta curta pelo mesmo caminho do chat e para no primeiro trecho da resposta.
export async function testConfig(config) {
  const engine = engineFromConfig(config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let answered = false;
  try {
    const events = engine.stream({
      system: "Você está sendo testado. Responda apenas: ok",
      messages: [{ role: "user", content: "Teste de conexão. Responda apenas: ok" }],
      signal: controller.signal,
    });
    for await (const event of events) {
      if (event.type === "text" || event.type === "thinking") {
        answered = true;
        break;
      }
    }
  } catch (err) {
    if (controller.signal.aborted) throw new ConfigError("O provedor demorou demais para responder ao teste.");
    throw new ConfigError(engine.describeError(err));
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  if (!answered) throw new ConfigError("O modelo não devolveu nenhuma resposta no teste.");
}

const originOf = (value) => {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`).origin;
  } catch {
    return null;
  }
};

// URL e token enviados pelo painel. Token vazio reaproveita o salvo, mas só para o mesmo endereço,
// para que uma sessão de admin não consiga mandar o token guardado para outro servidor.
export function credentials(body, saved) {
  const url = String(body?.url || "").trim();
  const token = String(body?.token || "").trim();
  if (token) return { url, token };
  if (!saved?.apiKey) throw new ConfigError("Informe o token da IA.");
  if (url && originOf(url) !== originOf(saved.baseURL)) {
    throw new ConfigError("Ao trocar a URL da API, informe o token de novo.");
  }
  return { url: url || saved.baseURL, token: saved.apiKey };
}
