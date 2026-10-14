// Catálogo de modelos disponíveis no IAHack.
// Workers AI roda direto na conta Cloudflare (binding `AI`), sem chave extra.
// Os modelos Claude só aparecem quando o secret ANTHROPIC_API_KEY está configurado.

export const MODELS = [
  {
    id: "sentinel",
    label: "Sentinel 120B",
    vendor: "OpenAI gpt-oss-120b",
    provider: "workers-ai",
    model: "@cf/openai/gpt-oss-120b",
    description: "Raciocínio profundo. Ótimo para análise e arquitetura.",
    reasoning: true,
    effort: true,
    contextTokens: 128000,
    maxTokens: 8192,
  },
  {
    id: "nemotron",
    label: "Nemotron 120B",
    vendor: "NVIDIA Nemotron 3",
    provider: "workers-ai",
    model: "@cf/nvidia/nemotron-3-120b-a12b",
    description: "Pensa longamente antes de responder. Investigações complexas.",
    reasoning: true,
    contextTokens: 128000,
    maxTokens: 8192,
  },
  {
    id: "qwen",
    label: "Qwen 3.8 27B",
    vendor: "Alibaba Qwen",
    provider: "workers-ai",
    model: "@cf/qwen/qwen3.8-27b",
    description: "Equilíbrio entre velocidade e raciocínio.",
    reasoning: true,
    contextTokens: 128000,
    maxTokens: 8192,
  },
  {
    id: "llama",
    label: "Llama 3.3 70B",
    vendor: "Meta Llama",
    provider: "workers-ai",
    model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    description: "Rápido e direto. Respostas sem etapa de raciocínio.",
    reasoning: false,
    contextTokens: 24000,
    maxTokens: 4096,
  },
  {
    id: "gemma",
    label: "Gemma 4 26B",
    vendor: "Google Gemma",
    provider: "workers-ai",
    model: "@cf/google/gemma-4-26b-a4b-it",
    description: "Leve e veloz, contexto longo.",
    reasoning: true,
    contextTokens: 128000,
    maxTokens: 8192,
  },
  {
    id: "coder",
    label: "Qwen Coder 32B",
    vendor: "Alibaba Qwen 2.5 Coder",
    provider: "workers-ai",
    model: "@cf/qwen/qwen2.5-coder-32b-instruct",
    description: "Especialista em código: revisão segura e correções.",
    reasoning: false,
    contextTokens: 32000,
    maxTokens: 4096,
  },
  // Modelos que exigem o plano Workers Paid (habilite com CF_PAID_PLAN=true).
  {
    id: "deepseek",
    label: "DeepSeek V4 Pro",
    vendor: "DeepSeek",
    provider: "workers-ai",
    model: "@cf/deepseek-ai/deepseek-v4-pro-0813",
    description: "Modelo de fronteira com contexto de 1M tokens.",
    reasoning: true,
    paid: true,
    contextTokens: 200000,
    maxTokens: 16384,
  },
  {
    id: "kimi",
    label: "Kimi K2.6",
    vendor: "Moonshot AI",
    provider: "workers-ai",
    model: "@cf/moonshotai/kimi-k2.6",
    description: "Raciocínio agêntico e código.",
    reasoning: true,
    paid: true,
    contextTokens: 200000,
    maxTokens: 16384,
  },
  {
    id: "glm",
    label: "GLM 5.3",
    vendor: "Z.ai",
    provider: "workers-ai",
    model: "@cf/zai-org/glm-5.3",
    description: "Modelo grande, forte em análise técnica.",
    reasoning: true,
    paid: true,
    contextTokens: 200000,
    maxTokens: 16384,
  },
  // Claude (Anthropic) — requer o secret ANTHROPIC_API_KEY.
  {
    id: "claude-opus",
    label: "Claude Opus 5.5",
    vendor: "Anthropic",
    provider: "anthropic",
    model: "claude-opus-5-5",
    description: "O mais capaz para trabalho técnico profundo.",
    reasoning: true,
    effort: true,
    fallbacks: true,
    contextTokens: 400000,
    maxTokens: 64000,
  },
  {
    id: "claude-sonnet",
    label: "Claude Sonnet 5.5",
    vendor: "Anthropic",
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    description: "Rápido e inteligente para o dia a dia.",
    reasoning: true,
    effort: true,
    fallbacks: true,
    contextTokens: 400000,
    maxTokens: 64000,
  },
  {
    id: "claude-haiku",
    label: "Claude Haiku 5.5",
    vendor: "Anthropic",
    provider: "anthropic",
    model: "claude-haiku-5-5",
    description: "Respostas instantâneas e econômicas.",
    reasoning: true,
    effort: true,
    contextTokens: 200000,
    maxTokens: 32000,
  },
];

export function availableModels(env) {
  const paid = String(env.CF_PAID_PLAN || "").toLowerCase() === "true";
  const claude = Boolean(env.ANTHROPIC_API_KEY);
  return MODELS.filter((m) => {
    if (m.provider === "anthropic") return claude;
    if (m.paid) return paid;
    return Boolean(env.AI);
  });
}

export function defaultModelId(env) {
  const list = availableModels(env);
  const preferred = env.DEFAULT_MODEL && list.find((m) => m.id === env.DEFAULT_MODEL);
  return (preferred || list[0] || MODELS[0]).id;
}

export function publicModel(m) {
  return {
    id: m.id,
    label: m.label,
    vendor: m.vendor,
    provider: m.provider,
    description: m.description,
    reasoning: m.reasoning,
    effort: Boolean(m.effort),
  };
}
