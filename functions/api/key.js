import { CLAUDE, FREE, describeAnthropicError, isAnthropicKey, verifyAnthropicKey } from "../_lib/providers.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// GET: informa qual modelo está ativo sem chave do usuário.
export function onRequestGet({ env }) {
  const server = Boolean(env.ANTHROPIC_API_KEY);
  return json({ default: server ? CLAUDE.label : FREE.label, claude: CLAUDE.label });
}

// POST: valida a chave colada pelo usuário antes de salvá-la no navegador.
export async function onRequestPost({ request }) {
  const key = (request.headers.get("x-api-key") || "").trim();
  if (!isAnthropicKey(key)) {
    return json({ ok: false, error: "A chave deve começar com sk-ant- (crie uma em console.anthropic.com)." }, 400);
  }
  try {
    await verifyAnthropicKey(key);
    return json({ ok: true, model: CLAUDE.label });
  } catch (err) {
    return json({ ok: false, error: describeAnthropicError(err) }, 400);
  }
}
