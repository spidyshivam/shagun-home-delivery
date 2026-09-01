# Shagun Home Delivery

A no-backend food delivery website. The menu lives in `menu.json` in this repository;
a password-protected admin page edits it directly through the GitHub API. Orders
reach you over WhatsApp or a phone call.

No server, no database, no cart, no build step, no hosting cost.

```
index.html        storefront (menu, veg/non-veg filters, search)
admin.html        menu manager  → /admin.html
config.js         brand name, phones, WhatsApp, address  ← edit this first
menu.json         the menu data
auth.json         your password-locked GitHub token (the manager writes this)
styles.css        storefront styles
admin.css         manager styles
images/           dish photos

js/
  storefront.js   what the storefront does
  admin.js        what the manager does
  lib/
    crypto.js     password lock (PBKDF2 → AES-GCM)
    github.js     GitHub Contents API client
    image.js      photo resizing before upload
    format.js     prices, tel: and wa.me links
    bytes.js      UTF-8-safe base64

vendor/
  alpine.esm.js   Alpine.js 3.17.1, committed on purpose (see below)

tools/            dev only — never runs on the live site
  check.mjs       pre-flight checks
  *.test.mjs      tests
```

---

## 1. Configure

Open `config.js` and set:

| Field | What it is |
|---|---|
| `brand`, `tagline`, `subTagline` | Text shown across the site |
| `phones` | List of call numbers, e.g. `["7060742177", "9876543210"]`. The first is used by the Call buttons; every one is listed in the footer |
| `whatsapp` | The WhatsApp number **with country code, digits only** — e.g. `919012203352`. This does not have to be one of the call numbers |
| `address`, `hours`, `deliveryNote` | Footer / hero details |
| `minOrder` | Minimum order value, or `0` to disable |
| `github.owner` | Your GitHub username |
| `github.repo` | The repository name |
| `github.branch` | Usually `main` |

## 2. Put it on GitHub

```bash
cd ~/shagun-home-delivery
git init
git add .
git commit -m "Shagun Home Delivery site"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/shagun-home-delivery.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch → `main` / `root`.**

The site goes live at `https://YOUR_USERNAME.github.io/shagun-home-delivery/`
and the manager at `.../admin.html`.

## 3. Set your password

The admin page signs you in with **a password you choose**. You do not memorise a
token or keep one lying around.

It needs a GitHub token exactly once, to get permission to write to this repository:

1. Open <https://github.com/settings/personal-access-tokens/new>
2. Name: `menu-admin`. Expiry: `No expiration` (or a long date).
3. **Repository access** → *Only select repositories* → pick this repo.
4. **Permissions → Repository permissions** → set **Contents** to **Read and write**.
5. Generate and copy the token.

Now open `admin.html`. The first time it runs it asks you to choose a password and
paste that token. It encrypts the token with your password and commits the result as
`auth.json`. **From then on the page only ever asks for the password** — the token is
not needed again, on this device or any other.

To change the password later: sign in, click **Password** in the header, type a new
one, Save. Same panel replaces the GitHub token when it expires.

Forgot the password? There is no recovery — it was never stored. Click *Forgot your
password?*, paste a GitHub token again, and pick a new one. That overwrites the lock.

---

## How the admin page works

Add a dish, upload a photo, set Half Plate / Full Plate prices, mark it veg or
non-veg, then hit **Publish**. That writes `menu.json` back to the repository,
GitHub Pages redeploys, and the change is live in about a minute.

- **Sold out** — flip *Available to order* off. The dish stays on the menu with a
  "Sold Out" ribbon and its buttons disabled.
- **Photos** are resized to 1000px and compressed before upload, so the repository
  stays small. Replacing a photo leaves the old file in `images/` — delete those
  from GitHub occasionally if you care.
- **Reorder** dishes with the ↑ ↓ buttons. The storefront shows them in this order.
- The manager works on a phone too — the edit form opens as a bottom sheet.
- Edits are held locally until you press **Publish**, so you can make several
  changes and ship them in one go.

## Working on the code

The published site is plain static files — no build step, no bundler. Open
`index.html` over a local server and it runs. The tooling below is for
development only and never ships.

```bash
npm install     # jsdom, for the tests. One time.
npm run check   # pre-flight checks — run this before every push
npm test        # mounts both pages in a real DOM and drives them
npm run serve   # http://localhost:8765
```

**`npm run check`** validates the things that have actually broken here before:
every module loads, every import resolves, every `<script>` is `type="module"`,
every name used in an Alpine expression exists on the component, the config is
sane, every menu item is well formed, every photo is really in the repo, and no
GitHub token has been committed by accident.

**`npm test`** loads the real pages into jsdom, starts Alpine, and asserts on the
result: that every price button is a working `wa.me` link with the right number,
that a wrong password is refused, that a right one decrypts the token, that
adding a dish and publishing writes the correct `menu.json`, and that the raw
token never appears in anything committed.

### Why it is built this way

- **ES modules everywhere.** A classic `<script>` runs the moment the parser
  reaches it, so it cannot see markup below itself, and a top-level `const` in
  one never becomes a property of `window`. Both of those bit this project.
  Modules wait for the document and have explicit imports; neither can recur.
- **Alpine.js, not React or Vue.** Alpine needs no build step, which keeps the
  promise that you can edit a file and push. Behaviour lives in the HTML next to
  the element it belongs to, so a control and its handler cannot drift apart —
  the previous hand-wired version had a single missing element silently disable
  every button after it.
