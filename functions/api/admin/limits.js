import { hasStorage, loadLimits, saveLimits } from "../../_lib/config.js";
import { json, readJson } from "../../_lib/http.js";

const MAX = 100_000;

export async function onRequestGet({ env }) {
  return json(await loadLimits(env));
}

// PUT { perHour, perDay }: 0 = sem limite.
export async function onRequestPut({ request, env }) {
  if (!hasStorage(env)) return json({ error: 'Falta o armazenamento do painel (KV "CONFIG").' }, 503);
  const body = (await readJson(request)) || {};
  const clean = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= MAX ? n : null;
  };
  const perHour = clean(body.perHour);
  const perDay = clean(body.perDay);
  if (perHour === null || perDay === null) return json({ error: "Use números inteiros de 0 a 100.000 (0 = sem limite)." }, 400);
  if (perHour && perDay && perHour > perDay) return json({ error: "O limite por hora não pode passar o limite por dia." }, 400);
  const limits = { perHour, perDay };
  await saveLimits(env, limits);
  return json(limits);
}
