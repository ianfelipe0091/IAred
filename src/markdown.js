import { Marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import nginx from "highlight.js/lib/languages/nginx";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import x86asm from "highlight.js/lib/languages/x86asm";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { icon } from "./icons.js";

const LANGS = {
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, markdown,
  nginx, php, plaintext, powershell, python, ruby, rust, sql, typescript, x86asm, xml, yaml,
};
for (const [name, def] of Object.entries(LANGS)) hljs.registerLanguage(name, def);
hljs.registerAliases(["sh", "shell", "zsh", "console"], { languageName: "bash" });
hljs.registerAliases(["ps", "ps1", "pwsh"], { languageName: "powershell" });
hljs.registerAliases(["py"], { languageName: "python" });
hljs.registerAliases(["js", "jsx", "mjs"], { languageName: "javascript" });
hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });
hljs.registerAliases(["html", "svg"], { languageName: "xml" });
hljs.registerAliases(["yml", "sigma"], { languageName: "yaml" });
hljs.registerAliases(["toml", "conf"], { languageName: "ini" });
hljs.registerAliases(["asm", "nasm"], { languageName: "x86asm" });
hljs.registerAliases(["kql", "spl"], { languageName: "sql" });
hljs.registerAliases(["text", "txt", "log"], { languageName: "plaintext" });

const escapeHtml = (str) =>
  str.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }) {
      const language = (lang || "").trim().split(/\s+/)[0].toLowerCase();
      const known = language && hljs.getLanguage(language);
      let highlighted;
      try {
        highlighted = known
          ? hljs.highlight(text, { language, ignoreIllegals: true }).value
          : escapeHtml(text);
      } catch {
        highlighted = escapeHtml(text);
      }
      return `<div class="code-block" data-lang="${escapeHtml(language || "texto")}">
  <div class="code-head">
    <span class="code-lang">${escapeHtml(language || "texto")}</span>
    <span class="code-actions">
      <button class="code-btn" data-action="copy" title="Copiar">${icon("copy")}<span>Copiar</span></button>
    </span>
  </div>
  <pre><code class="hljs">${highlighted}</code></pre>
</div>`;
    },
    link({ href, title, text }) {
      const t = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(href)}"${t} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function renderMarkdown(src) {
  // Fecha cercas de código abertas durante o streaming para não quebrar o layout.
  const fences = (src.match(/^\s*```/gm) || []).length;
  const text = fences % 2 === 1 ? `${src}\n\`\`\`` : src;
  const html = marked.parse(text);
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["target", "data-lang", "data-action"],
    FORBID_TAGS: ["style", "form", "input", "iframe"],
  });
}

export function highlightCode(code, lang) {
  const language = (lang || "").toLowerCase();
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  }
  return escapeHtml(code);
}

export { escapeHtml };
