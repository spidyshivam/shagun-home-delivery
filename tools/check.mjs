/* Pre-flight checks. Run `npm run check` before pushing.

   Each check here exists because something in this project's history went
   wrong in exactly that way. */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { JSDOM } from "jsdom";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const notes = [];

const fail = (msg) => problems.push(msg);
const note = (msg) => notes.push(msg);
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const PAGES = ["index.html", "admin.html"];

/* ---------------------------------------------------------------- modules */

const MODULES = [
  "config.js",
  "js/storefront.js",
  "js/admin.js",
  "js/lib/bytes.js",
  "js/lib/crypto.js",
  "js/lib/github.js",
  "js/lib/image.js",
  "js/lib/format.js"
];

for (const m of MODULES) {
  if (!existsSync(join(ROOT, m))) { fail(`missing module: ${m}`); continue; }
  try {
    await import(pathToFileURL(join(ROOT, m)));
  } catch (err) {
    fail(`${m} does not load: ${err.message}`);
  }
}

/* Every relative import must point at a file that exists. A typo here is a
   blank page in the browser and nothing in the terminal. */
for (const m of MODULES) {
  if (!existsSync(join(ROOT, m))) continue;
  const src = read(m);
  for (const match of src.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
    const target = resolve(dirname(join(ROOT, m)), match[1]);
    if (!existsSync(target)) fail(`${m} imports ${match[1]}, which does not exist`);
  }
}

/* ------------------------------------------------------------------ pages */

for (const page of PAGES) {
  const html = read(page);

  const pageDom = new JSDOM(html).window.document;

  // Classic scripts run the moment the parser reaches them, so anything
  // declared lower down does not exist yet — that is what broke this page
  // once already. Modules always wait for the full document.
  for (const script of pageDom.querySelectorAll("script")) {
    const isModule = script.getAttribute("type") === "module";
    const src = script.getAttribute("src");
    const inlineImports = /(^|\n)\s*import\s/.test(script.textContent || "");

    if (!isModule && (src || inlineImports)) {
      fail(`${page} has a <script> that is not type="module"` +
           (src ? ` (src="${src}")` : " (inline, and it uses import)") +
           " — modules run after the document is parsed, classic scripts do not");
    }

    if (src) {
      const target = join(ROOT, src.split("?")[0]);
      if (!existsSync(target)) fail(`${page} loads ${src}, which does not exist`);
    }

    for (const match of (script.textContent || "").matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const target = resolve(ROOT, match[1]);
      if (!existsSync(target)) fail(`${page} imports ${match[1]}, which does not exist`);
    }
  }

  // A screen switched with x-show must be cloaked, or every screen paints at
  // once for a frame before Alpine hides the inactive ones. An element inside
  // an already-cloaked ancestor is covered by it.
  for (const el of pageDom.querySelectorAll("[x-show]")) {
    if (!/screen\s*[!=]==?/.test(el.getAttribute("x-show") || "")) continue;
    if (!el.closest("[x-cloak]")) {
      fail(`${page}: <${el.tagName.toLowerCase()} x-show="${el.getAttribute("x-show")}"> ` +
           "switches a screen but nothing above it has x-cloak");
    }
  }
}

if (!existsSync(join(ROOT, "vendor/alpine.esm.js"))) {
  fail("vendor/alpine.esm.js is missing — Alpine must be committed, not hotlinked");
}

/* -------------------------------------------- Alpine expressions resolve */

const ALPINE_MAGICS = new Set([
  "$el", "$refs", "$store", "$watch", "$dispatch", "$nextTick", "$root",
  "$data", "$id", "$event", "$persist"
]);
const JS_GLOBALS = new Set([
  "true", "false", "null", "undefined", "Date", "Math", "JSON", "Number", "String",
  "Boolean", "Array", "Object", "console", "window", "document", "location", "new"
]);

const COMPONENTS = {
  "index.html": ["js/storefront.js", "storefront"],
  "admin.html": ["js/admin.js", "adminApp"]
};

