import Anthropic from "@anthropic-ai/sdk";

// Os dois provedores emitem os mesmos eventos para o frontend:
//   { type: "thinking", text }   trecho do raciocínio
//   { type: "text", text }       trecho da resposta
//   { type: "notice", text }     aviso curto
//   { type: "usage", input, output }

export const CLAUDE = {
  id: "claude",
  label: "Claude Opus 5.5",
  model: "claude-opus-5-5",
  maxTokens: 64000,
  contextTokens: 900000,
};

export const FREE = {
  id: "free",
  label: "IAHack Free",
  model: "@cf/nvidia/nemotron-3-120b-a12b",
  maxTokens: 16000,
  contextTokens: 200000,
};

export function isAnthropicKey(key) {
  return typeof key === "string" && /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim());
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
  yield* parseWorkersAIStream(stream);
}

async function* parseWorkersAIStream(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage = null;

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
        if (chunk.usage && (!usage || (chunk.usage.total_tokens || 0) >= (usage.total_tokens || 0))) {
          usage = chunk.usage;
        }
        const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : null;
        if (choice) {
          const delta = choice.delta || {};
          const reasoning = delta.reasoning_content ?? delta.reasoning;
          if (reasoning) yield { type: "thinking", text: reasoning };
          if (delta.content) yield { type: "text", text: delta.content };
        } else if (typeof chunk.response === "string" && chunk.response) {
          yield { type: "text", text: chunk.response };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (usage) {
    yield { type: "usage", input: usage.prompt_tokens || 0, output: usage.completion_tokens || 0 };
  }
}

export function describeWorkersAIError(err) {
  const msg = String(err?.message || err);
  if (/daily free allocation|neurons|4006/i.test(msg)) {
    return "A cota gratuita de hoje acabou. Conecte sua chave da API nas configurações para continuar.";
  }
  if (/context|too long|max.*tokens/i.test(msg)) {
    return "A conversa ficou longa demais. Inicie uma nova conversa.";
  }
  return `Falha no modelo gratuito: ${msg.slice(0, 300)}`;
}

// ---------- Anthropic (Claude) ----------

export async function* streamAnthropic(apiKey, { system, messages, signal }) {
  const client = new Anthropic({ apiKey });

  const stream = client.beta.messages.stream(
    {
      model: CLAUDE.model,
      max_tokens: CLAUDE.maxTokens,
      system,
      messages: toAnthropicMessages(messages),
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "high" },
      cache_control: { type: "ephemeral" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    },
    { signal },
  );

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

// A API exige alternância user/assistant começando por user; mescla vizinhos iguais.
function toAnthropicMessages(messages) {
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

export async function verifyAnthropicKey(apiKey) {
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  await client.models.retrieve(CLAUDE.model);
}

export function describeAnthropicError(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Chave da API inválida. Confira a chave nas configurações.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "Esta chave não tem permissão para usar o Claude Opus 5.5.";
  }
  if (err instanceof Anthropic.NotFoundError) {
    return "Modelo não disponível para esta chave.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Limite de uso da sua chave atingido. Aguarde alguns segundos e tente de novo.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(err.message)) {
      return "Sua conta da Anthropic está sem créditos. Adicione créditos no console da Anthropic.";
    }
    return `Requisição recusada: ${err.message}`;
  }
  if (err instanceof Anthropic.APIError) {
    return `Erro da API (${err.status ?? "rede"}): ${err.message}`;
  }
  return `Falha ao falar com o Claude: ${String(err?.message || err)}`;
}
