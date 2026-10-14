import { availableModels, defaultModelId, publicModel } from "../_lib/catalog.js";
import { AGENTS } from "../_lib/prompts.js";
import { json } from "../_lib/http.js";

export function onRequestGet({ env }) {
  return json({
    models: availableModels(env).map(publicModel),
    defaultModel: defaultModelId(env),
    agents: Object.entries(AGENTS).map(([id, a]) => ({ id, name: a.name })),
    requiresAccessCode: Boolean(env.ACCESS_CODE),
    claude: Boolean(env.ANTHROPIC_API_KEY),
  });
}
