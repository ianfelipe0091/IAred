import { hasStorage, loadModels } from "../../_lib/config.js";
import { ConfigError, credentials, detectProvider } from "../../_lib/detect.js";
import { json, readJson } from "../../_lib/http.js";

// POST: reconhece o provedor pela URL e pelo token e lista os modelos disponíveis.
// Ao editar um modelo (id), o token em branco reaproveita o salvo, só para o mesmo endereço.
export async function onRequestPost({ request, env }) {
  const body = (await readJson(request)) || {};
  try {
    const saved = body.id && hasStorage(env) ? (await loadModels(env)).list.find((m) => m.id === body.id) : null;
    const { url, token } = saved ? credentials(body, saved) : { url: body.url, token: body.token };
    const { provider, format, formatLabel, baseURL, models, suggested, warning } = await detectProvider({
      url,
      token,
      format: body.format,
    });
    return json({ provider, format, formatLabel, baseURL, models, suggested, warning });
  } catch (err) {
    if (err instanceof ConfigError) return json({ error: err.message }, 400);
    throw err;
  }
}
