import {
  AuthConfigError,
  deleteAuthConfig,
  loadAuthConfig,
  saveAuthConfig,
  testAuthConfig,
  validateAuthConfig,
} from "../../_lib/auth.js";
import { hasStorage } from "../../_lib/config.js";
import { json, readJson } from "../../_lib/http.js";

const view = (config, extra = {}) => ({
  enabled: config.enabled,
  url: config.url,
  keyHint: config.anonKey ? `${config.anonKey.slice(0, 14)}…${config.anonKey.slice(-4)}` : "",
  ...extra,
});

// GET: situação do login dos usuários.
export async function onRequestGet({ env }) {
  return json(view(await loadAuthConfig(env)));
}

// PUT: valida a URL e a chave pública na própria Supabase e salva. O login passa a ser obrigatório.
export async function onRequestPut({ request, env }) {
  if (!hasStorage(env)) return json({ error: 'Falta o armazenamento do painel (KV "CONFIG").' }, 503);
  const body = (await readJson(request)) || {};
  try {
    const current = await loadAuthConfig(env);
    const config = validateAuthConfig({ url: body.url || current.url, anonKey: body.anonKey || current.anonKey });
    const settings = await testAuthConfig(config);
    await saveAuthConfig(env, config);
    return json(view({ ...config, enabled: true }, settings));
  } catch (err) {
    if (err instanceof AuthConfigError) return json({ error: err.message }, 400);
    throw err;
  }
}

// DELETE: desliga o login; o app volta a ficar aberto para qualquer visitante.
export async function onRequestDelete({ env }) {
  if (!hasStorage(env)) return json({ error: 'Falta o armazenamento do painel (KV "CONFIG").' }, 503);
  await deleteAuthConfig(env);
  return json(view(await loadAuthConfig(env)));
}
