/* Mounts admin.html in a real DOM with a fake GitHub, and drives the actual
   flows: first-run setup, unlocking with a password, editing a dish, and
   publishing. Nothing here talks to the network. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PASSWORD = "copper lantern mango drift";
const TOKEN = "github_pat_11TESTTOKEN_value";

function fakeGitHub({ menu, calls }) {
  return async (url, options = {}) => {
    const href = String(url);
    const method = options.method || "GET";
    calls.push({ href, method, body: options.body ? JSON.parse(options.body) : null });

    // repo access probe
    if (/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(href)) {
      if (!String(options.headers?.Authorization || "").includes(TOKEN)) {
        return { ok: false, status: 401, json: async () => ({ message: "Bad credentials" }) };
      }
      return { ok: true, status: 200, json: async () => ({ full_name: "spidyshivam/shagun-home-delivery" }) };
    }

    if (href.includes("/contents/menu.json")) {
      if (method === "PUT") {
        return { ok: true, status: 200, json: async () => ({ content: { sha: "newsha" } }) };
      }
      return {
        ok: true, status: 200,
        json: async () => ({
          sha: "menusha",
          content: Buffer.from(JSON.stringify(menu), "utf8").toString("base64")
        })
      };
    }

    if (href.includes("/contents/auth.json")) {
      if (method === "PUT") {
        return { ok: true, status: 200, json: async () => ({ content: { sha: "authsha" } }) };
      }
      return { ok: false, status: 404, json: async () => ({ message: "Not Found" }) };
    }

    if (href.includes("/contents/images/")) {
      return { ok: true, status: 200, json: async () => ({ content: { sha: "imgsha" } }) };
    }

    return { ok: false, status: 404, json: async () => ({ message: "Not Found" }) };
  };
}

async function mount({ authRecord = null } = {}) {
  const html = readFileSync(join(ROOT, "admin.html"), "utf8");
  const menu = JSON.parse(readFileSync(join(ROOT, "menu.json"), "utf8"));

  const dom = new JSDOM(html, { url: "https://shop.test/admin.html", pretendToBeVisual: true });
  const { window } = dom;

  for (const k of ["window", "document", "MutationObserver", "Element", "Node", "ShadowRoot",
                   "HTMLElement", "DocumentFragment", "customElements", "requestAnimationFrame",
                   "cancelAnimationFrame", "CustomEvent", "Event", "getComputedStyle",
                   "localStorage", "sessionStorage", "FileReader", "Image", "URL"]) {
    if (window[k] !== undefined) globalThis[k] = window[k];
  }
  window.confirm = () => true;
  globalThis.confirm = window.confirm;

  const calls = [];
  const gh = fakeGitHub({ menu, calls });
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith("auth.json")) {
      return authRecord
        ? { ok: true, status: 200, json: async () => authRecord }
        : { ok: false, status: 404, json: async () => null };
    }
    return gh(url, opts);
  };
  window.fetch = globalThis.fetch;

  const nonce = `?t=${Math.random()}`;
  const { default: Alpine } = await import(pathToFileURL(join(ROOT, "vendor/alpine.esm.js")) + nonce);
  const { adminApp } = await import(pathToFileURL(join(ROOT, "js/admin.js")) + nonce);

  Alpine.data("adminApp", adminApp);
  window.Alpine = Alpine;
  Alpine.start();

  const settle = async (ms = 120) => new Promise((r) => setTimeout(r, ms));
  await settle(250);

  const state = () => Alpine.$data(window.document.body);
  return { window, document: window.document, state, calls, settle, menu };
}

async function makeAuthRecord() {
  const { lockToken } = await import(pathToFileURL(join(ROOT, "js/lib/crypto.js")));
  return lockToken(PASSWORD, TOKEN);
}

/* ------------------------------------------------------------------ */

test("with no auth.json the page offers first-run setup", async () => {
  const { state, document } = await mount();
  assert.equal(state().screen, "setup");
  assert.match(document.body.textContent, /Choose a password/);
});

test("with an auth.json the page asks only for a password", async () => {
  const { state, document } = await mount({ authRecord: await makeAuthRecord() });
  assert.equal(state().screen, "unlock");

  const panels = [...document.querySelectorAll(".gate .panel")];
  const shown = panels.filter((p) => p.style.display !== "none");
  assert.equal(shown.length, 1, "exactly one gate panel should be visible");
  assert.match(shown[0].textContent, /Enter your password/);
  assert.ok(!shown[0].textContent.includes("GitHub token"),
    "the visible sign-in panel must not ask for a token");

  // the token field exists in the markup but must be hidden, so it is not
  // focusable and cannot be filled in by accident
  const tokenField = document.querySelector("#s-token");
  assert.equal(tokenField.closest(".panel").style.display, "none");
});

test("a wrong password is refused and does not sign in", async () => {
  const { state, settle } = await mount({ authRecord: await makeAuthRecord() });
  const s = state();
  s.password = "not the right password";
  await s.unlock();
  await settle();
  assert.equal(s.screen, "unlock");
  assert.match(s.gateMsg.text, /did not work/);
  assert.equal(s.token, null);
});

test("the right password unlocks the token and loads the menu", async () => {
  const { state, settle, menu } = await mount({ authRecord: await makeAuthRecord() });
  const s = state();
  s.password = PASSWORD;
  await s.unlock();
  await settle(200);

  assert.equal(s.screen, "app");
  assert.equal(s.token, TOKEN, "the decrypted token should be the one that was locked");
  assert.equal(s.items.length, menu.items.length);
  assert.equal(s.dirty, false);
});

