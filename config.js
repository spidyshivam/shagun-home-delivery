/* ============================================================
   Shagun Home Delivery — site configuration

   This is the only file you need to edit by hand. Nothing here
   is secret; it is a public file. Your GitHub token is NEVER
   stored here — it lives encrypted in auth.json, behind your
   password.
   ============================================================ */

export const CONFIG = {
  brand:       "Shagun Home Delivery",
  tagline:     "Delicious & Fresh Food Menu",
  subTagline:  "Sending love from our kitchen to your doorstep",

  // Numbers for the tap-to-call buttons. Add as many as you like.
  // The first one is used by the Call buttons; all of them are
  // listed in the footer.
  phones:      ["7060742177"],

  // WhatsApp number WITH country code, digits only (91 = India).
  // It does not have to be one of the call numbers.
  whatsapp:    "919012203352",

  address:     "Sainik Colony, Sanjay Nagar",
  hours:       "Breakfast  ·  Lunch  ·  Dinner",
  deliveryNote:"Home, office & hospital delivery available",

  currency:    "₹",

  /* --- Where the menu lives (used by admin.html only) --------- */
  github: {
    owner:  "spidyshivam",
    repo:   "shagun-home-delivery",
    branch: "main"
  }
};

export default CONFIG;
