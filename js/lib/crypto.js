/* Password lock for the GitHub token.

   A site with no server cannot hide a secret in its own code, so the token
   is encrypted with the owner's password and committed as auth.json. The
   password is never stored; signing in means decrypting that file.

   The record format is FROZEN — auth.json files already exist in the wild
   and must keep opening with the passwords they were created with. */

import { bytesToB64, b64ToBytes } from "./bytes.js";

export const KDF_ITER = 600000;   // deliberately slow: the locked file is public

function subtle() {
  const s = globalThis.crypto?.subtle;
  if (!s) {
    throw new Error(
      "Web Crypto is unavailable. This page must be served over https:// or localhost."
    );
  }
  return s;
}

export function cryptoAvailable() {
  return !!globalThis.crypto?.subtle;
}

async function deriveKey(password, salt, iterations) {
  const base = await subtle().importKey(
    "raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
  );
  return subtle().deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function lockToken(password, token) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveKey(password, salt, KDF_ITER);
  const buf  = await subtle().encrypt(
    { name: "AES-GCM", iv }, key, new TextEncoder().encode(token)
  );
  return {
    v: 1,
    kdf: "PBKDF2-SHA256",
    cipher: "AES-GCM",
    iterations: KDF_ITER,
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    data: bytesToB64(new Uint8Array(buf)),
    note: "Encrypted GitHub token for the menu manager. Useless without the password."
  };
}

/* AES-GCM authenticates as it decrypts, so a wrong password throws here
   rather than returning junk. */
export async function unlockToken(password, rec) {
  const key = await deriveKey(password, b64ToBytes(rec.salt), rec.iterations || KDF_ITER);
  const buf = await subtle().decrypt(
    { name: "AES-GCM", iv: b64ToBytes(rec.iv) }, key, b64ToBytes(rec.data)
  );
  return new TextDecoder().decode(buf);
}

export function looksLikeAuthRecord(rec) {
  return !!(rec && rec.data && rec.salt && rec.iv);
}
