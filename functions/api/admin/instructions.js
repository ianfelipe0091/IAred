import { deletePromptConfig, hasStorage, loadPromptConfig, savePromptConfig } from "../../_lib/config.js";
import { json, readJson } from "../../_lib/http.js";
import { MAX_INSTRUCTIONS } from "../../_lib/prompt.js";

// Instruções extras que o admin dá ao modelo, enviadas em todas as conversas.

const noStorage = () => json({ error: 'Falta o armazenamento do painel (KV "CONFIG").' }, 503);
const view = (config) => ({ instructions: config?.instructions || "", updatedAt: config?.updatedAt || null, max: MAX_INSTRUCTIONS });

export async function onRequestGet({ env }) {
  if (!hasStorage(env)) return noStorage();
  return json(view(await loadPromptConfig(env)));
}

// PUT: salva o texto; em branco, volta a usar só o prompt padrão da KIRA.
export async function onRequestPut({ request, env }) {
  if (!hasStorage(env)) return noStorage();
  const instructions = String((await readJson(request))?.instructions ?? "").replace(/\r\n/g, "\n").trim();
  if (instructions.length > MAX_INSTRUCTIONS) {
    return json({ error: `As instruções passam do limite de ${MAX_INSTRUCTIONS.toLocaleString("pt-BR")} caracteres.` }, 400);
  }
  if (!instructions) {
    await deletePromptConfig(env);
    return json(view(null));
  }
  const config = { instructions, updatedAt: new Date().toISOString() };
  await savePromptConfig(env, config);
  return json(view(config));
}
