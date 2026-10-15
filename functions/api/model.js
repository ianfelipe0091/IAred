import { json } from "../_lib/http.js";
import { availableEngines } from "../_lib/providers.js";

// GET: modelos que os usuários podem escolher (o primeiro é o padrão).
export async function onRequestGet({ env }) {
  const models = (await availableEngines(env)).map((e) => ({ id: e.id, label: e.label }));
  return json({ models });
}
