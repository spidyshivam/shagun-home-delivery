/* Shrink a photo in the browser before it ever reaches the repository.
   Phone cameras produce 4-6MB files; the menu needs about 100KB. */

export const MAX_SIDE = 1000;
export const QUALITY  = 0.82;

export function resizeToJpegB64(file, maxSide = MAX_SIDE, quality = QUALITY) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith("image/")) {
      reject(new Error("That file is not an image."));
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);

      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      const comma = dataUrl.indexOf(",");
      if (comma === -1) { reject(new Error("Could not read that image.")); return; }
      resolve(dataUrl.slice(comma + 1));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not open that image."));
    };

    img.src = url;
  });
}

export function slugify(text) {
  return String(text || "dish")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "dish";
}
