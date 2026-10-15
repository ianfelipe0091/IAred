import { deleteFreeConfig, hasStorage, loadFreeConfig, publicView, saveFreeConfig } from "../../_lib/config.js";
import { ConfigError, OPENROUTER_URL, buildConfig, credentials, detectProvider, testConfig } from "../../_lib/detect.js";
import { json, readJson } from "../../_lib/http.js";
import { FREE } from "../../_lib/providers.js";

// Opção gratuita (KIRA Free): Workers AI do Cloudflare por padrão, ou um modelo da OpenRouter.

const noStorage = () => json({ error: 'Falta o armazenamento do painel (KV "CONFIG").' }, 503);

const view = (config) =>
  config
    ? { source: "openrouter", ...publicView(config) }
    : { source: "cloudflare", provider: FREE.provider, model: FREE.model };

const handle = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ConfigError) return json({ error: err.message }, 400);
    throw err;
  }
};

// GET: de onde vem a opção gratuita hoje.
export async function onRequestGet({ env }) {
  if (!hasStorage(env)) return noStorage();
  return json(view(await loadFreeConfig(env)));
}

// POST: confere a chave da OpenRouter e lista os modelos (gratuitos primeiro).
export async function onRequestPost({ request, env }) {
  if (!hasStorage(env)) return noStorage();
  const body = (await readJson(request)) || {};
  return handle(async () => {
    const { token } = credentials({ url: OPENROUTER_URL, token: body.token }, await loadFreeConfig(env));
    const { models, freeTier } = await detectProvider({ url: OPENROUTER_URL, token, format: "openai" });
    models.sort((a, b) => Number(Boolean(b.free)) - Number(Boolean(a.free)) || a.id.localeCompare(b.id));
    return json({ models, freeTier });
  });
}

// PUT: testa o modelo escolhido com uma pergunta curta e passa a usá-lo na opção gratuita.
export async function onRequestPut({ request, env }) {
  if (!hasStorage(env)) return noStorage();
  const body = (await readJson(request)) || {};
  return handle(async () => {
    const { token } = credentials({ url: OPENROUTER_URL, token: body.token }, await loadFreeConfig(env));
    const model = String(body.model || "").trim();
    if (!model) throw new ConfigError("Escolha o modelo da OpenRouter.");
    const detected = await detectProvider({ url: OPENROUTER_URL, token, format: "openai" });
    if (detected.models.length && !detected.models.some((m) => m.id === model)) {
      throw new ConfigError(`O modelo "${model}" não existe na OpenRouter. Escolha um da lista.`);
    }
    const config = await buildConfig(detected, { token, model, label: FREE.label });
    await testConfig(config);
    await saveFreeConfig(env, config);
    return json(view(config));
  });
}

// DELETE: volta a opção gratuita para o Workers AI do Cloudflare.
export async function onRequestDelete({ env }) {
  if (!hasStorage(env)) return noStorage();
  await deleteFreeConfig(env);
  return json(view(null));
}
