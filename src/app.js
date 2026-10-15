import { apiHeaders, authClient, currentUser, describeAuthError, historyInCloud, initAuth } from "./auth.js";
import { cloud } from "./cloud.js";
import { hydrateIcons, icon } from "./icons.js";
import { escapeHtml, renderMarkdown } from "./markdown.js";
import { store, uid } from "./store.js";

const $ = (sel, root = document) => root.querySelector(sel);

const els = {
  app: $("#app"),
  history: $("#history"),
  thread: $("#thread"),
  greeting: $("#greeting"),
  messages: $("#messages"),
  composer: $("#composer"),
  input: $("#input"),
  send: $("#send"),
  toBottom: $("#to-bottom"),
  starters: $("#starters"),
  chatTitle: $("#chat-title"),
  engineLabel: $("#engine-label"),
  engineSub: $("#engine-sub"),
  engineDot: $("#engine-dot"),
  settings: $("#settings"),
  modelPlans: $("#model-plans"),
  toasts: $("#toasts"),
  auth: $("#auth"),
  authForm: $("#auth-form"),
  authTitle: $("#auth-title"),
  authName: $("#auth-name"),
  authEmail: $("#auth-email"),
  authPassword: $("#auth-password"),
  authStatus: $("#auth-status"),
  authSubmit: $("#auth-submit"),
  authTabs: $("#auth-tabs"),
  authEmailWrap: $("#auth-email-wrap"),
  authPasswordWrap: $("#auth-password-wrap"),
  authPasswordLabel: $("#auth-password-label"),
  authForgot: $("#auth-forgot"),
  authBack: $("#auth-back"),
  account: $("#account"),
  historyHint: $("#history-hint"),
  profileSection: $("#profile-section"),
  profileName: $("#profile-name"),
  profileAbout: $("#profile-about"),
  profileSave: $("#profile-save"),
  profileHint: $("#profile-hint"),
};

// Fuso do usuário, para a KIRA saber a data certa.
const TIMEZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
})();

// Links de email da Supabase (recuperar senha, confirmar conta) chegam com dados no #hash.
const AUTH_HASH = new URLSearchParams(location.hash.slice(1));
const RECOVERY = AUTH_HASH.get("type") === "recovery";
const AUTH_LINK_ERROR = AUTH_HASH.get("error_code") === "otp_expired" ? "O link expirou ou já foi usado. Peça outro." : AUTH_HASH.get("error_description");

const MOBILE = matchMedia("(max-width: 820px)");

const STARTERS = [
  { icon: "shield", title: "Blindar um servidor Linux exposto à internet", prompt: "Quais são os passos essenciais para blindar um servidor Linux (Ubuntu 24.04) exposto à internet? Priorize por impacto e inclua os comandos." },
  { icon: "radar", title: "Triagem de um alerta suspeito no endpoint", prompt: "Recebi um alerta de PowerShell codificado em um endpoint Windows. Qual é o passo a passo de triagem para confirmar ou descartar um incidente?" },
  { icon: "bug", title: "Revisar código em busca de vulnerabilidades", prompt: 'Revise este endpoint e aponte as vulnerabilidades com a correção:\n\n```python\n@app.route("/user")\ndef user():\n    uid = request.args.get("id")\n    cur.execute(f"SELECT * FROM users WHERE id = {uid}")\n    return jsonify(cur.fetchall())\n```' },
  { icon: "siren", title: "Plano de resposta a ransomware", prompt: "Monte um plano de resposta a incidente de ransomware para uma empresa de 100 pessoas, detalhando as primeiras 24 horas." },
];

const state = {
  chatId: null,
  streaming: null, // { controller, chatId, msgId }
  models: [{ id: "default", label: "KIRA" }],
  choice: store.getPref("model") || "",
  user: null,
  authMode: "login", // login, signup, reset (pedir link) ou newpass (definir nova senha)
  historyLoading: false,
};

// ---------------- Utilidades ----------------

function toast(text, kind = "info") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = text;
  els.toasts.appendChild(el);
  setTimeout(() => el.classList.add("out"), 2800);
  setTimeout(() => el.remove(), 3200);
}

function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
  return Promise.resolve();
}

const currentChat = () => (state.chatId ? store.getChat(state.chatId) : null);
const orb = (extra = "") => `<div class="orb ${extra}" aria-hidden="true"><span></span></div>`;


function persist() {
  const result = store.saveChats();
  if (result === "trimmed") toast("Armazenamento cheio: conversas antigas foram removidas.", "error");
  else if (!result) toast("Não foi possível salvar a conversa.", "error");
}

// ---------------- Modelo ativo ----------------

