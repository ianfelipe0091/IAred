import { loadProfile, saveProfile, withCloud } from "../_lib/db.js";
import { json, readJson } from "../_lib/http.js";

const view = (p, user) => ({ name: p?.display_name ?? user.name ?? "", about: p?.about || "" });

// GET: personalização do usuário (nome e o que a KIRA deve saber sobre ele).
export async function onRequestGet({ request, env }) {
  return withCloud(request, env, async (db, auth) => json({ profile: view(await loadProfile(db), auth.user) }));
}

// PUT { name, about }
export async function onRequestPut({ request, env }) {
  const body = (await readJson(request)) || {};
  const name = String(body.name ?? "").replace(/\s+/g, " ").trim();
  const about = String(body.about ?? "").replace(/\r\n/g, "\n").trim();
  if (name.length > 80) return json({ error: "Nome com no máximo 80 caracteres." }, 400);
  if (about.length > 4000) return json({ error: "O texto sobre você pode ter no máximo 4.000 caracteres." }, 400);
  return withCloud(request, env, async (db, auth) => json({ profile: view(await saveProfile(db, { display_name: name, about }), auth.user) }));
}
