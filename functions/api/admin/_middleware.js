import { isAdmin } from "../../_lib/admin-auth.js";
import { json } from "../../_lib/http.js";

const OPEN = new Set(["/api/admin/session", "/api/admin/login"]);

// Protege as rotas do painel: só o próprio site pode alterar dados e só com sessão de admin.
export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (request.headers.get("origin") !== url.origin) {
      return json({ error: "Origem não permitida." }, 403);
    }
    if (!(request.headers.get("content-type") || "").startsWith("application/json")) {
      return json({ error: "Envie os dados em JSON." }, 415);
    }
  }
  if (!OPEN.has(url.pathname) && !(await isAdmin(request, env))) {
    return json({ error: "Sua sessão expirou. Entre de novo." }, 401);
  }
  const res = await next();
  const out = new Response(res.body, res);
  out.headers.set("cache-control", "no-store");
  out.headers.set("x-robots-tag", "noindex");
  return out;
}
