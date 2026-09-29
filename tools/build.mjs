#!/usr/bin/env node
// Static SEO build for the Rikaz site.
//
// index.html stays the single design file. This script reads its data (brands, products, SEO copy) and writes:
//   • one real page per route and language (…/brands/, …/brand/antat/, …/ar/product/an3/ …) with its own
//     <title>, description, canonical, hreflang, Open Graph / Twitter tags and JSON-LD structured data
//   • a prerendered snapshot of each page (desktop + mobile) so crawlers that don't run JavaScript, and
//     visitors on slow connections, get the real content immediately — the app replaces it once it boots
//   • social share images (assets/og/*.jpg), sitemap.xml, robots.txt, site.webmanifest and 404.html
//
// Usage:  node tools/build.mjs              rebuild pages (+ any missing share images)
//         node tools/build.mjs --og         also regenerate every share image
//         node tools/build.mjs --no-prerender   skip the browser step (head tags, sitemap etc. only)
// Prerendering and share images use Playwright (Chromium). Run it after editing index.html, then commit.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import http from 'node:http';
import vm from 'node:vm';

// ── Site settings ────────────────────────────────────────────────────────────────────────────────────
// When the site moves to its own domain, change SITE_URL (keep the trailing slash), add a CNAME file and rebuild.
const SITE_URL = process.env.SITE_URL || 'https://sheedosa.github.io/rikaz-website/';
const ORG = {
  phone: '+218910000000',            // ⚠ placeholder number shown on the site — replace with the real one
  email: 'info@rikaz.ly',
  street: { en: 'Al Serraj', ar: 'السراج' }, city: { en: 'Tripoli', ar: 'طرابلس' }, country: 'LY',
  geo: { latitude: 32.8952, longitude: 13.19 },
  hours: [{ days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'], opens: '08:00', closes: '17:00' }, { days: ['Saturday'], opens: '09:00', closes: '14:00' }],
  sameAs: [],                        // add official social profiles (Facebook, Instagram, LinkedIn…) when available
};
const FONTS = 'assets/fonts/fonts.css';   // self-hosted Instrument Sans + Readex Pro

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const PRERENDER = !args.has('--no-prerender');
const FORCE_OG = args.has('--og');
const SITE_PATH = new URL(SITE_URL).pathname;
const abs = (p) => new URL(p || './', SITE_URL).href;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Read the design file and evaluate its data script ─────────────────────────────────────────────
const stripGenerated = (html) => html.replace(/<!-- prerender:start -->[\s\S]*?<!-- prerender:end -->\n?/, '');
const SRC = stripGenerated(readFileSync(join(ROOT, 'index.html'), 'utf8'));
const script = SRC.match(/<script type="text\/x-dc" data-dc-script[^>]*>([\s\S]*?)<\/script>/)[1];
const D = vm.runInNewContext(script + '\n;({ HERO_IDS, BRANDS, PRODUCTS, CATS, COUNTRIES, CITIES, T, SEO, seoFor, pathFor, locU });', {
  React: { createElement: () => null, createRef: () => ({}) }, DCLogic: class {}, URL,
});
const { BRANDS, PRODUCTS, CATS, COUNTRIES, T, seoFor, pathFor, locU } = D;
const HERO_BG = { antat: '#F8EFEA', mymotto: '#EDF3F8', sweetsmil: '#F7F0E6' };

const LANGS = ['en', 'ar'];
const routes = [];
for (const lang of LANGS) {
  for (const page of ['home', 'about', 'brands', 'market', 'partner', 'contact']) routes.push({ lang, page });
  for (const b of BRANDS) routes.push({ lang, page: 'brand', brandId: b.id });
  for (const p of PRODUCTS) routes.push({ lang, page: 'product', productId: p.id, brandId: p.brand });
}
const fileFor = (r) => join(ROOT, pathFor(r), 'index.html');
const depthOf = (r) => pathFor(r).split('/').filter(Boolean).length;

// ── Structured data (schema.org JSON-LD) ──────────────────────────────────────────────────────────
function jsonLd(r, m) {
  const L = r.lang, url = abs(m.path), t = T[L];
  const org = {
    '@type': 'WholesaleStore', '@id': abs('#organization'), name: 'Rikaz', alternateName: ['رِكاز', 'Rikaz Food Distribution', 'رِكاز لتوزيع المواد الغذائية'],
    url: SITE_URL, logo: { '@type': 'ImageObject', url: abs('assets/logo-square.png'), width: 512, height: 512 }, image: abs('assets/logo-full-horizontal.png'),
    description: D.SEO[L].home.d, email: ORG.email, telephone: ORG.phone,
    address: { '@type': 'PostalAddress', streetAddress: ORG.street[L], addressLocality: ORG.city[L], addressCountry: ORG.country },
    geo: { '@type': 'GeoCoordinates', ...ORG.geo }, areaServed: { '@type': 'Country', name: L === 'ar' ? 'ليبيا' : 'Libya' },
    openingHoursSpecification: ORG.hours.map(h => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: h.days, opens: h.opens, closes: h.closes })),
    contactPoint: [{ '@type': 'ContactPoint', contactType: 'sales', telephone: ORG.phone, email: ORG.email, areaServed: 'LY', availableLanguage: ['English', 'Arabic'] }],
    knowsLanguage: ['en', 'ar'], ...(ORG.sameAs.length ? { sameAs: ORG.sameAs } : {}),
  };
  const website = { '@type': 'WebSite', '@id': abs('#website'), url: SITE_URL, name: 'Rikaz', alternateName: 'رِكاز', inLanguage: ['en', 'ar'], publisher: { '@id': org['@id'] } };
  const crumbs = [[t.nav.home, pathFor({ lang: L, page: 'home' })]];
  const b = BRANDS.find(x => x.id === r.brandId), p = PRODUCTS.find(x => x.id === r.productId);
  if (r.page === 'brand' || r.page === 'product') crumbs.push([t.nav.brands, pathFor({ lang: L, page: 'brands' })], [b.name, pathFor({ lang: L, page: 'brand', brandId: b.id })]);
  if (r.page === 'product') crumbs.push([L === 'ar' ? p.nameAr : p.name, m.path]);
  else if (r.page !== 'home' && r.page !== 'brand') crumbs.push([t.nav[r.page], m.path]);
  const type = { home: 'WebPage', about: 'AboutPage', contact: 'ContactPage', brands: 'CollectionPage', brand: 'CollectionPage', product: 'ItemPage', market: 'WebPage', partner: 'WebPage' }[r.page];
  const webpage = {
    '@type': type, '@id': url + '#webpage', url, name: m.title, description: m.desc, inLanguage: L, isPartOf: { '@id': website['@id'] },
    primaryImageOfPage: { '@type': 'ImageObject', url: abs(m.image), width: 1200, height: 630 },
    ...(r.page === 'home' || r.page === 'about' || r.page === 'contact' ? { about: { '@id': org['@id'] } } : {}),
    ...(crumbs.length > 1 ? { breadcrumb: { '@id': url + '#breadcrumb' } } : {}),
  };
  const graph = [org, website, webpage];
  if (crumbs.length > 1) graph.push({ '@type': 'BreadcrumbList', '@id': url + '#breadcrumb', itemListElement: crumbs.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(path) })) });
  const list = (items) => ({ '@type': 'ItemList', numberOfItems: items.length, itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, url: abs(path) })) });
  if (r.page === 'brands') webpage.mainEntity = list(BRANDS.map(x => [x.name, pathFor({ lang: L, page: 'brand', brandId: x.id })]));
  if (r.page === 'brand') {
    webpage.about = { '@type': 'Brand', name: b.name, logo: abs(b.logo.replace(/\.webp$/, '.png')), description: b.story[L] };
    webpage.mainEntity = list(PRODUCTS.filter(x => x.brand === b.id).map(x => [L === 'ar' ? x.nameAr : x.name, pathFor({ lang: L, page: 'product', productId: x.id })]));
  }
  if (r.page === 'product') {
    const sz = locU(p.size, L), spec = t.productPage.specs;
    graph.push({
      '@type': 'Product', '@id': url + '#product', url, name: L === 'ar' ? p.nameAr : p.name, alternateName: L === 'ar' ? p.name : p.nameAr,
      description: p.desc[L], sku: p.sku, ...(p.img ? { image: [abs(p.img.replace(/\.webp$/, '.png')), abs(p.img)] } : {}),
      brand: { '@type': 'Brand', name: b.name, logo: abs(b.logo.replace(/\.webp$/, '.png')) }, category: CATS[b.cat][L],
      countryOfOrigin: { '@type': 'Country', name: COUNTRIES[b.country][L] }, size: sz,
      additionalProperty: [[spec.pack, p.pack[L]], [spec.caseQty, locU(p.caseQty, L)], [spec.shelf, locU(p.shelf, L)]].map(([name, value]) => ({ '@type': 'PropertyValue', name, value })),
    });
    webpage.mainEntity = { '@id': url + '#product' };
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
}

