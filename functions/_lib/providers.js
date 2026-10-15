import Anthropic from "@anthropic-ai/sdk";
import { loadAIConfig } from "./config.js";

// Todos os provedores emitem os mesmos eventos para o frontend:
//   { type: "thinking", text }   trecho do raciocínio
//   { type: "text", text }       trecho da resposta
//   { type: "notice", text }     aviso curto
//   { type: "usage", input, output }

export const FREE = {
  id: "free",
  label: "KIRA Free",
  model: "@cf/nvidia/nemotron-3-120b-a12b",
  maxTokens: 16000,
  contextTokens: 200000,
};

// Chave padrão antiga (secret ANTHROPIC_API_KEY), usada quando o painel não tem configuração.
const LEGACY_CLAUDE = {
  provider: "Anthropic",
  format: "anthropic",
  model: "claude-opus-5-5",
  label: "Claude Opus 5.5",
  contextTokens: 900000,
  maxOutput: 64000,
  options: { thinking: true, effort: "high", cache: true, fallbacks: true },
};

// Modelos que o usuário pode escolher: a IA do painel (ou a chave padrão antiga) e o gratuito do Cloudflare.
export async function availableEngines(env) {
  const config = (await loadAIConfig(env)) || (env.ANTHROPIC_API_KEY ? { ...LEGACY_CLAUDE, apiKey: env.ANTHROPIC_API_KEY } : null);
  const engines = config ? [engineFromConfig(config)] : [];
  if (env.AI) {
    engines.push({
      ...FREE,
      stream: (args) => streamWorkersAI(env, args),
      describeError: describeWorkersAIError,
    });
  }
  return engines;
}

// Modelo da conversa: o gratuito se o usuário escolheu, senão a IA do painel.
export async function resolveEngine(env, choice) {
  const engines = await availableEngines(env);
  const free = engines.find((e) => e.id === FREE.id);
  const main = engines.find((e) => e.id !== FREE.id);
  return (choice === FREE.id ? free || main : main || free) || null;
}

export function engineFromConfig(config) {
  const anthropic = config.format === "anthropic";
  return {
    id: anthropic ? "claude" : "custom",
    label: config.label || config.model,
    contextTokens: config.contextTokens || 128000,
    maxTokens: config.maxOutput || 8192,
    stream: (args) => (anthropic ? streamAnthropic(config, args) : streamChatCompletions(config, args)),
    describeError: anthropic ? describeAnthropicError : describeHTTPError,
  };
}

