import {
  checkPassword,
  createSessionCookie,
  passwordConfigured,
  recordFailure,
  tooManyAttempts,
} from "../../_lib/admin-auth.js";
import { hasStorage } from "../../_lib/config.js";
import { json, readJson } from "../../_lib/http.js";

export async function onRequestPost({ request, env }) {
  if (!passwordConfigured(env) || !hasStorage(env)) {
    return json({ error: "O painel ainda não foi configurado no servidor." }, 503);
  }
  const ip = request.headers.get("cf-connecting-ip") || "local";
  if (await tooManyAttempts(env, ip)) {
    return json({ error: "Muitas tentativas erradas. Aguarde 15 minutos e tente de novo." }, 429);
  }
  const body = await readJson(request);
  if (!(await checkPassword(env, body?.password))) {
    await recordFailure(env, ip);
    return json({ error: "Senha incorreta." }, 401);
  }
  return json({ ok: true }, 200, { "set-cookie": await createSessionCookie(env) });
}
