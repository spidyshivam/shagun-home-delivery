/* Menu manager.

   Signing in decrypts the GitHub token out of auth.json using the owner's
   password. Everything after that is ordinary GitHub Contents API calls.
   There is no server anywhere in this. */

import { CONFIG } from "../config.js";
import { createClient, explainError } from "./lib/github.js";
import { lockToken, unlockToken, cryptoAvailable, looksLikeAuthRecord } from "./lib/crypto.js";
import { resizeToJpegB64, slugify } from "./lib/image.js";
import { money } from "./lib/format.js";

const AUTH_FILE  = "auth.json";
const MENU_FILE  = "menu.json";
const TOKEN_KEY  = "shd.key.v1";
const AUTH_CACHE = "shd.auth.v1";
const MIN_PASSWORD = 10;

function blankDish() {
  return {
    id: "", name: "", desc: "", type: "veg", image: "", tag: "",
    available: true,
    variants: [{ label: "Half Plate", price: "" }, { label: "Full Plate", price: "" }]
  };
}

/* localStorage throws in private modes and with site data blocked. None of
   this is important enough to break the page over. */
const store = {
  get(key) {
    try { return localStorage.getItem(key) ?? sessionStorage.getItem(key); }
    catch { return null; }
  },
  set(key, value, persist) {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
      (persist ? localStorage : sessionStorage).setItem(key, value);
    } catch { /* nothing we can do, and nothing that needs doing */ }
  },
  clear(key) {
    try { localStorage.removeItem(key); sessionStorage.removeItem(key); } catch {}
  },
  isPersisted(key) {
    try { return !!localStorage.getItem(key); } catch { return false; }
  }
};

