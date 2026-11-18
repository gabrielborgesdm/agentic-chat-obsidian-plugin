import esbuild from "esbuild";
import { readFileSync } from "node:fs";

// the version is baked into main.js, so the plugin can tell which code is really running
const version = JSON.parse(readFileSync("package.json", "utf8")).version;

const prod = process.argv[2] === "production";

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2020",
  platform: "browser", // never "node": must run on Obsidian Mobile
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  minify: prod,
  treeShaking: true,
  outfile: "build/main.js",
  define: { __PLUGIN_VERSION__: JSON.stringify(version) },
});

if (prod) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
}
