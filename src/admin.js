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
  modelList: $("#model-list"),
  modelForm: $("#model-form"),
  url: $("#url"),
  token: $("#token"),
  detect: $("#detect"),
  detected: $("#detected"),
  model: $("#model"),
  models: $("#models"),
  label: $("#label"),
  format: $("#format"),
  modelStatus: $("#model-status"),
  modelAdd: $("#model-add"),
  toasts: $("#toasts"),
  promptForm: $("#prompt-form"),
  promptScope: $("#prompt-scope"),
  promptTargets: $("#prompt-targets"),
  promptScopeHelp: $("#prompt-scope-help"),
  promptText: $("#prompt-text"),
  promptCounter: $("#prompt-counter"),
  promptPreview: $("#prompt-preview"),
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

const PAGES = {
  "visao-geral": { title: "Visão geral", desc: "Como o KIRA está configurado para os seus usuários." },
  modelos: { title: "Modelos", desc: "Conecte um ou mais modelos. Os usuários escolhem entre eles no app." },
  instrucoes: { title: "Instruções", desc: "Personalize o comportamento do modelo nas conversas." },
  usuarios: { title: "Login dos usuários", desc: "Cadastro e login com a Supabase." },
};

const state = {
  models: [], // modelos salvos (sem token)
  defaultId: null,
  auth: null,
  prompt: null,
  scope: "all", // "all" ou "some"
  targets: [], // ids marcados quando scope = "some"
  names: new Map(),
};

const esc = (text) =>
  String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const fmtNumber = (n) => n.toLocaleString("pt-BR");
const modelLabel = (m) => m.label || m.model;

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
  if (res.status === 401 && path !== "login") showLogin("Sua sessão expirou. Entre de novo.");
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

const currentPage = () => (PAGES[location.hash.slice(1)] ? location.hash.slice(1) : "visao-geral");

