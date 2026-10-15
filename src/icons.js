// Ícones SVG inline (herdam currentColor).
const s = (body, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const ICONS = {
  sparkle: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5c.7 4.6 4.3 8.2 8.9 8.9-4.6.7-8.2 4.3-8.9 8.9-.7-4.6-4.3-8.2-8.9-8.9 4.6-.7 8.2-4.3 8.9-8.9Z"/></svg>`,
  compose: s('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  sidebar: s('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>'),
  close: s('<path d="M18 6 6 18M6 6l12 12"/>'),
  chevron: s('<path d="m6 9 6 6 6-6"/>'),
  "arrow-up": s('<path d="M12 19V5M5 12l7-7 7 7"/>', 'stroke-width="2.4"'),
  "arrow-down": s('<path d="M12 5v14M19 12l-7 7-7-7"/>', 'stroke-width="2"'),
  stop: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor"/></svg>`,
  copy: s('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
  check: s('<path d="m5 12 5 5L20 7"/>', 'stroke-width="2.2"'),
  refresh: s('<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>'),
  edit: s('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  trash: s('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  key: s('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l2 2"/>'),
  eye: s('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  "eye-off": s('<path d="M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  bolt: s('<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>'),
  warn: s('<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>'),
  shield: s('<path d="M12 3 4.5 6v5.5c0 4.7 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.8 7.5-9.5V6L12 3Z"/>'),
  radar: s('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 19 5"/>'),
  bug: s('<rect x="7" y="7" width="10" height="13" rx="5"/><path d="M12 7V4M3 13h4M17 13h4M4 8l3 2M20 8l-3 2M4 19l3-2M20 19l-3-2"/>'),
  mail: s('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>'),
  user: s('<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>'),
  lock: s('<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
  link: s('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L12 5.6"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>'),
  chip: s('<rect x="6" y="6" width="12" height="12" rx="2.5"/><path d="M9.5 2.5v3.5M14.5 2.5v3.5M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5"/>'),
  logout: s('<path d="M9 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H9"/><path d="m15 16 4-4-4-4M19 12H9"/>'),
  siren: s('<path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M5 21h14v-3H5zM12 3v2M4.2 6.2l1.4 1.4M19.8 6.2l-1.4 1.4"/>'),
};

export function icon(name) {
  return ICONS[name] || "";
}

export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    if (el.dataset.iconDone) return;
    el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon));
    el.dataset.iconDone = "1";
  });
}
