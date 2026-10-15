import { ConfigError, detectProvider } from "../../_lib/detect.js";
import { json, readJson } from "../../_lib/http.js";

// POST: reconhece o provedor pela URL e pelo token e lista os modelos disponíveis.
export async function onRequestPost({ request }) {
  const body = (await readJson(request)) || {};
  try {
    const { provider, format, formatLabel, baseURL, models, suggested, warning } = await detectProvider({
      url: body.url,
      token: body.token,
      format: body.format,
    });
    return json({ provider, format, formatLabel, baseURL, models, suggested, warning });
  } catch (err) {
    if (err instanceof ConfigError) return json({ error: err.message }, 400);
    throw err;
  }
}
