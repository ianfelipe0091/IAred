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
  entryPoints: { app: "src/app.js", style: "src/styles.css" },
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

let html = await readFile("src/index.html", "utf8");
html = html.replace("/assets/app.css", css).replace("/assets/app.js", js);
await writeFile(path.join(OUT, "index.html"), html);

await cp("public", OUT, { recursive: true });

console.log(`\n✔ build pronto em ${OUT}/ → ${js}, ${css}`);
