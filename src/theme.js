// Aplica o tema antes da pintura para evitar flash.
try {
  var t = localStorage.getItem("iahack:theme") || "dark";
  if (t === "system") t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = t;
} catch (e) {}