export function adminApp() {
  return {
    config: CONFIG,
    build: "alpine-1",

    /* boot | unlock | setup | app */
    screen: "boot",
    bootError: "",

    /* auth */
    client: null,
    token: null,
    ownerPassword: null,      // held in memory only, never written anywhere
    authRec: null,
    password: "",
    remember: true,
    unlocking: false,
    gateMsg: null,

    /* first-run and recovery */
    recovery: false,
    setupPw: "",
    setupPw2: "",
    setupToken: "",
    savingSetup: false,
    setupMsg: null,

    /* menu */
    items: [],
    original: "[]",
    appMsg: null,
    publishing: false,

    /* edit sheet */
    modalOpen: false,
    editingIndex: null,
    draft: blankDish(),
    imageStatus: "",
    uploading: false,

    /* password panel */
    settingsOpen: false,
    cPw1: "",
    cPw2: "",
    cToken: "",
    savingSettings: false,
    setMsg: null,

    /* toast */
    toastText: "",
    toastVisible: false,
    _toastTimer: null,

    /* ------------------------------------------------ boot */

    async init() {
      if (!this.configReady) {
        this.bootError =
          "Open config.js and fill in your GitHub owner and repo before using the manager.";
        return;
      }
      if (!cryptoAvailable()) {
        this.bootError =
          "This page is not on a secure origin. Password locking needs https:// or localhost.";
        return;
      }

      window.addEventListener("beforeunload", (e) => {
        if (!this.dirty) return;
        e.preventDefault();
        e.returnValue = "";
      });

      this.authRec = await this.fetchAuthRecord();

      const saved = store.get(TOKEN_KEY);
      if (saved) {
        this.client = this.makeClient(saved);
        try {
          await this.client.checkAccess();
          this.token = saved;
          await this.enterApp();
          return;
        } catch {
          store.clear(TOKEN_KEY);
          this.client = null;
          this.gateMsg = { kind: "info", text: "Your saved session has ended. Please sign in again." };
        }
      }

      this.screen = looksLikeAuthRecord(this.authRec) ? "unlock" : "setup";
    },

    get configReady() {
      const g = this.config.github || {};
      return !!(g.owner && g.owner !== "YOUR_GITHUB_USERNAME" && g.repo);
    },

    get repoSlug() {
      const g = this.config.github || {};
      return `${g.owner}/${g.repo}`;
    },

    makeClient(token) {
      return createClient({ ...this.config.github, token });
    },

    /* The locked blob is read off the site, not the API — there is no token
       to authenticate with until it has been opened. */
    async fetchAuthRecord() {
      try {
        const res = await fetch(`${AUTH_FILE}?v=${Date.now()}`, { cache: "no-store" });
        if (res.ok) {
          const rec = await res.json();
          if (looksLikeAuthRecord(rec)) {
            try { localStorage.setItem(AUTH_CACHE, JSON.stringify(rec)); } catch {}
            return rec;
          }
        }
      } catch { /* fall through to the cached copy */ }

      // A freshly written auth.json takes a minute to redeploy; without this
      // a reload inside that window looks like first-run setup.
      try {
        const cached = JSON.parse(localStorage.getItem(AUTH_CACHE));
        return looksLikeAuthRecord(cached) ? cached : null;
      } catch { return null; }
    },

    /* ------------------------------------------------ sign in */

    async unlock() {
      if (!this.password || this.unlocking) return;
      this.gateMsg = null;
      this.unlocking = true;      // 600k PBKDF2 rounds take a moment on a phone

      let token;
      try {
        token = await unlockToken(this.password, this.authRec);
      } catch {
        this.unlocking = false;
        this.gateMsg = { kind: "error", text: "That password did not work." };
        return;
      }

      try {
        this.client = this.makeClient(token);
        await this.client.checkAccess();
        this.token = token;
        this.ownerPassword = this.password;
        store.set(TOKEN_KEY, token, this.remember);
        this.password = "";
        await this.enterApp();
      } catch (err) {
        this.client = null;
        this.gateMsg = {
          kind: "error",
          text: err?.status === 401
            ? "Your password is right, but the GitHub token it unlocked is no longer valid — " +
              "it has most likely expired. Use “Forgot your password?” to put a fresh token in."
            : explainError(err, this.repoSlug)
        };
      } finally {
        this.unlocking = false;
      }
    },

    startRecovery() {
      this.recovery = true;
      this.gateMsg = null;
      this.setupMsg = null;
      this.screen = "setup";
    },

    backToUnlock() {
      this.setupMsg = null;
      this.screen = "unlock";
    },

    get setupTitle() {
      return this.recovery ? "Reset your password" : "Choose a password";
    },

    get setupLede() {
      return this.recovery
        ? "The old password cannot be recovered — it was never stored anywhere, which is " +
          "the point of it. Paste a GitHub token again and pick a new password; that " +
          "replaces the old lock."
        : "This is the one and only time you need a GitHub token. It gets locked with your " +
          "password and stored in your repository, so from now on you only type the password.";
    },

    async runSetup() {
      if (this.savingSetup) return;
      this.setupMsg = null;

      if (this.setupPw.length < MIN_PASSWORD) {
        this.setupMsg = { kind: "error", text: `Use a password of at least ${MIN_PASSWORD} characters.` };
        return;
      }
      if (this.setupPw !== this.setupPw2) {
        this.setupMsg = { kind: "error", text: "The two passwords do not match." };
        return;
      }
      if (!this.setupToken.trim()) {
        this.setupMsg = { kind: "error", text: "Paste your GitHub token. You only need it this once." };
        return;
      }

      this.savingSetup = true;
      try {
        const token = this.setupToken.trim();
        this.client = this.makeClient(token);
        await this.client.checkAccess();

        const rec = await lockToken(this.setupPw, token);
        await this.client.writeJSON(AUTH_FILE, rec, "Set menu manager password");

        this.authRec = rec;
        try { localStorage.setItem(AUTH_CACHE, JSON.stringify(rec)); } catch {}

        this.token = token;
        this.ownerPassword = this.setupPw;
        store.set(TOKEN_KEY, token, true);

        this.setupPw = this.setupPw2 = this.setupToken = "";
        await this.enterApp();
        this.toast("Password set — that is all you need from now on");
      } catch (err) {
        this.client = null;
        this.setupMsg = { kind: "error", text: explainError(err, this.repoSlug) };
      } finally {
        this.savingSetup = false;
      }
    },

    signOut() {
      if (this.dirty && !confirm("You have unpublished changes. Sign out and lose them?")) return;
      store.clear(TOKEN_KEY);
      this.token = null;
      this.ownerPassword = null;
      location.reload();
    },

    /* ------------------------------------------------ menu */

    async enterApp() {
      this.screen = "app";
      await this.loadMenu();
    },

    async loadMenu() {
      this.appMsg = null;
      try {
        const { data } = await this.client.readJSON(MENU_FILE);
        if (!data) {
          this.items = [];
          this.appMsg = {
            kind: "info",
            text: "No menu.json in the repository yet — add your first dish and publish to create it."
          };
        } else {
          this.items = data.items ?? [];
        }
        this.original = JSON.stringify(this.items);
      } catch (err) {
        this.appMsg = { kind: "error", text: `Could not load the menu: ${explainError(err, this.repoSlug)}` };
      }
    },

    get dirty() { return JSON.stringify(this.items) !== this.original; },

    get itemCountLabel() {
      return `${this.items.length} ${this.items.length === 1 ? "item" : "items"}`;
    },

    price(amount) { return money(amount, this.config.currency); },

    variantSummary(item) {
      return (item.variants ?? []).map((v) => `${v.label} ${this.price(v.price)}`).join("  ·  ");
    },

    move(index, direction) {
      const to = index + direction;
      if (to < 0 || to >= this.items.length) return;
      const [moved] = this.items.splice(index, 1);
      this.items.splice(to, 0, moved);
    },

    remove(index) {
      if (!confirm(`Delete "${this.items[index].name}" from the menu?`)) return;
      this.items.splice(index, 1);
      this.toast("Deleted — remember to publish");
    },

    discard() {
      if (!confirm("Discard all unpublished changes?")) return;
      this.items = JSON.parse(this.original);
      this.toast("Changes discarded");
    },

    async publish() {
      if (this.publishing) return;
      this.publishing = true;
      this.appMsg = null;
      try {
        const payload = {
          updatedAt: new Date().toISOString().slice(0, 10),
          items: this.items
        };
        // writeJSON re-reads the sha first, so a second device's edit fails
        // loudly instead of being silently overwritten.
        await this.client.writeJSON(
          MENU_FILE, payload, `Update menu (${this.items.length} dishes)`
        );
        this.original = JSON.stringify(this.items);
        this.toast("Published — live in about a minute");
      } catch (err) {
        this.appMsg = { kind: "error", text: `Publish failed: ${explainError(err, this.repoSlug)}` };
      } finally {
        this.publishing = false;
      }
    },

    /* ------------------------------------------------ edit sheet */

    openEdit(index = null) {
      this.editingIndex = index;
      this.draft = index === null
        ? blankDish()
        : JSON.parse(JSON.stringify(this.items[index]));
      if (!this.draft.variants?.length) this.draft.variants = [{ label: "", price: "" }];
      this.imageStatus = "Optional. Resized automatically before upload.";
      this.modalOpen = true;
    },

    closeEdit() {
      this.modalOpen = false;
      this.editingIndex = null;
    },

    addVariant() {
      this.draft.variants.push({ label: "", price: "" });
    },

    removeVariant(index) {
      if (this.draft.variants.length === 1) {
        this.toast("At least one portion is needed");
        return;
      }
      this.draft.variants.splice(index, 1);
    },

    saveDraft() {
      const name = this.draft.name.trim();
      if (!name) { this.toast("Give the dish a name"); return; }

      const variants = this.draft.variants
        .map((v) => ({ label: v.label.trim(), price: Number(v.price) }))
        .filter((v) => v.label && Number.isFinite(v.price) && v.price >= 0);

      if (!variants.length) { this.toast("Add at least one portion with a price"); return; }

      const dish = {
        id: this.draft.id || slugify(name),
        name,
        desc: this.draft.desc.trim(),
        type: this.draft.type,
        image: this.draft.image,
        available: this.draft.available !== false,
        tag: this.draft.tag.trim(),
        variants
      };

      if (this.editingIndex === null) this.items.push(dish);
      else this.items[this.editingIndex] = dish;

      this.closeEdit();
      this.toast("Saved — remember to publish");
    },

    clearImage() {
      this.draft.image = "";
      this.imageStatus = "Photo removed from this dish.";
    },

    async handleFile(event) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      this.uploading = true;
      this.imageStatus = "Resizing…";
      try {
        const b64 = await resizeToJpegB64(file);
        const path = `images/${slugify(this.draft.name || "dish")}-${Date.now()}.jpg`;
        this.imageStatus = "Uploading…";
        await this.client.putFile(path, b64, `Add photo ${path}`);
        this.draft.image = path;
        // The committed file takes a moment to be fetchable from the site,
        // so preview the local render meanwhile.
        this.draft._preview = `data:image/jpeg;base64,${b64}`;
        this.imageStatus = "Photo uploaded ✓";
      } catch (err) {
        this.imageStatus = `Upload failed: ${err.message}`;
      } finally {
        this.uploading = false;
      }
    },

    get draftPreview() {
      return this.draft._preview || this.draft.image || "";
    },

    /* ------------------------------------------------ password panel */

    openSettings() {
      this.cPw1 = this.cPw2 = this.cToken = "";
      this.setMsg = null;
      this.settingsOpen = true;
    },

    closeSettings() { this.settingsOpen = false; },

    async saveSettings() {
      if (this.savingSettings) return;
      this.setMsg = null;

      const newToken = this.cToken.trim();
      const changingPassword = this.cPw1.length > 0 || this.cPw2.length > 0;

      if (changingPassword) {
        if (this.cPw1.length < MIN_PASSWORD) {
          this.setMsg = { kind: "error", text: `Use a password of at least ${MIN_PASSWORD} characters.` };
          return;
        }
        if (this.cPw1 !== this.cPw2) {
          this.setMsg = { kind: "error", text: "The two passwords do not match." };
          return;
        }
      }
      if (!changingPassword && !newToken) {
        this.setMsg = { kind: "info", text: "Nothing to change — fill in a new password, a new token, or both." };
        return;
      }

      // Re-locking needs a password. Normally it is the one typed at sign in;
      // a session restored from "stay signed in" never saw one.
      const password = changingPassword ? this.cPw1 : this.ownerPassword;
      if (!password) {
        this.setMsg = {
          kind: "error",
          text: "This browser was signed in from a saved session, so it does not know your " +
                "password. Type a new password above and the token will be re-locked with it."
        };
        return;
      }

      this.savingSettings = true;
      try {
        let token = this.token;
        if (newToken) {
          const probe = this.makeClient(newToken);
          await probe.checkAccess();
          token = newToken;
          this.client = probe;
        }

        const rec = await lockToken(password, token);
        const message = newToken && changingPassword ? "Change menu manager password and token"
                      : newToken                     ? "Replace menu manager token"
                                                     : "Change menu manager password";
        await this.client.writeJSON(AUTH_FILE, rec, message);

        this.authRec = rec;
        try { localStorage.setItem(AUTH_CACHE, JSON.stringify(rec)); } catch {}
        this.token = token;
        this.ownerPassword = password;
        store.set(TOKEN_KEY, token, store.isPersisted(TOKEN_KEY));

        this.closeSettings();
        this.toast(
          newToken && changingPassword ? "Password and token updated"
          : newToken                   ? "Token replaced"
                                       : "Password changed"
        );
      } catch (err) {
        this.setMsg = { kind: "error", text: explainError(err, this.repoSlug) };
      } finally {
        this.savingSettings = false;
      }
    },

    /* ------------------------------------------------ toast */

    toast(text) {
      this.toastText = text;
      this.toastVisible = true;
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => { this.toastVisible = false; }, 2400);
    }
  };
}
