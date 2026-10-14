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
  chatTitle: $("#chat-title"),
  engineLabel: $("#engine-label"),
  engineSub: $("#engine-sub"),
  settings: $("#settings"),
  apiKey: $("#api-key"),
  keyStatus: $("#key-status"),
  toasts: $("#toasts"),
};

const CLAUDE_LABEL = "Claude Opus 5.5";

const state = {
  chatId: null,
  streaming: null, // { controller, chatId, msgId }
  defaultLabel: "IAHack Free",
};

// ---------------- Utilidades ----------------

function toast(text, kind = "info") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = text;
  els.toasts.appendChild(el);
  setTimeout(() => el.classList.add("out"), 3000);
  setTimeout(() => el.remove(), 3400);
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

function headers() {
  const h = { "content-type": "application/json" };
  if (store.apiKey) h["x-api-key"] = store.apiKey;
  return h;
}

function persist() {
  const result = store.saveChats();
  if (result === "trimmed") toast("Armazenamento cheio: conversas antigas foram removidas.", "error");
  else if (!result) toast("Não foi possível salvar a conversa.", "error");
}

// ---------------- Modelo ativo ----------------

function renderEngine() {
  const label = store.apiKey ? CLAUDE_LABEL : state.defaultLabel;
  els.engineLabel.textContent = label;
  els.engineSub.textContent = store.apiKey ? `${CLAUDE_LABEL} · sua chave` : `${state.defaultLabel} · sem chave`;
}

async function loadEngine() {
  try {
    const res = await fetch("/api/key");
    if (res.ok) state.defaultLabel = (await res.json()).default || state.defaultLabel;
  } catch {
    // mantém o rótulo padrão
  }
  renderEngine();
}

// ---------------- Histórico ----------------

function renderHistory() {
  const chats = store.chats.filter((c) => c.messages.length).sort((a, b) => b.updatedAt - a.updatedAt);
  if (!chats.length) {
    els.history.innerHTML = `<p class="history-empty">Suas conversas aparecerão aqui.</p>`;
    return;
  }
  els.history.innerHTML = chats
    .map(
      (c) => `<div class="h-item ${c.id === state.chatId ? "active" : ""}">
        <button class="h-open" data-open="${c.id}" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</button>
        <button class="h-del" data-delete="${c.id}" title="Apagar" aria-label="Apagar conversa">${icon("trash")}</button>
      </div>`,
    )
    .join("");
}

els.history.addEventListener("click", (e) => {
  const del = e.target.closest("[data-delete]");
  const open = e.target.closest("[data-open]");
  if (del) {
    const chat = store.getChat(del.dataset.delete);
    if (!chat || !confirm(`Apagar "${chat.title}"?`)) return;
    if (state.streaming?.chatId === chat.id) state.streaming.controller.abort();
    store.deleteChat(chat.id);
    if (state.chatId === chat.id) newChat();
    renderHistory();
  } else if (open) {
    openChat(open.dataset.open);
    closeSidebar();
  }
});

els.chatTitle.addEventListener("click", () => {
  const chat = currentChat();
  if (!chat?.messages.length) return;
  const title = prompt("Nome da conversa:", chat.title);
  if (title?.trim()) {
    chat.title = title.trim().slice(0, 80);
    els.chatTitle.textContent = chat.title;
    persist();
    renderHistory();
  }
});

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
  els.input.focus();
}

