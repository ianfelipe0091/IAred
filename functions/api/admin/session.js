import { MIN_PASSWORD, adminName, isAdmin, passwordConfigured, userConfigured } from "../../_lib/admin-auth.js";
import { hasStorage } from "../../_lib/config.js";
import { json } from "../../_lib/http.js";

// GET: diz ao painel se já está logado e se falta configurar algo no projeto.
export async function onRequestGet({ request, env }) {
  const authenticated = await isAdmin(request, env);
  return json({
    authenticated,
    ...(authenticated && { user: adminName(env) }),
    userSet: userConfigured(env),
    passwordSet: passwordConfigured(env),
    passwordTooShort: Boolean(env.ADMIN_PASSWORD) && !passwordConfigured(env),
    minPassword: MIN_PASSWORD,
    storage: hasStorage(env),
  });
}
