/* Presentation helpers shared by the storefront and the manager. */

export function money(amount, currency = "₹") {
  return currency + Number(amount || 0).toLocaleString("en-IN");
}

export function telHref(number) {
  return "tel:" + String(number || "").replace(/[^\d+]/g, "");
}

export function waHref(whatsappNumber, text) {
  const digits = String(whatsappNumber || "").replace(/\D/g, "");
  if (!digits) {
    console.error("No WhatsApp number in config.js — order links will not work.");
  }
  return `https://wa.me/${digits}` + (text ? `?text=${encodeURIComponent(text)}` : "");
}

/* Call numbers, newest config shape first, older single `phone` second. */
export function callNumbers(config) {
  const list = config.phones?.length ? config.phones : (config.phone ? [config.phone] : []);
  return list.map((n) => String(n).trim()).filter(Boolean);
}

export function orderMessage({ brand, item, variant, currency }) {
  return (
    `Hello ${brand || ""},\n\n` +
    `I would like to order:\n` +
    `• ${item.name} — ${variant.label} (${money(variant.price, currency)})\n\n` +
    `Quantity: 1\n` +
    `Name: \n` +
    `Address: `
  );
}

export function generalMessage(brand) {
  return `Hello ${brand || ""},\n\nI would like to place an order.\n\nName: \nAddress: `;
}
