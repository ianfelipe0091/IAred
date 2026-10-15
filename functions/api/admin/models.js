import { hasStorage, loadModels, modelsView, saveModels, toModel } from "../../_lib/config.js";
import { ConfigError, buildConfig, detectProvider, testConfig } from "../../_lib/detect.js";
import { json, readJson } from "../../_lib/http.js";

const noStorage = () => json({ error: 'Falta o armazenamento do painel (KV "CONFIG").' }, 503);

const handle = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ConfigError) return json({ error: err.message }, 400);
    throw err;
  }
};

// GET: lista de modelos (sem os tokens).
export async function onRequestGet({ env }) {
  if (!hasStorage(env)) return noStorage();
  return json(await modelsView(env));
}

// POST: reconhece o provedor, testa o modelo e adiciona à lista. O primeiro vira o padrão.
export async function onRequestPost({ request, env }) {
  if (!hasStorage(env)) return noStorage();
  const body = (await readJson(request)) || {};
  return handle(async () => {
    const token = String(body.token || "").trim();
    if (!token) throw new ConfigError("Informe o token da API.");
    const detected = await detectProvider({ url: body.url, token, format: body.format });
    const model = String(body.model || "").trim() || detected.suggested;
    if (!model) throw new ConfigError("Escolha o modelo.");
    const label = String(body.label || "").trim().slice(0, 60);
    const built = await buildConfig(detected, { token, model, label });
    await testConfig(built);

    const { list, defaultId } = await loadModels(env);
    const entry = toModel({ ...built, id: crypto.randomUUID().slice(0, 8) });
    list.push(entry);
    const next = { list, defaultId: defaultId || entry.id };
    await saveModels(env, next);
    return json(await modelsView(env));
  });
}

// PUT: define o modelo padrão (quem o usuário recebe primeiro).
export async function onRequestPut({ request, env }) {
  if (!hasStorage(env)) return noStorage();
  const body = (await readJson(request)) || {};
  return handle(async () => {
    const { list, defaultId } = await loadModels(env);
    if (!list.some((m) => m.id === body.defaultId)) throw new ConfigError("Modelo não encontrado.");
    if (body.defaultId !== defaultId) await saveModels(env, { list, defaultId: body.defaultId });
    return json(await modelsView(env));
  });
}

// DELETE: remove um modelo. Se era o padrão, o primeiro da lista assume.
export async function onRequestDelete({ request, env }) {
  if (!hasStorage(env)) return noStorage();
  const body = (await readJson(request)) || {};
  return handle(async () => {
    const { list, defaultId } = await loadModels(env);
    const next = list.filter((m) => m.id !== body.id);
    await saveModels(env, { list: next, defaultId: next.some((m) => m.id === defaultId) ? defaultId : next[0]?.id || null });
    return json(await modelsView(env));
  });
}
