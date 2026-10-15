import { hydrateIcons, icon } from "./icons.js";

const $ = (sel) => document.querySelector(sel);

const els = {
  views: { loading: $("#view-loading"), setup: $("#view-setup"), login: $("#view-login"), panel: $("#view-panel") },
  loadingText: $("#loading-text"),
  setupSteps: $("#setup-steps"),
  loginForm: $("#login-form"),
  user: $("#user"),
  password: $("#password"),
  loginStatus: $("#login-status"),
  loginBtn: $("#login-btn"),
  adminName: $("#admin-name"),
  adminAvatar: $("#admin-avatar"),
  pageTitle: $("#page-title"),
  pageDesc: $("#page-desc"),
  stats: $("#stats"),
  status: $("#status"),
  statusFoot: $("#status-foot"),
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
  freeForm: $("#free-form"),
  freeState: $("#free-state"),
  freeCfHelp: $("#free-cf-help"),
  freeOr: $("#free-or"),
  freeToken: $("#free-token"),
  freeList: $("#free-list"),
  freeDetected: $("#free-detected"),
  freeModel: $("#free-model"),
  freeModels: $("#free-models"),
  freeStatus: $("#free-status"),
  freeSave: $("#free-save"),
  promptForm: $("#prompt-form"),
  promptText: $("#prompt-text"),
  promptCounter: $("#prompt-counter"),
  promptStatus: $("#prompt-status"),
  promptSave: $("#prompt-save"),
  sbForm: $("#sb-form"),
  sbState: $("#sb-state"),
  sbUrl: $("#sb-url"),
  sbKey: $("#sb-key"),
  sbStatus: $("#sb-status"),
  sbSave: $("#sb-save"),
  sbRemove: $("#sb-remove"),
};

const FORMAT_LABEL = { anthropic: "API da Anthropic", openai: "compatível com OpenAI" };
const TOKEN_HINT = els.tokenHint.textContent;
const CLOUDFLARE_MODEL = "Nemotron 3 Super 120B";

const PAGES = {
  "visao-geral": { title: "Visão geral", desc: "Como o KIRA está configurado para os seus usuários." },
  ia: { title: "IA principal", desc: "O modelo padrão do KIRA. Conecte qualquer API no formato da Anthropic ou da OpenAI." },
  gratuita: { title: "KIRA Free", desc: "A opção gratuita que os usuários podem escolher no app." },
  instrucoes: { title: "Instruções", desc: "Personalize o comportamento do modelo em todas as conversas." },
  usuarios: { title: "Login dos usuários", desc: "Cadastro e login com a Supabase." },
};

const state = {
  config: null, // IA principal salva (sem o token)
  free: null, // opção gratuita salva (sem o token)
  freeSource: "cloudflare",
  auth: null, // login dos usuários
  prompt: null, // instruções do admin
  names: new Map(), // id do modelo → nome amigável
};

const esc = (text) =>
  String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const fmtNumber = (n) => n.toLocaleString("pt-BR");

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

els.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.loginBtn.disabled = true;
  setStatus(els.loginStatus, "Entrando…");
  try {
    const { user } = await api("login", "POST", { user: els.user.value, password: els.password.value });
    els.password.value = "";
    await showPanel(user);
  } catch (err) {
    setStatus(els.loginStatus, err.message, "error");
    els.password.select();
  } finally {
    els.loginBtn.disabled = false;
  }
});

$("#logout").addEventListener("click", async () => {
  try {
    await api("logout", "POST");
  } catch {
    // a sessão expira sozinha
  }
  showLogin();
});

// ---------------- Navegação ----------------

function currentPage() {
  const page = location.hash.slice(1);
  return PAGES[page] ? page : "visao-geral";
}