test("setup locks the token with the chosen password and commits auth.json", async () => {
  const { state, settle, calls } = await mount();
  const s = state();
  s.setupPw = s.setupPw2 = PASSWORD;
  s.setupToken = TOKEN;
  await s.runSetup();
  await settle(200);

  assert.equal(s.screen, "app");

  const put = calls.find((c) => c.method === "PUT" && c.href.includes("auth.json"));
  assert.ok(put, "auth.json should have been committed");

  const written = JSON.parse(Buffer.from(put.body.content, "base64").toString("utf8"));
  assert.equal(written.kdf, "PBKDF2-SHA256");
  assert.equal(written.iterations, 600000);
  assert.ok(!JSON.stringify(written).includes(TOKEN), "the raw token must never be written in the clear");

  const { unlockToken } = await import(pathToFileURL(join(ROOT, "js/lib/crypto.js")));
  assert.equal(await unlockToken(PASSWORD, written), TOKEN);
});

test("the raw token is never written into the committed menu", async () => {
  const { state, settle, calls } = await mount({ authRecord: await makeAuthRecord() });
  const s = state();
  s.password = PASSWORD;
  await s.unlock();
  await settle(200);
  await s.publish();
  await settle();

  const put = calls.find((c) => c.method === "PUT" && c.href.includes("menu.json"));
  const written = Buffer.from(put.body.content, "base64").toString("utf8");
  assert.ok(!written.includes(TOKEN));
  assert.ok(!written.includes(PASSWORD));
});

async function signedIn() {
  const ctx = await mount({ authRecord: await makeAuthRecord() });
  const s = ctx.state();
  s.password = PASSWORD;
  await s.unlock();
  await ctx.settle(200);
  return ctx;
}

test("Add dish opens the sheet and saving appends to the menu", async () => {
  const { state, settle, document } = await signedIn();
  const s = state();
  const before = s.items.length;

  const addButton = [...document.querySelectorAll(".toolbar .abtn")]
    .find((b) => b.textContent.includes("Add dish"));
  assert.ok(addButton, "Add dish button should be in the toolbar");
  addButton.click();
  await settle();

  assert.equal(s.modalOpen, true, "clicking Add dish must open the edit sheet");

  s.draft.name = "Masala Dosa";
  s.draft.desc = "Crisp dosa with potato filling";
  s.draft.type = "veg";
  s.draft.variants = [{ label: "Full Plate", price: "90" }];
  s.saveDraft();
  await settle();

  assert.equal(s.items.length, before + 1);
  const added = s.items.at(-1);
  assert.equal(added.name, "Masala Dosa");
  assert.equal(added.id, "masala-dosa");
  assert.deepEqual(added.variants, [{ label: "Full Plate", price: 90 }]);
  assert.equal(s.dirty, true, "an unsaved change must mark the menu dirty");
});

test("a dish with no priced portion is rejected", async () => {
  const { state, settle } = await signedIn();
  const s = state();
  const before = s.items.length;
  s.openEdit(null);
  s.draft.name = "Mystery Dish";
  s.draft.variants = [{ label: "", price: "" }];
  s.saveDraft();
  await settle();
  assert.equal(s.items.length, before, "nothing should be added");
  assert.equal(s.modalOpen, true, "the sheet stays open so the mistake can be fixed");
});

test("publishing writes the edited menu and clears the dirty flag", async () => {
  const { state, settle, calls } = await signedIn();
  const s = state();
  s.openEdit(null);
  s.draft.name = "Masala Dosa";
  s.draft.variants = [{ label: "Full Plate", price: "90" }];
  s.saveDraft();
  assert.equal(s.dirty, true);

  await s.publish();
  await settle();

  const put = calls.find((c) => c.method === "PUT" && c.href.includes("menu.json"));
  assert.ok(put, "publish should PUT menu.json");
  assert.equal(put.body.sha, "menusha", "must send the sha it just read, so a concurrent edit conflicts");

  const written = JSON.parse(Buffer.from(put.body.content, "base64").toString("utf8"));
  assert.equal(written.items.at(-1).name, "Masala Dosa");
  assert.equal(s.dirty, false, "after publishing there is nothing outstanding");
});

test("reordering and deleting change the menu order", async () => {
  const { state } = await signedIn();
  const s = state();
  const [first, second] = s.items.map((i) => i.name);

  s.move(0, 1);
  assert.deepEqual(s.items.slice(0, 2).map((i) => i.name), [second, first]);

  const count = s.items.length;
  s.remove(0);
  assert.equal(s.items.length, count - 1);
});

test("every dish row renders its controls", async () => {
  const { document, state } = await signedIn();
  const rows = document.querySelectorAll(".rows .row");
  assert.equal(rows.length, state().items.length);
  for (const row of rows) {
    assert.equal(row.querySelectorAll(".acts .iconbtn").length, 4);
    assert.ok(row.querySelector(".emblem"), "each row shows a veg/non-veg emblem");
  }
});

test("the publish bar only appears when there is something to publish", async () => {
  const { document, state, settle } = await signedIn();
  const bar = document.querySelector(".publish-bar");
  assert.ok(!bar.classList.contains("show"), "nothing to publish on a clean load");

  const s = state();
  s.openEdit(null);
  s.draft.name = "Masala Dosa";
  s.draft.variants = [{ label: "Full Plate", price: "90" }];
  s.saveDraft();
  await settle();

  assert.ok(bar.classList.contains("show"), "an edit should raise the publish bar");
});
