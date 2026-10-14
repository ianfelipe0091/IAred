// Gera dist/: bundle do frontend com hash no nome + arquivos estáticos.
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = "dist";
const ASSETS = path.join(OUT, "assets");

await rm(OUT, { recursive: true, force: true });
await mkdir(ASSETS, { recursive: true });

const common = {
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ["es2022"],
  outdir: ASSETS,
  entryNames: "[name]-[hash]",
  metafile: true,
  legalComments: "none",
  logLevel: "info",
};

const app = await build({
  ...common,
  entryPoints: { app: "src/app.js", style: "src/styles.css", admin: "src/admin.js", panel: "src/admin.css" },
  format: "esm",
});

const outputs = Object.keys(app.metafile.outputs);
const find = (prefix, ext) => {
  const file = outputs.find((o) => path.basename(o).startsWith(`${prefix}-`) && o.endsWith(ext));
  if (!file) throw new Error(`Saída não encontrada: ${prefix}*${ext}`);
  return `/assets/${path.basename(file)}`;
};

const css = find("style", ".css");
const js = find("app", ".js");
const adminCss = find("panel", ".css");
const adminJs = find("admin", ".js");

// Cada página HTML aponta para os arquivos com hash.
const page = async (src, dest, swaps) => {
  let html = await readFile(src, "utf8");
  for (const [from, to] of swaps) html = html.replace(from, to);
  await writeFile(path.join(OUT, dest), html);
};
await page("src/index.html", "index.html", [["/assets/app.css", css], ["/assets/app.js", js]]);
await page("src/admin.html", "admin.html", [["/assets/admin.css", adminCss], ["/assets/admin.js", adminJs]]);

await cp("public", OUT, { recursive: true });

console.log(`\n✔ build pronto em ${OUT}/ → ${js}, ${css}, ${adminJs}, ${adminCss}`);
