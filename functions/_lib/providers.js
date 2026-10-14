import Anthropic from "@anthropic-ai/sdk";

// Todos os provedores emitem os mesmos eventos para o frontend:
//   { type: "thinking", text }   trecho do raciocínio
//   { type: "text", text }       trecho da resposta
//   { type: "notice", text }     aviso curto (ex.: fallback de modelo)
//   { type: "usage", input, output }

const EFFORTS = new Set(["low", "medium", "high"]);

// ---------- Workers AI ----------

export async function* streamWorkersAI(env, spec, { system, messages, effort, signal }) {
  const input = {
    messages: [{ role: "system", content: system }, ...messages],
    stream: true,
    max_tokens: spec.maxTokens,
  };
  if (spec.effort && EFFORTS.has(effort)) input.reasoning_effort = effort;

  const stream = await env.AI.run(spec.model, input, { signal });
  yield* parseWorkersAIStream(stream);
}

export async function* parseWorkersAIStream(stream) {
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
          // Formato legado do Workers AI: { response: "..." }
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
  if (msg.includes("5035") || /not available on the Workers Free plan/i.test(msg)) {
    return "Este modelo exige o plano Workers Paid da Cloudflare. Escolha outro modelo.";
  }
  if (/daily free allocation|neurons|4006/i.test(msg)) {
    return "A cota diária gratuita do Workers AI acabou. Tente novamente amanhã ou faça upgrade do plano.";
  }
  if (/context|too long|max.*tokens/i.test(msg)) {
    return "A conversa ficou longa demais para este modelo. Inicie uma nova conversa ou escolha um modelo com mais contexto.";
  }
  return `Falha no Workers AI: ${msg.slice(0, 300)}`;
}

// ---------- Anthropic (Claude) ----------

export async function* streamAnthropic(env, spec, { system, messages, effort, signal }) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const params = {
    model: spec.model,
    max_tokens: spec.maxTokens,
    system,
    messages: toAnthropicMessages(messages),
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: EFFORTS.has(effort) ? effort : "medium" },
  };
  if (spec.fallbacks) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }

  const stream = client.beta.messages.stream(params, { signal });

  for await (const event of stream) {
    if (event.type === "content_block_start" && event.content_block.type === "fallback") {
      const to = event.content_block.to?.model || "outro modelo";
      yield { type: "notice", text: `Resposta continuada por ${to}.` };
    } else if (event.type === "content_block_delta") {
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
      text: "O modelo recusou esta solicitação por política de segurança. Reformule com mais contexto (escopo, autorização, objetivo defensivo).",
    };
  } else if (final.stop_reason === "max_tokens") {
    yield { type: "notice", text: "A resposta atingiu o limite de tamanho. Peça para continuar." };
  }
  yield {
    type: "usage",
    input: (final.usage.input_tokens || 0) + (final.usage.cache_read_input_tokens || 0),
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

export function describeAnthropicError(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Chave da Anthropic inválida. Verifique o secret ANTHROPIC_API_KEY.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Limite de requisições da Anthropic atingido. Aguarde alguns segundos e tente de novo.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `Requisição recusada pela Anthropic: ${err.message}`;
  }
  if (err instanceof Anthropic.APIError) {
    return `Erro da Anthropic (${err.status ?? "rede"}): ${err.message}`;
  }
  return `Falha ao falar com o Claude: ${String(err?.message || err)}`;
}
