import { hydrateIcons, icon } from "./icons.js";
import { escapeHtml, highlightCode, renderMarkdown } from "./markdown.js";
import { store, uid } from "./store.js";
import { mountTools } from "./tools.js";
import { AGENT_META, SUGGESTIONS } from "./suggestions.js";

const $ = (sel, root = document) => root.querySelector(sel);

const els = {
  app: $("#app"),
  sidebar: $("#sidebar"),
  scrim: $("#scrim"),
  history: $("#history"),
  search: $("#search"),
  thread: $("#thread"),
  welcome: $("#welcome"),
  greeting: $("#greeting"),
  messages: $("#messages"),
  suggestions: $("#suggestions"),
  composer: $("#composer"),
  input: $("#input"),
  send: $("#send"),
  attach: $("#attach"),
  fileInput: $("#file-input"),
  attachments: $("#attachments"),
  chatTitle: $("#chat-title"),
  modelBtn: $("#model-btn"),
  modelLabel: $("#model-label"),
  modelMenu: $("#model-menu"),
  agentBtn: $("#agent-btn"),
  agentLabel: $("#agent-label"),
  agentMenu: $("#agent-menu"),
  effortDropdown: $("#effort-dropdown"),
  effortBtn: $("#effort-btn"),
  effortLabel: $("#effort-label"),
  effortMenu: $("#effort-menu"),
  panel: $("#panel"),
  panelTitle: $("#panel-title"),
  panelBody: $("#panel-body"),
  statusText: $("#status-text"),
  statusLine: $("#status-line"),
  toasts: $("#toasts"),
  toolsModal: $("#tools-modal"),
  settingsModal: $("#settings-modal"),
};

const EFFORTS = [
  { id: "low", label: "Rápido", hint: "Pensa pouco, responde logo" },
  { id: "medium", label: "Equilibrado", hint: "Bom para a maioria dos casos" },
  { id: "high", label: "Profundo", hint: "Mais raciocínio em tarefas difíceis" },
];

const MAX_ATTACHMENT = 300 * 1024;
const PASTE_TO_FILE = 6000;

const state = {
  config: { models: [], agents: [], defaultModel: "", requiresAccessCode: false },
  chatId: null,
  streaming: null, // { controller, chatId, msgId }
  pending: [], // anexos aguardando envio
  panelCode: null,
};

// ---------------- Utilidades ----------------