// As APIs exigem alternância user/assistant começando por user; mescla vizinhos iguais.
function alternate(messages) {
  const out = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      last.content += `\n\n${m.content}`;
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

// ---------- Workers AI (modelo gratuito) ----------

export async function* streamWorkersAI(env, { system, messages, signal }) {
  const stream = await env.AI.run(
    FREE.model,
    {
      messages: [{ role: "system", content: system }, ...messages],
      stream: true,
      max_tokens: FREE.maxTokens,
    },
    { signal },
  );
  yield* parseChatCompletionsStream(stream);
}

export function describeWorkersAIError(err) {
  const msg = String(err?.message || err);
  if (/daily free allocation|neurons|4006/i.test(msg)) {
    return "A cota gratuita de hoje acabou. Tente novamente mais tarde.";
  }
  if (/context|too long|max.*tokens/i.test(msg)) {
    return "A conversa ficou longa demais. Inicie uma nova conversa.";
  }
  return `Falha no modelo gratuito: ${msg.slice(0, 300)}`;
}

// ---------- APIs no formato da OpenAI (Chat Completions) ----------

export class ProviderError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function providerError(res) {
  const text = await res.text().catch(() => "");
  let message = "";
  try {
    const data = JSON.parse(text);
    const body = Array.isArray(data) ? data[0] : data;
    message = body?.error?.message || body?.message || (typeof body?.error === "string" ? body.error : "");
  } catch {
    // corpo não é JSON
  }
  return new ProviderError(res.status, String(message || text || res.statusText).slice(0, 300));
}

export async function* streamChatCompletions(config, { system, messages, signal }) {
  const res = await fetch(`${config.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      messages: [{ role: "system", content: system }, ...alternate(messages)],
    }),
    signal,
  });
  if (!res.ok) throw await providerError(res);

  // Alguns provedores ignoram stream e devolvem a resposta inteira.
  if ((res.headers.get("content-type") || "").includes("application/json")) {
    const data = await res.json();
    const message = data?.choices?.[0]?.message || {};
    const reasoning = message.reasoning_content ?? message.reasoning;
    if (reasoning) yield { type: "thinking", text: reasoning };
    if (message.content) yield { type: "text", text: message.content };
    return;
  }
  if (!res.body) throw new ProviderError(res.status, "O provedor devolveu uma resposta vazia.");
  yield* parseChatCompletionsStream(res.body);
}

async function* parseChatCompletionsStream(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage = null;
  let finish = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) {
          throw new ProviderError(0, String(chunk.error.message || chunk.error).slice(0, 300));
        }
        if (chunk.usage && (!usage || (chunk.usage.total_tokens || 0) >= (usage.total_tokens || 0))) {
          usage = chunk.usage;
        }
        const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : null;
        if (choice) {
          const delta = choice.delta || {};
          const reasoning = delta.reasoning_content ?? delta.reasoning;
          if (reasoning) yield { type: "thinking", text: reasoning };
          if (delta.content) yield { type: "text", text: delta.content };
          if (choice.finish_reason) finish = choice.finish_reason;
        } else if (typeof chunk.response === "string" && chunk.response) {
          yield { type: "text", text: chunk.response };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (finish === "length") {
    yield { type: "notice", text: "A resposta atingiu o limite de tamanho. Peça para continuar." };
  } else if (finish === "content_filter") {
    yield { type: "notice", text: "O provedor bloqueou parte da resposta pelo filtro de conteúdo." };
  }
  if (usage) {
    yield { type: "usage", input: usage.prompt_tokens || 0, output: usage.completion_tokens || 0 };
  }
}

export function describeHTTPError(err) {
  if (!(err instanceof ProviderError)) {
    return `Não foi possível conectar à API de IA: ${String(err?.message || err).slice(0, 200)}`;
  }
  const detail = err.message ? `: ${err.message}` : ".";
  switch (true) {
    case err.status === 401 || err.status === 403:
      return `O provedor recusou o token da IA (HTTP ${err.status})${detail}`;
    case err.status === 402:
      return `A conta do provedor está sem créditos (HTTP 402)${detail}`;
    case err.status === 404:
      return `Modelo ou endereço não encontrado no provedor (HTTP 404)${detail}`;
    case err.status === 429:
      return "Limite de uso do provedor atingido. Aguarde alguns segundos e tente de novo.";
    case err.status >= 500:
      return `O provedor de IA está instável (HTTP ${err.status}). Tente de novo em instantes.`;
    case err.status === 0:
      return `O provedor interrompeu a resposta${detail}`;
    default:
      return `Requisição recusada pelo provedor (HTTP ${err.status})${detail}`;
  }
}

// ---------- Anthropic (Claude) ----------

export async function* streamAnthropic(config, { system, messages, signal }) {
  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseURL || undefined });
  const options = config.options || {};

  const params = {
    model: config.model,
    max_tokens: config.maxOutput || 16000,
    system,
    messages: alternate(messages),
  };
  if (options.thinking) params.thinking = { type: "adaptive", display: "summarized" };
  if (options.effort) params.output_config = { effort: options.effort };
  if (options.cache) params.cache_control = { type: "ephemeral" };
  if (options.fallbacks) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }

  const stream = client.beta.messages.stream(params, { signal });

  for await (const event of stream) {
    if (event.type === "content_block_delta") {
      if (event.delta.type === "thinking_delta" && event.delta.thinking) {
        yield { type: "thinking", text: event.delta.thinking };
      } else if (event.delta.type === "text_delta" && event.delta.text) {
        yield { type: "text", text: event.delta.text };
      }
    }
  }

  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    yield {
      type: "notice",
      text: "O modelo recusou esta solicitação. Reformule com mais contexto (objetivo defensivo, escopo e autorização).",
    };
  } else if (final.stop_reason === "max_tokens") {
    yield { type: "notice", text: "A resposta atingiu o limite de tamanho. Peça para continuar." };
  }
  yield {
    type: "usage",
    input:
      (final.usage.input_tokens || 0) +
      (final.usage.cache_read_input_tokens || 0) +
      (final.usage.cache_creation_input_tokens || 0),
    output: final.usage.output_tokens || 0,
  };
}

export function describeAnthropicError(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return "O token da IA foi recusado pela Anthropic (chave inválida).";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "O token da IA não tem permissão para usar este modelo.";
  }
  if (err instanceof Anthropic.NotFoundError) {
    return "Modelo não disponível para este token.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Limite de uso da API atingido. Aguarde alguns segundos e tente de novo.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(err.message)) {
      return "A conta da Anthropic está sem créditos. Adicione créditos no console da Anthropic.";
    }
    return `Requisição recusada: ${err.message}`;
  }
  if (err instanceof Anthropic.APIError) {
    return `Erro da API (${err.status ?? "rede"}): ${err.message}`;
  }
  return `Falha ao falar com o Claude: ${String(err?.message || err)}`;
}