// Modelo escolhido pelo usuário; se não estiver na lista, usa o primeiro (o padrão).
const currentModel = () => state.models.find((m) => m.id === state.choice) || state.models[0];

// Monta a lista só quando os modelos mudam; trocar a escolha só move a marcação,
// para não perder o toque nem o foco no meio da troca.
let renderedModels = "";

function renderEngine() {
  const current = currentModel();
  const only = state.models.length < 2;
  els.engineLabel.textContent = current.label;
  els.engineSub.textContent = current.label;
  els.engineDot.classList.toggle("on", true);

  const key = JSON.stringify(state.models);
  if (key !== renderedModels) {
    renderedModels = key;
    els.modelPlans.innerHTML = state.models
      .map(
        (m, i) => `<button type="button" class="plan" data-model="${escapeHtml(m.id)}" role="radio">
        <span class="plan-icon plan-icon-ai">${icon("sparkle")}</span>
        <span class="plan-text"><b>${escapeHtml(m.label)}</b><small>${i === 0 ? "Padrão" : "Modelo de IA"}</small></span>
        <span class="plan-check">${icon("check")}</span>
      </button>`,
      )
      .join("");
    // Com um modelo só não há o que escolher: a seção de modelos some.
    document.getElementById("model-section").hidden = only;
  }
  els.modelPlans.querySelectorAll("[data-model]").forEach((b) => {
    const on = b.dataset.model === current.id;
    b.classList.toggle("active", on);
    b.setAttribute("aria-checked", String(on));
  });
}

async function loadEngine() {
  try {
    const res = await fetch("/api/model");
    if (res.ok) {
      const { models } = await res.json();
      if (models?.length) state.models = models;
    }
  } catch {
    // mantém a lista padrão
  }
  renderEngine();
}

els.modelPlans.addEventListener("click", (e) => {
  const b = e.target.closest("[data-model]");
  if (!b) return;
  state.choice = b.dataset.model;
  store.setPref("model", state.choice);
  renderEngine();
});

// ---------------- Barra lateral ----------------

// Grupos por data, como nos apps de chat.
function dayGroup(time) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(time);
  day.setHours(0, 0, 0, 0);
  const days = Math.round((today - day) / 86_400_000);
  if (days <= 0) return "Hoje";
  if (days === 1) return "Ontem";
  if (days < 7) return "Últimos 7 dias";
  if (days < 30) return "Últimos 30 dias";
  return "Mais antigas";
}

function renderHistory() {
  // Na nuvem, conversas ainda não abertas aparecem mesmo sem as mensagens carregadas.
  const chats = store.chats.filter((c) => c.messages.length || !c.loaded).sort((a, b) => b.updatedAt - a.updatedAt);
  if (!chats.length) {
    els.history.innerHTML = `<p class="history-empty">${state.historyLoading ? "Carregando conversas…" : "Nenhuma conversa ainda."}</p>`;
    return;
  }
  let group = "";
  els.history.innerHTML = chats
    .map((c) => {
      const g = dayGroup(c.updatedAt);
      const head = g !== group ? `<p class="h-group sb-text">${g}</p>` : "";
      group = g;
      return `${head}<div class="h-item ${c.id === state.chatId ? "active" : ""} ${state.streaming?.chatId === c.id ? "live" : ""}">
        <button class="h-open" data-open="${c.id}" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</button>
        <button class="h-del" data-delete="${c.id}" title="Apagar" aria-label="Apagar conversa">${icon("trash")}</button>
      </div>`;
    })
    .join("");
}

els.history.addEventListener("click", async (e) => {
  const del = e.target.closest("[data-delete]");
  const open = e.target.closest("[data-open]");
  if (del) {
    const chat = store.getChat(del.dataset.delete);
    if (!chat || !confirm(`Apagar "${chat.title}"?`)) return;
    if (state.streaming?.chatId === chat.id) state.streaming.controller.abort();
    if (store.cloud && !chat.isNew) {
      try {
        await cloud.remove(chat.id);
      } catch (err) {
        if (err.status !== 404) return toast(err.message, "error");
      }
    }
    store.deleteChat(chat.id);
    if (state.chatId === chat.id) newChat();
    renderHistory();
  } else if (open) {
    openChat(open.dataset.open);
    closeDrawer();
  }
});

function setCollapsed(collapsed) {
  els.app.classList.toggle("collapsed", collapsed);
  store.setPref("collapsed", collapsed);
}

const closeDrawer = () => els.app.classList.remove("sidebar-open");

