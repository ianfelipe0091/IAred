import { loadAuthConfig } from "../../_lib/auth.js";
import { hasStorage } from "../../_lib/config.js";
import { dbStatus, serverKey, sha256Hex } from "../../_lib/db.js";
import { json } from "../../_lib/http.js";
import { SCHEMA_VERSION, schemaSql } from "../../_lib/schema.js";

// Situação do banco de dados e o SQL para criar as tabelas (com o SHA-256 da chave do servidor).
async function view(env, fresh) {
  const auth = await loadAuthConfig(env);
  if (!auth.enabled) return { state: "off", schemaVersion: SCHEMA_VERSION };
  if (!hasStorage(env)) return { state: "error", message: 'Falta o armazenamento do painel (KV "CONFIG").', schemaVersion: SCHEMA_VERSION };
  const key = await serverKey(env, { create: true });
  const status = await dbStatus(env, { fresh });
  const ref = /^https:\/\/([a-z0-9-]+)\.supabase\.co$/.exec(auth.url)?.[1] || null;
  return {
    ...status,
    schemaVersion: SCHEMA_VERSION,
    url: auth.url,
    sqlEditorUrl: ref ? `https://supabase.com/dashboard/project/${ref}/sql/new` : null,
    sql: schemaSql(await sha256Hex(key)),
  };
}

export async function onRequestGet({ env }) {
  return json(await view(env, false));
}

// POST: confere de novo agora (depois de rodar o SQL).
export async function onRequestPost({ env }) {
  return json(await view(env, true));
}
