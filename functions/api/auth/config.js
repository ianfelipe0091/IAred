import { loadAuthConfig } from "../../_lib/auth.js";
import { json } from "../../_lib/http.js";

// GET: dados públicos que o navegador usa para o cadastro e o login (URL e chave publishable/anon).
export async function onRequestGet({ env }) {
  const { enabled, url, anonKey } = await loadAuthConfig(env);
  return json(enabled ? { enabled, url, anonKey } : { enabled: false });
}
