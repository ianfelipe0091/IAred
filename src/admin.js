import { hydrateIcons, icon } from "./icons.js";

const $ = (sel) => document.querySelector(sel);

const els = {
  views: { loading: $("#view-loading"), setup: $("#view-setup"), login: $("#view-login"), panel: $("#view-panel") },
  logout: $("#logout"),
  setupSteps: $("#setup-steps"),
  user: $("#user"),
  password: $("#password"),
  loginStatus: $("#login-status"),
  loginBtn: $("#login-btn"),
  status: $("#status"),
  form: $("#config-form"),
  url: $("#url"),
  token: $("#token"),
  tokenHint: $("#token-hint"),
  detect: $("#detect"),
  detected: $("#detected"),
  model: $("#model"),
  models: $("#models"),
  label: $("#label"),
  format: $("#format"),
  configStatus: $("#config-status"),
  remove: $("#remove"),
  save: $("#save"),
  toasts: $("#toasts"),
};

const FORMAT_LABEL = { anthropic: "API da Anthropic", openai: "compatível com OpenAI" };
const TOKEN_HINT = els.tokenHint.textContent;

const state = {
  config: null, // configuração salva (sem o token)
  names: new Map(), // id do modelo → nome amigável
};

const esc = (text) =>
  String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function toast(text, kind = "info") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = text;
  els.toasts.appendChild(el);
  setTimeout(() => el.classList.add("out"), 3200);
  setTimeout(() => el.remove(), 3600);
}

function setStatus(el, text, kind = "") {
  el.textContent = text;
  el.className = `key-status ${kind}`;
}

function show(view) {
  for (const [name, el] of Object.entries(els.views)) el.hidden = name !== view;
  els.logout.hidden = view !== "panel";
}

async function api(path, method = "GET", body) {
  const init = { method, headers: {} };
  if (method !== "GET") {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(`/api/admin/${path}`, init);
  let data = {};
  try {
    data = await res.json();
  } catch {
    // resposta sem JSON
  }
  if (res.status === 401 && path !== "login") {
    showLogin("Sua sessão expirou. Entre de novo.");
  }
  if (!res.ok) throw new Error(data.error || `Erro HTTP ${res.status}`);
  return data;
}

// ---------------- Configuração do servidor ----------------

function showSetup(session) {
  const steps = [];
  if (!session.storage) {
    steps.push(`Crie o armazenamento do painel (o comando já grava no <b>wrangler.toml</b>):
      <code>npx wrangler kv namespace create kira-config --binding CONFIG --update-config</code>`);
  }
  if (!session.userSet || !session.passwordSet) {
    const missing = [
      !session.userSet && `<code>npx wrangler pages secret put ADMIN_USER --project-name kira</code>`,
      !session.passwordSet && `<code>npx wrangler pages secret put ADMIN_PASSWORD --project-name kira</code>`,
    ].filter(Boolean);
    steps.push(`Defina o usuário e a senha do administrador (senha com pelo menos ${session.minPassword} caracteres):
      ${missing.join("")}
      <small>${session.passwordTooShort ? "A senha atual é curta demais. " : ""}Também dá para criar os secrets no painel da Cloudflare: Workers &amp; Pages → kira → Settings → Variables and Secrets.</small>`);
  }
  steps.push(`Publique de novo e recarregue esta página:
    <code>npm run deploy</code>`);
  els.setupSteps.innerHTML = steps.map((s) => `<li>${s}</li>`).join("");
  show("setup");
}

// ---------------- Login ----------------

function showLogin(message = "") {
  setStatus(els.loginStatus, message, message ? "error" : "");
  els.password.value = "";
  show("login");
  (els.user.value ? els.password : els.user).focus();
}

els.views.login.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.loginBtn.disabled = true;
  setStatus(els.loginStatus, "Entrando…");
  try {
    await api("login", "POST", { user: els.user.value, password: els.password.value });
    els.password.value = "";
    await showPanel();
  } catch (err) {
    setStatus(els.loginStatus, err.message, "error");
    els.password.select();
  } finally {
    els.loginBtn.disabled = false;
  }
});

els.logout.addEventListener("click", async () => {
  try {
    await api("logout", "POST");
  } catch {
    // a sessão expira sozinha
  }
  showLogin();
});

// ---------------- Painel ----------------

