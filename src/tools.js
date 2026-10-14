// Kit de ferramentas: tudo roda localmente no navegador.
import { escapeHtml } from "./markdown.js";
import { icon } from "./icons.js";

const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// ---------- Hash ----------

export function md5(bytes) {
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
  const len = bytes.length;
  const padLen = (((len + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(padLen);
  buf.set(bytes);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(padLen - 8, (len * 8) >>> 0, true);
  dv.setUint32(padLen - 4, Math.floor((len * 8) / 2 ** 32), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < padLen; off += 64) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + dv.getUint32(off + g * 4, true)) >>> 0;
      A = D; D = C; C = B;
      const r = S[(i >> 4) * 4 + (i % 4)];
      B = (B + ((F << r) | (F >>> (32 - r)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((v, i) => out.setUint32(i * 4, v, true));
  return hex(new Uint8Array(out.buffer));
}

export async function hashAll(bytes) {
  const result = { MD5: md5(bytes) };
  for (const algo of ["SHA-1", "SHA-256", "SHA-384", "SHA-512"]) {
    result[algo] = hex(new Uint8Array(await crypto.subtle.digest(algo, bytes)));
  }
  return result;
}

export function identifyHash(value) {
  const v = value.trim();
  const hints = [];
  if (/^\$2[aby]\$\d{2}\$/.test(v)) hints.push("bcrypt");
  if (/^\$argon2(id|i|d)\$/.test(v)) hints.push("Argon2");
  if (/^\$6\$/.test(v)) hints.push("SHA-512 crypt (Linux /etc/shadow)");
  if (/^\$5\$/.test(v)) hints.push("SHA-256 crypt");
  if (/^\$1\$/.test(v)) hints.push("MD5 crypt");
  if (/^\$y\$/.test(v)) hints.push("yescrypt (Linux moderno)");
  if (/^pbkdf2_sha256\$/.test(v)) hints.push("PBKDF2-SHA256 (Django)");
  if (/^[a-f0-9]+$/i.test(v)) {
    const map = { 32: "MD5 ou NTLM", 40: "SHA-1", 56: "SHA-224", 64: "SHA-256", 96: "SHA-384", 128: "SHA-512" };
    if (map[v.length]) hints.push(map[v.length]);
  }
  return hints;
}

// ---------- Codificadores ----------

const b64encode = (s) => {
  let bin = "";
  enc.encode(s).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
};
const b64decode = (s) => {
  const clean = s.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  const padded = clean + "===".slice((clean.length + 3) % 4);
  const bin = atob(padded);
  return dec.decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export const CODECS = {
  base64: { label: "Base64", encode: b64encode, decode: b64decode },
  base64url: {
    label: "Base64URL",
    encode: (s) => b64encode(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    decode: b64decode,
  },
  url: { label: "URL", encode: (s) => encodeURIComponent(s), decode: (s) => decodeURIComponent(s.replace(/\+/g, " ")) },
  hex: {
    label: "Hex",
    encode: (s) => hex(enc.encode(s)),
    decode: (s) => {
      const clean = s.replace(/0x|\\x|[\s:,-]/gi, "");
      if (clean.length % 2 || /[^a-f0-9]/i.test(clean)) throw new Error("Hex inválido");
      return dec.decode(Uint8Array.from(clean.match(/../g) || [], (h) => parseInt(h, 16)));
    },
  },
  html: {
    label: "HTML",
    encode: (s) => escapeHtml(s),
    decode: (s) => {
      const doc = new DOMParser().parseFromString(`<!doctype html><body>${s}`, "text/html");
      return doc.body.textContent || "";
    },
  },
  rot13: {
    label: "ROT13",
    encode: (s) => s.replace(/[a-z]/gi, (c) => {
      const base = c <= "Z" ? 65 : 97;
      return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    }),
    decode: (s) => CODECS.rot13.encode(s),
  },
  binary: {
    label: "Binário",
    encode: (s) => Array.from(enc.encode(s), (b) => b.toString(2).padStart(8, "0")).join(" "),
    decode: (s) => {
      const bits = s.replace(/[^01]/g, "");
      if (bits.length % 8) throw new Error("Quantidade de bits não é múltipla de 8");
      return dec.decode(Uint8Array.from(bits.match(/.{8}/g) || [], (b) => parseInt(b, 2)));
    },
  },
};

// ---------- JWT ----------

export function decodeJwt(token) {
  const parts = token.trim().split(".");
  if (parts.length < 2) throw new Error("Um JWT tem 3 partes separadas por ponto.");
  const header = JSON.parse(b64decode(parts[0]));
  const payload = JSON.parse(b64decode(parts[1]));
  const findings = [];
  const alg = String(header.alg || "");
  if (!alg || alg.toLowerCase() === "none") {
    findings.push(["crit", "Algoritmo \"none\": o token não tem assinatura. Rejeite no servidor."]);
  } else if (/^HS/.test(alg)) {
    findings.push(["info", `${alg} (HMAC): exige segredo forte e longo (≥ 256 bits) e nunca compartilhado com clientes.`]);
  } else {
    findings.push(["ok", `${alg}: assinatura assimétrica. Fixe o algoritmo esperado na validação.`]);
  }
  if (!parts[2]) findings.push(["crit", "Assinatura vazia."]);
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp === undefined) findings.push(["warn", "Sem \"exp\": o token não expira."]);
  else if (payload.exp < now) findings.push(["warn", `Expirado em ${new Date(payload.exp * 1000).toLocaleString()}.`]);
  else findings.push(["ok", `Expira em ${new Date(payload.exp * 1000).toLocaleString()}.`]);
  if (payload.exp && payload.iat && payload.exp - payload.iat > 60 * 60 * 24 * 7) {
    findings.push(["warn", "Validade maior que 7 dias. Prefira tokens curtos com refresh."]);
  }
  if (payload.nbf && payload.nbf > now) findings.push(["info", "Ainda não válido (nbf no futuro)."]);
  if (!payload.aud) findings.push(["info", "Sem \"aud\": valide o público do token no servidor."]);
  if (header.jku || header.x5u) findings.push(["warn", "Cabeçalho com jku/x5u: nunca busque chaves de URLs controladas pelo token."]);
  if (header.kid && /[./\\'"]/.test(String(header.kid))) findings.push(["warn", "\"kid\" com caracteres suspeitos: valide contra uma lista fixa."]);
  const sensitive = Object.keys(payload).filter((k) => /pass|senha|secret|cpf|card|ssn/i.test(k));
  if (sensitive.length) findings.push(["crit", `Possíveis dados sensíveis no payload: ${sensitive.join(", ")}. JWT não é criptografado.`]);
  return { header, payload, findings };
}

// ---------- Senhas ----------

const SETS = {
  lower: "abcdefghijkmnopqrstuvwxyz",
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  digits: "23456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/",
};

export function generatePassword(length, opts) {
  const pools = Object.keys(SETS).filter((k) => opts[k]).map((k) => SETS[k]);
  if (!pools.length) return "";
  const all = pools.join("");
  const pick = (pool) => {
    const max = Math.floor(2 ** 32 / pool.length) * pool.length;
    const buf = new Uint32Array(1);
    do crypto.getRandomValues(buf); while (buf[0] >= max);
    return pool[buf[0] % pool.length];
  };
  const chars = pools.map(pick);
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.slice(0, length).join("");
}

const COMMON = ["123456", "password", "senha", "qwerty", "abc123", "admin", "letmein", "iloveyou", "111111", "brasil", "dragon", "monkey", "welcome", "000000"];

export function analyzePassword(pw) {
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  let bits = pw.length * Math.log2(pool || 1);
  const issues = [];
  if (pw.length < 12) issues.push("Menos de 12 caracteres.");
  if (/(.)\1{2,}/.test(pw)) { bits *= 0.8; issues.push("Caracteres repetidos em sequência."); }
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|qwer|asdf)/i.test(pw)) { bits *= 0.75; issues.push("Sequências previsíveis (1234, abcd, qwer…)."); }
  if (COMMON.some((w) => pw.toLowerCase().includes(w))) { bits *= 0.5; issues.push("Contém senha muito comum."); }
  if (/(19|20)\d{2}/.test(pw)) issues.push("Parece conter um ano.");
  const guessesPerSec = 1e11; // GPU offline contra hash rápido
  const seconds = 2 ** bits / 2 / guessesPerSec;
  const level = bits < 40 ? 0 : bits < 60 ? 1 : bits < 80 ? 2 : bits < 100 ? 3 : 4;
  return { bits: Math.round(bits), seconds, level, issues };
}

export function humanTime(seconds) {
  if (seconds < 1) return "instantâneo";
  const units = [["séculos", 3.15e9], ["anos", 3.15e7], ["dias", 86400], ["horas", 3600], ["minutos", 60], ["segundos", 1]];
  for (const [name, size] of units) {
    if (seconds >= size) {
      const v = seconds / size;
      if (name === "séculos" && v > 1e6) return "bilhões de anos+";
      return `${v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString("pt-BR")} ${name}`;
    }
  }
  return "instantâneo";
}

// ---------- CIDR ----------

const ipToInt = (ip) => {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) throw new Error("IPv4 inválido");
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
};
const intToIp = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");

export function cidrInfo(input) {
  const [ip, prefixRaw = "32"] = input.trim().split("/");
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new Error("Prefixo deve estar entre 0 e 32");
  const addr = ipToInt(ip);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (addr & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const total = 2 ** (32 - prefix);
  const usable = prefix >= 31 ? total : total - 2;
  const first = prefix >= 31 ? network : network + 1;
  const last = prefix >= 31 ? broadcast : broadcast - 1;
  const ranges = [
    ["10.0.0.0/8", "Privado (RFC 1918)"], ["172.16.0.0/12", "Privado (RFC 1918)"], ["192.168.0.0/16", "Privado (RFC 1918)"],
    ["127.0.0.0/8", "Loopback"], ["169.254.0.0/16", "Link-local"], ["100.64.0.0/10", "CGNAT (RFC 6598)"],
    ["224.0.0.0/4", "Multicast"], ["0.0.0.0/8", "Rede \"esta\""], ["240.0.0.0/4", "Reservado"],
  ];
  let kind = "Público";
  for (const [cidr, label] of ranges) {
    const [rip, rp] = cidr.split("/");
    const rmask = (0xffffffff << (32 - Number(rp))) >>> 0;
    if (((addr & rmask) >>> 0) === ipToInt(rip)) { kind = label; break; }
  }
  return {
    "Rede": `${intToIp(network)}/${prefix}`,
    "Máscara": intToIp(mask),
    "Wildcard": intToIp(~mask >>> 0),
    "Broadcast": intToIp(broadcast),
    "Primeiro host": intToIp(first),
    "Último host": intToIp(last),
    "Hosts utilizáveis": usable.toLocaleString("pt-BR"),
    "Tipo": kind,
  };
}

// ---------- CVSS 3.1 ----------

export const CVSS_METRICS = [
  ["AV", "Vetor de ataque", [["N", "Rede"], ["A", "Adjacente"], ["L", "Local"], ["P", "Físico"]]],
  ["AC", "Complexidade", [["L", "Baixa"], ["H", "Alta"]]],
  ["PR", "Privilégios exigidos", [["N", "Nenhum"], ["L", "Baixos"], ["H", "Altos"]]],
  ["UI", "Interação do usuário", [["N", "Nenhuma"], ["R", "Requerida"]]],
  ["S", "Escopo", [["U", "Inalterado"], ["C", "Alterado"]]],
  ["C", "Confidencialidade", [["H", "Alta"], ["L", "Baixa"], ["N", "Nenhuma"]]],
  ["I", "Integridade", [["H", "Alta"], ["L", "Baixa"], ["N", "Nenhuma"]]],
  ["A", "Disponibilidade", [["H", "Alta"], ["L", "Baixa"], ["N", "Nenhuma"]]],
];

const roundUp = (x) => {
  const i = Math.round(x * 100000);
  return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10;
};

export function cvss31(m) {
  const AV = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[m.AV];
  const AC = { L: 0.77, H: 0.44 }[m.AC];
  const changed = m.S === "C";
  const PR = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[m.PR];
  const UI = { N: 0.85, R: 0.62 }[m.UI];
  const cia = { H: 0.56, L: 0.22, N: 0 };
  const iss = 1 - (1 - cia[m.C]) * (1 - cia[m.I]) * (1 - cia[m.A]);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  const exploitability = 8.22 * AV * AC * PR * UI;
  let score = 0;
  if (impact > 0) score = changed ? roundUp(Math.min(1.08 * (impact + exploitability), 10)) : roundUp(Math.min(impact + exploitability, 10));
  const severity = score === 0 ? "Nenhuma" : score < 4 ? "Baixa" : score < 7 ? "Média" : score < 9 ? "Alta" : "Crítica";
  const vector = `CVSS:3.1/${CVSS_METRICS.map(([k]) => `${k}:${m[k]}`).join("/")}`;
  return { score, severity, vector };
}

// ---------- UI ----------

export const TOOLS = [
  { id: "hash", label: "Hash", icon: "hash" },
  { id: "codec", label: "Codificador", icon: "code" },
  { id: "jwt", label: "JWT", icon: "token" },
  { id: "password", label: "Senhas", icon: "key" },
  { id: "cidr", label: "Sub-redes", icon: "network" },
  { id: "cvss", label: "CVSS 3.1", icon: "gauge" },
  { id: "time", label: "Timestamps", icon: "terminal" },
];

const copyBtn = (target) =>
  `<button class="mini-btn" data-copy="${target}" title="Copiar">${icon("copy")}</button>`;

const kv = (rows) =>
  `<div class="kv">${rows.map(([k, v, id]) => `<div class="kv-row"><span>${escapeHtml(k)}</span><code ${id ? `id="${id}"` : ""}>${escapeHtml(String(v))}</code>${id ? copyBtn(id) : ""}</div>`).join("")}</div>`;

export function mountTools({ tabs, body, onAsk }) {
  let current = "hash";
  tabs.innerHTML = TOOLS.map((t) => `<button class="tool-tab" data-tool="${t.id}">${icon(t.icon)}<span>${t.label}</span></button>`).join("");
  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tool]");
    if (btn) show(btn.dataset.tool);
  });
  body.addEventListener("click", (e) => {
    const c = e.target.closest("[data-copy]");
    if (c) {
      const el = body.querySelector(`#${c.dataset.copy}`);
      const text = el ? (el.value ?? el.textContent) : "";
      navigator.clipboard?.writeText(text);
      c.innerHTML = icon("check");
      setTimeout(() => (c.innerHTML = icon("copy")), 1200);
    }
    const ask = e.target.closest("[data-ask]");
    if (ask) onAsk(ask.dataset.ask === "jwt" ? jwtAskText() : cvssAskText());
  });

  let lastJwt = null;
  let lastCvss = null;
  const jwtAskText = () =>
    `Analise a segurança deste JWT (header e payload decodificados, sem a assinatura) e diga o que devo corrigir na emissão/validação:\n\n\`\`\`json\n${JSON.stringify({ header: lastJwt?.header, payload: lastJwt?.payload }, null, 2)}\n\`\`\``;
  const cvssAskText = () =>
    `Explique este vetor CVSS e como priorizar a correção: ${lastCvss?.vector} (nota ${lastCvss?.score}, ${lastCvss?.severity}).`;

  function show(id) {
    current = id;
    tabs.querySelectorAll(".tool-tab").forEach((b) => b.classList.toggle("active", b.dataset.tool === id));
    RENDER[id]();
  }

  const RENDER = {
    hash() {
      body.innerHTML = `
        <h3>Gerador e identificador de hash</h3>
        <textarea id="h-in" rows="4" placeholder="Digite um texto ou cole um hash para identificar"></textarea>
        <div class="row"><label class="btn ghost small">${icon("file")}Calcular de arquivo<input type="file" id="h-file" hidden></label><span class="muted" id="h-meta"></span></div>
        <div id="h-id"></div>
        <div id="h-out"></div>`;
      const input = body.querySelector("#h-in");
      const run = async (bytes, meta = "") => {
        const res = await hashAll(bytes);
        body.querySelector("#h-meta").textContent = meta;
        body.querySelector("#h-out").innerHTML = kv(Object.entries(res).map(([k, v], i) => [k, v, `h-${i}`]));
      };
      input.addEventListener("input", () => {
        const hints = identifyHash(input.value);
        body.querySelector("#h-id").innerHTML = hints.length
          ? `<div class="callout">${icon("search")}<span>Possível formato: <b>${hints.map(escapeHtml).join(" · ")}</b></span></div>`
          : "";
        run(enc.encode(input.value));
      });
      body.querySelector("#h-file").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        run(new Uint8Array(await file.arrayBuffer()), `${file.name} · ${(file.size / 1024).toFixed(1)} KB`);
      });
      run(enc.encode(""));
    },

    codec() {
      body.innerHTML = `
        <h3>Codificar e decodificar</h3>
        <div class="seg" id="c-mode">${Object.entries(CODECS).map(([k, c], i) => `<button data-codec="${k}" class="${i === 0 ? "active" : ""}">${c.label}</button>`).join("")}</div>
        <textarea id="c-in" rows="5" placeholder="Entrada"></textarea>
        <div class="row"><button class="btn primary small" id="c-enc">Codificar ↓</button><button class="btn ghost small" id="c-dec">Decodificar ↓</button><button class="btn ghost small" id="c-swap">Trocar ↑</button></div>
        <div class="out-wrap"><textarea id="c-out" rows="5" readonly placeholder="Saída"></textarea>${copyBtn("c-out")}</div>
        <p class="muted" id="c-err"></p>`;
      let codec = "base64";
      body.querySelector("#c-mode").addEventListener("click", (e) => {
        const b = e.target.closest("[data-codec]");
        if (!b) return;
        codec = b.dataset.codec;
        body.querySelectorAll("#c-mode button").forEach((x) => x.classList.toggle("active", x === b));
      });
      const go = (dir) => {
        const err = body.querySelector("#c-err");
        err.textContent = "";
        try {
          body.querySelector("#c-out").value = CODECS[codec][dir](body.querySelector("#c-in").value);
        } catch (e) {
          err.textContent = `Não foi possível ${dir === "encode" ? "codificar" : "decodificar"}: ${e.message}`;
        }
      };
      body.querySelector("#c-enc").onclick = () => go("encode");
      body.querySelector("#c-dec").onclick = () => go("decode");
      body.querySelector("#c-swap").onclick = () => {
        body.querySelector("#c-in").value = body.querySelector("#c-out").value;
        body.querySelector("#c-out").value = "";
      };
    },

    jwt() {
      body.innerHTML = `
        <h3>Inspetor de JWT</h3>
        <textarea id="j-in" rows="4" placeholder="Cole um token JWT (header.payload.assinatura)" spellcheck="false"></textarea>
        <div id="j-out"></div>`;
      const input = body.querySelector("#j-in");
      input.addEventListener("input", () => {
        const out = body.querySelector("#j-out");
        if (!input.value.trim()) return (out.innerHTML = "");
        try {
          lastJwt = decodeJwt(input.value);
          out.innerHTML = `
            <div class="grid-2">
              <div><h4>Header</h4><pre class="json">${escapeHtml(JSON.stringify(lastJwt.header, null, 2))}</pre></div>
              <div><h4>Payload</h4><pre class="json">${escapeHtml(JSON.stringify(lastJwt.payload, null, 2))}</pre></div>
            </div>
            <h4>Análise</h4>
            <ul class="findings">${lastJwt.findings.map(([lvl, t]) => `<li class="f-${lvl}">${escapeHtml(t)}</li>`).join("")}</ul>
            <button class="btn ghost small" data-ask="jwt">${icon("sparkle")}Pedir análise à IA</button>`;
        } catch (e) {
          out.innerHTML = `<p class="muted">Token inválido: ${escapeHtml(e.message)}</p>`;
        }
      });
    },

    password() {
      body.innerHTML = `
        <h3>Gerador e analisador de senhas</h3>
        <div class="row wrap">
          <label class="range">Tamanho <input type="range" id="p-len" min="8" max="64" value="20"><b id="p-len-v">20</b></label>
          ${Object.keys(SETS).map((k) => `<label class="check"><input type="checkbox" data-set="${k}" checked>${{ lower: "a-z", upper: "A-Z", digits: "0-9", symbols: "!@#" }[k]}</label>`).join("")}
        </div>
        <div class="out-wrap"><input id="p-out" class="mono big" readonly>${copyBtn("p-out")}</div>
        <div class="row"><button class="btn primary small" id="p-gen">${icon("refresh")}Gerar nova</button></div>
        <h4>Analisar uma senha</h4>
        <input id="p-test" type="text" class="mono" placeholder="Digite para analisar (não sai do navegador)" autocomplete="off" spellcheck="false">
        <div id="p-res"></div>`;
      const gen = () => {
        const opts = {};
        body.querySelectorAll("[data-set]").forEach((c) => (opts[c.dataset.set] = c.checked));
        const len = Number(body.querySelector("#p-len").value);
        body.querySelector("#p-len-v").textContent = len;
        const pw = generatePassword(len, opts);
        body.querySelector("#p-out").value = pw;
        analyze(pw);
      };
      const analyze = (pw) => {
        const res = body.querySelector("#p-res");
        if (!pw) return (res.innerHTML = "");
        const a = analyzePassword(pw);
        const labels = ["Muito fraca", "Fraca", "Razoável", "Forte", "Excelente"];
        res.innerHTML = `
          <div class="meter l${a.level}"><span style="width:${(a.level + 1) * 20}%"></span></div>
          ${kv([["Força", labels[a.level]], ["Entropia estimada", `${a.bits} bits`], ["Tempo p/ quebrar (offline, GPU)", humanTime(a.seconds)]])}
          ${a.issues.length ? `<ul class="findings">${a.issues.map((i) => `<li class="f-warn">${escapeHtml(i)}</li>`).join("")}</ul>` : ""}`;
      };
      body.querySelector("#p-gen").onclick = gen;
      body.querySelector("#p-len").oninput = gen;
      body.querySelectorAll("[data-set]").forEach((c) => (c.onchange = gen));
      body.querySelector("#p-test").oninput = (e) => analyze(e.target.value);
      gen();
    },

    cidr() {
      body.innerHTML = `
        <h3>Calculadora de sub-redes IPv4</h3>
        <input id="n-in" type="text" class="mono" value="192.168.10.37/26" spellcheck="false">
        <div id="n-out"></div>`;
      const input = body.querySelector("#n-in");
      const run = () => {
        const out = body.querySelector("#n-out");
        try {
          out.innerHTML = kv(Object.entries(cidrInfo(input.value)));
        } catch (e) {
          out.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
        }
      };
      input.oninput = run;
      run();
    },

    cvss() {
      const state = { AV: "N", AC: "L", PR: "N", UI: "N", S: "U", C: "H", I: "H", A: "H" };
      body.innerHTML = `
        <h3>Calculadora CVSS 3.1 (base)</h3>
        <div class="cvss">${CVSS_METRICS.map(([k, label, opts]) => `
          <div class="cvss-row"><span>${label}</span><div class="seg small" data-metric="${k}">${opts.map(([v, l]) => `<button data-v="${v}" class="${state[k] === v ? "active" : ""}">${l}</button>`).join("")}</div></div>`).join("")}
        </div>
        <div id="v-out"></div>`;
      const run = () => {
        lastCvss = cvss31(state);
        const cls = { Nenhuma: "none", Baixa: "low", Média: "med", Alta: "high", Crítica: "crit" }[lastCvss.severity];
        body.querySelector("#v-out").innerHTML = `
          <div class="score ${cls}"><b>${lastCvss.score.toFixed(1)}</b><span>${lastCvss.severity}</span></div>
          <div class="out-wrap"><input id="v-vec" class="mono" readonly value="${lastCvss.vector}">${copyBtn("v-vec")}</div>
          <button class="btn ghost small" data-ask="cvss">${icon("sparkle")}Pedir explicação à IA</button>`;
      };
      body.querySelector(".cvss").addEventListener("click", (e) => {
        const b = e.target.closest("[data-v]");
        if (!b) return;
        const group = b.parentElement;
        state[group.dataset.metric] = b.dataset.v;
        group.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
        run();
      });
      run();
    },

    time() {
      body.innerHTML = `
        <h3>Conversor de timestamps</h3>
        <p class="muted">Aceita Unix (segundos ou milissegundos), Windows FILETIME e datas ISO 8601.</p>
        <input id="t-in" type="text" class="mono" spellcheck="false">
        <div id="t-out"></div>`;
      const input = body.querySelector("#t-in");
      input.value = String(Math.floor(Date.now() / 1000));
      const run = () => {
        const v = input.value.trim();
        const out = body.querySelector("#t-out");
        let date = null;
        let kind = "";
        if (/^\d{17,18}$/.test(v)) {
          date = new Date(Number(BigInt(v) / 10000n - 11644473600000n));
          kind = "Windows FILETIME";
        } else if (/^\d{13}$/.test(v)) {
          date = new Date(Number(v));
          kind = "Unix (ms)";
        } else if (/^\d{1,11}$/.test(v)) {
          date = new Date(Number(v) * 1000);
          kind = "Unix (s)";
        } else if (v) {
          date = new Date(v);
          kind = "Data/hora";
        }
        if (!date || Number.isNaN(date.getTime())) return (out.innerHTML = `<p class="muted">Formato não reconhecido.</p>`);
        out.innerHTML = kv([
          ["Formato detectado", kind],
          ["UTC (ISO 8601)", date.toISOString(), "t-iso"],
          ["Horário local", date.toLocaleString("pt-BR"), "t-local"],
          ["Unix (s)", Math.floor(date.getTime() / 1000), "t-unix"],
          ["Unix (ms)", date.getTime(), "t-ms"],
        ]);
      };
      input.oninput = run;
      run();
    },
  };

  return { show: (id = current) => show(id) };
}