// ── <head> SEO block ──────────────────────────────────────────────────────────────────────────────
function seoBlock(r) {
  const m = seoFor(r), url = abs(m.path);
  const robots = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
  return `<!-- seo:start -->
<title>${esc(m.title)}</title>
<meta name="description" content="${esc(m.desc)}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="en" href="${abs(m.enPath)}">
<link rel="alternate" hreflang="ar" href="${abs(m.arPath)}">
<link rel="alternate" hreflang="x-default" href="${abs(m.enPath)}">
<meta property="og:type" content="${m.type === 'product' ? 'product' : 'website'}">
<meta property="og:site_name" content="${esc(m.siteName)}">
<meta property="og:title" content="${esc(m.title)}">
<meta property="og:description" content="${esc(m.desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${abs(m.image)}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(m.imageAlt)}">
<meta property="og:locale" content="${m.locale}">
<meta property="og:locale:alternate" content="${m.altLocale}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(m.title)}">
<meta name="twitter:description" content="${esc(m.desc)}">
<meta name="twitter:image" content="${abs(m.image)}">
<meta name="twitter:image:alt" content="${esc(m.imageAlt)}">
<script type="application/ld+json">${jsonLd(r, m)}</script>
${(r.lang === 'ar' ? ['readex-pro-arabic', 'instrument-sans-latin'] : ['instrument-sans-latin']).map(f => `<link rel="preload" href="assets/fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`).join('\n')}
${lcpImage(r) ? `\n<link rel="preload" as="image" href="${lcpImage(r)}" fetchpriority="high">` : ''}
<!-- seo:end -->`;
}
// The largest above-the-fold image of a page, fetched before the app scripts.
function lcpImage(r) {
  if (r.page === 'home') return PRODUCTS.find(p => p.id === D.HERO_IDS[0]).img;
  if (r.page === 'product') return PRODUCTS.find(p => p.id === r.productId).img || null;
  return null;
}

function pageHtml(r, pre) {
  let html = SRC
    .replace(/<html[^>]*>/, `<html lang="${r.lang}" dir="${r.lang === 'ar' ? 'rtl' : 'ltr'}">`)
    .replace(/<base href="[^"]*">/, `<base href="${'../'.repeat(depthOf(r)) || './'}">`)
    .replace(/<!-- seo:start -->[\s\S]*?<!-- seo:end -->/, seoBlock(r));
  if (pre) html = html.replace('<body>\n', `<body>\n<!-- prerender:start --><div id="dc-pre"><div class="dcp-d">${pre.d}</div><div class="dcp-m">${pre.m}</div></div><!-- prerender:end -->\n`);
  return html;
}
const writePage = (r, pre) => { const f = fileFor(r); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, pageHtml(r, pre)); };

// Remove route folders from a previous build that no longer exist (e.g. a deleted product).
function cleanStale() {
  const keep = new Set(routes.map(r => pathFor(r)));
  const walk = (rel) => {
    for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const sub = rel + e.name + '/', page = join(ROOT, sub, 'index.html');
      if (!keep.has(sub) && existsSync(page) && readFileSync(page, 'utf8').includes('<!-- seo:start -->')) {
        rmSync(join(ROOT, sub), { recursive: true }); console.log(`  removed stale ${sub}`);
      } else walk(sub);
    }
  };
  for (const top of ['ar', 'about', 'brands', 'brand', 'product', 'market', 'partner', 'contact']) if (existsSync(join(ROOT, top))) walk(top + '/');
}

// ── Static server + Playwright (for prerendering and share images) ─────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json' };
function serve() {
  return new Promise((res) => {
    const srv = http.createServer((q, s) => {
      let p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = join(ROOT, p);
      if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { s.writeHead(404); return s.end('not found'); }
      s.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' }); s.end(readFileSync(f));
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}
function loadPlaywright() {
  const req = createRequire(import.meta.url);
  const paths = [ROOT];
  try { paths.push(execSync('npm root -g', { encoding: 'utf8' }).trim()); } catch {}
  return req(req.resolve('playwright', { paths }));
}

// Serialises the rendered app; above-the-fold visible images become eager so the snapshot paints fast.
function snapshot(vh) {
  const root = document.getElementById('dc-root');
  const clone = root.cloneNode(true);
  const live = [...root.querySelectorAll('img')], copies = [...clone.querySelectorAll('img')];
  const visible = (el) => { for (let e = el; e && e !== root; e = e.parentElement) if (getComputedStyle(e).opacity === '0') return false; return true; };
  live.forEach((im, i) => { const b = im.getBoundingClientRect(); if (b.top < vh && b.bottom > 0 && visible(im)) copies[i].removeAttribute('loading'); });
  clone.querySelectorAll('[data-dc-tpl]').forEach(e => e.removeAttribute('data-dc-tpl'));
  clone.querySelectorAll('[class]').forEach(e => { const c = [...e.classList].filter(k => !/^scp/.test(k)); if (c.length) e.className = c.join(' '); else e.removeAttribute('class'); });
  clone.querySelectorAll('iframe').forEach(f => f.removeAttribute('src'));   // the live app loads the map
  return clone.innerHTML;
}

async function prerender(browser, base) {
  const out = new Map();
  for (const [key, viewport] of [['d', { width: 1280, height: 800 }], ['m', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('  page error:', e.message));
    for (const r of routes) {
      await page.goto(base + pathFor(r), { waitUntil: 'load' });
      await page.waitForSelector('#dc-root main');
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      const html = await page.evaluate(snapshot, viewport.height);
      const k = pathFor(r); out.set(k, { ...(out.get(k) || {}), [key]: html });
    }
    await ctx.close();
  }
  return out;
}

// ── Social share images (1200×630) ────────────────────────────────────────────────────────────────
const cardCss = `*{box-sizing:border-box;margin:0}html,body{width:1200px;height:630px;overflow:hidden}
body{font-family:'Instrument Sans','Readex Pro',sans-serif;color:#1F2A28;-webkit-font-smoothing:antialiased}
.card{width:1200px;height:630px;display:flex;background:#F7F6F1;position:relative}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(15,79,69,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(15,79,69,.07) 1px,transparent 1px);background-size:44px 44px}
.left{flex:0 0 620px;padding:56px 60px 52px;display:flex;flex-direction:column;position:relative}
.right{flex:1;position:relative;overflow:hidden;border-inline-start:1px solid rgba(15,79,69,.14)}
.kicker{display:flex;align-items:center;gap:14px;font-size:17px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#7A6E12}
.kicker i{width:30px;height:2px;background:#B5A422;display:block}
h1{font-weight:600;color:#0F4F45;letter-spacing:-.03em;line-height:1.04}
.foot{margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:20px;padding-top:22px;border-top:1px solid rgba(15,79,69,.16);font-size:17px;color:#5C6866}
[dir=rtl] *{letter-spacing:0!important}[dir=rtl] h1{line-height:1.3}
.shot{position:absolute;object-fit:contain;filter:drop-shadow(0 26px 26px rgba(15,40,35,.24)) drop-shadow(0 6px 8px rgba(15,40,35,.12))}`;
const cardDoc = (body, dir = 'ltr', lang = 'en') => `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><link rel="stylesheet" href="${FONTS}"><style>${cardCss}</style></head><body>${body}</body></html>`;

function siteCard(L) {
  const t = T[L], ar = L === 'ar';
  const shots = [['assets/brands/sweetsmile-product-2.webp', 'left:38px;top:92px;height:420px'], ['assets/brands/antat-product-3.webp', 'left:150px;top:150px;width:360px'], ['assets/brands/mymotto-product-2.webp', 'left:96px;top:392px;width:330px']];
  return cardDoc(`<div class="card">
  <div class="left">
    <img src="assets/logo-full-horizontal.png" style="height:62px;width:auto;align-self:flex-start">
    <div style="margin-top:auto" class="kicker"><i></i>${esc(t.hero.kicker)}</div>
    <h1 style="font-size:${ar ? 50 : 58}px;margin-top:22px">${esc(t.hero.title)}</h1>
    <div class="foot" style="margin-top:34px"><span>${BRANDS.map(b => b.name).join(' · ')}</span></div>
  </div>
  <div class="right" style="background:#0F4F45">
    <div class="grid" style="background-image:linear-gradient(rgba(255,255,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.06) 1px,transparent 1px)"></div>
    <img src="assets/mark-white.png" style="position:absolute;inset-inline-end:-70px;top:-60px;height:560px;opacity:.06">
    ${shots.map(([src, pos]) => `<img class="shot" src="${src}" style="${pos}">`).join('')}
  </div></div>`, ar ? 'rtl' : 'ltr', L);
}
function brandCard(b) {
  const imgs = PRODUCTS.filter(p => p.brand === b.id && p.img).slice(0, 3);
  const bg = HERO_BG[b.id] || '#EAF1EE';
  const meta = `${CATS[b.cat].en} · ${COUNTRIES[b.country].en}`;
  if (!imgs.length) return cardDoc(`<div class="card" style="flex-direction:column;background:#fff">
    <div class="grid"></div>
    <div style="flex:1;display:grid;place-items:center;position:relative"><img src="${b.logo.replace(/\.webp$/, '.png')}" style="max-width:640px;max-height:250px"></div>
    <div style="position:relative;background:#0F4F45;color:#fff;height:150px;padding:0 60px;display:flex;align-items:center;justify-content:space-between;gap:30px">
      <div><div style="font-size:40px;font-weight:600;letter-spacing:-.02em">${esc(b.name)} <span style="color:#D8CC63">in Libya</span></div>
      <div style="font-size:20px;opacity:.75;margin-top:6px">${esc(meta)} · <span dir="rtl" style="font-family:'Readex Pro'">توزيع رِكاز في ليبيا</span></div></div>
      <img src="assets/logo-horizontal-white.png" style="height:56px">
    </div></div>`);
  const pos = imgs.length === 1 ? [['left:70px;top:70px;width:440px;height:490px']]
    : imgs.length === 2 ? [['left:30px;top:90px;width:300px;height:440px'], ['left:250px;top:130px;width:300px;height:440px']]
    : [['left:10px;top:60px;width:260px;height:360px'], ['left:280px;top:80px;width:280px;height:340px'], ['left:120px;top:300px;width:330px;height:300px']];
  return cardDoc(`<div class="card">
  <div class="left" style="background:#fff">
    <div style="height:200px;display:flex;align-items:center"><img src="${b.logo.replace(/\.webp$/, '.png')}" style="max-width:420px;max-height:180px"></div>
    <div class="kicker" style="margin-top:auto"><i></i>${esc(meta)}</div>
    <h1 style="font-size:60px;margin-top:18px">${esc(b.name)} in Libya</h1>
    <div style="font-size:26px;color:#3E4A48;margin-top:10px">Distributed by Rikaz · <span dir="rtl" style="font-family:'Readex Pro'">توزيع رِكاز في ليبيا</span></div>
    <div class="foot"><img src="assets/logo-full-horizontal.png" style="height:44px"><span>${PRODUCTS.filter(p => p.brand === b.id).length} products</span></div>
  </div>
  <div class="right" style="background:${bg}"><div class="grid"></div>${imgs.map((p, i) => `<img class="shot" src="${p.img}" style="${pos[i][0]}">`).join('')}</div></div>`);
}
function productCard(p) {
  const b = BRANDS.find(x => x.id === p.brand);
  return cardDoc(`<div class="card">
  <div class="left" style="background:#fff">
    <div style="height:110px;display:flex;align-items:center"><img src="${b.logo.replace(/\.webp$/, '.png')}" style="max-width:300px;max-height:100px"></div>
    <div class="kicker" style="margin-top:auto"><i></i>${esc(b.name)} · ${esc(CATS[b.cat].en)}</div>
    <h1 style="font-size:${p.name.length > 30 ? 46 : 54}px;margin-top:18px">${esc(p.name)}</h1>
    <div dir="rtl" style="font-family:'Readex Pro';font-size:28px;color:#3E4A48;margin-top:12px;text-align:left">${esc(p.nameAr)}</div>
    <div style="font-size:21px;color:#5C6866;margin-top:14px">${esc(p.size)} · ${esc(p.pack.en)} · Case ${esc(p.caseQty)}</div>
    <div class="foot"><img src="assets/logo-full-horizontal.png" style="height:44px"><span>Distributed in Libya</span></div>
  </div>
  <div class="right" style="background:${HERO_BG[b.id] || '#EAF1EE'}"><div class="grid"></div><img class="shot" src="${p.img}" style="inset:60px 50px"></div></div>`);
}

async function shareImages(browser, base) {
  const cards = [...LANGS.map(L => [`rikaz-${L}`, siteCard(L)]), ...BRANDS.map(b => [`brand-${b.id}`, brandCard(b)]), ...PRODUCTS.filter(p => p.img).map(p => [`product-${p.id}`, productCard(p)])];
  mkdirSync(join(ROOT, 'assets/og'), { recursive: true });
  const todo = cards.filter(([name]) => FORCE_OG || !existsSync(join(ROOT, `assets/og/${name}.jpg`)));
  if (!todo.length) return;
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 } });
  const page = await ctx.newPage();
  for (const [name, html] of todo) {
    await page.goto(base + '__card'); // same-origin blank page so relative asset URLs resolve
    await page.setContent(html.replace('<head>', `<head><base href="${base}">`), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const missing = await page.evaluate(() => { const ok = new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, ''))); return ['Instrument Sans', ...(/[\u0600-\u06FF]/.test(document.body.innerText) ? ['Readex Pro'] : [])].filter(f => !ok.has(f)); });
    if (missing.length) console.warn(`  ⚠ ${name}: fonts not loaded (${missing.join(', ')})`);
    await page.screenshot({ path: join(ROOT, `assets/og/${name}.jpg`), type: 'jpeg', quality: 86 });
  }
  await ctx.close();
  console.log(`  share images: ${todo.length} written`);
}

// ── sitemap.xml, robots.txt, manifest, 404 ────────────────────────────────────────────────────────
function writeExtras() {
  const today = new Date().toISOString().slice(0, 10);
  const pri = { home: '1.0', brands: '0.9', brand: '0.8', product: '0.7', partner: '0.8', about: '0.7', market: '0.7', contact: '0.7' };
  const urls = routes.map(r => {
    const m = seoFor(r), img = r.page === 'product' ? PRODUCTS.find(p => p.id === r.productId).img : r.page === 'brand' ? BRANDS.find(b => b.id === r.brandId).logo : null;
    return `  <url>
    <loc>${abs(m.path)}</loc>
    <lastmod>${today}</lastmod>
    <priority>${r.lang === 'en' ? pri[r.page] : (pri[r.page] - 0.1).toFixed(1)}</priority>
    <xhtml:link rel="alternate" hreflang="en" href="${abs(m.enPath)}"/>
    <xhtml:link rel="alternate" hreflang="ar" href="${abs(m.arPath)}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${abs(m.enPath)}"/>${img ? `
    <image:image><image:loc>${abs(img)}</image:loc></image:image>` : ''}
  </url>`;
  });
  writeFileSync(join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join('\n')}
</urlset>
`);
  writeFileSync(join(ROOT, 'robots.txt'), `# Rikaz — ${SITE_URL}\nUser-agent: *\nAllow: /\n\nSitemap: ${abs('sitemap.xml')}\n`);
  writeFileSync(join(ROOT, 'site.webmanifest'), JSON.stringify({
    name: 'Rikaz — Food Import & Distribution, Libya', short_name: 'Rikaz', description: D.SEO.en.home.d, lang: 'en', dir: 'ltr',
    start_url: './', scope: './', display: 'minimal-ui', background_color: '#F7F6F1', theme_color: '#0F4F45',
    icons: [
      { src: 'assets/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'assets/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'assets/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 2) + '\n');
  // GitHub Pages serves this for unknown URLs at any depth, so it links with root-absolute paths.
  const R = SITE_PATH;
  writeFileSync(join(ROOT, '404.html'), `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found — Rikaz</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0F4F45">
<link rel="icon" type="image/png" sizes="32x32" href="${R}assets/favicon-32.png">
<link rel="stylesheet" href="${R}${FONTS}">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F7F6F1;color:#1F2A28;font-family:'Instrument Sans','Readex Pro',sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:560px;padding:40px 24px;text-align:center}h1{margin:28px 0 10px;font-size:34px;font-weight:600;letter-spacing:-.02em;color:#0F4F45}
p{margin:0 0 6px;color:#3E4A48;line-height:1.6}nav{margin-top:28px;display:flex;flex-wrap:wrap;gap:10px;justify-content:center}
a{display:inline-block;padding:13px 22px;border-radius:3px;font-weight:600;font-size:14.5px;text-decoration:none;background:#0F4F45;color:#fff}a.alt{background:transparent;color:#0F4F45;border:1px solid rgba(15,79,69,.35)}</style>
<script>
// Old share links used #/… routes — send them to the matching clean URL.
if (/^#\\/./.test(location.hash)) location.replace('${R}' + location.hash.slice(2).replace(/\\/?$/, '/'));
</script>
</head>
<body>
<main>
  <img src="${R}assets/logo-full-horizontal.webp" alt="Rikaz — رِكاز" width="600" height="145" style="height:52px;width:auto">
  <h1>Page not found</h1>
  <p>The page you were looking for has moved or no longer exists.</p>
  <p dir="rtl" lang="ar" style="font-family:'Readex Pro',sans-serif">الصفحة التي تبحث عنها غير موجودة.</p>
  <nav><a href="${R}">Home</a><a class="alt" href="${R}brands/">Our brands</a><a class="alt" href="${R}ar/" lang="ar">العربية</a></nav>
</main>
</body>
</html>
`);
}

// ── Run ───────────────────────────────────────────────────────────────────────────────────────────
console.log(`Building ${routes.length} pages for ${SITE_URL}`);
cleanStale();
for (const r of routes) writePage(r, null);
writeExtras();
if (PRERENDER) {
  const { chromium } = loadPlaywright();
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  try {
    await shareImages(browser, base);
    const snaps = await prerender(browser, base);
    for (const r of routes) writePage(r, snaps.get(pathFor(r)));
    console.log(`  prerendered ${snaps.size} pages`);
  } finally { await browser.close(); srv.close(); }
}
console.log('Done.');
