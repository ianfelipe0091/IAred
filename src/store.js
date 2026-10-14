// Persistência local (apenas neste navegador).
const KEY_CHATS = "iahack:chats";
const KEY_SETTINGS = "iahack:settings";
const KEY_THEME = "iahack:theme";

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export const store = {
  chats: read(KEY_CHATS, []),
  settings: {
    name: "",
    instructions: "",
    accessCode: "",
    model: "",
    agent: "geral",
    effort: "medium",
    ...read(KEY_SETTINGS, {}),
  },

  saveChats() {
    if (!write(KEY_CHATS, this.chats)) {
      // Armazenamento cheio: descarta as conversas mais antigas não fixadas.
      const sorted = [...this.chats].sort((a, b) => a.updatedAt - b.updatedAt);
      for (const chat of sorted) {
        if (chat.pinned) continue;
        this.chats = this.chats.filter((c) => c.id !== chat.id);
        if (write(KEY_CHATS, this.chats)) return "trimmed";
      }
      return false;
    }
    return true;
  },

  saveSettings() {
    write(KEY_SETTINGS, this.settings);
  },

  get theme() {
    try {
      return localStorage.getItem(KEY_THEME) || "dark";
    } catch {
      return "dark";
    }
  },

  set theme(value) {
    try {
      localStorage.setItem(KEY_THEME, value);
    } catch {
      // ignora
    }
  },

  getChat(id) {
    return this.chats.find((c) => c.id === id) || null;
  },

  createChat({ agent, model }) {
    const chat = {
      id: uid(),
      title: "Nova conversa",
      agent,
      model,
      messages: [],
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.chats.unshift(chat);
    return chat;
  },

  deleteChat(id) {
    this.chats = this.chats.filter((c) => c.id !== id);
    this.saveChats();
  },
};