$("#collapse").addEventListener("click", () => (MOBILE.matches ? closeDrawer() : setCollapsed(true)));
$("#open-sidebar").addEventListener("click", () => (MOBILE.matches ? els.app.classList.add("sidebar-open") : setCollapsed(false)));
$("#scrim").addEventListener("click", closeDrawer);

// ---------------- Conversas ----------------

function greet() {
  const h = new Date().getHours();
  els.greeting.textContent = h < 5 ? "Boa madrugada" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function newChat() {
  state.chatId = null;
  els.chatTitle.textContent = "";
  els.messages.innerHTML = "";
  els.app.classList.add("is-empty");
  history.replaceState(null, "", location.pathname);
  greet();
  renderHistory();
  updateToBottom();
  if (!MOBILE.matches) els.input.focus();
}

async function openChat(id) {
  const chat = store.getChat(id);
  if (!chat) return newChat();
  state.chatId = id;
  els.chatTitle.textContent = chat.title;
  history.replaceState(null, "", `#${id}`);
  renderHistory();
  if (!chat.loaded) {
    els.app.classList.remove("is-empty");
    els.messages.innerHTML = `<div class="chat-loading"><span class="shimmer">Carregando conversa…</span></div>`;
    try {
      await loadChat(chat);
    } catch (err) {
      if (state.chatId !== id) return;
      if (err.status === 404) {
        store.deleteChat(id);
        toast("Esta conversa não existe mais.", "error");
        return newChat();
      }
      els.messages.innerHTML = `<div class="notice error">${icon("warn")}<span>${escapeHtml(err.message)}</span></div>`;
      return;
    }
    if (state.chatId !== id) return; // abriu outra conversa enquanto carregava
    els.chatTitle.textContent = chat.title;
  }
  els.app.classList.toggle("is-empty", !chat.messages.length);
  els.messages.innerHTML = "";
  chat.messages.forEach((m) => els.messages.appendChild(renderMessage(m)));
  scrollToBottom(true);
}

// Nuvem: busca as mensagens da conversa na conta.
async function loadChat(chat) {
  const data = await cloud.load(chat.id);
  chat.messages = data.messages;
  chat.title = data.title;
  chat.updatedAt = Math.max(chat.updatedAt || 0, data.updatedAt);
  chat.loaded = true;
  chat.isNew = false;
}

function ensureChat() {
  let chat = currentChat();
  if (!chat) {
    chat = store.createChat();
    state.chatId = chat.id;
    history.replaceState(null, "", `#${chat.id}`);
  }
  return chat;
}

function setTitle(chat, title) {
  chat.title = title;
  if (state.chatId === chat.id) els.chatTitle.textContent = title;
  renderHistory();
}

els.chatTitle.addEventListener("click", async () => {
  const chat = currentChat();
  if (!chat?.messages.length) return;
  const title = prompt("Nome da conversa:", chat.title)?.trim().slice(0, 80);
  if (!title || title === chat.title) return;
  const old = chat.title;
  setTitle(chat, title);
  if (!store.cloud || chat.isNew) return persist();
  try {
    await cloud.rename(chat.id, title);
  } catch (err) {
    setTitle(chat, old);
    toast(err.message, "error");
  }
});

for (const id of ["#new-chat", "#new-chat-top"]) {
  $(id).addEventListener("click", () => {
    newChat();
    closeDrawer();
  });
}
$("#brand-link").addEventListener("click", (e) => {
  e.preventDefault();
  newChat();
  closeDrawer();
});

// ---------------- Mensagens ----------------

function renderMessage(msg) {
  const el = document.createElement("article");
  el.className = `msg ${msg.role}`;
  el.dataset.id = msg.id;
  if (msg.role === "user") {
    el.innerHTML = `
      <div class="bubble">${escapeHtml(msg.content)}</div>
      <div class="msg-actions">
        <button data-act="copy" title="Copiar">${icon("copy")}</button>
        <button data-act="edit" title="Editar">${icon("edit")}</button>
      </div>`;
  } else {
    el.innerHTML = `
      ${orb()}
      <div class="msg-body">
        <div class="thinking-slot"></div>
        <div class="content prose"></div>
        <div class="notices"></div>
        <div class="msg-foot">
          <div class="msg-actions">
            <button data-act="copy" title="Copiar">${icon("copy")}</button>
            <button data-act="regen" title="Gerar novamente">${icon("refresh")}</button>
            <span class="msg-meta"></span>
          </div>
        </div>
      </div>`;
    updateAssistant(el, msg);
  }
  return el;
}

function updateAssistant(el, msg) {
  const live = state.streaming?.msgId === msg.id;
  el.classList.toggle("live", live);

  // Raciocínio
  const slot = el.querySelector(".thinking-slot");
  if (msg.thinking) {
    let details = slot.querySelector("details");
    if (!details) {
      slot.innerHTML = `<details class="thinking"><summary><span class="t-label"></span>${icon("chevron")}</summary><div class="t-body"></div></details>`;
      details = slot.querySelector("details");
    }
    const thinkingNow = live && !msg.content;
    const secs = msg.thinkingMs ? Math.max(1, Math.round(msg.thinkingMs / 1000)) : 0;
    details.querySelector(".t-label").textContent = thinkingNow ? "Raciocinando" : secs ? `Raciocinou por ${secs}s` : "Raciocínio";
    details.classList.toggle("active", thinkingNow);
    details.querySelector(".t-body").textContent = msg.thinking;
  } else {
    slot.innerHTML = "";
  }

  // Conteúdo
  const content = el.querySelector(".content");
  if (msg.content) content.innerHTML = renderMarkdown(msg.content);
  else if (live && !msg.thinking) {
    content.innerHTML = `<div class="pending"><span class="shimmer">${escapeHtml(msg.statusText || "Pensando…")}</span></div>`;
  }
  else content.innerHTML = "";

  el.querySelector(".notices").innerHTML = [
    ...(msg.notices || []).map((n) => `<div class="notice">${escapeHtml(n)}</div>`),
    msg.error ? `<div class="notice error">${icon("warn")}<span>${escapeHtml(msg.error)}</span></div>` : "",
    msg.stopped ? `<div class="notice">Resposta interrompida.</div>` : "",
  ].join("");

  el.querySelector(".msg-meta").textContent = msg.modelLabel || "";
}

const messageEl = (id) => els.messages.querySelector(`.msg[data-id="${CSS.escape(id)}"]`);

els.messages.addEventListener("click", async (e) => {
  const codeBtn = e.target.closest(".code-btn");
  if (codeBtn) {
    await copyText(codeBtn.closest(".code-block").querySelector("pre code").textContent);
    codeBtn.classList.add("done");
    codeBtn.querySelector("span").textContent = "Copiado";
    setTimeout(() => {
      codeBtn.classList.remove("done");
      codeBtn.querySelector("span").textContent = "Copiar";
    }, 1500);
    return;
  }

  const act = e.target.closest("[data-act]");
  if (!act) return;
  const msgEl = act.closest(".msg");
  const chat = currentChat();
  const msg = chat?.messages.find((m) => m.id === msgEl.dataset.id);
  if (!msg) return;

  if (act.dataset.act === "copy") {
    await copyText(msg.content);
    act.innerHTML = icon("check");
    setTimeout(() => (act.innerHTML = icon("copy")), 1500);
  } else if (state.streaming) {
    return;
  } else if (act.dataset.act === "regen") {
    chat.messages.splice(chat.messages.indexOf(msg));
    while (msgEl.nextElementSibling) msgEl.nextElementSibling.remove();
    msgEl.remove();
    runAssistant(chat, { regenerate: true, fromMessageId: msg.id });
  } else if (act.dataset.act === "edit") {
    startEdit(msgEl, msg, chat);
  }
});

function startEdit(msgEl, msg, chat) {
  const bubble = msgEl.querySelector(".bubble");
  msgEl.classList.add("editing");
  bubble.innerHTML = `<textarea class="edit-area">${escapeHtml(msg.content)}</textarea>
    <div class="edit-bar"><button class="btn ghost small" data-edit="cancel">Cancelar</button><button class="btn primary small" data-edit="save">Enviar</button></div>`;
  const ta = bubble.querySelector("textarea");
  autosize(ta);
  ta.focus();
  ta.addEventListener("input", () => autosize(ta));
  bubble.addEventListener("click", function onClick(ev) {
    const b = ev.target.closest("[data-edit]");
    if (!b) return;
    bubble.removeEventListener("click", onClick);
    msgEl.classList.remove("editing");
    const text = ta.value.trim();
    if (b.dataset.edit === "cancel" || !text) {
      bubble.textContent = msg.content;
      return;
    }
    chat.messages.splice(chat.messages.indexOf(msg));
    while (msgEl.nextElementSibling) msgEl.nextElementSibling.remove();
    msgEl.remove();
    sendMessage(text, { editOf: msg.id });
  });
}

// ---------------- Envio e streaming ----------------

const provisionalTitle = (text) => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.slice(0, 48) + (clean.length > 48 ? "…" : "");
};

