/* ============================================================
   Shagun Home Delivery — menu manager
   Writes menu.json + images directly to GitHub from the browser.
   No server, no build step. The access key lives only in this
   browser's storage and is never part of the published site.
   ============================================================ */

(function () {
  "use strict";

  var C   = window.CONFIG || (typeof CONFIG !== "undefined" ? CONFIG : {});
  var GH  = C.github || {};
  var CUR = C.currency || "₹";
  var KEY = "shd.key.v1";
  var API = "https://api.github.com";

  var BUILD = "b5";

  /* Errors used to vanish into the console, where nobody was looking. Any
     failure now paints a banner across the top of whatever screen is up. */
  function showFatal(text) {
    var bar = document.getElementById("fatalBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "fatalBar";
      bar.style.cssText =
        "position:fixed;left:0;right:0;top:0;z-index:9999;background:#8f2029;color:#fff;" +
        "font:13px/1.5 ui-monospace,Menlo,monospace;padding:11px 40px 11px 14px;" +
        "white-space:pre-wrap;box-shadow:0 2px 12px rgba(0,0,0,.35)";
      var x = document.createElement("button");
      x.textContent = "\u00d7";
      x.setAttribute("aria-label", "Dismiss");
      x.style.cssText = "position:absolute;top:6px;right:10px;background:none;border:0;" +
        "color:#fff;font-size:20px;line-height:1;cursor:pointer";
      x.onclick = function () { bar.remove(); };
      document.body.appendChild(bar);
      bar.appendChild(x);
      bar._text = document.createElement("span");
      bar.insertBefore(bar._text, x);
    }
    bar._text.textContent = text + "   [build " + BUILD + "]";
  }

  window.addEventListener("error", function (e) {
    showFatal("Error: " + (e.message || "unknown") +
      (e.lineno ? "  (" + String(e.filename || "").split("/").pop() + ":" + e.lineno + ")" : ""));
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    showFatal("Promise error: " + ((r && r.message) || String(r)));
  });

  /* Wrap a click handler so a throw inside it is reported, not swallowed. */
  function guard(label, fn) {
    return function (e) {
      try { return fn.call(this, e); }
      catch (err) { showFatal(label + " failed: " + err.message); throw err; }
    };
  }

  var state = {
    token:    null,   // GitHub token, in memory only
    password: null,   // owner's password, in memory only — never stored
    authRec:  null,   // the locked-token record read from auth.json
    items:    [],
    original: "",     // JSON string as published, for dirty-checking
    editing:  null,   // index being edited, or null for a new dish
    draftImg: "",     // image path chosen in the open modal
    busy:     false
  };

  /* ---------------------------------------------------- tiny dom */

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function money(n) { return CUR + Number(n || 0).toLocaleString("en-IN"); }

  function msg(el, text, kind) {
    var box = $(el);
    box.className = "msg show " + (kind || "info");
    box.innerHTML = text;
  }
  function clearMsg(el) { $(el).className = "msg"; }

  var toastTimer = null;
  function toast(text) {
    var el = $("#toast");
    $("#toastMsg").textContent = text;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  var EMBLEM = {
    veg: '<svg class="emblem" viewBox="0 0 20 20"><rect x="1" y="1" width="18" height="18" rx="3" fill="#fff" stroke="#1f7a3d" stroke-width="2"/><circle cx="10" cy="10" r="4.6" fill="#1f7a3d"/></svg>',
    nonveg: '<svg class="emblem" viewBox="0 0 20 20"><rect x="1" y="1" width="18" height="18" rx="3" fill="#fff" stroke="#8f2029" stroke-width="2"/><path d="M10 5.2 14.6 14H5.4z" fill="#8f2029"/></svg>'
  };

  var IMG_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="m21 15-5-5L5 21"/></svg>';

  /* ---------------------------------------------------- base64 (utf-8 safe) */

  function toB64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function fromB64(b64) {
    var bin = atob(String(b64).replace(/\s/g, ""));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ---------------------------------------------------- password lock

     A site with no server cannot hide a secret inside its own code, so the
     GitHub token is encrypted with the owner's password and committed as
     auth.json. The password itself is never written anywhere — signing in
     means decrypting that file, and a wrong password simply fails to open
     it. Changing the password re-encrypts the same token and commits it.  */

  var AUTH_FILE  = "auth.json";
  var AUTH_CACHE = "shd.auth.v1";
  var KDF_ITER   = 600000;   // deliberately slow: the locked file is public

  function bytesToB64(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64ToBytes(b64) {
    var bin = atob(String(b64).replace(/\s/g, ""));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function subtle() { return (window.crypto && window.crypto.subtle) || null; }

  function deriveKey(password, salt, iterations) {
    return subtle()
      .importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveKey"])
      .then(function (base) {
        return subtle().deriveKey(
          { name: "PBKDF2", salt: salt, iterations: iterations, hash: "SHA-256" },
          base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      });
  }

  function lockToken(password, token) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv   = crypto.getRandomValues(new Uint8Array(12));
    return deriveKey(password, salt, KDF_ITER)
      .then(function (key) {
        return subtle().encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(token));
      })
      .then(function (buf) {
        return {
          v: 1, kdf: "PBKDF2-SHA256", cipher: "AES-GCM", iterations: KDF_ITER,
          salt: bytesToB64(salt), iv: bytesToB64(iv),
          data: bytesToB64(new Uint8Array(buf)),
          note: "Encrypted GitHub token for the menu manager. Useless without the password."
        };
      });
  }

  /* AES-GCM verifies as it decrypts, so a wrong password throws here. */
  function unlockTokenWith(password, rec) {
    return deriveKey(password, b64ToBytes(rec.salt), rec.iterations || KDF_ITER)
      .then(function (key) {
        return subtle().decrypt({ name: "AES-GCM", iv: b64ToBytes(rec.iv) }, key, b64ToBytes(rec.data));
      })
      .then(function (buf) { return new TextDecoder().decode(buf); });
  }

  function cacheAuthRecord(rec) {
    try { localStorage.setItem(AUTH_CACHE, JSON.stringify(rec)); } catch (e) {}
  }
  function cachedAuthRecord() {
    try { return JSON.parse(localStorage.getItem(AUTH_CACHE)); } catch (e) { return null; }
  }

  /* Read straight off the site rather than through the API — there is no
     token to authenticate with until this file has been opened. */
  function fetchAuthRecord() {
    return fetch(AUTH_FILE + "?v=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rec) { return (rec && rec.data && rec.salt && rec.iv) ? rec : null; })
      .catch(function () { return null; });
  }

  function saveAuthRecord(rec, message) {
    var content = toB64(JSON.stringify(rec, null, 2) + "\n");
    return getFile(AUTH_FILE)
      .then(function (file) { return putFile(AUTH_FILE, content, message, file && file.sha); })
      .then(function () { state.authRec = rec; cacheAuthRecord(rec); });
  }

  /* ---------------------------------------------------- github api */

  function repoPath() { return "/repos/" + GH.owner + "/" + GH.repo; }

  function gh(path, options) {
    var opts = options || {};
    return fetch(API + path, {
      method: opts.method || "GET",
      headers: {
        "Authorization": "Bearer " + state.token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store"
    }).then(function (res) {
      if (res.status === 204) return null;
      return res.json().then(function (data) {
        if (!res.ok) {
          var e = new Error((data && data.message) || ("GitHub returned " + res.status));
          e.status = res.status;
          throw e;
        }
        return data;
      }, function () {
        if (!res.ok) {
          var e = new Error("GitHub returned " + res.status);
          e.status = res.status;
          throw e;
        }
        return null;
      });
    });
  }

  function getFile(path) {
    return gh(repoPath() + "/contents/" + path + "?ref=" + encodeURIComponent(GH.branch || "main"))
      .catch(function (err) {
        if (err.status === 404) return null;
        throw err;
      });
  }

  function putFile(path, base64, message, sha) {
    var body = {
      message: message,
      content: base64,
      branch: GH.branch || "main"
    };
    if (sha) body.sha = sha;
    return gh(repoPath() + "/contents/" + path, { method: "PUT", body: body });
  }

  /* ---------------------------------------------------- auth */

  function storedToken() {
    try {
      return localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || null;
    } catch (e) { return null; }
  }
  function storeToken(token, remember) {
    try {
      localStorage.removeItem(KEY);
      sessionStorage.removeItem(KEY);
      (remember ? localStorage : sessionStorage).setItem(KEY, token);
    } catch (e) {}
  }
  function forgetToken() {
    try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch (e) {}
  }
  function isRemembered() {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  }

  function configReady() {
    return !!(GH.owner && GH.owner !== "YOUR_GITHUB_USERNAME" && GH.repo);
  }

  /* Set the token, prove it works, and roll back if it does not. */
  function verifyToken(token) {
    var previous = state.token;
    state.token = token;
    return gh(repoPath()).catch(function (err) {
      state.token = previous;
      throw err;
    });
  }

  function tokenError(err) {
    if (err.status === 401) {
      return "That GitHub token was not accepted. Check you pasted the whole thing.";
    }
    if (err.status === 404) {
      return "The token is valid, but it cannot see <code>" + esc(GH.owner + "/" + GH.repo) +
             "</code>. Give it access to that repository, or fix the names in <code>config.js</code>.";
    }
    return esc(err.message || "Something went wrong.");
  }

  function showPane(id) {
    ["#paneBoot", "#paneUnlock", "#paneSetup"].forEach(function (sel) {
      var el = $(sel);
      if (el) el.hidden = (sel !== id);
    });
  }

  var SPINNER = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="2.2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg> ';

  function busyBtn(sel, label) {
    var btn = $(sel);
    var original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = SPINNER + label;
    return function () { btn.disabled = false; btn.innerHTML = original; };
  }

  /* ---- signing in with the password ---- */

  function unlock() {
    var pw = $("#pw").value;
    if (!pw) { $("#pw").focus(); return; }
    clearMsg("#gateMsg");

    // 600k PBKDF2 rounds takes a moment, especially on a phone.
    var done = busyBtn("#unlock", "Unlocking…");

    unlockTokenWith(pw, state.authRec)
      .catch(function () { var e = new Error("bad password"); e.wrongPassword = true; throw e; })
      .then(function (token) {
        return verifyToken(token).then(function () {
          state.password = pw;
          storeToken(token, $("#remember").checked);
          done();
          showApp();
        });
      })
      .catch(function (err) {
        done();
        if (err.wrongPassword) {
          msg("#gateMsg", "That password did not work.", "error");
        } else if (err.status === 401) {
          msg("#gateMsg",
            "Your password is right, but the GitHub token it unlocked is no longer valid — " +
            "it has most likely expired. Use <b>Forgot your password?</b> below to put a " +
            "fresh token in.", "error");
        } else {
          msg("#gateMsg", tokenError(err), "error");
        }
      });
  }

  /* ---- first-time setup, and resetting a forgotten password ---- */

  function setupMode(mode) {
    var recovery = (mode === "recovery");
    $("#setupTitle").textContent = recovery ? "Reset your password" : "Choose a password";
    $("#setupLede").textContent = recovery
      ? "The old password cannot be recovered — it was never stored anywhere, which is the " +
        "point of it. Paste a GitHub token again and pick a new password; that replaces the old lock."
      : "This is the one and only time you need a GitHub token. It gets locked with your " +
        "password and stored in your repository, so from now on you only type the password.";
    $("#setupGoLabel").textContent = recovery ? "Reset password" : "Set password";
    $("#backToUnlockWrap").hidden = !recovery;
  }

  function runSetup() {
    var pw1   = $("#s-newpw").value;
    var pw2   = $("#s-newpw2").value;
    var token = $("#s-token").value.trim();
    clearMsg("#setupMsg");

    if (pw1.length < 10) {
      msg("#setupMsg", "Use a password of at least 10 characters — see the note below on why.", "error");
      $("#s-newpw").focus(); return;
    }
    if (pw1 !== pw2) {
      msg("#setupMsg", "The two passwords do not match.", "error");
      $("#s-newpw2").focus(); return;
    }
    if (!token) {
      msg("#setupMsg", "Paste your GitHub token. You only need it this once.", "error");
      $("#s-token").focus(); return;
    }

    var done = busyBtn("#setupGo", "Saving…");
    verifyToken(token)
      .then(function () { return lockToken(pw1, token); })
      .then(function (rec) { return saveAuthRecord(rec, "Set menu manager password"); })
      .then(function () {
        state.password = pw1;
        storeToken(token, true);
        $("#s-newpw").value = $("#s-newpw2").value = $("#s-token").value = "";
        done();
        showApp();
        toast("Password set — that is all you need from now on");
      })
      .catch(function (err) {
        done();
        msg("#setupMsg", tokenError(err), "error");
      });
  }

  /* ---- changing the password / swapping the token from inside the app ---- */

  function openSettings() {
    $("#c-pw1").value = "";
    $("#c-pw2").value = "";
    $("#c-token").value = "";
    clearMsg("#setMsg");
    $("#setScrim").classList.add("open");
    $("#setModal").classList.add("open");
    $("#setModal").setAttribute("aria-hidden", "false");
    setTimeout(function () { $("#c-pw1").focus(); }, 60);
  }

  function closeSettings() {
    $("#setScrim").classList.remove("open");
    $("#setModal").classList.remove("open");
    $("#setModal").setAttribute("aria-hidden", "true");
  }

  function saveSettings() {
    var pw1    = $("#c-pw1").value;
    var pw2    = $("#c-pw2").value;
    var newTok = $("#c-token").value.trim();
    clearMsg("#setMsg");

    var changingPw = pw1.length > 0 || pw2.length > 0;

    if (changingPw) {
      if (pw1.length < 10) {
        msg("#setMsg", "Use a password of at least 10 characters.", "error");
        $("#c-pw1").focus(); return;
      }
      if (pw1 !== pw2) {
        msg("#setMsg", "The two passwords do not match.", "error");
        $("#c-pw2").focus(); return;
      }
    }
    if (!changingPw && !newTok) {
      msg("#setMsg", "Nothing to change — fill in a new password, a new token, or both.", "info");
      return;
    }

    // Re-locking needs a password. Normally it is the one typed at sign in;
    // a session restored from "stay signed in" never saw one, so ask for a new one.
    var password = changingPw ? pw1 : state.password;
    if (!password) {
      msg("#setMsg",
        "This browser was signed in from a saved session, so it does not know your " +
        "password. Type a new password above and the token will be re-locked with it.", "error");
      $("#c-pw1").focus(); return;
    }

    var done = busyBtn("#setSave", "Saving…");
    Promise.resolve()
      .then(function () { return newTok ? verifyToken(newTok) : null; })
      .then(function () {
        var tok = newTok || state.token;
        return lockToken(password, tok).then(function (rec) {
          var what = newTok && changingPw ? "Change menu manager password and token"
                   : newTok               ? "Replace menu manager token"
                                          : "Change menu manager password";
          return saveAuthRecord(rec, what).then(function () { return tok; });
        });
      })
      .then(function (tok) {
        state.token = tok;
        state.password = password;
        storeToken(tok, isRemembered());
        done();
        closeSettings();
        toast(newTok && changingPw ? "Password and token updated"
            : newTok               ? "Token replaced"
                                   : "Password changed");
      })
      .catch(function (err) {
        done();
        msg("#setMsg", tokenError(err), "error");
      });
  }

  /* ---- app shell ---- */

  function showApp() {
    $("#gate").hidden = true;
    $("#app").hidden = false;
    $("#repoLabel").textContent = GH.owner + "/" + GH.repo;
    loadMenu();
  }

  function signOut() {
    forgetToken();
    state.token = null;
    state.password = null;
    location.reload();
  }

  /* ---------------------------------------------------- menu load / publish */

  function loadMenu() {
    $("#rows").innerHTML = '<div class="empty"><h3>Loading menu…</h3></div>';
    getFile("menu.json")
      .then(function (file) {
        if (!file) {
          state.items = [];
          state.original = JSON.stringify([]);
          msg("#appMsg", "No <code>menu.json</code> found in the repository yet — " +
                         "add your first dish and publish to create it.", "info");
        } else {
          var data = JSON.parse(fromB64(file.content));
          state.items = (data && data.items) || [];
          state.original = JSON.stringify(state.items);
          clearMsg("#appMsg");
        }
        render();
      })
      .catch(function (err) {
        msg("#appMsg", "Could not load the menu: " + esc(err.message), "error");
        $("#rows").innerHTML = "";
      });
  }

  function isDirty() { return JSON.stringify(state.items) !== state.original; }

  function publish() {
    if (state.busy) return;
    state.busy = true;

    var btn = $("#publish");
    var label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg> Publishing…';

    var payload = {
      updatedAt: new Date().toISOString().slice(0, 10),
      items: state.items
    };
    var content = toB64(JSON.stringify(payload, null, 2) + "\n");

    // Re-read the sha immediately before writing so concurrent edits
    // from another device fail loudly instead of being clobbered.
    getFile("menu.json")
      .then(function (file) {
        return putFile("menu.json", content, "Update menu (" + state.items.length + " dishes)", file && file.sha);
      })
      .then(function () {
        state.original = JSON.stringify(state.items);
        render();
        toast("Published — live in about a minute");
        clearMsg("#appMsg");
      })
      .catch(function (err) {
        msg("#appMsg", "Publish failed: " + esc(err.message) +
            (err.status === 409 ? " — someone else changed the menu. Reload and redo your edits." : ""), "error");
      })
      .then(function () {
        state.busy = false;
        btn.disabled = false;
        btn.innerHTML = label;
      });
  }

  /* ---------------------------------------------------- rendering */

  function render() {
    var rows = $("#rows");
    $("#itemCount").textContent = state.items.length + (state.items.length === 1 ? " item" : " items");
    $("#publishBar").classList.toggle("show", isDirty());

    if (!state.items.length) {
      rows.innerHTML =
        '<div class="empty"><h3>No dishes yet</h3><p>Click <b>Add dish</b> to create your first menu item.</p></div>';
      return;
    }

    rows.innerHTML = state.items.map(function (it, i) {
      var variants = (it.variants || []).map(function (v) {
        return esc(v.label) + " <b>" + money(v.price) + "</b>";
      }).join(" · ");

      return '<div class="row' + (it.available === false ? " off" : "") + '">' +
        '<div class="thumb">' +
          (it.image ? '<img src="' + esc(it.image) + '" alt="" onerror="this.remove()">' : IMG_ICON) +
        '</div>' +
        '<div class="meta">' +
          '<div class="nm">' + (EMBLEM[it.type] || EMBLEM.veg) + esc(it.name) +
            (it.available === false ? ' <span class="badge-off">Sold out</span>' : '') +
          '</div>' +
          '<div class="vr">' + (variants || '<span style="color:var(--maroon)">No price set</span>') + '</div>' +
        '</div>' +
        '<div class="acts">' +
          iconBtn("up", i, "Move up", 'M12 19V5M5 12l7-7 7 7', i === 0) +
          iconBtn("down", i, "Move down", 'M12 5v14M19 12l-7 7-7-7', i === state.items.length - 1) +
          iconBtn("edit", i, "Edit", 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z', false) +
          iconBtn("del", i, "Delete", 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', false) +
        '</div>' +
      '</div>';
    }).join("");
  }

  function iconBtn(action, index, label, path, disabled) {
    return '<button class="iconbtn ' + action + '" data-act="' + action + '" data-i="' + index + '"' +
      ' title="' + label + '" aria-label="' + label + '"' + (disabled ? " disabled" : "") + '>' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="' + path + '"/></svg>' +
      '</button>';
  }

  /* ---------------------------------------------------- modal */

  function openModal(index) {
    state.editing = (index == null ? null : index);
    var it = index == null
      ? { name: "", desc: "", type: "veg", image: "", tag: "", available: true,
          variants: [{ label: "Half Plate", price: "" }, { label: "Full Plate", price: "" }] }
      : state.items[index];

    $("#modalTitle").textContent = index == null ? "Add Dish" : "Edit Dish";
    $("#m-name").value = it.name || "";
    $("#m-desc").value = it.desc || "";
    $("#m-tag").value  = it.tag || "";
    $("#m-available").checked = it.available !== false;

    $$('input[name="mtype"]').forEach(function (r) { r.checked = (r.value === (it.type || "veg")); });
    syncSeg();

    state.draftImg = it.image || "";
    renderPreview();
    $("#imgStatus").textContent = "Optional. Resized automatically before upload.";

    renderVariants(it.variants && it.variants.length ? it.variants : [{ label: "", price: "" }]);

    $("#modal").classList.add("open");
    $("#modal").setAttribute("aria-hidden", "false");
    $("#modalScrim").classList.add("open");
    document.body.style.overflow = "hidden";
    setTimeout(function () { $("#m-name").focus(); }, 120);
  }

  function closeModal() {
    $("#modal").classList.remove("open");
    $("#modal").setAttribute("aria-hidden", "true");
    $("#modalScrim").classList.remove("open");
    document.body.style.overflow = "";
    state.editing = null;
  }

  function syncSeg() {
    $$("#m-type label").forEach(function (l) {
      l.classList.toggle("on", $("input", l).checked);
    });
  }

  function renderVariants(variants) {
    $("#m-variants").innerHTML = variants.map(function (v) {
      return '<div class="vrow">' +
        '<input class="vlabel" type="text" placeholder="Portion (e.g. Full Plate)" value="' + esc(v.label) + '">' +
        '<input class="vprice" type="number" inputmode="numeric" min="0" step="1" placeholder="Price" value="' + esc(v.price) + '">' +
        '<button class="iconbtn del" data-rmv title="Remove portion" aria-label="Remove portion">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/></svg>' +
        '</button>' +
      '</div>';
    }).join("");
  }

  function readVariants() {
    return $$("#m-variants .vrow").map(function (row) {
      return {
        label: $(".vlabel", row).value.trim(),
        price: Number($(".vprice", row).value)
      };
    }).filter(function (v) { return v.label && v.price > 0; });
  }

  function renderPreview() {
    var prev = $("#m-prev");
    prev.innerHTML = state.draftImg
      ? IMG_ICON + '<img src="' + esc(state.draftImg) + '" alt="" style="position:absolute;inset:0" onerror="this.remove()">'
      : IMG_ICON;
    $("#clearImage").hidden = !state.draftImg;
  }

  function slug(text) {
    return String(text).toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "dish";
  }

  function uniqueId(base, ignoreIndex) {
    var id = base, n = 2;
    var taken = function (candidate) {
      return state.items.some(function (it, i) {
        return i !== ignoreIndex && it.id === candidate;
      });
    };
    while (taken(id)) { id = base + "-" + n; n++; }
    return id;
  }

  function saveItem() {
    var name = $("#m-name").value.trim();
    if (!name) { $("#m-name").focus(); toast("Please enter a dish name"); return; }

    var variants = readVariants();
    if (!variants.length) { toast("Add at least one portion with a price"); return; }

    var type = ($$('input[name="mtype"]').filter(function (r) { return r.checked; })[0] || {}).value || "veg";

    var item = {
      id:        state.editing == null
                   ? uniqueId(slug(name), -1)
                   : (state.items[state.editing].id || uniqueId(slug(name), state.editing)),
      name:      name,
      desc:      $("#m-desc").value.trim(),
      type:      type,
      image:     state.draftImg || "",
      available: $("#m-available").checked,
      tag:       $("#m-tag").value.trim(),
      variants:  variants
    };

    if (state.editing == null) state.items.push(item);
    else state.items[state.editing] = item;

    closeModal();
    render();
    toast(state.editing == null ? "Dish added — remember to publish" : "Dish updated — remember to publish");
  }

  /* ---------------------------------------------------- image upload */

  function resize(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("Could not read that file")); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error("That file is not a readable image")); };
        img.onload = function () {
          var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          var w = Math.round(img.width * scale);
          var h = Math.round(img.height * scale);
          var canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function handleImage(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast("Please choose an image file"); return; }

    var status = $("#imgStatus");
    status.textContent = "Preparing photo…";

    var name = slug($("#m-name").value || "dish") + "-" + Date.now() + ".jpg";
    var path = "images/" + name;

    resize(file, 1000, 0.82)
      .then(function (b64) {
        status.textContent = "Uploading…";
        return putFile(path, b64, "Add photo " + name).then(function () { return b64; });
      })
      .then(function (b64) {
        state.draftImg = path;
        // show the local render straight away; the committed file may take
        // a moment to become fetchable from the site
        $("#m-prev").innerHTML = '<img src="data:image/jpeg;base64,' + b64 + '" alt="">';
        $("#clearImage").hidden = false;
        status.textContent = "Photo uploaded ✓";
      })
      .catch(function (err) {
        status.textContent = "Upload failed: " + err.message;
      });
  }

  /* ---------------------------------------------------- events */

  function bind() {
    // --- gate
    $("#unlock").addEventListener("click", unlock);
    $("#pw").addEventListener("keydown", function (e) {
      if (e.key === "Enter") unlock();
    });

    $("#setupGo").addEventListener("click", runSetup);
    $("#s-token").addEventListener("keydown", function (e) {
      if (e.key === "Enter") runSetup();
    });

    $("#forgot").addEventListener("click", function (e) {
      e.preventDefault();
      clearMsg("#gateMsg");
      setupMode("recovery");
      showPane("#paneSetup");
      $("#s-newpw").focus();
    });
    $("#backToUnlock").addEventListener("click", function (e) {
      e.preventDefault();
      clearMsg("#setupMsg");
      showPane("#paneUnlock");
      $("#pw").focus();
    });

    // --- password / access settings
    $("#openSettings").addEventListener("click", guard("Password panel", openSettings));
    $("#setClose").addEventListener("click", closeSettings);
    $("#setCancel").addEventListener("click", closeSettings);
    $("#setScrim").addEventListener("click", closeSettings);
    $("#setSave").addEventListener("click", saveSettings);
    $("#signOut").addEventListener("click", function () {
      if (isDirty() && !confirm("You have unpublished changes. Sign out and lose them?")) return;
      signOut();
    });

    // --- list actions
    $("#rows").addEventListener("click", guard("Dish action", function (e) {
      var btn = e.target.closest("[data-act]");
      if (!btn) return;
      var i = Number(btn.getAttribute("data-i"));
      var act = btn.getAttribute("data-act");

      if (act === "edit") { openModal(i); return; }
      if (act === "del") {
        if (!confirm('Delete "' + state.items[i].name + '" from the menu?')) return;
        state.items.splice(i, 1);
        render();
        toast("Deleted — remember to publish");
        return;
      }
      var to = act === "up" ? i - 1 : i + 1;
      if (to < 0 || to >= state.items.length) return;
      var moved = state.items.splice(i, 1)[0];
      state.items.splice(to, 0, moved);
      render();
    }));

    $("#addItem").addEventListener("click", guard("Add dish", function () { openModal(null); }));

    // --- publish bar
    $("#publish").addEventListener("click", guard("Publish", publish));
    $("#discard").addEventListener("click", function () {
      if (!confirm("Discard all unpublished changes?")) return;
      state.items = JSON.parse(state.original);
      render();
      toast("Changes discarded");
    });

    // --- modal
    $("#modalClose").addEventListener("click", closeModal);
    $("#modalCancel").addEventListener("click", closeModal);
    $("#modalScrim").addEventListener("click", closeModal);
    $("#modalSave").addEventListener("click", guard("Save dish", saveItem));

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if ($("#setModal").classList.contains("open")) { closeSettings(); return; }
      if ($("#modal").classList.contains("open")) closeModal();
    });

    $("#m-type").addEventListener("change", syncSeg);

    $("#addVariant").addEventListener("click", function () {
      var current = $$("#m-variants .vrow").map(function (row) {
        return { label: $(".vlabel", row).value, price: $(".vprice", row).value };
      });
      current.push({ label: "", price: "" });
      renderVariants(current);
    });

    $("#m-variants").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-rmv]");
      if (!btn) return;
      var rows = $$("#m-variants .vrow");
      if (rows.length === 1) { toast("At least one portion is needed"); return; }
      btn.closest(".vrow").remove();
    });

    $("#pickImage").addEventListener("click", function () { $("#m-file").click(); });
    $("#m-file").addEventListener("change", function (e) {
      handleImage(e.target.files[0]);
      e.target.value = "";
    });
    $("#clearImage").addEventListener("click", function () {
      state.draftImg = "";
      renderPreview();
      $("#imgStatus").textContent = "Photo removed from this dish.";
    });

    // --- leave guard
    window.addEventListener("beforeunload", function (e) {
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = "";
    });
  }

  /* ---------------------------------------------------- boot */

  function openGate(rec, note) {
    if (rec && rec.data) {
      showPane("#paneUnlock");
      if (note) msg("#gateMsg", note, "info");
      $("#pw").focus();
    } else {
      setupMode("setup");
      showPane("#paneSetup");
      $("#s-newpw").focus();
    }
  }

  function boot() {
    if (!configReady()) {
      showPane("#paneBoot");
      msg("#bootMsg",
        "<b>Setup needed.</b> Open <code>config.js</code> and fill in your GitHub " +
        "<code>owner</code> and <code>repo</code> before using the manager.", "error");
      return;
    }
    if (!subtle()) {
      showPane("#paneBoot");
      msg("#bootMsg",
        "<b>This page is not on a secure origin.</b> Password locking needs " +
        "<code>https://</code> or <code>localhost</code>. GitHub Pages is https, so this " +
        "will work once the site is live.", "error");
      return;
    }

    fetchAuthRecord().then(function (rec) {
      // A freshly written auth.json takes a minute to redeploy; fall back to
      // the local copy so a reload in that window is not mistaken for setup.
      state.authRec = rec || cachedAuthRecord();
      if (rec) cacheAuthRecord(rec);

      var saved = storedToken();
      if (!saved) { openGate(state.authRec, ""); return; }

      state.token = saved;
      gh(repoPath())
        .then(function () { showApp(); })
        .catch(function () {
          forgetToken();
          state.token = null;
          openGate(state.authRec, "Your saved session has ended. Please sign in again.");
        });
    });
  }

  var stamp = document.getElementById("buildStamp");
  if (stamp) stamp.textContent = "build " + BUILD;

  // bind() failing must not stop boot() — otherwise the gate never appears.
  try {
    bind();
  } catch (err) {
    showFatal("Could not wire up the page: " + err.message +
              " — this usually means a cached copy; reload with Ctrl+Shift+R");
  }
  boot();
})();
