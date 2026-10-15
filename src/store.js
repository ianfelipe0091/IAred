// Persistência local (apenas neste navegador).
const KEY_CHATS = "iahack:chats";
let chatsKey = KEY_CHATS;

// A chave da API agora é definida só pelo administrador: apaga a que o usuário tinha colado.
try {
  localStorage.removeItem("iahack:apiKey");
} catch {
  // ignora
}

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
  chats: [],

  // Cada conta tem o próprio histórico neste navegador; sem login, usa o histórico geral.
  // A primeira conta a entrar herda as conversas feitas antes do login existir.
  useAccount(userId) {
    chatsKey = userId ? `${KEY_CHATS}:${userId}` : KEY_CHATS;
    if (userId && read(chatsKey, null) === null) {
      const legacy = read(KEY_CHATS, null);
      if (legacy?.length && write(chatsKey, legacy)) {
        try {
          localStorage.removeItem(KEY_CHATS);
        } catch {
          // ignora
        }
      }
    }
    this.chats = read(chatsKey, []);
  },

  saveChats() {
    if (write(chatsKey, this.chats)) return true;
    // Armazenamento cheio: descarta as conversas mais antigas até caber.
    const sorted = [...this.chats].sort((a, b) => a.updatedAt - b.updatedAt);
    for (const chat of sorted) {
      this.chats = this.chats.filter((c) => c.id !== chat.id);
      if (write(chatsKey, this.chats)) return "trimmed";
    }
    return false;
  },

  getPref(name) {
    return read(`iahack:pref:${name}`, null);
  },

  setPref(name, value) {
    write(`iahack:pref:${name}`, value);
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
