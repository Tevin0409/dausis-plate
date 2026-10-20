// Browser-side photo optimisation: resize, re-encode to WebP (JPEG where the browser
// can't encode WebP), and drop EXIF/location data by redrawing through a canvas.

export type PhotoVariant = { name: "full" | "thumb"; blob: Blob; width: number; height: number };

const VARIANTS = [
  { name: "full", maxEdge: 1600, quality: 0.82 },
  { name: "thumb", maxEdge: 480, quality: 0.78 },
] as const;

async function decode(file: File): Promise<ImageBitmap> {
  try {
    // Honours the camera's EXIF rotation so portrait photos stay upright.
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("That file isn’t a photo we can read. Try a JPG, PNG or HEIC from the camera roll.");
  }
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (webp) => {
        // Browsers that can't encode WebP silently return PNG: fall back to JPEG instead.
        if (webp && webp.type === "image/webp") return resolve(webp);
        canvas.toBlob((jpeg) => (jpeg ? resolve(jpeg) : reject(new Error("Couldn’t process the photo"))), "image/jpeg", quality);
      },
      "image/webp",
      quality,
    );
  });
}

export async function optimisePhoto(file: File): Promise<PhotoVariant[]> {
  const bitmap = await decode(file);
  try {
    const out: PhotoVariant[] = [];
    for (const v of VARIANTS) {
      const scale = Math.min(1, v.maxEdge / Math.max(bitmap.width, bitmap.height));
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Couldn’t process the photo");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, width, height);
      out.push({ name: v.name, blob: await encode(canvas, v.quality), width, height });
    }
    return out;
  } finally {
    bitmap.close();
  }
}