- **Alpine is committed, not loaded from a CDN.** The manager must not stop
  working because someone else's server is down.
- **Logic is separated from the DOM.** `js/lib/*` are plain functions with no
  page in them, so they can be tested directly.

## Security, honestly

Read this part; it is short and it matters.

**Where the password lives: nowhere.** Signing in works by using your password to
decrypt `auth.json`. A wrong password simply fails to decrypt it. Nothing on the
server, or in the page, knows what the password is.

**How the token is locked.** PBKDF2-SHA256, 600,000 iterations, into an AES-256-GCM
key. Fresh random salt and IV each time it is written. That is the standard recipe,
and the high iteration count is chosen deliberately — it makes each password guess
slow.

**The one real weakness.** `auth.json` sits in a public repository, because a site
with no server has nowhere private to put anything. Anyone can download it and grind
guesses against it on their own hardware, with no rate limit to stop them. The
600,000 iterations make that expensive, but not impossible against a weak password.

So: **use a long password.** Four or five unrelated words beats a short cryptic one.
`copper-lantern-mango-drift` is far stronger than `Shagun@123`, and easier to type on
a phone. The minimum enforced is 10 characters; treat that as a floor, not a target.

**If something does go wrong**, the blast radius is small. The token is scoped to this
one repository with contents-only access — the worst anyone can do is edit this menu.
Delete the token on GitHub and the old one dies instantly; generate a fresh one and
put it in through the **Password** panel.

**Requires https.** The encryption uses the browser's Web Crypto API, which browsers
only expose on secure origins. GitHub Pages is https, so this is fine in production;
locally, use `localhost` rather than a LAN IP.

## How ordering works

There is no cart. Every portion on every dish is its own WhatsApp button — tapping
"Full Plate ₹120" on Idli Sambhar opens WhatsApp with this already typed:

```
Hello Shagun Home Delivery,

I would like to order:
• Idli Sambhar — Full Plate (₹120)

Quantity: 1
Name:
Address:
```

The customer fills the blank lines and hits send. Ordering a second dish is a
second message, which for a tiffin service is usually how people message anyway.

A *Call* button sits beside it throughout — in the header, in the hero, and in the
bar fixed to the bottom of the screen on phones.

Nothing is stored anywhere. The order exists only as the WhatsApp message that
arrives on your phone.

## On phones

The site is built mobile-first:

- Dishes are compact horizontal rows on phones and photo cards from tablet width up.
- Call and *Order on WhatsApp* live in a bar fixed to the bottom of the screen,
  above the home indicator on notched iPhones.
- Every button clears 44px, and text inputs are 16px so iOS does not zoom in
  when the keyboard opens.
- Filter tabs scroll sideways; search is a full-width row of its own below them.
- Hover effects are suppressed on touch devices, where they only cause stuck states.

## Local preview

```bash
cd ~/shagun-home-delivery
python3 -m http.server 8000
```

Then open <http://localhost:8000>. (Opening `index.html` directly as a `file://`
URL will not work — the browser blocks the `menu.json` fetch.)

---

## About the photos

`menu.json` ships with the four dishes from the printed menu (Idli Sambhar, Dahi
Vada, Vegetable Pasta, Fried Rice) plus Egg Curry and Chicken Curry so the non-veg
section is not empty. Edit or delete those two from the admin page.

Every dish has a photo in `images/`, sourced from **Wikimedia Commons** and reused
under Creative Commons licences. Two things to know:

1. **They are stock photos of the dish, not of your food.** They are there so the
   site does not launch with empty grey boxes. Replace them with real photographs
   from your kitchen as soon as you can — for a food business, your own photos sell
   far better than generic ones, and the admin page makes swapping them a 20-second
   job per dish.
2. **They carry Creative Commons licences that ask for credit.** The public credits
   page was removed at the owner's request, so the attribution now lives only in the
   table below. Replacing these six with your own photographs settles the question
   entirely — then nothing on the site needs crediting to anyone.

| Dish | Photograph | Author | Licence |
|---|---|---|---|
| Idli Sambhar | [Idli Sambar-Noida-UP-SP004](https://commons.wikimedia.org/wiki/File:Idli_Sambar-Noida-UP-SP004.jpg) | Sutapa Pal | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| Dahi Vada | [Dahi Vada (Dahi Bhalla)](https://commons.wikimedia.org/wiki/File:Dahi_Vada_(Dahi_Bhalla).jpg) | BhargavVora | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| Vegetable Pasta | [Italian vegetable pasta…](https://commons.wikimedia.org/wiki/File:Italian_vegetable_pasta_in_Guido_%5E_Angelina_Restaurant_-_panoramio.jpg) | Jiaqian AirplaneFan | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Fried Rice | [Veg fried rice 2](https://commons.wikimedia.org/wiki/File:Veg_fried_rice_2.jpg) | Testmaskara | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| Egg Curry | [Spicy Anda Curry](https://commons.wikimedia.org/wiki/File:Spicy_Anda_Curry.jpg) | onlybestrecipes.com | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| Chicken Curry | [Butter Chicken, City Grill Kottayam](https://commons.wikimedia.org/wiki/File:Butter_Chicken,_City_Grill_Kottayam.jpg) | Vis M | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |

Each image is cropped to 900×563 and compressed to roughly 100 KB, so the whole set
is under 600 KB.
