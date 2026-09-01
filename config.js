/* ============================================================
   Shagun Home Delivery — site configuration
   Edit the values below. Nothing here is secret; this file is
   public. Your GitHub token is NEVER stored here.
   ============================================================ */

const CONFIG = {
  brand:       "Shagun Home Delivery",
  tagline:     "Delicious & Fresh Food Menu",
  subTagline:  "Sending love from our kitchen to your doorstep",

  // Numbers for the tap-to-call buttons. Add as many as you like.
  // The first one is used by the Call buttons; all of them are
  // listed in the footer.
  phones:      ["7060742177"],

  // WhatsApp number WITH country code, digits only (91 = India)
  whatsapp:    "919012203352",

  address:     "Sainik Colony, Sanjay Nagar",
  hours:       "Breakfast  ·  Lunch  ·  Dinner",
  deliveryNote:"Home, office & hospital delivery available",

  currency:    "₹",

  // Minimum order value before checkout is allowed. Set to 0 to disable.
  minOrder:    0,

  /* --- Where the menu lives (used by admin.html only) ---------
     Fill these in after you create the GitHub repository.      */
  github: {
    owner:  "spidyshivam",
    repo:   "shagun-home-delivery",
    branch: "main"
  }
};

/* A top-level `const` in a classic script is a global *lexical* binding, not a
   property of `window`. Hang it on `window` explicitly so the page scripts can
   actually find it. */
window.CONFIG = CONFIG;