function toast(text, kind = "info") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === "error" ? "warn" : "check")}<span>${escapeHtml(text)}</span>`;
  els.toasts.appendChild(el);
  setTimeout(() => el.classList.add("out"), 3200);
  setTimeout(() => el.remove(), 3600);
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

function download(name, content, type = "text/plain") {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fmtTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const fmtSize = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "conversa";

function currentChat() {
  return state.chatId ? store.getChat(state.chatId) : null;
}

function modelById(id) {
  return state.config.models.find((m) => m.id === id) || null;
}

function selectedModel() {
  return modelById(store.settings.model) || modelById(state.config.defaultModel) || state.config.models[0] || null;
}

function apiHeaders() {
  const h = { "content-type": "application/json" };
  if (store.settings.accessCode) h["x-access-code"] = store.settings.accessCode;
  return h;
}

// ---------------- Configuração / modelos ----------------

async function loadConfig() {
  try {
    const res = await fetch("/api/models");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.config = await res.json();
    const n = state.config.models.length;
    els.statusText.textContent = n ? `Online · ${n} modelos` : "Nenhum modelo disponível";
    els.statusLine.classList.toggle("ok", n > 0);
  } catch {
    els.statusText.textContent = "Offline — API indisponível";
    els.statusLine.classList.add("bad");
  }
  if (!modelById(store.settings.model)) store.settings.model = state.config.defaultModel || "";
  $("#access-field").hidden = !state.config.requiresAccessCode;
  renderModelMenu();
  renderAgentMenu();
  renderEffortMenu();
}

function renderModelMenu() {
  const model = selectedModel();
  els.modelLabel.textContent = model ? model.label : "Sem modelos";
  const groups = [
    ["workers-ai", "Cloudflare Workers AI"],
    ["anthropic", "Anthropic Claude"],
  ];
  els.modelMenu.innerHTML = groups
    .map(([provider, title]) => {
      const list = state.config.models.filter((m) => m.provider === provider);
      if (!list.length) return "";
      return `<div class="menu-group">${title}</div>${list
        .map(
          (m) => `<button class="menu-item ${model && m.id === model.id ? "selected" : ""}" data-model="${m.id}" role="option">
            <span class="mi-main"><span class="mi-title">${escapeHtml(m.label)}${m.reasoning ? `<span class="tag">raciocínio</span>` : ""}</span>
            <span class="mi-sub">${escapeHtml(m.description)}</span></span>
            <span class="mi-check">${icon("check")}</span>
          </button>`,
        )
        .join("")}`;
    })
    .join("");
  els.effortDropdown.hidden = !(model && model.effort);
}

function renderAgentMenu() {
  const agents = state.config.agents.length ? state.config.agents : [{ id: "geral", name: "IAHack" }];
  if (!agents.find((a) => a.id === store.settings.agent)) store.settings.agent = "geral";
  const active = agents.find((a) => a.id === store.settings.agent);
  els.agentLabel.textContent = active.name;
  els.agentBtn.querySelector("svg").outerHTML = icon(AGENT_META[active.id]?.icon || "shield");
  els.agentMenu.innerHTML = `<div class="menu-group">Especialista</div>${agents
    .map(
      (a) => `<button class="menu-item ${a.id === active.id ? "selected" : ""}" data-agent="${a.id}" role="option">
        <span class="mi-icon">${icon(AGENT_META[a.id]?.icon || "shield")}</span>
        <span class="mi-main"><span class="mi-title">${escapeHtml(a.name)}</span><span class="mi-sub">${escapeHtml(AGENT_META[a.id]?.hint || "")}</span></span>
        <span class="mi-check">${icon("check")}</span>
      </button>`,
    )
    .join("")}`;
  renderSuggestions();
}

function renderEffortMenu() {
  const active = EFFORTS.find((e) => e.id === store.settings.effort) || EFFORTS[1];
  els.effortLabel.textContent = active.label;
  els.effortMenu.innerHTML = `<div class="menu-group">Raciocínio</div>${EFFORTS.map(
    (e) => `<button class="menu-item ${e.id === active.id ? "selected" : ""}" data-effort="${e.id}" role="option">
      <span class="mi-main"><span class="mi-title">${e.label}</span><span class="mi-sub">${e.hint}</span></span>
      <span class="mi-check">${icon("check")}</span>
    </button>`,
  ).join("")}`;
}

function renderSuggestions() {
  const list = SUGGESTIONS[store.settings.agent] || SUGGESTIONS.geral;
  els.suggestions.innerHTML = list
    .map(
      (s, i) => `<button class="suggestion" data-suggestion="${i}" style="--i:${i}">
        <span class="s-icon">${icon(s.icon)}</span>
        <span class="s-title">${escapeHtml(s.title)}</span>
      </button>`,
    )
    .join("");
}

// ---------------- Dropdowns ----------------

function closeMenus(except) {
  document.querySelectorAll(".dropdown.open").forEach((d) => d !== except && d.classList.remove("open"));
}

document.addEventListener("click", (e) => {
  const trigger = e.target.closest(".dropdown > button");
  if (trigger) {
    const dd = trigger.parentElement;
    closeMenus(dd);
    dd.classList.toggle("open");
    return;
  }
  if (!e.target.closest(".menu")) closeMenus();
});

els.modelMenu.addEventListener("click", (e) => {
  const item = e.target.closest("[data-model]");
  if (!item) return;
  store.settings.model = item.dataset.model;
  store.saveSettings();
  renderModelMenu();
  closeMenus();
  els.input.focus();
});

els.agentMenu.addEventListener("click", (e) => {
  const item = e.target.closest("[data-agent]");
  if (!item) return;
  store.settings.agent = item.dataset.agent;
  store.saveSettings();
  const chat = currentChat();
  if (chat && !chat.messages.length) chat.agent = store.settings.agent;
  renderAgentMenu();
  closeMenus();
  els.input.focus();
});

els.effortMenu.addEventListener("click", (e) => {
  const item = e.target.closest("[data-effort]");
  if (!item) return;
  store.settings.effort = item.dataset.effort;
  store.saveSettings();
  renderEffortMenu();
  closeMenus();
});

// ---------------- Histórico ----------------

function groupLabel(ts) {
  const day = 86400000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t = today.getTime();
  if (ts >= t) return "Hoje";
  if (ts >= t - day) return "Ontem";
  if (ts >= t - 7 * day) return "Últimos 7 dias";
  if (ts >= t - 30 * day) return "Últimos 30 dias";
  return "Mais antigas";
}

function renderHistory() {
  const q = els.search.value.trim().toLowerCase();
  const chats = store.chats
    .filter((c) => c.messages.length)
    .filter((c) => !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (!chats.length) {
    els.history.innerHTML = `<p class="history-empty">${q ? "Nada encontrado." : "Suas conversas aparecerão aqui."}</p>`;
    return;
  }

  const groups = new Map();
  const pinned = chats.filter((c) => c.pinned);
  if (pinned.length) groups.set("Fixadas", pinned);
  for (const c of chats.filter((c) => !c.pinned)) {
    const g = groupLabel(c.updatedAt);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }

  els.history.innerHTML = [...groups.entries()]
    .map(
      ([label, list]) => `<div class="h-group"><div class="h-label">${label}</div>${list
        .map(
          (c) => `<div class="h-item ${c.id === state.chatId ? "active" : ""}" data-chat="${c.id}">
            <button class="h-open" data-open="${c.id}" title="${escapeHtml(c.title)}">
              ${c.pinned ? `<span class="h-pin">${icon("pin")}</span>` : ""}
              <span class="h-title">${escapeHtml(c.title)}</span>
              ${state.streaming?.chatId === c.id ? `<span class="h-live"></span>` : ""}
            </button>
            <div class="h-actions">
              <button data-pin="${c.id}" title="${c.pinned ? "Desafixar" : "Fixar"}">${icon("pin")}</button>
              <button data-rename="${c.id}" title="Renomear">${icon("edit")}</button>
              <button data-delete="${c.id}" title="Apagar">${icon("trash")}</button>
            </div>
          </div>`,
        )
        .join("")}</div>`,
    )
    .join("");
}

els.history.addEventListener("click", (e) => {
  const open = e.target.closest("[data-open]");
  const pin = e.target.closest("[data-pin]");
  const rename = e.target.closest("[data-rename]");
  const del = e.target.closest("[data-delete]");
  if (pin) {
    const chat = store.getChat(pin.dataset.pin);
    chat.pinned = !chat.pinned;
    store.saveChats();
    renderHistory();
  } else if (rename) {
    renameChat(rename.dataset.rename);
  } else if (del) {
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

els.search.addEventListener("input", renderHistory);

function renameChat(id) {
  const chat = store.getChat(id);
  if (!chat) return;
  const title = prompt("Novo nome da conversa:", chat.title);
  if (title && title.trim()) {
    chat.title = title.trim().slice(0, 80);
    store.saveChats();
    renderHistory();
    if (id === state.chatId) els.chatTitle.textContent = chat.title;
  }
}

els.chatTitle.addEventListener("click", () => state.chatId && currentChat()?.messages.length && renameChat(state.chatId));

// ---------------- Conversa ----------------

function setGreeting() {
  const h = new Date().getHours();
  const part = h < 5 ? "Boa madrugada" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const who = store.settings.name?.trim() || "defensor";
  const text = `${part}, ${who}.`;
  els.greeting.textContent = "";
  els.greeting.dataset.text = text;
  let i = 0;
  clearInterval(setGreeting.timer);
  setGreeting.timer = setInterval(() => {
    els.greeting.textContent = text.slice(0, ++i);
    if (i >= text.length) clearInterval(setGreeting.timer);
  }, 28);
}

function newChat() {
  state.chatId = null;
  els.chatTitle.textContent = "Nova conversa";
  els.messages.innerHTML = "";
  els.app.classList.add("is-empty");
  setGreeting();
  renderHistory();
  renderSuggestions();
  els.input.focus();
}

function openChat(id) {
  const chat = store.getChat(id);
  if (!chat) return newChat();
  state.chatId = id;
  if (chat.agent) {
    store.settings.agent = chat.agent;
    renderAgentMenu();
  }
  els.chatTitle.textContent = chat.title;
  els.app.classList.toggle("is-empty", !chat.messages.length);
  els.messages.innerHTML = "";
  chat.messages.forEach((m) => els.messages.appendChild(renderMessage(m)));
  hydrateIcons(els.messages);
  renderHistory();
  scrollToBottom(true);
  history.replaceState(null, "", `#${id}`);
}

