// Build and copy the plugin into the vault (iCloud syncs it to the iPhone).
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vault =
  process.env.OBSIDIAN_VAULT ||
  "C:/Users/Gabe/iCloudDrive/iCloud~md~obsidian/Personal";
const id = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).id;

execSync("npm run build", { cwd: root, stdio: "inherit" });

const dest = join(vault, ".obsidian", "plugins", id);
mkdirSync(dest, { recursive: true });
copyFileSync(join(root, "build", "main.js"), join(dest, "main.js"));
copyFileSync(join(root, "manifest.json"), join(dest, "manifest.json"));
copyFileSync(join(root, "styles.css"), join(dest, "styles.css"));

// enable the plugin
const cp = join(vault, ".obsidian", "community-plugins.json");
let list = [];
if (existsSync(cp)) {
  try { list = JSON.parse(readFileSync(cp, "utf8")); } catch { list = []; }
}
if (!list.includes(id)) {
  list.push(id);
  writeFileSync(cp, JSON.stringify(list, null, 2));
  console.log(`Enabled "${id}" in community-plugins.json`);
}
console.log(`Deployed to ${dest}`);
