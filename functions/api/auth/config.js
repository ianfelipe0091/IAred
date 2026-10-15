import { loadAuthConfig } from "../../_lib/auth.js";
import { dbStatus } from "../../_lib/db.js";
import { json } from "../../_lib/http.js";

// GET: dados públicos que o navegador usa para o cadastro e o login (URL e chave publishable/anon)
// e se o histórico fica na nuvem (banco pronto) ou só no navegador.
export async function onRequestGet({ env }) {
  const { enabled, url, anonKey } = await loadAuthConfig(env);
  if (!enabled) return json({ enabled: false, cloud: false });
  const cloud = (await dbStatus(env)).state === "ready";
  return json({ enabled, url, anonKey, cloud });
}