function renderPage() {
  const page = currentPage();
  document.querySelectorAll("[data-page]").forEach((el) => (el.hidden = el.dataset.page !== page));
  document.querySelectorAll("[data-nav]").forEach((el) => {
    const on = el.dataset.nav === page;
    el.classList.toggle("active", on);
    el.toggleAttribute("aria-current", on);
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
        <span class="badge ${badge.kind}">${esc(badge.text)}</span>
      </div>
      <div class="stat-value">${esc(value)}</div>
      <div class="stat-meta ${mono ? "mono" : ""}">${esc(meta)}</div>
      <span class="stat-link">Configurar ${icon("arrow-right")}</span>
    </a>`;
}

function renderOverview() {
  const count = state.models.length;
  const def = state.models.find((m) => m.id === state.defaultId) || state.models[0];
  const a = state.auth;
  const chars = state.prompt?.instructions?.length || 0;
  const targetsLabel = describeTargets(state.prompt?.targets);

  els.stats.innerHTML = [
    stat({
      page: "modelos",
      iconName: "sparkle",
      title: "Modelos",
      badge: count ? { kind: "ok", text: count === 1 ? "1 modelo" : `${count} modelos` } : { kind: "warn", text: "Nenhum" },
      value: count ? modelLabel(def) : "Modelo de reserva",
      meta: count ? `Padrão · ${def.model}` : "Adicione um modelo. Sem nenhum, o KIRA usa um modelo gratuito de reserva.",
      mono: count > 0,
    }),
    stat({
      page: "instrucoes",
      iconName: "doc",
      title: "Instruções",
      badge: chars ? { kind: "ok", text: "Definidas" } : { kind: "", text: "Padrão" },
      value: chars ? `${fmtNumber(chars)} caracteres` : "Só o prompt padrão",
      meta: chars ? `Valem para: ${targetsLabel}. Atualizadas em ${fmtDate(state.prompt.updatedAt)}.` : "Nenhuma instrução extra.",
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

  $("#dot-modelos").classList.toggle("ok", count > 0);
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
  els.modelList.innerHTML = `<p class="help">Carregando…</p>`;
  const [models] = await Promise.allSettled([api("models"), loadUserAuth(), loadPrompt()]);
  if (models.status === "rejected") {
    els.modelList.innerHTML = `<p class="key-status error">${esc(models.reason.message)}</p>`;
    return;
  }
  setModelsState(models.value);
  if (state.promptData) renderPrompt(state.promptData); // os alvos e o aviso dependem da lista de modelos
  renderOverview();
}

// ---------------- Modelos ----------------

function setModelsState({ models, defaultId }) {
  state.models = models || [];
  state.defaultId = defaultId;
  renderModelList();
  renderTargets(); // os alvos das instruções dependem da lista de modelos
}

function renderModelList() {
  if (!state.models.length) {
    els.modelList.innerHTML = `<div class="empty"><b>Nenhum modelo conectado</b><span>Adicione um modelo abaixo. Enquanto não houver nenhum, o KIRA responde com um modelo gratuito de reserva.</span></div>`;
    return;
  }
  els.modelList.innerHTML = state.models
    .map((m) => {
      const isDefault = m.id === state.defaultId;
      return `<div class="model-row">
        <span class="model-mark">${icon("sparkle")}</span>
        <div class="model-info">
          <div class="model-name">${esc(modelLabel(m))}${isDefault ? `<span class="badge ok">Padrão</span>` : ""}</div>
          <div class="model-sub mono">${esc(m.provider)} · ${esc(m.model)}</div>
        </div>
        <div class="model-actions">
          ${isDefault ? "" : `<button type="button" class="btn ghost small" data-default="${esc(m.id)}">Tornar padrão</button>`}
          <button type="button" class="icon-btn" data-remove="${esc(m.id)}" title="Remover" aria-label="Remover modelo">${icon("trash")}</button>
        </div>
      </div>`;
    })
    .join("");
}

els.modelList.addEventListener("click", async (e) => {
  const def = e.target.closest("[data-default]");
  const del = e.target.closest("[data-remove]");
  try {
    if (def) {
      setModelsState(await api("models", "PUT", { defaultId: def.dataset.default }));
      renderOverview();
      toast("Modelo padrão atualizado");
    } else if (del) {
      const m = state.models.find((x) => x.id === del.dataset.remove);
      if (!m || !confirm(`Remover "${modelLabel(m)}"?`)) return;
      setModelsState(await api("models", "DELETE", { id: del.dataset.remove }));
      renderOverview();
      loadPrompt();
      toast("Modelo removido");
    }
  } catch (err) {
    setStatus(els.modelStatus, err.message, "error");
  }
});

function addForm() {
  return {
    url: els.url.value.trim(),
    token: els.token.value.trim(),
    model: els.model.value.trim(),
    label: els.label.value.trim(),
    format: els.format.value,
  };
}

function setDetectedModels(models) {
  state.names = new Map(models.map((m) => [m.id, m.name]));
  els.models.innerHTML = models
    .map((m) => `<option value="${esc(m.id)}">${m.name !== m.id ? esc(m.name) : ""}</option>`)
    .join("");
  updateLabelPlaceholder();
}

function updateLabelPlaceholder() {
  els.label.placeholder = state.names.get(els.model.value.trim()) || els.model.value.trim() || "Usa o nome do modelo";
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
    const d = await api("detect", "POST", addForm());
    setDetectedModels(d.models);
    if (!els.model.value.trim() || (d.models.length && !state.names.has(els.model.value.trim()))) {
      els.model.value = d.suggested || "";
    }
    updateLabelPlaceholder();
    if (!els.url.value.trim()) els.url.value = d.baseURL;
    const count = d.models.length ? ` · ${d.models.length} modelo${d.models.length > 1 ? "s" : ""}` : "";
    els.detected.innerHTML = `${icon("check")}<span>${esc(d.provider)} · ${esc(d.formatLabel)}${count}</span>`;
    if (d.warning) setStatus(els.modelStatus, d.warning);
    if (!els.model.value) els.model.focus();
  } catch (err) {
    els.detected.className = "detected error";
    els.detected.textContent = err.message;
  } finally {
    els.detect.disabled = false;
  }
});

els.model.addEventListener("input", updateLabelPlaceholder);

els.modelForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.modelAdd.disabled = true;
  setStatus(els.modelStatus, "Testando a conexão com a IA… pode levar alguns segundos.");
  try {
    setModelsState(await api("models", "POST", addForm()));
    els.modelForm.reset();
    els.detected.textContent = "";
    state.names = new Map();
    renderOverview();
    loadPrompt();
    setStatus(els.modelStatus, "Modelo adicionado.", "ok");
    toast("Modelo adicionado");
  } catch (err) {
    setStatus(els.modelStatus, err.message, "error");
  } finally {
    els.modelAdd.disabled = false;
  }
});

$("#toggle-token").addEventListener("click", (e) => {
  const reveal = els.token.type === "password";
  els.token.type = reveal ? "text" : "password";
  e.currentTarget.innerHTML = icon(reveal ? "eye-off" : "eye");
  e.currentTarget.setAttribute("aria-label", reveal ? "Esconder token" : "Mostrar token");
});

// ---------------- Instruções ----------------

// Sem limite: mostra o tamanho e uma estimativa de tokens, que é o que ocupa o contexto do modelo.
const LONG_TOKENS = 30_000;

function updateCounter() {
  const chars = els.promptText.value.length;
  const tokens = Math.ceil(chars / 3.5);
  els.promptCounter.textContent = `${fmtNumber(chars)} caracteres · ~${fmtNumber(tokens)} tokens`;
  els.promptCounter.classList.toggle("near", tokens > LONG_TOKENS);
  els.promptCounter.title =
    tokens > LONG_TOKENS
      ? "Instruções longas ocupam o contexto do modelo: cada mensagem fica mais cara e lenta, e modelos com contexto pequeno podem recusar."
      : "";
}

// Texto legível dos alvos: "todos os modelos" ou os nomes dos modelos marcados.
function describeTargets(targets) {
  if (!Array.isArray(targets)) return "todos os modelos";
  const names = targets.map((id) => state.models.find((m) => m.id === id)).filter(Boolean).map(modelLabel);
  return names.length ? names.join(", ") : "nenhum modelo";
}

function setScope(scope) {
  state.scope = scope;
  els.promptScope.querySelectorAll("[data-scope]").forEach((b) => {
    b.classList.toggle("active", b.dataset.scope === scope);
    b.setAttribute("aria-checked", String(b.dataset.scope === scope));
  });
  els.promptTargets.hidden = scope !== "some";
  els.promptScopeHelp.textContent =
    scope === "all"
      ? "Vale para todos os modelos, inclusive os que você adicionar depois."
      : "Vale só para os modelos marcados. Modelos adicionados depois não recebem estas instruções.";
}

function renderTargets() {
  els.promptTargets.innerHTML = state.models.length
    ? state.models
        .map(
          (m) => `<label class="check"><input type="checkbox" value="${esc(m.id)}" ${state.targets.includes(m.id) ? "checked" : ""} />${esc(modelLabel(m))}</label>`,
        )
        .join("")
    : `<p class="help">Nenhum modelo para escolher. Adicione modelos na página Modelos.</p>`;
}

// Monta o preview ao vivo, na mesma ordem do servidor (buildSystemPrompt).
function updatePreview() {
  const p = state.promptParts;
  if (!p) return;
  const text = els.promptText.value.trim();
  const blocks = [p.identity, p.responsible, text ? `${p.intro}\n\n${text}` : "", p.style, p.date].filter(Boolean);
  els.promptPreview.textContent = blocks.join("\n\n");
}

function renderPrompt(data) {
  state.promptData = data;
  state.prompt = { instructions: data.instructions, targets: data.targets, updatedAt: data.updatedAt };
  state.promptParts = data.parts;
  els.promptText.value = data.instructions || "";
  state.targets = Array.isArray(data.targets) ? data.targets : [];
  setScope(data.targets === "all" || !Array.isArray(data.targets) ? "all" : "some");
  renderTargets();
  updateCounter();
  updatePreview();
  // Se o único modelo marcado foi removido, as instruções ficam sem valer para ninguém: avisa.
  const orphan = data.instructions && Array.isArray(data.targets) && !data.targets.some((id) => state.models.some((m) => m.id === id));
  setStatus(
    els.promptStatus,
    orphan && state.models.length ? 'Estas instruções não valem para nenhum modelo agora. Marque um modelo ou escolha "Todos os modelos".' : "",
    orphan ? "error" : "",
  );
}

async function loadPrompt() {
  try {
    renderPrompt(await api("instructions"));
  } catch (err) {
    setStatus(els.promptStatus, err.message, "error");
  }
}

els.promptScope.querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => setScope(b.dataset.scope)));

els.promptText.addEventListener("input", () => {
  updateCounter();
  updatePreview();
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

function targetsPayload() {
  if (state.scope === "all") return "all";
  return [...els.promptTargets.querySelectorAll("input:checked")].map((i) => i.value);
}

async function savePrompt(instructions) {
  const targets = targetsPayload();
  if (instructions.trim() && Array.isArray(targets) && !targets.length) {
    setStatus(els.promptStatus, 'Marque pelo menos um modelo, ou escolha "Todos os modelos".', "error");
    return;
  }
  els.promptSave.disabled = true;
  try {
    renderPrompt(await api("instructions", "PUT", { instructions, targets }));
    renderOverview();
    setStatus(
      els.promptStatus,
      instructions.trim()
        ? `Salvo. Valem para: ${describeTargets(state.prompt.targets)}.`
        : "Instruções removidas. O modelo usa só o prompt padrão.",
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
