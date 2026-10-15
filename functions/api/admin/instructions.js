import { deletePromptConfig, hasStorage, loadPromptConfig, modelsView, savePromptConfig } from "../../_lib/config.js";
import { json, readJson } from "../../_lib/http.js";
import { promptParts } from "../../_lib/prompt.js";

// Sem limite de caracteres: o único teto é o de armazenamento do KV (25 MiB por valor).
const STORAGE_LIMIT_BYTES = 24 * 1024 * 1024;

const noStorage = () => json({ error: 'Falta o armazenamento do painel (KV "CONFIG").' }, 503);

// Normaliza os alvos: "all" (todos os modelos) ou uma lista de ids de modelos.
function normalizeTargets(input, modelIds) {
  if (input === "all" || input === undefined || input === null) return "all";
  if (!Array.isArray(input)) return "all";
  const picked = input.filter((id) => modelIds.includes(id));
  return picked.length && picked.length < modelIds.length ? picked : "all";
}

async function view(env, config) {
  const { models } = await modelsView(env);
  const instructions = config?.instructions || "";
  return {
    instructions,
    targets: config?.targets || "all",
    updatedAt: config?.updatedAt || null,
    models: models.map((m) => ({ id: m.id, label: m.label || m.model })),
    // Partes do prompt para o painel montar o preview ao vivo (parte fixa + onde a instrução entra).
    parts: promptParts(),
  };
}

export async function onRequestGet({ env }) {
  if (!hasStorage(env)) return noStorage();
  return json(await view(env, await loadPromptConfig(env)));
}

// PUT: salva o texto e para quais modelos ele vale. Em branco, volta só ao prompt padrão.
export async function onRequestPut({ request, env }) {
  if (!hasStorage(env)) return noStorage();
  const body = (await readJson(request)) || {};
  const instructions = String(body.instructions ?? "").replace(/\r\n/g, "\n").trim();
  if (new TextEncoder().encode(instructions).length > STORAGE_LIMIT_BYTES) {
    return json({ error: "As instruções passam do limite de armazenamento (24 MB)." }, 400);
  }
  if (!instructions) {
    await deletePromptConfig(env);
    return json(await view(env, null));
  }
  const { models } = await modelsView(env);
  const targets = normalizeTargets(body.targets, models.map((m) => m.id));
  const config = { instructions, targets, updatedAt: new Date().toISOString() };
  await savePromptConfig(env, config);
  return json(await view(env, config));
}