for (const [page, [modulePath, factoryName]] of Object.entries(COMPONENTS)) {
  const html = read(page);
  const declared = [...html.matchAll(/x-data="([A-Za-z0-9_$]+)"/g)].map((m) => m[1]);
  if (!declared.includes(factoryName)) {
    fail(`${page} does not declare x-data="${factoryName}"`);
    continue;
  }

  let component;
  try {
    const mod = await import(pathToFileURL(join(ROOT, modulePath)));
    component = mod[factoryName]();
  } catch (err) {
    fail(`cannot build ${factoryName}(): ${err.message}`);
    continue;
  }

  const known = new Set(Object.keys(component));

  // Names used inside Alpine directives, minus locals introduced by x-for.
  const locals = new Set();
  for (const m of html.matchAll(/x-for="\s*\(?\s*([A-Za-z0-9_$]+)\s*(?:,\s*([A-Za-z0-9_$]+))?/g)) {
    if (m[1]) locals.add(m[1]);
    if (m[2]) locals.add(m[2]);
  }

  const DIRECTIVE = /(?:x-(?:text|html|show|model|if|for|bind|effect)|[@:][A-Za-z0-9_.:-]+)="([^"]*)"/g;
  const used = new Set();
  for (const m of html.matchAll(DIRECTIVE)) {
    // Strip string literals first — otherwise words inside "Add Dish" or
    // 'sold-out' get read as identifiers.
    const expr = m[1]
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``")
      .replace(/&quot;(?:[^&]|&(?!quot;))*&quot;/g, "");
    for (const id of expr.matchAll(/(?<![.$\w])([A-Za-z_$][A-Za-z0-9_$]*)\b/g)) {
      used.add(id[1]);
    }
  }

  for (const name of used) {
    if (known.has(name) || locals.has(name) || ALPINE_MAGICS.has(name) || JS_GLOBALS.has(name)) continue;
    // property shorthand inside object literals, string contents, and the
    // like will slip through the regex; only flag plausible identifiers
    if (/^(of|in|typeof|instanceof|return|await|async|function|let|const|var|not|and|or)$/.test(name)) continue;
    fail(`${page} uses "${name}" in an Alpine expression, but ${factoryName}() has no such property`);
  }
}

/* ----------------------------------------------------------------- config */

const { CONFIG } = await import(pathToFileURL(join(ROOT, "config.js")));

if (!CONFIG.github?.owner || CONFIG.github.owner === "YOUR_GITHUB_USERNAME") {
  fail("config.js: github.owner is not set");
}
if (!CONFIG.github?.repo) fail("config.js: github.repo is not set");
if (!/^\d{10,15}$/.test(String(CONFIG.whatsapp || ""))) {
  fail(`config.js: whatsapp must be digits only with country code, got "${CONFIG.whatsapp}"`);
}
if (!CONFIG.phones?.length) fail("config.js: phones is empty — the Call buttons will do nothing");
if (!CONFIG.brand) fail("config.js: brand is empty");

/* ------------------------------------------------------------------- menu */

const menu = JSON.parse(read("menu.json"));
if (!Array.isArray(menu.items)) fail("menu.json has no items array");

const ids = new Set();
for (const [i, item] of (menu.items ?? []).entries()) {
  const where = `menu.json item ${i} (${item.name || "unnamed"})`;
  if (!item.id) fail(`${where}: no id`);
  if (ids.has(item.id)) fail(`${where}: duplicate id "${item.id}"`);
  ids.add(item.id);
  if (!item.name) fail(`${where}: no name`);
  if (!["veg", "nonveg"].includes(item.type)) fail(`${where}: type must be "veg" or "nonveg", got "${item.type}"`);
  if (!item.variants?.length) fail(`${where}: no portions priced`);
  for (const v of item.variants ?? []) {
    if (!v.label) fail(`${where}: a portion has no label`);
    if (!Number.isFinite(v.price)) fail(`${where}: portion "${v.label}" has a non-numeric price`);
  }
  if (item.image && !existsSync(join(ROOT, item.image))) {
    fail(`${where}: image ${item.image} is not in the repository`);
  }
}

/* ------------------------------------------------------------------ leaks */

for (const file of [...PAGES, ...MODULES, "menu.json"]) {
  if (!existsSync(join(ROOT, file))) continue;
  const src = read(file);
  if (/gh[ps]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/.test(src)) {
    fail(`${file} appears to contain a GitHub token — it must never be committed`);
  }
}

/* ----------------------------------------------------------------- report */

for (const n of notes) console.log(`note  ${n}`);

if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"} found:\n`);
  for (const p of problems) console.error(`  ✖ ${p}`);
  console.error("");
  process.exit(1);
}

console.log(`\n✔ all checks passed — ${MODULES.length} modules, ${PAGES.length} pages, ${menu.items.length} dishes\n`);