// editOf: id da mensagem do usuário que foi editada (ela e o que vinha depois são substituídos).
async function sendMessage(text, { editOf = null } = {}) {
  if (state.streaming) return;
  if (currentChat() && !currentChat().loaded) return toast("Aguarde a conversa carregar.");
  const chat = ensureChat();
  const userMsg = { id: uid(), role: "user", content: text, createdAt: Date.now() };
  chat.messages.push(userMsg);
  chat.updatedAt = Date.now();
  els.app.classList.remove("is-empty");
  els.messages.appendChild(renderMessage(userMsg));
  scrollToBottom(true);
  if (chat.messages.length === 1) {
    setTitle(chat, provisionalTitle(text));
    if (!store.cloud) generateTitle(chat, text); // na nuvem o servidor manda o título
  }
  await runAssistant(chat, { content: text, userMessageId: userMsg.id, editOf });
}

// op: { content, userMessageId, editOf } para mensagem nova, ou { regenerate, fromMessageId } para gerar de novo.
async function runAssistant(chat, op) {
  const msg = { id: uid(), role: "assistant", content: "", thinking: "", notices: [], createdAt: Date.now() };
  const base = { model: currentModel().id, timezone: TIMEZONE };
  // Nuvem: o servidor guarda o histórico e monta o contexto; vai só a mensagem nova.
  // Local: o histórico deste navegador vai inteiro a cada mensagem.
  const payload = store.cloud
    ? {
        ...base,
        conversationId: chat.id,
        newConversation: Boolean(chat.isNew),
        assistantMessageId: msg.id,
        ...(op.regenerate
          ? { regenerate: true, fromMessageId: op.fromMessageId }
          : { content: op.content, userMessageId: op.userMessageId, editMessageId: op.editOf || undefined }),
      }
    : { ...base, messages: chat.messages.map(({ role, content }) => ({ role, content })) };
  const controller = new AbortController();
  state.streaming = { controller, chatId: chat.id, msgId: msg.id };
  chat.messages.push(msg);
  els.messages.appendChild(renderMessage(msg));
  setBusy(true);
  renderHistory();
  scrollToBottom(true);

  let frame = 0;
  const paint = () => {
    frame = 0;
    const target = state.chatId === chat.id ? messageEl(msg.id) : null;
    if (!target) return;
    const stick = nearBottom();
    updateAssistant(target, msg);
    if (stick) scrollToBottom();
    updateToBottom();
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(paint);
  };

  let thinkStart = 0;
  let rejected = null;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: await apiHeaders(),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      let data = {};
      try {
        data = await res.json();
      } catch {
        // resposta sem JSON
      }
      if (res.status === 401 && data.auth) showAuth("Sua sessão expirou. Entre de novo para continuar.");
      const error = new Error(data.error || `Erro HTTP ${res.status}`);
      // Na nuvem, uma recusa antes do streaming significa que o servidor não guardou nada.
      if (store.cloud) Object.assign(error, { rejected: true, status: res.status, data });
      throw error;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const line = buffer.slice(0, idx).split("\n").find((l) => l.startsWith("data:"));
        buffer = buffer.slice(idx + 2);
        if (!line) continue;
        let ev;
        try {
          ev = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        if (ev.type === "meta") {
          msg.modelLabel = ev.label;
          chat.isNew = false;
        } else if (ev.type === "title") {
          setTitle(chat, ev.title);
        } else if (ev.type === "status") {
          msg.statusText = ev.text;
        } else if (ev.type === "thinking") {
          if (!thinkStart) thinkStart = Date.now();
          msg.statusText = "";
          msg.thinking += ev.text;
        } else if (ev.type === "text") {
          if (thinkStart && !msg.thinkingMs) msg.thinkingMs = Date.now() - thinkStart;
          msg.statusText = "";
          msg.content += ev.text;
        } else if (ev.type === "notice") msg.notices.push(ev.text);
        else if (ev.type === "error") msg.error = ev.message;
        schedule();
      }
    }
  } catch (err) {
    if (err.name === "AbortError") msg.stopped = true;
    else if (err.rejected) rejected = err;
    else msg.error = err.message || "Falha de conexão.";
  } finally {
    if (thinkStart && !msg.thinkingMs) msg.thinkingMs = Date.now() - thinkStart;
    state.streaming = null;
    if (frame) cancelAnimationFrame(frame);
    paint();
    setBusy(false);
    chat.updatedAt = Date.now();
    persist();
    renderHistory();
  }
  if (rejected) await undoRejected(chat, op, rejected);
}

