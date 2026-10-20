// Catalogue rules shared by the admin dashboard (browser) and tools/build.mjs (Node).
// The content lives in content/brands.json, content/products.json and content/settings.json.
// Keep this file dependency-free: it is loaded as a plain ES module in both places.

export const STATUSES = { stock: 'In stock', soon: 'Coming soon' };
export const HERO_SLOTS = 8;   // the home page product spread has exactly eight positions
export const MAX_PRODUCT_PX = 800, MAX_LOGO_PX = 480, MAX_ORIGINAL_PX = 1200;

const BRAND_KEYS = ['id', 'name', 'logo', 'cat', 'country', 'tint', 'desc', 'story'];
const PRODUCT_KEYS = ['id', 'brand', 'img', 'name', 'nameAr', 'size', 'sku', 'status', 'shelf', 'pack', 'caseQty', 'desc'];
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const opt = (v) => (str(v) ? str(v) : null);
const bi = (v) => ({ en: str(v && v.en), ar: str(v && v.ar) });

// Canonical shape and key order, so saved files stay tidy and diffs stay small.
export function cleanBrand(b) {
  const o = { id: str(b.id), name: str(b.name), logo: str(b.logo), cat: str(b.cat), country: str(b.country), tint: str(b.tint).toUpperCase() || '#EEF2EF', desc: bi(b.desc), story: bi(b.story) };
  return Object.fromEntries(BRAND_KEYS.map(k => [k, o[k]]));
}
export function cleanProduct(p) {
  const o = { id: str(p.id), brand: str(p.brand), img: opt(p.img), name: str(p.name), nameAr: str(p.nameAr), size: opt(p.size), sku: str(p.sku), status: str(p.status) || 'stock', shelf: opt(p.shelf), pack: bi(p.pack), caseQty: opt(p.caseQty), desc: bi(p.desc) };
  if (!o.img) delete o.img;
  return Object.fromEntries(PRODUCT_KEYS.filter(k => k in o).map(k => [k, o[k]]));
}
export function cleanSettings(s) {
  return { heroProducts: (s.heroProducts || []).map(str), categories: s.categories || {}, countries: s.countries || {} };
}

export const slugify = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);

// A brand's product-ID prefix ('an' for Antat): taken from its existing products, otherwise a new unused one.
export function prefixFor(brandId, products) {
  const own = products.filter(p => p.brand === brandId).map(p => p.id.replace(/\d+$/, ''));
  if (own.length) return own.sort((a, b) => own.filter(x => x === b).length - own.filter(x => x === a).length)[0];
  const taken = new Set(products.map(p => p.id.replace(/\d+$/, '')));
  const s = brandId.replace(/[^a-z]/g, '') || 'p';
  const cands = [s.slice(0, 2), s[0] + (s[2] || ''), s.slice(0, 3), ...[...'abcdefghijklmnopqrstuvwxyz'].map(c => s[0] + c)];
  return cands.find(c => c.length >= 2 && !taken.has(c)) || s + 'x';
}
export function nextProductId(brandId, products) {
  const pre = prefixFor(brandId, products), ids = new Set(products.map(p => p.id));
  let n = Math.max(0, ...products.filter(p => p.id.replace(/\d+$/, '') === pre).map(p => +p.id.slice(pre.length) || 0)) + 1;
  while (ids.has(pre + n)) n++;
  return pre + n;
}
export function newBrandId(name, brands) {
  const base = slugify(name) || 'brand', ids = new Set(brands.map(b => b.id));
  let id = base, n = 2;
  while (ids.has(id)) id = base + n++;
  return id;
}