function renderStatus() {
  const c = state.config;
  els.remove.hidden = !c;
  if (!c) {
    els.status.innerHTML = `
      <div class="status-head"><i class="dot"></i>Nenhuma IA configurada</div>
      <p class="status-name">KIRA Free</p>
      <p class="lead">Os usuários estão usando o modelo gratuito. Configure abaixo a URL e o token da IA que eles devem usar.</p>`;
    return;
  }
  const updated = c.updatedAt ? new Date(c.updatedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
  els.status.innerHTML = `
    <div class="status-head"><i class="dot on"></i>IA ativa para os usuários</div>
    <p class="status-name">${esc(c.label || c.model)}</p>
    <dl class="facts">
      <dt>Provedor</dt><dd>${esc(c.provider)} · ${esc(FORMAT_LABEL[c.format] || c.format)}</dd>
      <dt>Modelo</dt><dd class="mono">${esc(c.model)}</dd>
      <dt>URL</dt><dd class="mono">${esc(c.baseURL)}</dd>
      <dt>Token</dt><dd class="mono">${esc(c.tokenHint)}</dd>
      <dt>Atualizado</dt><dd>${esc(updated)}</dd>
    </dl>`;
}

function fillForm() {
  const c = state.config;
  els.url.value = c?.baseURL || "";
  els.token.value = "";
  els.token.placeholder = c ? `Salvo: ${c.tokenHint}` : "Cole aqui o token (sk-…)";
  els.tokenHint.textContent = c
    ? "Deixe em branco para manter o token salvo. Se trocar a URL, cole o token de novo."
    : TOKEN_HINT;
  els.model.value = c?.model || "";
  els.label.value = c?.label || "";
  els.format.value = "auto";
  els.detected.textContent = "";
  setStatus(els.configStatus, "");
}

async function showPanel() {
  show("panel");
  els.status.innerHTML = `<p class="lead">Carregando…</p>`;
  try {
    state.config = (await api("config")).config;
  } catch (err) {
    if (!els.views.panel.hidden) els.status.innerHTML = `<p class="key-status error">${esc(err.message)}</p>`;
    return;
  }
  renderStatus();
  fillForm();
}

function formData() {
  return {
    url: els.url.value.trim(),
    token: els.token.value.trim(),
    model: els.model.value.trim(),
    label: els.label.value.trim(),
    format: els.format.value,
  };
}

function setModels(models) {
  state.names = new Map(models.map((m) => [m.id, m.name]));
  els.models.innerHTML = models
    .map((m) => `<option value="${esc(m.id)}">${m.name !== m.id ? esc(m.name) : ""}</option>`)
    .join("");
  updateLabelPlaceholder();
}

function updateLabelPlaceholder() {
  const name = state.names.get(els.model.value.trim());
  els.label.placeholder = name || els.model.value.trim() || "Usa o nome do modelo";
}

els.detect.addEventListener("click", async () => {
  els.detect.disabled = true;
  els.detected.className = "detected";
  els.detected.textContent = "Reconhecendo…";
  try {
    const d = await api("detect", "POST", formData());
    setModels(d.models);
    if (!els.model.value.trim() || (d.models.length && !state.names.has(els.model.value.trim()))) {
      els.model.value = d.suggested || "";
    }
    updateLabelPlaceholder();
    if (!els.url.value.trim()) els.url.value = d.baseURL;
    const count = d.models.length ? ` · ${d.models.length} modelo${d.models.length > 1 ? "s" : ""}` : "";
    els.detected.innerHTML = `${icon("check")}<span>${esc(d.provider)} · ${esc(d.formatLabel)}${count}</span>`;
    if (d.warning) setStatus(els.configStatus, d.warning);
    if (!els.model.value) els.model.focus();
  } catch (err) {
    els.detected.className = "detected error";
    els.detected.textContent = err.message;
  } finally {
    els.detect.disabled = false;
  }
});

els.model.addEventListener("input", () => {
  // Trocou de modelo sem mexer no nome: o nome antigo deixa de valer.
  if (state.config && els.label.value === state.config.label && els.model.value.trim() !== state.config.model) {
    els.label.value = "";
  }
  updateLabelPlaceholder();
});

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.save.disabled = true;
  setStatus(els.configStatus, "Testando a conexão com a IA… pode levar alguns segundos.");
  try {
    const { config } = await api("config", "PUT", formData());
    state.config = config;
    renderStatus();
    fillForm();
    setStatus(els.configStatus, `Salvo. Os usuários já estão usando ${config.label}.`, "ok");
    toast("Configuração salva");
  } catch (err) {
    setStatus(els.configStatus, err.message, "error");
  } finally {
    els.save.disabled = false;
  }
});

els.remove.addEventListener("click", async () => {
  if (!confirm("Remover a IA configurada? Os usuários voltam para o modelo gratuito.")) return;
  try {
    await api("config", "DELETE");
    state.config = null;
    renderStatus();
    fillForm();
    toast("Configuração removida");
  } catch (err) {
    setStatus(els.configStatus, err.message, "error");
  }
});

$("#toggle-token").addEventListener("click", (e) => {
  const reveal = els.token.type === "password";
  els.token.type = reveal ? "text" : "password";
  e.currentTarget.innerHTML = icon(reveal ? "eye-off" : "eye");
  e.currentTarget.setAttribute("aria-label", reveal ? "Esconder token" : "Mostrar token");
});

// ---------------- Início ----------------

async function boot() {
  hydrateIcons();
  let session;
  try {
    session = await api("session");
  } catch (err) {
    els.views.loading.textContent = `Não foi possível abrir o painel: ${err.message}`;
    return;
  }
  if (!session.userSet || !session.passwordSet || !session.storage) return showSetup(session);
  if (!session.authenticated) return showLogin();
  return showPanel();
}

boot();
