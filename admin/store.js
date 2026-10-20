// Drafts, publishing and merging.
//
// The dashboard keeps two copies of the catalogue:
//   base  — the catalogue as it was on GitHub when editing started (with its commit `sha`)
//   draft — base plus the owner's unpublished changes
// Drafts (and photos waiting to be uploaded) are saved in this browser, so closing the tab loses nothing.
// Publishing writes everything in one commit. If someone else published in the meantime, the owner's changes
// are re-applied on top of the newest catalogue (item by item), so nobody's work is overwritten silently.
import { cleanBrand, cleanProduct, cleanSettings, validate, nextProductId, newBrandId } from './schema.js';

const LS_KEY = 'rikaz-admin-draft-v1';
const clone = (x) => JSON.parse(JSON.stringify(x));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const normalize = (c) => ({ brands: c.brands.map(cleanBrand), products: c.products.map(cleanProduct), settings: cleanSettings(c.settings) });
export const fileText = (v) => JSON.stringify(v, null, 2) + '\n';

// ── Photos waiting to be uploaded (IndexedDB: survives reloads, holds binary data) ────────────────
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open('rikaz-admin', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('images');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
async function tx(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('images', mode), s = t.objectStore('images'), out = fn(s);
    t.oncomplete = () => { db.close(); res(out && 'result' in out ? out.result : undefined); };
    t.onerror = () => { db.close(); rej(t.error); };
  });
}
export const pendingImages = {
  put: (path, blob) => tx('readwrite', s => s.put(blob, path)),
  get: (path) => tx('readonly', s => s.get(path)),
  keys: () => tx('readonly', s => s.getAllKeys()),
  del: (path) => tx('readwrite', s => s.delete(path)),
  clear: () => tx('readwrite', s => s.clear()),
};

// ── Saved draft ───────────────────────────────────────────────────────────────────────────────────
export function loadSaved(login) {
  try { const s = JSON.parse(localStorage.getItem(LS_KEY)); return s && s.base && s.draft && s.login === login ? s : null; } catch { return null; }
}
export function save(state, login) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ base: state.base, draft: state.draft, login, savedAt: Date.now() })); } catch {}
}
export const SAVED_KEY = LS_KEY;
export function forget() { try { localStorage.removeItem(LS_KEY); } catch {} }

// ── What changed ──────────────────────────────────────────────────────────────────────────────────
function diffList(base, draft) {
  const b = new Map(base.map(x => [x.id, x])), d = new Map(draft.map(x => [x.id, x]));
  const added = draft.filter(x => !b.has(x.id)), removed = base.filter(x => !d.has(x.id));
  const edited = draft.filter(x => b.has(x.id) && !same(b.get(x.id), x));
  const common = (list, other) => list.map(x => x.id).filter(id => other.has(id));
  const reordered = !same(common(base, d), common(draft, b));
  return { added, removed, edited, reordered };
}
export function changes(base, draft) {
  const brands = diffList(base.brands, draft.brands), products = diffList(base.products, draft.products);
  const list = [];
  const brandName = (id) => (draft.brands.find(b => b.id === id) || base.brands.find(b => b.id === id) || { name: id }).name;
  for (const b of brands.added) list.push({ kind: 'add', type: 'brand', id: b.id, label: `Added brand “${b.name}”` });
  for (const b of brands.edited) list.push({ kind: 'edit', type: 'brand', id: b.id, label: `Edited brand “${b.name}”` });
  for (const b of brands.removed) list.push({ kind: 'remove', type: 'brand', id: b.id, label: `Deleted brand “${b.name}”` });
  if (brands.reordered) list.push({ kind: 'order', type: 'brands', label: 'Changed the order of brands' });
  for (const p of products.added) list.push({ kind: 'add', type: 'product', id: p.id, label: `Added product “${p.name}” (${brandName(p.brand)})` });
  for (const p of products.edited) list.push({ kind: 'edit', type: 'product', id: p.id, label: `Edited product “${p.name}”` });
  for (const p of products.removed) list.push({ kind: 'remove', type: 'product', id: p.id, label: `Deleted product “${p.name}”` });
  if (products.reordered) list.push({ kind: 'order', type: 'products', label: 'Changed the order of products' });
  if (!same(base.settings.heroProducts, draft.settings.heroProducts)) list.push({ kind: 'edit', type: 'home', label: 'Changed the home page products' });
  if (!same(base.settings.countries, draft.settings.countries)) list.push({ kind: 'edit', type: 'settings', label: 'Changed the list of countries' });
  if (!same(base.settings.categories, draft.settings.categories)) list.push({ kind: 'edit', type: 'settings', label: 'Changed the list of categories' });
  return list;
}
export const isDirty = (base, draft) => !same(base, draft);
export const itemChanged = (base, draft, type, id) => {
  const k = type === 'brand' ? 'brands' : 'products';
  const a = base[k].find(x => x.id === id), b = draft[k].find(x => x.id === id);
  return !same(a, b);
};

