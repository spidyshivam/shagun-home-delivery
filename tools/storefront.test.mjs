/* Mounts index.html in a real DOM, starts Alpine, and asserts on what a
   customer would actually see. This is the test that would have caught
   every bug in this project's history. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function mount() {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const menu = readFileSync(join(ROOT, "menu.json"), "utf8");

  const dom = new JSDOM(html, { url: "https://shop.test/", pretendToBeVisual: true });
  const { window } = dom;

  for (const k of ["window", "document", "MutationObserver", "Element", "Node",
                   "ShadowRoot", "HTMLElement", "DocumentFragment", "customElements",
                   "requestAnimationFrame", "cancelAnimationFrame", "CustomEvent",
                   "Event", "getComputedStyle"]) {
    if (window[k] !== undefined) globalThis[k] = window[k];
  }
  globalThis.fetch = async (url) =>
    String(url).startsWith("menu.json")
      ? { ok: true, status: 200, json: async () => JSON.parse(menu) }
      : { ok: false, status: 404, json: async () => null };

  // A fresh module instance per test: Alpine keeps init state on the module,
  // and one test's DOM must not leak into the next.
  const nonce = `?t=${Math.random()}`;
  const { default: Alpine } = await import(pathToFileURL(join(ROOT, "vendor/alpine.esm.js")) + nonce);
  const { storefront } = await import(pathToFileURL(join(ROOT, "js/storefront.js")) + nonce);

  Alpine.data("storefront", storefront);
  window.Alpine = Alpine;
  Alpine.start();

  await new Promise((r) => setTimeout(r, 250));
  return { window, document: window.document, Alpine };
}

test("the menu renders every dish from menu.json", async () => {
  const { document } = await mount();
  const cards = document.querySelectorAll(".card");
  const menu = JSON.parse(readFileSync(join(ROOT, "menu.json"), "utf8"));
  assert.equal(cards.length, menu.items.length);
});

test("veg and non-veg are grouped under their own headings", async () => {
  const { document } = await mount();
  const heads = [...document.querySelectorAll(".group-head h2")].map((h) => h.textContent);
  assert.deepEqual(heads, ["Vegetarian", "Non-Vegetarian"]);
});

test("every price button is a real WhatsApp link with the configured number", async () => {
  const { document } = await mount();
  const links = [...document.querySelectorAll("a.price-btn")];
  assert.ok(links.length >= 12, `expected at least 12 price buttons, got ${links.length}`);

  for (const a of links) {
    const href = a.getAttribute("href");
    assert.ok(href, `a price button has no href: ${a.textContent.trim()}`);
    assert.match(href, /^https:\/\/wa\.me\/919012203352\?text=/,
      `wrong or empty WhatsApp number in: ${href.slice(0, 60)}`);
    const msg = decodeURIComponent(href.split("?text=")[1]);
    assert.match(msg, /I would like to order:/);
    assert.match(msg, /Address:/);
  }
});

test("the order message names the dish and the portion the customer tapped", async () => {
  const { document } = await mount();
  const first = document.querySelector(".card");
  const dish  = first.querySelector("h3").textContent;
  const btn   = first.querySelector("a.price-btn");
  const label = btn.querySelector(".lbl").textContent;
  const msg   = decodeURIComponent(btn.getAttribute("href").split("?text=")[1]);
  assert.ok(msg.includes(dish),  `message does not name the dish: ${msg}`);
  assert.ok(msg.includes(label), `message does not name the portion: ${msg}`);
});

test("call buttons dial the configured number", async () => {
  const { document } = await mount();
  const tels = [...document.querySelectorAll('a[href^="tel:"]')];
  assert.ok(tels.length >= 3, `expected header/hero/bar call links, got ${tels.length}`);
  for (const a of tels) {
    assert.equal(a.getAttribute("href"), "tel:7060742177");
  }
});

test("the brand name is rendered in full, not a fallback", async () => {
  const { document } = await mount();
  assert.equal(document.querySelector(".wordmark .n1").textContent, "Shagun Home Delivery");
  assert.equal(document.querySelector(".hero h1").textContent, "Shagun Home Delivery");
});

test("filter tabs narrow the menu", async () => {
  const { document } = await mount();
  const vegTab = [...document.querySelectorAll(".tab")].find((t) => t.textContent.includes("Veg") && !t.textContent.includes("Non"));
  vegTab.click();
  await new Promise((r) => setTimeout(r, 60));
  const heads = [...document.querySelectorAll(".group-head h2")].map((h) => h.textContent);
  assert.deepEqual(heads, ["Vegetarian"]);
  assert.equal(document.querySelectorAll(".card").length, 4);
});

test("tab counts match the menu", async () => {
  const { document } = await mount();
  const counts = [...document.querySelectorAll(".tab .n")].map((n) => Number(n.textContent));
  assert.deepEqual(counts, [6, 4, 2]);
});

test("every dish shows a veg or non-veg emblem", async () => {
  const { document } = await mount();
  for (const card of document.querySelectorAll(".card")) {
    assert.ok(card.querySelector(".card-title .emblem"),
      `no emblem on ${card.querySelector("h3").textContent}`);
  }
});