function whenText(iso) {
  const t = new Date(iso);
  const hm = t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return t.toDateString() === new Date().toDateString() ? `às ${hm}` : `amanhã às ${hm}`;
}

// Nuvem: o servidor recusou (limite, conversa apagada, banco fora do ar…) sem guardar nada.
// Desfaz na tela, volta o texto para o campo e recarrega a conversa como ela está na conta.
async function undoRejected(chat, op, err) {
  const data = err.data || {};
  if (op.content && !els.input.value.trim()) {
    els.input.value = op.content;
    autosize(els.input);
    updateSend();
  }
  if (err.status !== 401) toast(data.limit && data.retryAt ? `${err.message} Tente de novo ${whenText(data.retryAt)}.` : err.message, "error");
  if (chat.isNew || data.gone) {
    store.deleteChat(chat.id);
    if (state.chatId === chat.id) newChat();
    else renderHistory();
    return;
  }
  try {
    await loadChat(chat);
  } catch {
    // mantém o que está na tela
  }
  if (state.chatId === chat.id) openChat(chat.id);
}

// Histórico local: título curto gerado pelo servidor.
async function generateTitle(chat, text) {
  try {
    const res = await fetch("/api/title", { method: "POST", headers: await apiHeaders(), body: JSON.stringify({ text }) });
    const { title } = await res.json();
    if (title) {
      setTitle(chat, title);
      persist();
    }
  } catch {
    // mantém o título provisório
  }
}