function ensureChat() {
  let chat = currentChat();
  if (!chat) {
    chat = store.createChat({ agent: store.settings.agent, model: store.settings.model });
    state.chatId = chat.id;
    history.replaceState(null, "", `#${chat.id}`);
  }
  return chat;
}

// ---------------- Renderização de mensagens ----------------

function renderMessage(msg) {
  const el = document.createElement("article");
  el.className = `msg ${msg.role}`;
  el.dataset.id = msg.id;
  if (msg.role === "user") {
    const files = (msg.attachments || [])
      .map((a) => `<span class="file-chip">${icon("file")}<span>${escapeHtml(a.name)}</span><small>${fmtSize(a.size)}</small></span>`)
      .join("");
    el.innerHTML = `
      ${files ? `<div class="msg-files">${files}</div>` : ""}
      <div class="bubble">${escapeHtml(msg.content)}</div>
      <div class="msg-actions">
        <button data-act="copy" title="Copiar">${icon("copy")}</button>
        <button data-act="edit" title="Editar e reenviar">${icon("edit")}</button>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="avatar">${icon("logo")}</div>
      <div class="msg-body">
        <div class="thinking-slot"></div>
        <div class="content markdown"></div>
        <div class="notices"></div>
        <div class="msg-foot">
          <div class="msg-actions">
            <button data-act="copy" title="Copiar">${icon("copy")}</button>
            <button data-act="regen" title="Gerar novamente">${icon("refresh")}</button>
          </div>
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

  // Raciocínio
  const slot = el.querySelector(".thinking-slot");
  if (msg.thinking) {
    let details = slot.querySelector("details");
    if (!details) {
      slot.innerHTML = `<details class="thinking"><summary><span class="t-icon">${icon("brain")}</span><span class="t-label"></span>${icon("chevron")}</summary><div class="t-body"></div></details>`;
      details = slot.querySelector("details");
    }
    const thinkingNow = live && !msg.content;
    const secs = msg.thinkingMs ? Math.max(1, Math.round(msg.thinkingMs / 1000)) : null;
    details.querySelector(".t-label").textContent = thinkingNow ? "Pensando" : secs ? `Raciocinou por ${secs}s` : "Raciocínio";
    details.classList.toggle("active", thinkingNow);
    details.querySelector(".t-body").textContent = msg.thinking;
    if (thinkingNow) {
      const body = details.querySelector(".t-body");
      body.scrollTop = body.scrollHeight;
    }
  } else {
    slot.innerHTML = "";
  }

  // Conteúdo
  const content = el.querySelector(".content");
  if (msg.content) {
    content.innerHTML = renderMarkdown(msg.content);
    if (live) content.insertAdjacentHTML("beforeend", `<span class="caret"></span>`);
  } else if (live && !msg.thinking) {
    content.innerHTML = `<div class="loader"><span></span><span></span><span></span><em>Analisando…</em></div>`;
  } else {
    content.innerHTML = "";
  }

  // Avisos e erros
  const notices = el.querySelector(".notices");
  notices.innerHTML = [
    ...(msg.notices || []).map((n) => `<div class="notice">${icon("warn")}<span>${escapeHtml(n)}</span></div>`),
    msg.error ? `<div class="notice error">${icon("warn")}<span>${escapeHtml(msg.error)}</span></div>` : "",
    msg.stopped ? `<div class="notice muted">Geração interrompida.</div>` : "",
  ].join("");

  // Metadados
  const meta = [];
  if (msg.modelLabel) meta.push(msg.modelLabel);
  if (msg.usage?.output) meta.push(`${fmtTokens(msg.usage.output)} tokens`);
  if (msg.ms) meta.push(`${(msg.ms / 1000).toFixed(1)}s`);
  el.querySelector(".msg-meta").textContent = meta.join(" · ");
}

function messageEl(id) {
  return els.messages.querySelector(`.msg[data-id="${CSS.escape(id)}"]`);
}

// Botões dentro das mensagens (copiar, editar, regenerar, blocos de código)
els.messages.addEventListener("click", async (e) => {
  const codeBtn = e.target.closest(".code-btn");
  if (codeBtn) {
    const block = codeBtn.closest(".code-block");
    const code = block.querySelector("pre code").textContent;
    if (codeBtn.dataset.action === "copy") {
      await copyText(code);
      codeBtn.classList.add("done");
      codeBtn.querySelector("span").textContent = "Copiado";
      setTimeout(() => {
        codeBtn.classList.remove("done");
        codeBtn.querySelector("span").textContent = "Copiar";
      }, 1500);
    } else {
      openPanel(code, block.dataset.lang);
    }
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
  } else if (act.dataset.act === "regen") {
    if (state.streaming) return;
    const idx = chat.messages.indexOf(msg);
    chat.messages.splice(idx);
    while (msgEl.nextElementSibling) msgEl.nextElementSibling.remove();
    msgEl.remove();
    runAssistant(chat);
  } else if (act.dataset.act === "edit") {
    if (state.streaming) return;
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
  ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.addEventListener("input", () => autosize(ta));
  bubble.addEventListener("click", function onClick(ev) {
    const b = ev.target.closest("[data-edit]");
    if (!b) return;
    bubble.removeEventListener("click", onClick);
    msgEl.classList.remove("editing");
    if (b.dataset.edit === "cancel") {
      bubble.textContent = msg.content;
      return;
    }
    const text = ta.value.trim();
    if (!text) {
      bubble.textContent = msg.content;
      return;
    }
    const idx = chat.messages.indexOf(msg);
    chat.messages.splice(idx);
    while (msgEl.nextElementSibling) msgEl.nextElementSibling.remove();
    msgEl.remove();
    sendMessage(text, msg.attachments || []);
  });
}

// ---------------- Envio e streaming ----------------

function buildApiMessages(chat) {
  return chat.messages
    .filter((m) => m.content || m.attachments?.length)
    .map((m) => {
      let content = m.content;
      if (m.role === "user" && m.attachments?.length) {
        const files = m.attachments
          .map((a) => `<arquivo nome="${a.name}">\n${a.text}\n</arquivo>`)
          .join("\n\n");
        content = `${files}\n\n${content}`;
      }
      return { role: m.role, content };
    });
}

async function sendMessage(text, attachments = state.pending) {
  const model = selectedModel();
  if (!model) {
    toast("Nenhum modelo disponível no momento.", "error");
    return;
  }
  if (state.streaming) return;
  const chat = ensureChat();
  chat.agent = store.settings.agent;
  const userMsg = {
    id: uid(),
    role: "user",
    content: text,
    attachments: attachments.map(({ name, size, text: t }) => ({ name, size, text: t })),
    createdAt: Date.now(),
  };
  chat.messages.push(userMsg);
  chat.updatedAt = Date.now();
  state.pending = [];
  renderAttachments();
  els.app.classList.remove("is-empty");
  els.messages.appendChild(renderMessage(userMsg));
  scrollToBottom(true);
  const isFirst = chat.messages.length === 1;
  if (isFirst) generateTitle(chat, text);
  await runAssistant(chat);
}

async function runAssistant(chat) {
  const model = selectedModel();
  const msg = {
    id: uid(),
    role: "assistant",
    content: "",
    thinking: "",
    model: model.id,
    modelLabel: model.label,
    notices: [],
    createdAt: Date.now(),
  };
  const controller = new AbortController();
  state.streaming = { controller, chatId: chat.id, msgId: msg.id };
  const payload = {
    model: model.id,
    agent: chat.agent || store.settings.agent,
    effort: store.settings.effort,
    customInstructions: store.settings.instructions,
    messages: buildApiMessages(chat),
  };
  chat.messages.push(msg);
  const el = renderMessage(msg);
  els.messages.appendChild(el);
  setBusy(true);
  renderHistory();
  scrollToBottom(true);

  let frame = 0;
  const paint = () => {
    frame = 0;
    const target = state.chatId === chat.id ? messageEl(msg.id) : null;
    if (target) {
      const stick = nearBottom();
      updateAssistant(target, msg);
      if (stick) scrollToBottom();
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(paint);
  };

  const started = Date.now();
  let thinkStart = 0;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      let err = `Erro HTTP ${res.status}`;
      try {
        const body = await res.json();
        err = body.error || err;
        if (body.code === "access_code") {
          openSettings(true);
        }
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
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = raw.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        let ev;
        try {
          ev = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        switch (ev.type) {
          case "meta":
            msg.modelLabel = ev.label;
            break;
          case "thinking":
            if (!thinkStart) thinkStart = Date.now();
            msg.thinking += ev.text;
            break;
          case "text":
            if (thinkStart && !msg.thinkingMs) msg.thinkingMs = Date.now() - thinkStart;
            msg.content += ev.text;
            break;
          case "notice":
            msg.notices.push(ev.text);
            break;
          case "usage":
            msg.usage = { input: ev.input, output: ev.output };
            break;
          case "error":
            msg.error = ev.message;
            break;
          case "done":
            msg.ms = ev.ms;
            break;
        }
        schedule();
      }
    }
  } catch (err) {
    if (err.name === "AbortError") {
      msg.stopped = true;
    } else {
      msg.error = err.message || "Falha de conexão.";
    }
  } finally {
    if (thinkStart && !msg.thinkingMs) msg.thinkingMs = Date.now() - thinkStart;
    if (!msg.ms) msg.ms = Date.now() - started;
    state.streaming = null;
    if (frame) cancelAnimationFrame(frame);
    paint();
    setBusy(false);
    chat.updatedAt = Date.now();
    persist();
    renderHistory();
  }
}

function persist() {
  const result = store.saveChats();
  if (result === "trimmed") toast("Armazenamento cheio: conversas antigas foram removidas.", "error");
  else if (!result) toast("Não foi possível salvar a conversa (armazenamento cheio).", "error");
}

async function generateTitle(chat, text) {
  chat.title = text.replace(/\s+/g, " ").slice(0, 48) + (text.length > 48 ? "…" : "");
  els.chatTitle.textContent = chat.title;
  renderHistory();
  try {
    const res = await fetch("/api/title", { method: "POST", headers: apiHeaders(), body: JSON.stringify({ text }) });
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
  els.send.title = busy ? "Parar geração (Esc)" : "Enviar (Enter)";
  updateSendState();
}

function updateSendState() {
  els.send.disabled = !state.streaming && !els.input.value.trim() && !state.pending.length;
}

// ---------------- Composer ----------------

function autosize(ta) {
  ta.style.height = "auto";
  ta.style.height = `${Math.min(ta.scrollHeight, 320)}px`;
}

els.input.addEventListener("input", () => {
  autosize(els.input);
  updateSendState();
});

els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    els.composer.requestSubmit();
  }
});

els.input.addEventListener("paste", (e) => {
  const text = e.clipboardData?.getData("text/plain") || "";
  if (text.length > PASTE_TO_FILE) {
    e.preventDefault();
    addAttachment({ name: `colado-${state.pending.length + 1}.txt`, size: new Blob([text]).size, text });
    toast("Texto longo convertido em anexo.");
  }
});

els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  if (state.streaming) {
    state.streaming.controller.abort();
    return;
  }
  const text = els.input.value.trim();
  if (!text && !state.pending.length) return;
  els.input.value = "";
  autosize(els.input);
  sendMessage(text || "Analise o(s) arquivo(s) anexado(s).");
});

els.suggestions.addEventListener("click", (e) => {
  const b = e.target.closest("[data-suggestion]");
  if (!b) return;
  const s = (SUGGESTIONS[store.settings.agent] || SUGGESTIONS.geral)[Number(b.dataset.suggestion)];
  if (s) sendMessage(s.prompt, []);
});

// Anexos
els.attach.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", () => {
  readFiles(els.fileInput.files);
  els.fileInput.value = "";
});

async function readFiles(files) {
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT) {
      toast(`${file.name}: máximo de ${fmtSize(MAX_ATTACHMENT)} por arquivo.`, "error");
      continue;
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    const sample = buf.subarray(0, 4096);
    const binary = sample.some((b) => b === 0);
    if (binary) {
      toast(`${file.name}: apenas arquivos de texto (logs, código, configs, CSV…).`, "error");
      continue;
    }
    addAttachment({ name: file.name, size: file.size, text: new TextDecoder().decode(buf) });
  }
}

function addAttachment(att) {
  state.pending.push(att);
  renderAttachments();
  els.input.focus();
}

function renderAttachments() {
  els.attachments.innerHTML = state.pending
    .map(
      (a, i) => `<span class="file-chip removable">${icon("file")}<span>${escapeHtml(a.name)}</span><small>${fmtSize(a.size)}</small>
        <button type="button" data-remove="${i}" aria-label="Remover">${icon("close")}</button></span>`,
    )
    .join("");
  els.composer.classList.toggle("has-files", state.pending.length > 0);
  updateSendState();
}

els.attachments.addEventListener("click", (e) => {
  const b = e.target.closest("[data-remove]");
  if (!b) return;
  state.pending.splice(Number(b.dataset.remove), 1);
  renderAttachments();
});

// Arrastar e soltar
let dragDepth = 0;
document.addEventListener("dragenter", (e) => {
  if (!e.dataTransfer?.types?.includes("Files")) return;
  dragDepth++;
  els.app.classList.add("dragging");
});
document.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) els.app.classList.remove("dragging");
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  els.app.classList.remove("dragging");
  if (e.dataTransfer?.files?.length) readFiles(e.dataTransfer.files);
});

// ---------------- Rolagem ----------------

function nearBottom() {
  const t = els.thread;
  return t.scrollHeight - t.scrollTop - t.clientHeight < 140;
}

function scrollToBottom(force = false) {
  if (force || nearBottom()) els.thread.scrollTop = els.thread.scrollHeight;
}

// ---------------- Painel de código ----------------

const EXT = { python: "py", javascript: "js", typescript: "ts", bash: "sh", powershell: "ps1", yaml: "yml", json: "json", sql: "sql", go: "go", rust: "rs", java: "java", c: "c", cpp: "cpp", csharp: "cs", php: "php", ruby: "rb", xml: "xml", html: "html", css: "css", dockerfile: "Dockerfile", ini: "ini", nginx: "conf", markdown: "md", diff: "diff" };

function openPanel(code, lang) {
  state.panelCode = { code, lang };
  els.panelTitle.textContent = lang && lang !== "texto" ? lang : "Código";
  const lines = code.split("\n");
  els.panelBody.innerHTML = `<pre class="panel-code"><code class="hljs">${highlightCode(code, lang)}</code></pre>`;
  els.panelBody.querySelector("pre").style.setProperty("--lines", String(lines.length).length);
  els.panelBody.querySelector("pre").dataset.lines = lines.map((_, i) => i + 1).join("\n");
  els.app.classList.add("panel-open");
}

$("#panel-close").addEventListener("click", () => els.app.classList.remove("panel-open"));
$("#panel-copy").addEventListener("click", async () => {
  if (!state.panelCode) return;
  await copyText(state.panelCode.code);
  toast("Código copiado.");
});
$("#panel-download").addEventListener("click", () => {
  if (!state.panelCode) return;
  const ext = EXT[state.panelCode.lang] || "txt";
  download(ext === "Dockerfile" ? "Dockerfile" : `iahack-snippet.${ext}`, state.panelCode.code);
});

// ---------------- Sidebar móvel ----------------

function openSidebar() {
  els.app.classList.add("sidebar-open");
}
function closeSidebar() {
  els.app.classList.remove("sidebar-open");
}
$("#open-sidebar").addEventListener("click", openSidebar);
$("#close-sidebar").addEventListener("click", closeSidebar);
els.scrim.addEventListener("click", closeSidebar);

$("#new-chat").addEventListener("click", () => {
  newChat();
  closeSidebar();
});
$("#brand-link").addEventListener("click", (e) => {
  e.preventDefault();
  newChat();
});

// ---------------- Tema ----------------

function applyTheme(pref) {
  let t = pref;
  if (t === "system") t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]').content = t === "light" ? "#f3faf6" : "#06100b";
}

$("#toggle-theme").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  store.theme = next;
  applyTheme(next);
});

// ---------------- Exportar ----------------

function chatToMarkdown(chat) {
  const lines = [`# ${chat.title}`, "", `_Exportado do IAHack em ${new Date().toLocaleString("pt-BR")}_`, ""];
  for (const m of chat.messages) {
    lines.push(m.role === "user" ? "## Você" : `## IAHack${m.modelLabel ? ` (${m.modelLabel})` : ""}`, "");
    if (m.attachments?.length) lines.push(`Anexos: ${m.attachments.map((a) => a.name).join(", ")}`, "");
    lines.push(m.content || "", "");
  }
  return lines.join("\n");
}

$("#export-chat").addEventListener("click", () => {
  const chat = currentChat();
  if (!chat?.messages.length) return toast("Nada para exportar ainda.");
  download(`${slug(chat.title)}.md`, chatToMarkdown(chat), "text/markdown");
});

// ---------------- Modais ----------------

document.querySelectorAll("dialog").forEach((d) => {
  d.addEventListener("click", (e) => {
    if (e.target === d || e.target.closest("[data-close]")) d.close();
  });
});

const tools = mountTools({
  tabs: $("#tool-tabs"),
  body: $("#tool-body"),
  onAsk: (text) => {
    els.toolsModal.close();
    sendMessage(text, []);
  },
});

$("#open-tools").addEventListener("click", () => {
  tools.show();
  els.toolsModal.showModal();
  closeSidebar();
});

function openSettings(focusAccess = false) {
  $("#set-theme").value = store.theme;
  $("#set-name").value = store.settings.name || "";
  $("#set-instructions").value = store.settings.instructions || "";
  $("#set-access").value = store.settings.accessCode || "";
  $("#access-field").hidden = !state.config.requiresAccessCode && !focusAccess;
  if (!els.settingsModal.open) els.settingsModal.showModal();
  if (focusAccess) {
    $("#set-access").focus();
    toast("Informe o código de acesso para usar a IA.", "error");
  }
  closeSidebar();
}

$("#open-settings").addEventListener("click", () => openSettings());

$("#save-settings").addEventListener("click", () => {
  store.theme = $("#set-theme").value;
  applyTheme(store.theme);
  store.settings.name = $("#set-name").value.trim();
  store.settings.instructions = $("#set-instructions").value.trim();
  store.settings.accessCode = $("#set-access").value.trim();
  store.saveSettings();
  els.settingsModal.close();
  if (!currentChat()?.messages.length) setGreeting();
  toast("Configurações salvas.");
});

$("#export-all").addEventListener("click", () => {
  download(`iahack-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.chats, null, 2), "application/json");
});

$("#clear-all").addEventListener("click", () => {
  if (!confirm("Apagar todas as conversas deste navegador? Esta ação não pode ser desfeita.")) return;
  state.streaming?.controller.abort();
  store.chats = [];
  store.saveChats();
  els.settingsModal.close();
  newChat();
  toast("Conversas apagadas.");
});

// ---------------- Atalhos ----------------

document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "k") {
    e.preventDefault();
    newChat();
  } else if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
    e.preventDefault();
    newChat();
  } else if (e.key === "Escape") {
    if (state.streaming) state.streaming.controller.abort();
    else if (els.app.classList.contains("panel-open")) els.app.classList.remove("panel-open");
    closeMenus();
    closeSidebar();
  } else if (e.key === "/" && document.activeElement === document.body) {
    e.preventDefault();
    els.input.focus();
  }
});

// ---------------- Início ----------------

hydrateIcons();
applyTheme(store.theme);
setBusy(false);
renderSuggestions();
loadConfig().then(() => {
  const fromHash = location.hash.slice(1);
  if (fromHash && store.getChat(fromHash)?.messages.length) openChat(fromHash);
  else newChat();
});
renderHistory();
