// Conversas do usuário, em dois modos:
//   nuvem: a lista vem da conta (banco) e cada conversa busca as mensagens quando é aberta;
//   local: tudo fica no localStorage deste navegador (sem login ou sem banco configurado).
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

function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignora
  }
}

// UUID v4 (o banco usa UUID como id das conversas e mensagens).
export const uid = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export const store = {
  chats: [],
  cloud: false,

  // Cada conta tem o próprio histórico; sem login, usa o histórico geral deste navegador.
  // A primeira conta a entrar herda as conversas feitas antes do login existir.
  useAccount(userId, cloud = false) {
    this.cloud = Boolean(cloud);
    chatsKey = userId ? `${KEY_CHATS}:${userId}` : KEY_CHATS;
    if (userId && read(chatsKey, null) === null) {
      const legacy = read(KEY_CHATS, null);
      if (legacy?.length && write(chatsKey, legacy)) remove(KEY_CHATS);
    }
    this.chats = this.cloud ? [] : read(chatsKey, []).map((c) => ({ ...c, loaded: true }));
  },

  // Nuvem: conversas que ficaram só neste navegador (de antes do banco existir), para levar à conta.
  pendingLocal() {
    return this.cloud ? read(chatsKey, []).filter((c) => c.messages?.length) : [];
  },

  forgetLocal(ids) {
    const left = read(chatsKey, []).filter((c) => !ids.includes(c.id));
    if (left.length) write(chatsKey, left);
    else remove(chatsKey);
  },

  // Nuvem: aplica a lista vinda do servidor, mantendo as mensagens já carregadas e a conversa nova ainda não enviada.
  setRemote(list) {
    const known = new Map(this.chats.map((c) => [c.id, c]));
    const remote = list.map((c) => {
      const old = known.get(c.id);
      return old?.loaded ? { ...old, title: c.title, updatedAt: Math.max(old.updatedAt, c.updatedAt) } : { ...c, messages: [], loaded: false };
    });
    const ids = new Set(list.map((c) => c.id));
    this.chats = [...this.chats.filter((c) => c.isNew && !ids.has(c.id)), ...remote];
  },

  saveChats() {
    if (this.cloud) return true;
    const plain = this.chats.map(({ loaded, ...c }) => c);
    if (write(chatsKey, plain)) return true;
    // Armazenamento cheio: descarta as conversas mais antigas até caber.
    const sorted = [...this.chats].sort((a, b) => a.updatedAt - b.updatedAt);
    for (const chat of sorted) {
      this.chats = this.chats.filter((c) => c.id !== chat.id);
      if (write(chatsKey, this.chats.map(({ loaded, ...c }) => c))) return "trimmed";
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
    const now = Date.now();
    const chat = { id: uid(), title: "Nova conversa", messages: [], createdAt: now, updatedAt: now, loaded: true, isNew: this.cloud };
    this.chats.unshift(chat);
    return chat;
  },

  deleteChat(id) {
    this.chats = this.chats.filter((c) => c.id !== id);
    this.saveChats();
  },

  clear() {
    this.chats = [];
    this.saveChats();
  },
};