function renderPage() {
  const page = currentPage();
  document.querySelectorAll("[data-page]").forEach((el) => (el.hidden = el.dataset.page !== page));
  document.querySelectorAll("[data-nav]").forEach((el) => {
    const on = el.dataset.nav === page;
    el.classList.toggle("active", on);
    if (on) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  els.pageTitle.textContent = PAGES[page].title;
  els.pageDesc.textContent = PAGES[page].desc;
  document.title = `${PAGES[page].title} · KIRA Admin`;
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", renderPage);

// ---------------- Visão geral ----------------

function stat({ page, iconName, title, badge, value, meta, mono = false }) {
  return `<a class="stat" href="#${page}">
      <div class="stat-top">
        <span class="stat-icon">${icon(iconName)}</span>
        <span class="stat-title">${title}</span>
        <span class="badge ${badge.kind}">${badge.text}</span>
      </div>
      <div class="stat-value">${esc(value)}</div>
      <div class="stat-meta ${mono ? "mono" : ""}">${esc(meta)}</div>
      <span class="stat-link">Configurar ${icon("arrow-right")}</span>
    </a>`;
}

function renderOverview() {
  const c = state.config;
  const f = state.free;
  const a = state.auth;
  const p = state.prompt;
  const freeOr = f?.source === "openrouter";
  const chars = p?.instructions?.length || 0;

  els.stats.innerHTML = [
    stat({
      page: "ia",
      iconName: "sparkle",
      title: "IA principal",
      badge: c ? { kind: "ok", text: "Ativa" } : { kind: "warn", text: "Não configurada" },
      value: c ? c.label || c.model : "Nenhuma IA conectada",
      meta: c ? `${c.provider} · ${c.model}` : "Os usuários só têm a opção gratuita.",
    }),
    stat({
      page: "gratuita",
      iconName: "bolt",
      title: "KIRA Free",
      badge: { kind: "ok", text: freeOr ? "OpenRouter" : "Cloudflare" },
      value: freeOr ? f.model : CLOUDFLARE_MODEL,
      meta: freeOr ? "Conectado com a sua chave da OpenRouter." : "Incluído no Cloudflare Workers AI.",
    }),
    stat({
      page: "instrucoes",
      iconName: "doc",
      title: "Instruções",
      badge: chars ? { kind: "ok", text: "Definidas" } : { kind: "", text: "Padrão" },
      value: chars ? `${fmtNumber(chars)} caracteres` : "Só o prompt padrão",
      meta: chars ? `Atualizadas em ${fmtDate(p.updatedAt)}.` : "Nenhuma instrução extra para o modelo.",
    }),
    stat({
      page: "usuarios",
      iconName: "users",
      title: "Login dos usuários",
      badge: a?.enabled ? { kind: "ok", text: "Ativo" } : { kind: "warn", text: "Desligado" },
      value: a?.enabled ? "Só usuários cadastrados" : "Aberto a qualquer visitante",
      meta: a?.enabled ? a.url : "Ative para exigir conta no KIRA.",
      mono: Boolean(a?.enabled),
    }),
  ].join("");

  $("#dot-ia").classList.toggle("ok", Boolean(c));
  $("#dot-gratuita").classList.toggle("ok", Boolean(f));
  $("#dot-instrucoes").classList.toggle("ok", chars > 0);
  $("#dot-usuarios").classList.toggle("ok", Boolean(a?.enabled));
}

// ---------------- Painel ----------------

function setAdmin(name) {
  if (!name) return;
  els.adminName.textContent = name;
  els.adminAvatar.textContent = name.slice(0, 1);
}

async function showPanel(user) {
  setAdmin(user);
  renderPage();
  show("panel");
  els.status.innerHTML = `<p class="help">Carregando…</p>`;
  const [config] = await Promise.allSettled([api("config"), loadFree(), loadUserAuth(), loadPrompt()]);
  if (config.status === "rejected") {
    if (!els.views.panel.hidden) els.status.innerHTML = `<p class="key-status error">${esc(config.reason.message)}</p>`;
    return;
  }
  state.config = config.value.config;
  renderStatus();
  fillForm();
  renderOverview();
}

// ---------------- IA principal ----------------

function renderStatus() {
  const c = state.config;
  els.statusFoot.hidden = !c;
  if (!c) {
    els.status.innerHTML = `<div class="empty"><b>Nenhuma IA conectada</b><span>Os usuários estão usando só a opção gratuita. Conecte uma IA abaixo.</span></div>`;
    return;
  }
  els.status.innerHTML = `
    <dl class="facts">
      <dt>Nome para os usuários</dt><dd><b>${esc(c.label || c.model)}</b></dd>
      <dt>Provedor</dt><dd>${esc(c.provider)} · ${esc(FORMAT_LABEL[c.format] || c.format)}</dd>
      <dt>Modelo</dt><dd class="mono">${esc(c.model)}</dd>
      <dt>URL</dt><dd class="mono">${esc(c.baseURL)}</dd>
      <dt>Token</dt><dd class="mono">${esc(c.tokenHint)}</dd>
      <dt>Atualizado</dt><dd>${esc(fmtDate(c.updatedAt))}</dd>
    </dl>`;
}

function fillForm() {
  const c = state.config;
  els.url.value = c?.baseURL || "";
  els.token.value = "";
  els.token.placeholder = c ? `Salvo: ${c.tokenHint}` : "sk-…";
  els.tokenHint.textContent = c
    ? "Deixe em branco para manter o token salvo. Se trocar a URL, cole o token de novo."
    : TOKEN_HINT;
  els.model.value = c?.model || "";
  els.label.value = c?.label || "";
  els.format.value = "auto";
  els.detected.textContent = "";
  setStatus(els.configStatus, "");
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

$("#presets").addEventListener("click", (e) => {
  const b = e.target.closest("[data-url]");
  if (!b) return;
  els.url.value = b.dataset.url;
  els.format.value = "auto";
  els.detected.textContent = "";
  els.token.focus();
});

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
    renderOverview();
    setStatus(els.configStatus, `Salvo. Os usuários já estão usando ${config.label}.`, "ok");
    toast("Configuração salva");
  } catch (err) {
    setStatus(els.configStatus, err.message, "error");
  } finally {
    els.save.disabled = false;
  }
});

els.remove.addEventListener("click", async () => {
  if (!confirm("Remover a IA configurada? Os usuários ficam só com a opção gratuita.")) return;
  try {
    await api("config", "DELETE");
    state.config = null;
    renderStatus();
    fillForm();
    renderOverview();
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

// ---------------- KIRA Free ----------------

function setFreeSource(source) {
  state.freeSource = source;
  els.freeForm.querySelectorAll("[data-source]").forEach((b) => {
    b.classList.toggle("active", b.dataset.source === source);
    b.setAttribute("aria-checked", String(b.dataset.source === source));
  });
  els.freeOr.hidden = source !== "openrouter";
  els.freeCfHelp.hidden = source !== "cloudflare";
}

function renderFree(free) {
  state.free = free;
  const or = free.source === "openrouter";
  els.freeState.innerHTML = or
    ? `<span class="badge ok">OpenRouter</span><span class="mono-inline">${esc(free.model)}</span>`
    : `<span class="badge ok">Cloudflare</span><span>${CLOUDFLARE_MODEL} no Workers AI</span>`;
  els.freeToken.value = "";
  els.freeToken.placeholder = or && free.tokenHint ? `Salva: ${free.tokenHint}` : "sk-or-v1-…";
  els.freeModel.value = or ? free.model : els.freeModel.value;
  setFreeSource(free.source);
}

async function loadFree() {
  try {
    renderFree(await api("free"));
  } catch (err) {
    setStatus(els.freeStatus, err.message, "error");
  }
}

els.freeForm.querySelectorAll("[data-source]").forEach((b) =>
  b.addEventListener("click", () => {
    setFreeSource(b.dataset.source);
    setStatus(els.freeStatus, "");
    if (b.dataset.source === "openrouter" && !els.freeModel.value) {
      els.freeModel.value = "nvidia/nemotron-3-super-120b-a12b:free";
    }
  }),
);

els.freeList.addEventListener("click", async () => {
  els.freeList.disabled = true;
  els.freeDetected.className = "detected";
  els.freeDetected.textContent = "Conferindo a chave…";
  try {
    const { models, freeTier } = await api("free", "POST", { token: els.freeToken.value.trim() });
    els.freeModels.innerHTML = models
      .map((m) => `<option value="${esc(m.id)}">${m.free ? "Grátis · " : ""}${esc(m.name)}</option>`)
      .join("");
    const free = models.filter((m) => m.free).length;
    const account = freeTier ? " · conta sem créditos (50 mensagens/dia nos grátis)" : "";
    els.freeDetected.innerHTML = `${icon("check")}<span>Chave válida · ${models.length} modelos, ${free} grátis${esc(account)}</span>`;
  } catch (err) {
    els.freeDetected.className = "detected error";
    els.freeDetected.textContent = err.message;
  } finally {
    els.freeList.disabled = false;
  }
});

els.freeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.freeSave.disabled = true;
  try {
    if (state.freeSource === "cloudflare") {
      renderFree(await api("free", "DELETE"));
      setStatus(els.freeStatus, "A opção gratuita voltou a usar o Cloudflare Workers AI.", "ok");
    } else {
      setStatus(els.freeStatus, "Testando o modelo na OpenRouter… pode levar alguns segundos.");
      renderFree(await api("free", "PUT", { token: els.freeToken.value.trim(), model: els.freeModel.value.trim() }));
      setStatus(els.freeStatus, "Salvo. O KIRA Free agora usa a OpenRouter.", "ok");
    }
    renderOverview();
    toast("Opção gratuita salva");
  } catch (err) {
    setStatus(els.freeStatus, err.message, "error");
  } finally {
    els.freeSave.disabled = false;
  }
});

// ---------------- Instruções ----------------

function updateCounter() {
  const max = Number(els.promptText.maxLength) || 8000;
  const used = els.promptText.value.length;
  els.promptCounter.textContent = `${fmtNumber(used)} / ${fmtNumber(max)}`;
  els.promptCounter.classList.toggle("near", used > max * 0.9);
}

function renderPrompt(prompt) {
  state.prompt = prompt;
  if (prompt.max) els.promptText.maxLength = prompt.max;
  els.promptText.value = prompt.instructions || "";
  updateCounter();
}

async function loadPrompt() {
  try {
    renderPrompt(await api("instructions"));
  } catch (err) {
    setStatus(els.promptStatus, err.message, "error");
  }
}

els.promptText.addEventListener("input", () => {
  updateCounter();
  setStatus(els.promptStatus, els.promptText.value !== (state.prompt?.instructions || "") ? "Alterações não salvas." : "");
});

$("#prompt-examples").addEventListener("click", (e) => {
  const b = e.target.closest("[data-text]");
  if (!b) return;
  const current = els.promptText.value.trimEnd();
  els.promptText.value = current ? `${current}\n${b.dataset.text}` : b.dataset.text;
  els.promptText.dispatchEvent(new Event("input"));
  els.promptText.focus();
});

async function savePrompt(instructions) {
  els.promptSave.disabled = true;
  try {
    renderPrompt(await api("instructions", "PUT", { instructions }));
    renderOverview();
    setStatus(
      els.promptStatus,
      instructions.trim() ? "Salvo. As próximas mensagens já seguem estas instruções." : "Instruções removidas. O modelo usa só o prompt padrão.",
      "ok",
    );
    toast("Instruções salvas");
  } catch (err) {
    setStatus(els.promptStatus, err.message, "error");
  } finally {
    els.promptSave.disabled = false;
  }
}

els.promptForm.addEventListener("submit", (e) => {
  e.preventDefault();
  savePrompt(els.promptText.value);
});

$("#prompt-clear").addEventListener("click", () => {
  if (!els.promptText.value.trim() && !state.prompt?.instructions) return;
  if (!confirm("Apagar as instruções? O modelo volta a usar só o prompt padrão da KIRA.")) return;
  savePrompt("");
});

// ---------------- Login dos usuários (Supabase) ----------------

function renderUserAuth(auth) {
  state.auth = auth;
  els.sbState.innerHTML = auth.enabled
    ? `<span class="badge ok">Ativo</span><span>Só usuários cadastrados usam o KIRA.</span>`
    : `<span class="badge warn">Desligado</span><span>Qualquer visitante usa o KIRA.</span>`;
  els.sbUrl.value = auth.url || "";
  els.sbKey.value = "";
  els.sbKey.placeholder = auth.keyHint ? `Salva: ${auth.keyHint}` : "sb_publishable_… ou eyJ…";
  els.sbRemove.hidden = !auth.enabled;
}

async function loadUserAuth() {
  try {
    renderUserAuth(await api("auth"));
  } catch (err) {
    setStatus(els.sbStatus, err.message, "error");
  }
}

els.sbForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.sbSave.disabled = true;
  setStatus(els.sbStatus, "Testando com a Supabase…");
  try {
    const auth = await api("auth", "PUT", { url: els.sbUrl.value.trim(), anonKey: els.sbKey.value.trim() });
    renderUserAuth(auth);
    renderOverview();
    const note = auth.signupEnabled === false ? " Atenção: novos cadastros estão desativados na Supabase." : "";
    setStatus(els.sbStatus, `Login ativo. Os usuários já precisam entrar ou criar conta.${note}`, "ok");
    toast("Login dos usuários ativado");
  } catch (err) {
    setStatus(els.sbStatus, err.message, "error");
  } finally {
    els.sbSave.disabled = false;
  }
});

els.sbRemove.addEventListener("click", async () => {
  if (!confirm("Desligar o login? Qualquer visitante volta a poder usar o KIRA sem conta.")) return;
  try {
    renderUserAuth(await api("auth", "DELETE"));
    renderOverview();
    setStatus(els.sbStatus, "Login desligado.");
  } catch (err) {
    setStatus(els.sbStatus, err.message, "error");
  }
});

// ---------------- Início ----------------

async function boot() {
  hydrateIcons();
  let session;
  try {
    session = await api("session");
  } catch (err) {
    els.loadingText.textContent = `Não foi possível abrir o painel: ${err.message}`;
    return;
  }
  if (!session.userSet || !session.passwordSet || !session.storage) return showSetup(session);
  if (!session.authenticated) return showLogin();
  return showPanel(session.user);
}

boot();
