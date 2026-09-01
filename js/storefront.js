/* Storefront: reads menu.json and renders the menu.

   Every price is its own WhatsApp link — there is no cart, so a customer
   never has to fill anything in on the site itself. */

import { CONFIG } from "../config.js";
import {
  money, telHref, waHref, callNumbers, orderMessage, generalMessage
} from "./lib/format.js";

export function storefront() {
  return {
    config: CONFIG,
    items: [],
    loading: true,
    error: "",
    filter: "all",
    query: "",

    async init() {
      // Cache-busted: the manager republishes this file and the customer
      // must not be served yesterday's prices.
      try {
        const res = await fetch(`menu.json?v=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.items = data?.items ?? [];
      } catch (err) {
        console.error(err);
        this.error = `Could not load the menu right now. Please call ${this.primaryPhone || "us"} to order.`;
      } finally {
        this.loading = false;
      }
    },

    /* ---- branding ---- */
    get brand()       { return this.config.brand || "Shagun Home Delivery"; },
    get phones()      { return callNumbers(this.config); },
    get primaryPhone(){ return this.phones[0] || ""; },
    get telPrimary()  { return telHref(this.primaryPhone); },
    get waGeneral()   { return waHref(this.config.whatsapp, generalMessage(this.brand)); },

    tel(number) { return telHref(number); },

    /* ---- filtering ---- */
    get counts() {
      const veg = this.items.filter((i) => i.type === "veg").length;
      return { all: this.items.length, veg, nonveg: this.items.length - veg };
    },

    get visible() {
      const q = this.query.trim().toLowerCase();
      return this.items.filter((it) => {
        if (this.filter === "veg" && it.type !== "veg") return false;
        if (this.filter === "nonveg" && it.type === "veg") return false;
        if (!q) return true;
        return `${it.name} ${it.desc || ""}`.toLowerCase().includes(q);
      });
    },

    get groups() {
      const list = this.visible;
      if (this.filter !== "all") {
        return [{
          title: this.filter === "veg" ? "Vegetarian" : "Non-Vegetarian",
          items: list
        }];
      }
      const veg = list.filter((i) => i.type === "veg");
      const non = list.filter((i) => i.type !== "veg");
      return [
        ...(veg.length ? [{ title: "Vegetarian", items: veg }] : []),
        ...(non.length ? [{ title: "Non-Vegetarian", items: non }] : [])
      ];
    },

    get emptyMessage() {
      return this.query.trim()
        ? `No dishes match “${this.query.trim()}”.`
        : "This section has no items right now.";
    },

    /* ---- per dish ---- */
    isSold(item)   { return item.available === false; },
    variantsOf(item) {
      return item.variants?.length
        ? item.variants
        : [{ label: "Order", price: item.price || 0 }];
    },
    price(amount)  { return money(amount, this.config.currency); },

    orderHref(item, variant) {
      return waHref(
        this.config.whatsapp,
        orderMessage({
          brand: this.brand, item, variant, currency: this.config.currency
        })
      );
    },

    orderLabel(item, variant) {
      return `Order ${item.name}, ${variant.label}, ${this.price(variant.price)}, on WhatsApp`;
    },

    /* A broken photo should leave the plate illustration showing, not a
       torn-image icon. */
    hideBrokenImage(event) { event.target.style.display = "none"; }
  };
}
