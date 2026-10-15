import { requireUser } from "../_lib/auth.js";
import { json } from "../_lib/http.js";
import { generateTitle } from "../_lib/title.js";

// Gera um título curto para a conversa a partir da primeira mensagem (histórico só no navegador).
export async function onRequestPost({ request, env }) {
  if (await requireUser(request, env)) return json({ title: null }, 401);
  let text = "";
  try {
    text = String((await request.json()).text || "");
  } catch {
    return json({ title: null }, 400);
  }
  return json({ title: await generateTitle(env, text) });
}
