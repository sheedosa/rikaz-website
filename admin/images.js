// Turns any photo the owner picks into the files the site uses:
//   • <name>.webp — the display image (≤ 800 px for products, ≤ 480 px for logos)
//   • <name>.png  — a larger original (≤ 1200 px), used for search results and share images
// Everything happens in the browser; nothing is uploaded until "Publish".
import { MAX_PRODUCT_PX, MAX_LOGO_PX, MAX_ORIGINAL_PX } from './schema.js';

const MAX_FILE_MB = 25;

async function decode(file) {
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|gif|avif)$/i.test(file.name)) throw new Error('Please choose an image file (JPG, PNG or WebP).');
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`That image is too large (over ${MAX_FILE_MB} MB).`);
  try { return await createImageBitmap(file); } catch {}
  const url = URL.createObjectURL(file);   // fallback for browsers without createImageBitmap support for this type
  try {
    const img = new Image(); img.src = url; await img.decode(); return img;
  } catch {
    throw new Error(/heic|heif/i.test(file.type + file.name) ? 'iPhone HEIC photos are not supported here. Open the photo, share it as JPG (or take a screenshot), and try again.' : 'This image could not be opened. Try saving it as JPG or PNG first.');
  } finally { URL.revokeObjectURL(url); }
}

function draw(src, maxPx) {
  const w = src.width, h = src.height, k = Math.min(1, maxPx / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
const toBlob = (canvas, type, q) => new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('Could not convert the image.')), type, q));

// Returns { ext: 'webp' | 'png', display: Blob, original: Blob, width, height, small: boolean }.
// Browsers that cannot write WebP (older Safari) get a PNG display image instead; the site handles both.
export async function prepareImage(file, kind) {
  const src = await decode(file);
  const max = kind === 'logo' ? MAX_LOGO_PX : MAX_PRODUCT_PX;
  let display = await toBlob(draw(src, max), 'image/webp', 0.82);
  const ext = display.type === 'image/webp' ? 'webp' : 'png';
  if (ext === 'png') display = await toBlob(draw(src, max), 'image/png');
  const original = await toBlob(draw(src, MAX_ORIGINAL_PX), 'image/png');
  return { ext, display, original, width: src.width, height: src.height, small: Math.max(src.width, src.height) < (kind === 'logo' ? 200 : 400) };
}

export const randomTag = () => Math.random().toString(36).slice(2, 8);
