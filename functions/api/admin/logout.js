import { clearSessionCookie } from "../../_lib/admin-auth.js";
import { json } from "../../_lib/http.js";

export function onRequestPost() {
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
}