function setBusy(busy) {
  els.app.classList.toggle("is-busy", busy);
  els.send.innerHTML = icon(busy ? "stop" : "arrow-up");
  els.send.setAttribute("aria-label", busy ? "Parar" : "Enviar");
  els.send.title = busy ? "Parar (Esc)" : "Enviar (Enter)";
  updateSend();
}

function updateSend() {
  els.send.disabled = !state.streaming && !els.input.value.trim();
}

// ---------------- Composer ----------------

function autosize(ta) {
  ta.style.height = "auto";
  ta.style.height = `${Math.min(ta.scrollHeight, 280)}px`;
}

els.input.addEventListener("input", () => {
  autosize(els.input);
  updateSend();
});

els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !MOBILE.matches) {
    e.preventDefault();
    els.composer.requestSubmit();
  }
});

els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  if (state.streaming) {
    state.streaming.controller.abort();
    return;
  }
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = "";
  autosize(els.input);
  sendMessage(text);
});

els.starters.innerHTML = STARTERS.map(
  (s, i) => `<button class="starter" data-starter="${i}">${icon(s.icon)}<span>${escapeHtml(s.title)}</span></button>`,
).join("");
els.starters.querySelectorAll(".starter").forEach((b, i) => b.style.setProperty("--i", i));
els.starters.addEventListener("click", (e) => {
  const b = e.target.closest("[data-starter]");
  if (b) sendMessage(STARTERS[Number(b.dataset.starter)].prompt);
});

// ---------------- Rolagem ----------------

function nearBottom() {
  const t = els.thread;
  return t.scrollHeight - t.scrollTop - t.clientHeight < 140;
}

function scrollToBottom(force = false) {
  if (force || nearBottom()) els.thread.scrollTop = els.thread.scrollHeight;
}

function updateToBottom() {
  els.toBottom.classList.toggle("show", !els.app.classList.contains("is-empty") && !nearBottom());
}

els.thread.addEventListener("scroll", updateToBottom, { passive: true });
els.toBottom.addEventListener("click", () => {
  els.thread.scrollTo({ top: els.thread.scrollHeight, behavior: "smooth" });
});

// ---------------- Configurações ----------------

function openSettings() {
  loadEngine();
  renderAccount();
  els.historyHint.textContent = store.cloud
    ? "Suas conversas ficam salvas na sua conta e aparecem em qualquer aparelho em que você entrar."
    : "O histórico fica salvo só neste navegador.";
  els.profileSection.hidden = !store.cloud;
  els.settings.showModal();
  closeDrawer();
  if (store.cloud) loadProfile();
}

// ---------------- Personalização ----------------

function setProfileHint(text, kind = "") {
  els.profileHint.textContent = text;
  els.profileHint.className = `hint ${kind}`;
}

async function loadProfile() {
  setProfileHint("Vale para todas as suas conversas.");
  try {
    const profile = await cloud.profile();
    els.profileName.value = profile.name || "";
    els.profileAbout.value = profile.about || "";
  } catch (err) {
    setProfileHint(err.message, "error");
  }
}

els.profileSave.addEventListener("click", async () => {
  els.profileSave.disabled = true;
  setProfileHint("Salvando…");
  try {
    const profile = await cloud.saveProfile({ name: els.profileName.value, about: els.profileAbout.value });
    els.profileName.value = profile.name || "";
    els.profileAbout.value = profile.about || "";
    setProfileHint("Salvo. Vale a partir da próxima mensagem.", "ok");
  } catch (err) {
    setProfileHint(err.message, "error");
  } finally {
    els.profileSave.disabled = false;
  }
});

