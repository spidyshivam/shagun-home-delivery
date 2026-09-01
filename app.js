/* ============================================================
   Shagun Home Delivery — storefront
   No cart, no backend. Tapping a portion opens WhatsApp with
   that order pre-written; the customer fills in name + address.
   ============================================================ */

(function () {
  "use strict";

  var C   = window.CONFIG || {};
  var CUR = C.currency || "₹";

  var state = { items: [], filter: "all", query: "" };

  /* ---------------------------------------------------- helpers */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function money(n) { return CUR + Number(n || 0).toLocaleString("en-IN"); }

  /* Call numbers, newest config shape first, older single `phone` second. */
  function callNumbers() {
    var list = (C.phones && C.phones.length) ? C.phones : (C.phone ? [C.phone] : []);
    return list.map(function (n) { return String(n).trim(); })
               .filter(function (n) { return n.length > 0; });
  }

  function telHref(num) { return "tel:" + String(num || "").replace(/[^\d+]/g, ""); }

  function waHref(text) {
    var num = String(C.whatsapp || "").replace(/\D/g, "");
    return "https://wa.me/" + num + (text ? "?text=" + encodeURIComponent(text) : "");
  }

  /* Message for one dish + portion. The blank Name / Address lines
     are filled in by the customer inside WhatsApp before sending. */
  function orderText(item, variant) {
    return "Hello " + (C.brand || "") + ",\n\n" +
           "I would like to order:\n" +
           "• " + item.name + " — " + variant.label + " (" + money(variant.price) + ")\n\n" +
           "Quantity: 1\n" +
           "Name: \n" +
           "Address: ";
  }

  function generalText() {
    return "Hello " + (C.brand || "") + ", I would like to place an order.";
  }

  var EMBLEM = {
    veg: '<svg class="emblem" viewBox="0 0 20 20" role="img" aria-label="Vegetarian">' +
         '<rect x="1" y="1" width="18" height="18" rx="3" fill="#fff" stroke="#1f7a3d" stroke-width="2"/>' +
         '<circle cx="10" cy="10" r="4.6" fill="#1f7a3d"/></svg>',
    nonveg: '<svg class="emblem" viewBox="0 0 20 20" role="img" aria-label="Non-vegetarian">' +
         '<rect x="1" y="1" width="18" height="18" rx="3" fill="#fff" stroke="#8f2029" stroke-width="2"/>' +
         '<path d="M10 5.2 14.6 14H5.4z" fill="#8f2029"/></svg>'
  };

  var PLATE_SVG =
    '<div class="fallback"><svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="32" cy="34" r="21"/><circle cx="32" cy="34" r="13"/>' +
    '<path d="M12 14c0 5 3 8 3 8M20 14c0 5-3 8-3 8"/></svg></div>';

  var WA_ICON =
    '<svg class="wa-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.2-1.7-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.7 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.5-.5c.1-.2.2-.3.3-.5 0-.2 0-.4-.1-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5 4.4.7.3 1.2.5 1.7.6.7.2 1.3.2 1.8.1.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3ZM12 21.5c-1.7 0-3.3-.5-4.7-1.3l-3.3.9.9-3.2A9.4 9.4 0 0 1 2.6 12 9.4 9.4 0 1 1 12 21.5Zm0-20.5A11 11 0 0 0 1 12c0 1.9.5 3.8 1.5 5.4L1 23l5.8-1.5c1.6.9 3.4 1.3 5.2 1.3A11 11 0 1 0 12 1Z"/></svg>';

  /* ---------------------------------------------------- branding */

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function applyBranding() {
    var name = C.brand || "Shagun Home Delivery";
    document.title = name + " — Fresh Home-Cooked Food, Delivered";

    setText("brandName", name);
    setText("brandInitial", name.trim().charAt(0).toUpperCase());
    setText("brandHours", C.hours || "");
    setText("heroTitle", name);
    setText("heroSub", C.tagline || "");
    setText("footBrand", name);
    setText("footBrand2", name);
    setText("footTagline", C.subTagline || "");
    setText("footHours", C.hours || "");
    setText("footAddress", C.address || "");
    setText("year", String(new Date().getFullYear()));

    var addr = $("#metaAddress");
    if (addr && C.address) addr.lastChild.textContent = " " + C.address;

    var note = $("#metaNote");
    if (note) {
      if (C.deliveryNote) note.lastChild.textContent = " " + C.deliveryNote;
      else note.hidden = true;
    }

    var nums = callNumbers();
    var primary = nums[0] || "";

    ["headerCall", "heroCall", "barCall"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.href = telHref(primary);
    });
    setText("heroCallLabel", primary ? "Call " + primary : "Call to Order");

    /* Footer lists every call number, one tap-to-call link each. The
       extras are inserted as siblings so they keep the stacked layout
       that `.foot-grid > div > a` gives the first one. */
    var fc = $("#footCall");
    if (fc) {
      Array.prototype.slice.call(document.querySelectorAll(".foot-call-extra"))
        .forEach(function (el) { el.remove(); });

      if (!primary) {
        fc.hidden = true;
      } else {
        fc.hidden = false;
        fc.href = telHref(primary);
        fc.textContent = "Call " + primary;
        var after = fc;
        for (var i = 1; i < nums.length; i++) {
          var a = document.createElement("a");
          a.className = "foot-call-extra";
          a.href = telHref(nums[i]);
          a.textContent = "Call " + nums[i];
          after.parentNode.insertBefore(a, after.nextSibling);
          after = a;
        }
      }
    }

    var link = waHref(generalText());
    ["headerWhatsapp", "heroWhatsapp", "footWa", "barWhatsapp"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.href = link;
    });
  }

  /* ---------------------------------------------------- menu */

  function loadMenu() {
    fetch("menu.json?v=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        state.items = (data && data.items) || [];
        renderCounts();
        renderMenu();
      })
      .catch(function (err) {
        $("#menuRoot").innerHTML =
          '<div class="empty"><h3>Menu unavailable</h3>' +
          '<p>Could not load the menu right now. Please call ' + esc(callNumbers()[0] || "us") + ' to order.</p></div>';
        console.error(err);
      });
  }

  function visibleItems() {
    var q = state.query.trim().toLowerCase();
    return state.items.filter(function (it) {
      if (state.filter !== "all" && it.type !== state.filter) return false;
      if (!q) return true;
      return (it.name + " " + (it.desc || "")).toLowerCase().indexOf(q) > -1;
    });
  }

  function renderCounts() {
    var all = state.items.length;
    var veg = state.items.filter(function (i) { return i.type === "veg"; }).length;
    $$("[data-count]").forEach(function (el) {
      var k = el.getAttribute("data-count");
      el.textContent = k === "all" ? all : k === "veg" ? veg : all - veg;
    });
  }

  function renderMenu() {
    var root = $("#menuRoot");
    var list = visibleItems();

    if (!list.length) {
      root.innerHTML =
        '<div class="empty"><h3>Nothing here yet</h3><p>' +
        (state.query ? "No dishes match “" + esc(state.query) + "”."
                     : "This section has no items right now.") +
        '</p></div>';
      return;
    }

    var groups = [];
    if (state.filter === "all") {
      var veg = list.filter(function (i) { return i.type === "veg"; });
      var nv  = list.filter(function (i) { return i.type !== "veg"; });
      if (veg.length) groups.push({ title: "Vegetarian", items: veg });
      if (nv.length)  groups.push({ title: "Non-Vegetarian", items: nv });
    } else {
      groups.push({
        title: state.filter === "veg" ? "Vegetarian" : "Non-Vegetarian",
        items: list
      });
    }

    root.innerHTML = groups.map(function (g) {
      return '<section class="group">' +
               '<header class="group-head">' +
                 '<h2>' + esc(g.title) + '</h2>' +
                 '<span class="rule"></span>' +
               '</header>' +
               '<div class="grid">' + g.items.map(cardHtml).join("") + '</div>' +
             '</section>';
    }).join("");
  }

  function cardHtml(it) {
    var sold = it.available === false;

    var media =
      '<div class="card-media">' + PLATE_SVG +
        (it.image ? '<img src="' + esc(it.image) + '" alt="' + esc(it.name) + '" loading="lazy"' +
                    ' onerror="this.style.display=\'none\'">' : '') +
        (it.tag && !sold ? '<span class="card-tag">' + esc(it.tag) + '</span>' : '') +
        (sold ? '<div class="soldout-flag"><span>Sold Out</span></div>' : '') +
      '</div>';

    var variants = (it.variants && it.variants.length)
      ? it.variants
      : [{ label: "Order", price: it.price || 0 }];

    var prices = variants.map(function (v) {
      if (sold) {
        return '<span class="price-btn off">' +
                 '<span class="lbl">' + esc(v.label) + '</span>' +
                 '<span class="amt">' + money(v.price) + '</span>' +
               '</span>';
      }
      return '<a class="price-btn" href="' + esc(waHref(orderText(it, v))) + '"' +
             ' target="_blank" rel="noopener"' +
             ' aria-label="Order ' + esc(it.name) + ', ' + esc(v.label) + ', ' + esc(money(v.price)) + ', on WhatsApp">' +
               WA_ICON +
               '<span class="lbl">' + esc(v.label) + '</span>' +
               '<span class="amt">' + money(v.price) + '</span>' +
             '</a>';
    }).join("");

    return '<article class="card' + (sold ? " sold-out" : "") + '">' + media +
      '<div class="card-body">' +
        '<div class="card-title">' +
          (EMBLEM[it.type] || EMBLEM.veg) +
          '<h3>' + esc(it.name) + '</h3>' +
        '</div>' +
        (it.desc ? '<p class="card-desc">' + esc(it.desc) + '</p>' : '') +
        '<div class="prices">' + prices + '</div>' +
      '</div>' +
    '</article>';
  }

  /* ---------------------------------------------------- events */

  function bind() {
    $$(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        state.filter = tab.getAttribute("data-filter");
        $$(".tab").forEach(function (t) {
          t.setAttribute("aria-selected", t === tab ? "true" : "false");
        });
        renderMenu();
      });
    });

    var search = $("#searchInput");
    if (search) {
      search.addEventListener("input", function () {
        state.query = search.value;
        renderMenu();
      });
    }
  }

  /* ---------------------------------------------------- boot */

  applyBranding();
  bind();
  loadMenu();
})();