// ── Three-way merge: apply (base → draft) onto `latest` ───────────────────────────────────────────
function mergeList(base, draft, latest, notes, label) {
  const b = new Map(base.map(x => [x.id, x])), d = new Map(draft.map(x => [x.id, x])), l = new Map(latest.map(x => [x.id, x]));
  const result = new Map(l);
  for (const [id, x] of d) {
    if (b.has(id) && same(b.get(id), x)) continue;                 // untouched here: keep theirs
    if (b.has(id) && l.has(id) && !same(b.get(id), l.get(id))) notes.push(`${label(x)} was also changed by someone else — your version was kept.`);
    if (b.has(id) && !l.has(id)) notes.push(`${label(x)} was deleted by someone else — your version brings it back.`);
    result.set(id, x);
  }
  for (const [id, x] of b) if (!d.has(id)) {                      // deleted here
    if (l.has(id) && !same(l.get(id), x)) notes.push(`${label(x)} was changed by someone else, but you deleted it.`);
    result.delete(id);
  }
  // Order: if the order was changed here, use it; otherwise keep theirs. New items go where they were placed.
  const baseIds = base.map(x => x.id).filter(id => d.has(id)), draftOld = draft.map(x => x.id).filter(id => b.has(id));
  let order;
  if (!same(baseIds, draftOld)) order = [...draft.map(x => x.id), ...latest.map(x => x.id).filter(id => !d.has(id) && !b.has(id))];
  else {
    order = latest.map(x => x.id);
    draft.forEach((x, i) => {
      if (b.has(x.id) || order.includes(x.id)) return;
      const prev = draft.slice(0, i).reverse().find(y => order.includes(y.id));
      order.splice(prev ? order.indexOf(prev.id) + 1 : 0, 0, x.id);
    });
  }
  return [...new Set(order)].filter(id => result.has(id)).map(id => result.get(id));
}
export function merge(base, draft, latest) {
  const notes = [];
  draft = renameClashes(base, draft, latest, notes);
  const out = {
    brands: mergeList(base.brands, draft.brands, latest.brands, notes, (x) => `Brand “${x.name}”`),
    products: mergeList(base.products, draft.products, latest.products, notes, (x) => `Product “${x.name}”`),
    settings: { ...latest.settings },
  };
  // Lists of named entries (countries, categories): merge entry by entry, so additions on both sides survive.
  for (const k of ['countries', 'categories']) {
    const b = base.settings[k] || {}, d = draft.settings[k] || {}, m = { ...(latest.settings[k] || {}) };
    for (const key of new Set([...Object.keys(b), ...Object.keys(d)])) {
      if (same(b[key], d[key])) continue;
      if (d[key] === undefined) delete m[key]; else m[key] = d[key];
    }
    out.settings[k] = m;
  }
  if (!same(base.settings.heroProducts, draft.settings.heroProducts)) {
    if (!same(base.settings.heroProducts, latest.settings.heroProducts)) notes.push('The home page products were also changed by someone else — your selection was kept.');
    out.settings.heroProducts = draft.settings.heroProducts;
  }
  const r = (x) => x.settings.retired || { brands: [], products: [] };
  out.settings.retired = { brands: [...r(latest).brands, ...r(draft).brands], products: [...r(latest).products, ...r(draft).products] };
  return { content: normalize(out), notes };
}

// Something we added has the same ID as something someone else added meanwhile (both picked the next free
// number): give ours a new ID so neither is lost, and update everything that points at it.
function renameClashes(base, draft, latest, notes) {
  const isNew = (list, id) => !list.some(x => x.id === id);
  let d = clone(draft);
  const retired = { brands: [...((latest.settings.retired || {}).brands || []), ...((d.settings.retired || {}).brands || [])], products: [...((latest.settings.retired || {}).products || []), ...((d.settings.retired || {}).products || [])] };
  for (const b of draft.brands) {
    const theirs = latest.brands.find(x => x.id === b.id);
    if (!isNew(base.brands, b.id) || !theirs || same(theirs, b)) continue;
    const id = newBrandId(b.name, [...latest.brands, ...d.brands], retired.brands);
    d.brands = d.brands.map(x => x.id === b.id ? { ...x, id } : x);
    d.products = d.products.map(p => p.brand === b.id && isNew(base.products, p.id) ? { ...p, brand: id } : p);
    notes.push(`Someone else also added a brand with the address “${b.id}”; yours now uses “${id}”.`);
  }
  for (const p of draft.products) {
    const mine = d.products.find(x => x.id === p.id), theirs = latest.products.find(x => x.id === p.id);
    if (!isNew(base.products, p.id) || !theirs || same(theirs, mine)) continue;
    const id = nextProductId(mine.brand, [...latest.products, ...d.products], retired.products);
    d.products = d.products.map(x => x === mine ? { ...x, id } : x);
    d.settings = { ...d.settings, heroProducts: d.settings.heroProducts.map(h => h === p.id ? id : h) };
    notes.push(`Someone else also added a product with the address “${p.id}”; “${p.name}” now uses “${id}”.`);
  }
  return d;
}

// Records the IDs of brands/products deleted between `from` and `to`, so they are never reused.
export function retire(from, to) {
  const gone = (k) => from[k].map(x => x.id).filter(id => !to[k].some(x => x.id === id));
  const r = to.settings.retired || { brands: [], products: [] };
  const brands = [...new Set([...r.brands, ...gone('brands')])].sort(), products = [...new Set([...r.products, ...gone('products')])].sort();
  // An item brought back (e.g. by Undo) is no longer retired.
  return { ...to, settings: { ...to.settings, retired: { brands: brands.filter(id => !to.brands.some(b => b.id === id)), products: products.filter(id => !to.products.some(p => p.id === id)) } } };
}

// ── Commit message ────────────────────────────────────────────────────────────────────────────────
export function commitMessage(list) {
  const title = list.length === 1 ? list[0].label : `Update catalogue: ${list.length} changes`;
  return `${title.replace(/[“”]/g, '"')}\n\n${list.map(c => '- ' + c.label.replace(/[“”]/g, '"')).join('\n')}\n\nPublished from the Rikaz admin dashboard.`;
}

// Images referenced by the catalogue (display files and their .png originals).
export function referencedImages(content) {
  const out = new Set();
  for (const b of content.brands) if (b.logo) { out.add(b.logo); out.add(b.logo.replace(/\.webp$/, '.png')); }
  for (const p of content.products) if (p.img) { out.add(p.img); out.add(p.img.replace(/\.webp$/, '.png')); }
  return out;
}

export { validate, clone, same };