$("#open-settings").addEventListener("click", openSettings);
$("#engine-btn").addEventListener("click", openSettings);

$("#clear-all").addEventListener("click", async () => {
  const question = store.cloud
    ? "Apagar todas as suas conversas? Elas somem da sua conta em todos os aparelhos."
    : "Apagar todas as conversas deste navegador?";
  if (!confirm(question)) return;
  state.streaming?.controller.abort();
  if (store.cloud) {
    try {
      await cloud.removeAll();
    } catch (err) {
      return toast(err.message, "error");
    }
  }
  store.clear();
  els.settings.close();
  newChat();
});

els.settings.addEventListener("click", (e) => {
  if (e.target === els.settings || e.target.closest("[data-close]")) els.settings.close();
});

// ---------------- Cadastro e login ----------------

function setAuthStatus(text, kind = "") {
  els.authStatus.textContent = text;
  els.authStatus.className = `key-status ${kind}`;
}

const AUTH_MODES = {
  login: { title: "Entrar no KIRA", submit: "Entrar", status: "" },
  signup: { title: "Criar conta no KIRA", submit: "Criar conta", status: "A senha precisa ter pelo menos 8 caracteres." },
  reset: { title: "Recuperar senha", submit: "Enviar link", status: "Enviaremos um link para você criar uma nova senha." },
  newpass: { title: "Definir nova senha", submit: "Salvar nova senha", status: "A senha precisa ter pelo menos 8 caracteres." },
};

function setAuthMode(mode) {
  state.authMode = mode;
  const conf = AUTH_MODES[mode];
  els.auth.querySelectorAll("[data-mode]").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
    b.setAttribute("aria-selected", String(b.dataset.mode === mode));
  });
  els.authTabs.hidden = mode === "reset" || mode === "newpass";
  $("#auth-name-wrap").hidden = mode !== "signup";
  els.authEmailWrap.hidden = mode === "newpass";
  els.authPasswordWrap.hidden = mode === "reset";
  els.authForgot.hidden = mode !== "login";
  els.authBack.hidden = mode !== "reset";
  els.authTitle.textContent = conf.title;
  els.authSubmit.textContent = conf.submit;
  els.authPasswordLabel.textContent = mode === "newpass" ? "Nova senha" : "Senha";
  els.authPassword.autocomplete = mode === "signup" || mode === "newpass" ? "new-password" : "current-password";
  setAuthStatus(conf.status);
}

function showAuth(message = "") {
  if (!authClient()) {
    toast("Não foi possível carregar o login. Recarregue a página.", "error");
    return;
  }
  state.streaming?.controller.abort();
  els.settings.open && els.settings.close();
  document.body.classList.add("booting");
  els.auth.hidden = false;
  if (message) setAuthStatus(message, "error");
  (els.authEmail.value ? els.authPassword : els.authEmail).focus();
}

function renderAccount() {
  const user = state.user;
  els.account.hidden = !user;
  if (!user) return;
  $("#account-email").textContent = user.email || "";
  $("#account-name").textContent = user.user_metadata?.name || "Conectado";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Abre o app para a conta atual (ou sem conta, quando o login está desligado).
async function enterApp(user) {
  state.user = user;
  store.useAccount(user?.id ?? null, Boolean(user) && historyInCloud());
  els.auth.hidden = true;
  document.body.classList.remove("booting");
  const fromHash = location.hash.slice(1);
  if (!store.cloud) {
    if (fromHash && store.getChat(fromHash)?.messages.length) openChat(fromHash);
    else newChat();
    return;
  }
  // Nuvem: abre a conversa do link (se houver) enquanto a lista carrega.
  if (UUID.test(fromHash)) {
    store.chats = [{ id: fromHash, title: "", messages: [], loaded: false, createdAt: 0, updatedAt: 0 }];
    openChat(fromHash);
  } else {
    newChat();
  }
  await syncHistory();
}

// Nuvem: leva para a conta as conversas que estavam só neste navegador e carrega a lista.
async function syncHistory() {
  state.historyLoading = true;
  renderHistory();
  const pending = store.pendingLocal();
  if (pending.length) {
    const result = await cloud.importLocal(pending);
    if (result.done.length) store.forgetLocal(result.done);
    if (result.imported) {
      toast(result.imported === 1 ? "1 conversa deste navegador foi salva na sua conta." : `${result.imported} conversas deste navegador foram salvas na sua conta.`);
    }
  }
  try {
    store.setRemote(await cloud.list());
  } catch (err) {
    toast(`Não foi possível carregar suas conversas: ${err.message}`, "error");
  }
  state.historyLoading = false;
  renderHistory();
  const chat = currentChat();
  if (chat?.title) els.chatTitle.textContent = chat.title;
}

els.auth.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setAuthMode(b.dataset.mode)));

