import { json } from "../_lib/http.js";
import { FREE, resolveEngine } from "../_lib/providers.js";

// GET: informa aos usuários qual modelo de IA está ativo.
export async function onRequestGet({ env }) {
  const engine = await resolveEngine(env);
  return json({ label: engine?.label || FREE.label, free: !engine || engine.id === FREE.id });
}
