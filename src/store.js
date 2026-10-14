// Persistência local (apenas neste navegador).
const KEY_CHATS = "iahack:chats";
const KEY_API = "iahack:apiKey";

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
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export const store = {
  chats: read(KEY_CHATS, []),
  apiKey: read(KEY_API, ""),

  saveChats() {
    if (write(KEY_CHATS, this.chats)) return true;
    // Armazenamento cheio: descarta as conversas mais antigas até caber.
    const sorted = [...this.chats].sort((a, b) => a.updatedAt - b.updatedAt);
    for (const chat of sorted) {
      this.chats = this.chats.filter((c) => c.id !== chat.id);
      if (write(KEY_CHATS, this.chats)) return "trimmed";
    }
    return false;
  },

  setApiKey(value) {
    this.apiKey = value;
    if (value) write(KEY_API, value);
    else {
      try {
        localStorage.removeItem(KEY_API);
      } catch {
        // ignora
      }
    }
  },

  getChat(id) {
    return this.chats.find((c) => c.id === id) || null;
  },

  createChat() {
    const chat = { id: uid(), title: "Nova conversa", messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    this.chats.unshift(chat);
    return chat;
  },

  deleteChat(id) {
    this.chats = this.chats.filter((c) => c.id !== id);
    this.saveChats();
  },
};