$("#auth-toggle").addEventListener("click", (e) => {
  const reveal = els.authPassword.type === "password";
  els.authPassword.type = reveal ? "text" : "password";
  e.currentTarget.innerHTML = icon(reveal ? "eye-off" : "eye");
  e.currentTarget.setAttribute("aria-label", reveal ? "Esconder senha" : "Mostrar senha");
});

els.authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const client = authClient();
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  const mode = state.authMode;
  const signup = mode === "signup";
  if (mode === "reset") return requestReset(client, email);
  if (mode === "newpass") return saveNewPassword(client, password);
  if (!email || !password) return setAuthStatus("Preencha o email e a senha.", "error");
  if (signup && password.length < 8) return setAuthStatus("A senha precisa ter pelo menos 8 caracteres.", "error");

  els.authSubmit.disabled = true;
  setAuthStatus(signup ? "Criando a sua conta…" : "Entrando…");
  try {
    const { data, error } = signup
      ? await client.auth.signUp({
          email,
          password,
          options: { data: { name: els.authName.value.trim() }, emailRedirectTo: location.origin },
        })
      : await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!data.session) {
      setAuthMode("login");
      setAuthStatus("Conta criada! Confirme o seu email pelo link que enviamos e depois entre aqui.", "ok");
      return;
    }
    els.authPassword.value = "";
    enterApp(data.session.user);
    if (signup) toast("Conta criada. Bem-vindo ao KIRA!");
  } catch (err) {
    setAuthStatus(describeAuthError(err), "error");
  } finally {
    els.authSubmit.disabled = false;
  }
});

// Recuperar senha: a Supabase manda um link que volta para o app em modo "nova senha".
async function requestReset(client, email) {
  if (!email) return setAuthStatus("Informe o seu email.", "error");
  els.authSubmit.disabled = true;
  setAuthStatus("Enviando…");
  try {
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/` });
    if (error) throw error;
    setAuthStatus("Se houver uma conta com este email, enviamos um link para criar uma nova senha. Confira também o spam.", "ok");
  } catch (err) {
    setAuthStatus(describeAuthError(err), "error");
  } finally {
    els.authSubmit.disabled = false;
  }
}

async function saveNewPassword(client, password) {
  if (password.length < 8) return setAuthStatus("A senha precisa ter pelo menos 8 caracteres.", "error");
  els.authSubmit.disabled = true;
  setAuthStatus("Salvando…");
  try {
    const { data, error } = await client.auth.updateUser({ password });
    if (error) throw error;
    els.authPassword.value = "";
    toast("Senha alterada.");
    enterApp(data.user);
  } catch (err) {
    setAuthStatus(describeAuthError(err), "error");
  } finally {
    els.authSubmit.disabled = false;
  }
}

els.authForgot.addEventListener("click", () => {
  setAuthMode("reset");
  els.authEmail.focus();
});
els.authBack.addEventListener("click", () => setAuthMode("login"));

$("#sign-out").addEventListener("click", async () => {
  state.streaming?.controller.abort();
  els.settings.close();
  await authClient()?.auth.signOut();
  state.user = null;
  store.chats = [];
  store.cloud = false;
  els.messages.innerHTML = "";
  renderHistory();
  setAuthMode("login");
  showAuth();
});

// ---------------- Atalhos ----------------

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    newChat();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b" && !MOBILE.matches) {
    e.preventDefault();
    setCollapsed(!els.app.classList.contains("collapsed"));
  } else if (e.key === "Escape" && state.streaming && !els.settings.open) {
    state.streaming.controller.abort();
  }
});

// ---------------- Início ----------------

hydrateIcons();
if (store.getPref("collapsed") && !MOBILE.matches) els.app.classList.add("collapsed");
setBusy(false);
renderEngine();
loadEngine();

(async () => {
  const client = await initAuth();
  if (!client) return enterApp(null);
  const user = await currentUser(); // espera o login ler a sessão do link de email, se houver
  // Tira do endereço os dados do link de email.
  if (AUTH_HASH.has("type") || AUTH_HASH.has("error")) history.replaceState(null, "", location.pathname);
  if (user && RECOVERY) {
    setAuthMode("newpass");
    return showAuth();
  }
  if (user) return enterApp(user);
  setAuthMode("login");
  showAuth(AUTH_LINK_ERROR || "");
})();