function openChat(id) {
  const chat = store.getChat(id);
  if (!chat) return newChat();
  state.chatId = id;
  els.chatTitle.textContent = chat.title;
  els.app.classList.toggle("is-empty", !chat.messages.length);
  els.messages.innerHTML = "";
  chat.messages.forEach((m) => els.messages.appendChild(renderMessage(m)));
  renderHistory();
  scrollToBottom(true);
  history.replaceState(null, "", `#${id}`);
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
      <div class="thinking-slot"></div>
      <div class="content prose"></div>
      <div class="notices"></div>
      <div class="msg-foot">
        <span class="live-mark">${icon("logo")}</span>
        <div class="msg-actions">
          <button data-act="copy" title="Copiar">${icon("copy")}</button>
          <button data-act="regen" title="Gerar novamente">${icon("refresh")}</button>
          <span class="msg-meta"></span>
        </div>
      </div>`;
    updateAssistant(el, msg);
  }
  return el;
}

function updateAssistant(el, msg) {
  const live = state.streaming?.msgId === msg.id;
  el.classList.toggle("live", live);

  const slot = el.querySelector(".thinking-slot");
  if (msg.thinking) {
    let details = slot.querySelector("details");
    if (!details) {
      slot.innerHTML = `<details class="thinking"><summary><span class="t-label"></span>${icon("chevron")}</summary><div class="t-body"></div></details>`;
      details = slot.querySelector("details");
    }
    const thinkingNow = live && !msg.content;
    const secs = msg.thinkingMs ? Math.max(1, Math.round(msg.thinkingMs / 1000)) : 0;
    details.querySelector(".t-label").textContent = thinkingNow ? "Pensando" : secs ? `Pensou por ${secs}s` : "Pensamento";
    details.classList.toggle("active", thinkingNow);
    details.querySelector(".t-body").textContent = msg.thinking;
  } else {
    slot.innerHTML = "";
  }

  el.querySelector(".content").innerHTML = msg.content ? renderMarkdown(msg.content) : "";

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
    runAssistant(chat);
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
    sendMessage(text);
  });
}

// ---------------- Envio e streaming ----------------

async function sendMessage(text) {
  if (state.streaming) return;
  const chat = ensureChat();
  const userMsg = { id: uid(), role: "user", content: text, createdAt: Date.now() };
  chat.messages.push(userMsg);
  chat.updatedAt = Date.now();
  els.app.classList.remove("is-empty");
  els.messages.appendChild(renderMessage(userMsg));
  scrollToBottom(true);
  if (chat.messages.length === 1) generateTitle(chat, text);
  await runAssistant(chat);
}

async function runAssistant(chat) {
  const msg = { id: uid(), role: "assistant", content: "", thinking: "", notices: [], createdAt: Date.now() };
  const payload = { messages: chat.messages.map(({ role, content }) => ({ role, content })) };
  const controller = new AbortController();
  state.streaming = { controller, chatId: chat.id, msgId: msg.id };
  chat.messages.push(msg);
  els.messages.appendChild(renderMessage(msg));
  setBusy(true);
  scrollToBottom(true);

  let frame = 0;
  const paint = () => {
    frame = 0;
    const target = state.chatId === chat.id ? messageEl(msg.id) : null;
    if (!target) return;
    const stick = nearBottom();
    updateAssistant(target, msg);
    if (stick) scrollToBottom();
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(paint);
  };

  let thinkStart = 0;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      let err = `Erro HTTP ${res.status}`;
      try {
        err = (await res.json()).error || err;
      } catch {
        // resposta sem JSON
      }
      throw new Error(err);
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
        if (ev.type === "meta") msg.modelLabel = ev.label;
        else if (ev.type === "thinking") {
          if (!thinkStart) thinkStart = Date.now();
          msg.thinking += ev.text;
        } else if (ev.type === "text") {
          if (thinkStart && !msg.thinkingMs) msg.thinkingMs = Date.now() - thinkStart;
          msg.content += ev.text;
        } else if (ev.type === "notice") msg.notices.push(ev.text);
        else if (ev.type === "error") msg.error = ev.message;
        schedule();
      }
    }
  } catch (err) {
    if (err.name === "AbortError") msg.stopped = true;
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
}

async function generateTitle(chat, text) {
  chat.title = text.replace(/\s+/g, " ").slice(0, 48) + (text.length > 48 ? "…" : "");
  if (state.chatId === chat.id) els.chatTitle.textContent = chat.title;
  renderHistory();
  try {
    const res = await fetch("/api/title", { method: "POST", headers: headers(), body: JSON.stringify({ text }) });
    const { title } = await res.json();
    if (title) {
      chat.title = title;
      if (state.chatId === chat.id) els.chatTitle.textContent = title;
      persist();
      renderHistory();
    }
  } catch {
    // mantém o título provisório
  }
}

function setBusy(busy) {
  els.app.classList.toggle("is-busy", busy);
  els.send.innerHTML = icon(busy ? "stop" : "arrow-up");
  els.send.setAttribute("aria-label", busy ? "Parar" : "Enviar");
  updateSend();
}

function updateSend() {
  els.send.disabled = !state.streaming && !els.input.value.trim();
}

// ---------------- Composer ----------------

function autosize(ta) {
  ta.style.height = "auto";
  ta.style.height = `${Math.min(ta.scrollHeight, 300)}px`;
}

els.input.addEventListener("input", () => {
  autosize(els.input);
  updateSend();
});

els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
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

function nearBottom() {
  const t = els.thread;
  return t.scrollHeight - t.scrollTop - t.clientHeight < 140;
}

function scrollToBottom(force = false) {
  if (force || nearBottom()) els.thread.scrollTop = els.thread.scrollHeight;
}

// ---------------- Configurações (chave da API) ----------------

function setKeyStatus(text, kind = "") {
  els.keyStatus.textContent = text;
  els.keyStatus.className = `key-status ${kind}`;
}

function openSettings() {
  els.apiKey.value = store.apiKey;
  els.apiKey.type = "password";
  $("#toggle-key").innerHTML = icon("eye");
  setKeyStatus(store.apiKey ? `Conectado: ${CLAUDE_LABEL}` : "", store.apiKey ? "ok" : "");
  els.settings.showModal();
  closeSidebar();
}

$("#open-settings").addEventListener("click", openSettings);
$("#engine-btn").addEventListener("click", openSettings);

$("#toggle-key").addEventListener("click", (e) => {
  const show = els.apiKey.type === "password";
  els.apiKey.type = show ? "text" : "password";
  e.currentTarget.innerHTML = icon(show ? "eye-off" : "eye");
});

$("#settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = els.apiKey.value.trim();
  if (!key) {
    store.setApiKey("");
    renderEngine();
    els.settings.close();
    return;
  }
  const btn = $("#save-key");
  btn.disabled = true;
  setKeyStatus("Verificando a chave…");
  try {
    const res = await fetch("/api/key", { method: "POST", headers: { "x-api-key": key } });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Chave inválida.");
    store.setApiKey(key);
    renderEngine();
    els.settings.close();
    toast(`Conectado ao ${CLAUDE_LABEL}.`);
  } catch (err) {
    setKeyStatus(err.message, "error");
  } finally {
    btn.disabled = false;
  }
});

$("#remove-key").addEventListener("click", () => {
  store.setApiKey("");
  els.apiKey.value = "";
  setKeyStatus("Chave removida. Usando o modelo gratuito.");
  renderEngine();
});

$("#clear-all").addEventListener("click", () => {
  if (!confirm("Apagar todas as conversas deste navegador?")) return;
  state.streaming?.controller.abort();
  store.chats = [];
  store.saveChats();
  els.settings.close();
  newChat();
});

els.settings.addEventListener("click", (e) => {
  if (e.target === els.settings || e.target.closest("[data-close]")) els.settings.close();
});

// ---------------- Navegação ----------------

const closeSidebar = () => els.app.classList.remove("sidebar-open");
$("#open-sidebar").addEventListener("click", () => els.app.classList.add("sidebar-open"));
$("#close-sidebar").addEventListener("click", closeSidebar);
$("#scrim").addEventListener("click", closeSidebar);
$("#new-chat").addEventListener("click", () => {
  newChat();
  closeSidebar();
});
$("#brand-link").addEventListener("click", (e) => {
  e.preventDefault();
  newChat();
});

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    newChat();
  } else if (e.key === "Escape" && state.streaming && !els.settings.open) {
    state.streaming.controller.abort();
  }
});

// ---------------- Início ----------------

hydrateIcons();
setBusy(false);
renderEngine();
loadEngine();
const fromHash = location.hash.slice(1);
if (fromHash && store.getChat(fromHash)?.messages.length) openChat(fromHash);
else newChat();
