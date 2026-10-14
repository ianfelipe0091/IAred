import { deleteAIConfig, hasStorage, loadAIConfig, publicView, saveAIConfig } from "../../_lib/config.js";
import { ConfigError, buildConfig, credentials, detectProvider, testConfig } from "../../_lib/detect.js";
import { json, readJson } from "../../_lib/http.js";

const noStorage = () =>
  json({ error: 'Falta o armazenamento do painel (KV "CONFIG") no projeto da Cloudflare.' }, 503);

// GET: configuração atual (sem o token).
export async function onRequestGet({ env }) {
  if (!hasStorage(env)) return noStorage();
  return json({ config: publicView(await loadAIConfig(env)) });
}

// PUT: reconhece o provedor, testa uma resposta de verdade e só então salva.
export async function onRequestPut({ request, env }) {
  if (!hasStorage(env)) return noStorage();
  const body = (await readJson(request)) || {};
  try {
    const { url, token } = credentials(body, await loadAIConfig(env));
    const detected = await detectProvider({ url, token, format: body.format });
    const model = String(body.model || "").trim() || detected.suggested;
    if (!model) throw new ConfigError("Escolha o modelo que os usuários vão usar.");
    const label = String(body.label || "").trim().slice(0, 60);
    const config = await buildConfig(detected, { token, model, label });
    await testConfig(config);
    await saveAIConfig(env, config);
    return json({ config: publicView(config) });
  } catch (err) {
    if (err instanceof ConfigError) return json({ error: err.message }, 400);
    throw err;
  }
}

// DELETE: remove a configuração; os usuários voltam ao modelo gratuito.
export async function onRequestDelete({ env }) {
  if (!hasStorage(env)) return noStorage();
  await deleteAIConfig(env);
  return json({ config: null });
}
