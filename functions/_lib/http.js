export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

// Se ACCESS_CODE estiver configurado, a API exige o header x-access-code.
export function checkAccess(request, env) {
  const expected = env.ACCESS_CODE;
  if (!expected) return null;
  const given = request.headers.get("x-access-code") || "";
  if (!timingSafeEqual(given, String(expected))) {
    return json({ error: "Código de acesso inválido ou ausente.", code: "access_code" }, { status: 401 });
  }
  return null;
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] || 0) ^ (y[i] || 0);
  }
  return diff === 0;
}
