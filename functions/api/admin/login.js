import {
  checkCredentials,
  adminName,
  createSessionCookie,
  credentialsConfigured,
  recordFailure,
  tooManyAttempts,
} from "../../_lib/admin-auth.js";
import { hasStorage } from "../../_lib/config.js";
import { json, readJson } from "../../_lib/http.js";

export async function onRequestPost({ request, env }) {
  if (!credentialsConfigured(env) || !hasStorage(env)) {
    return json({ error: "O painel ainda não foi configurado no servidor." }, 503);
  }
  const ip = request.headers.get("cf-connecting-ip") || "local";
  if (await tooManyAttempts(env, ip)) {
    return json({ error: "Muitas tentativas erradas. Aguarde 15 minutos e tente de novo." }, 429);
  }
  const body = await readJson(request);
  if (!(await checkCredentials(env, body?.user, body?.password))) {
    await recordFailure(env, ip);
    return json({ error: "Usuário ou senha incorretos." }, 401);
  }
  return json({ ok: true, user: adminName(env) }, 200, { "set-cookie": await createSessionCookie(env) });
}