// Returns a list of problems: { level: 'error' | 'warning', where: 'brand:antat' | 'product:an3' | 'settings', field, msg }.
// Errors block publishing (and fail the build); warnings are shown but allowed.
export function validate({ brands, products, settings }, { fileExists } = {}) {
  const out = [], err = (where, field, msg) => out.push({ level: 'error', where, field, msg }), warn = (where, field, msg) => out.push({ level: 'warning', where, field, msg });
  const cats = settings.categories || {}, countries = settings.countries || {};
  const brandIds = new Set(), productIds = new Set(), skus = new Map();
  const imgOk = (p) => !fileExists || fileExists(p);
  for (const b of brands) {
    const w = 'brand:' + b.id;
    if (!/^[a-z0-9]{2,24}$/.test(b.id)) err(w, 'id', 'Brand ID must be 2–24 lowercase letters or digits.');
    if (brandIds.has(b.id)) err(w, 'id', `Two brands share the ID "${b.id}".`);
    brandIds.add(b.id);
    if (!str(b.name)) err(w, 'name', 'Brand name is required.');
    if (!str(b.logo)) err(w, 'logo', 'A logo is required.');
    else if (!imgOk(b.logo)) err(w, 'logo', `Logo file ${b.logo} is missing.`);
    if (!cats[b.cat]) err(w, 'cat', 'Choose a category.');
    if (!countries[b.country]) err(w, 'country', 'Choose a country of origin.');
    if (!/^#[0-9A-F]{6}$/i.test(b.tint || '')) err(w, 'tint', 'Background colour must look like #F5EEE8.');
    for (const k of ['desc', 'story']) for (const L of ['en', 'ar']) if (!str(b[k] && b[k][L])) err(w, `${k}.${L}`, `${k === 'desc' ? 'Short description' : 'Story'} (${L === 'en' ? 'English' : 'Arabic'}) is required.`);
  }
  for (const p of products) {
    const w = 'product:' + p.id;
    if (!/^[a-z]{1,4}\d{1,4}$/.test(p.id)) err(w, 'id', `Product ID "${p.id}" is not valid.`);
    if (productIds.has(p.id)) err(w, 'id', `Two products share the ID "${p.id}".`);
    productIds.add(p.id);
    if (!brandIds.has(p.brand)) err(w, 'brand', 'Choose a brand that exists.');
    if (!str(p.name)) err(w, 'name', 'English name is required.');
    if (!str(p.nameAr)) err(w, 'nameAr', 'Arabic name is required.');
    if (!str(p.sku)) err(w, 'sku', 'SKU is required.');
    else if (skus.has(p.sku)) warn(w, 'sku', `SKU ${p.sku} is also used by ${skus.get(p.sku)}.`);
    else skus.set(p.sku, p.name || p.id);
    if (!STATUSES[p.status]) err(w, 'status', 'Choose a status.');
    for (const L of ['en', 'ar']) {
      if (!str(p.pack && p.pack[L])) err(w, `pack.${L}`, `Packaging (${L === 'en' ? 'English' : 'Arabic'}) is required.`);
      if (!str(p.desc && p.desc[L])) err(w, `desc.${L}`, `Description (${L === 'en' ? 'English' : 'Arabic'}) is required.`);
    }
    if (p.img && !imgOk(p.img)) err(w, 'img', `Image file ${p.img} is missing.`);
    if (!p.img) warn(w, 'img', 'No photo yet — the site shows a placeholder.');
  }
  for (const b of brands) if (!products.some(p => p.brand === b.id)) warn('brand:' + b.id, 'products', 'This brand has no products yet.');
  const hero = settings.heroProducts || [];
  if (hero.length !== HERO_SLOTS) err('settings', 'heroProducts', `The home page needs exactly ${HERO_SLOTS} featured products (now ${hero.length}).`);
  if (new Set(hero).size !== hero.length) err('settings', 'heroProducts', 'A product is featured twice on the home page.');
  for (const id of hero) {
    const p = products.find(x => x.id === id);
    if (!p) err('settings', 'heroProducts', `Featured product "${id}" no longer exists.`);
    else if (!p.img) err('settings', 'heroProducts', `Featured product "${p.name}" has no photo.`);
  }
  for (const [k, v] of Object.entries(countries)) if (!/^[A-Z]{2}$/.test(k) || !str(v.en) || !str(v.ar)) err('settings', 'countries', `Country "${k}" needs a 2-letter code and English and Arabic names.`);
  return out;
}
