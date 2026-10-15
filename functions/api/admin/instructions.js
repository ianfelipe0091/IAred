import { hasStorage, loadPromptConfig, modelsView, savePromptConfig } from "../../_lib/config.js";
import { json, readJson } from "../../_lib/http.js";
import { promptParts } from "../../_lib/prompt.js";

// Sem limite de caracteres: o único teto é o de armazenamento do KV (25 MiB por valor, somando todos os textos).
const STORAGE_LIMIT_BYTES = 24 * 1024 * 1024;

const noStorage = () => json({ error: 'Falta o armazenamento do painel (KV "CONFIG").' }, 503);

const entryView = (entry) => ({ instructions: entry?.text || "", updatedAt: entry?.updatedAt || null });

// Um texto para "todos os modelos" e um texto próprio para cada modelo, independentes entre si.
async function view(env, config) {
  const { models } = await modelsView(env);
  return {
    all: entryView(config.all),
    models: models.map((m) => ({ id: m.id, label: m.label || m.model, ...entryView(config.models[m.id]) })),
    // Partes do prompt para o painel montar o preview ao vivo (parte fixa + onde as instruções entram).
    parts: promptParts(),
  };
}

export async function onRequestGet({ env }) {
  if (!hasStorage(env)) return noStorage();
  return json(await view(env, await loadPromptConfig(env)));
}

// PUT { scope: "all" | id do modelo, instructions }: salva só o texto desse escopo. Em branco, apaga esse texto.
export async function onRequestPut({ request, env }) {
  if (!hasStorage(env)) return noStorage();
  const body = (await readJson(request)) || {};
  const scope = String(body.scope || "");
  const { models } = await modelsView(env);
  if (scope !== "all" && !models.some((m) => m.id === scope)) {
    return json({ error: "Modelo não encontrado. Recarregue a página." }, 400);
  }
  const instructions = String(body.instructions ?? "").replace(/\r\n/g, "\n").trim();

  const config = await loadPromptConfig(env);
  const entry = instructions ? { text: instructions, updatedAt: new Date().toISOString() } : null;
  if (scope === "all") config.all = entry;
  else if (entry) config.models[scope] = entry;
  else delete config.models[scope];

  if (new TextEncoder().encode(JSON.stringify(config)).length > STORAGE_LIMIT_BYTES) {
    return json({ error: "As instruções passam do limite de armazenamento (24 MB no total)." }, 400);
  }
  await savePromptConfig(env, config);
  return json(await view(env, config));
}
