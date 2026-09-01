/* Base64 helpers that survive non-ASCII. `btoa` alone mangles anything
   outside Latin-1, and the menu is full of ₹ and dish names that are not. */

export function toB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromB64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function bytesToB64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function b64ToBytes(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
