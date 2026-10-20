#!/usr/bin/env node
// End-to-end test of the admin dashboard (/admin/) against a fake, in-memory GitHub API.
// It drives the real dashboard in Chromium through every main flow and checks what gets committed.
//
// Usage:  node tools/test-admin.mjs            (needs Playwright, like tools/build.mjs)
//         node tools/test-admin.mjs --shots DIR   also save screenshots of each screen to DIR
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { validate } from '../admin/schema.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const OWNER = 'sheedosa', NAME = 'rikaz-website', BRANCH = 'main', TOKEN = 'github_pat_TEST';

// ── Fake GitHub ───────────────────────────────────────────────────────────────────────────────────
const sha = (s) => createHash('sha1').update(s).digest('hex');
const commits = new Map(), blobs = new Map(), trees = new Map();
let head, runs = [];
function addCommit(files, parent, message, date = new Date()) {
  const tree = new Map(parent ? trees.get(commits.get(parent).tree) : []);
  for (const [p, v] of Object.entries(files)) tree.set(p, v);
  const treeSha = sha('tree' + Math.random());
  trees.set(treeSha, tree);
  const s = sha('commit' + Math.random());
  commits.set(s, { sha: s, tree: treeSha, parent, message, date: date.toISOString() });
  return s;
}
// Files not committed through the fake (the site's existing photos) are read from the working copy.
const fileAt = (ref, path) => trees.get(commits.get(ref === BRANCH ? head : ref).tree).get(path) ?? (path.startsWith('assets/') && existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path)) : undefined);
const contentNow = () => Object.fromEntries(['brands', 'products', 'settings'].map(k => [k, JSON.parse(fileAt(head, `content/${k}.json`))]));
head = addCommit(Object.fromEntries(['brands', 'products', 'settings'].map(k => [`content/${k}.json`, readFileSync(join(ROOT, `content/${k}.json`), 'utf8')])), null, 'Initial catalogue', new Date(Date.now() - 86400000));
let failNextRefUpdate = 0;

function github(method, url, body, accept = '') {
  const u = new URL(url), p = u.pathname.replace(`/repos/${OWNER}/${NAME}`, '');
  const ok = (data, status = 200) => ({ status, data });
  if (p === '/user') return ok({ login: 'rikaz-owner', name: 'Rikaz Owner', avatar_url: 'https://avatars.githubusercontent.com/u/1' });
  if (p === '' ) return ok({ default_branch: BRANCH, permissions: { push: true } });
  if (p === `/git/ref/heads/${BRANCH}`) return ok({ object: { sha: head } });
  if (p.startsWith('/contents/')) {
    const f = fileAt(u.searchParams.get('ref'), decodeURIComponent(p.slice(10)));
    if (f == null) return { status: 404, data: { message: 'Not Found' } };
    return /raw/.test(accept) ? { status: 200, raw: f } : ok({ type: 'file', path: decodeURIComponent(p.slice(10)), size: f.length });
  }
  let m;
  if ((m = p.match(/^\/git\/commits\/(\w+)$/))) return ok({ sha: m[1], tree: { sha: commits.get(m[1]).tree } });
  if (p === '/git/blobs' && method === 'POST') { const s = sha(body.content); blobs.set(s, Buffer.from(body.content, 'base64')); return ok({ sha: s }, 201); }
  if (p === '/git/trees' && method === 'POST') {
    const t = new Map(trees.get(body.base_tree));
    for (const e of body.tree) t.set(e.path, e.sha ? blobs.get(e.sha) : e.content);
    const s = sha('tree' + Math.random()); trees.set(s, t); return ok({ sha: s }, 201);
  }
  if (p === '/git/commits' && method === 'POST') {
    const s = sha('commit' + Math.random());
    commits.set(s, { sha: s, tree: body.tree, parent: body.parents[0], message: body.message, date: new Date().toISOString() });
    return ok({ sha: s }, 201);
  }
  if (p === `/git/refs/heads/${BRANCH}` && method === 'PATCH') {
    if (failNextRefUpdate > 0) { failNextRefUpdate--; simulateOtherAdmin(); }
    if (commits.get(body.sha).parent !== head) return { status: 422, data: { message: 'Update is not a fast forward' } };
    head = body.sha;
    runs.unshift({ id: runs.length + 1, head_sha: head, status: 'in_progress', conclusion: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), html_url: 'https://github.com/x/runs/' + (runs.length + 1), _done: Date.now() + 3000 });
    return ok({ object: { sha: head } });
  }
  if (p === '/commits') {
    const out = [];
    for (let c = commits.get(head); c && out.length < 25; c = commits.get(c.parent)) {
      const t = trees.get(c.tree), pt = c.parent ? trees.get(commits.get(c.parent).tree) : new Map();
      if ([...t.keys()].some(k => k.startsWith('content/') && t.get(k) !== pt.get(k))) out.push({ sha: c.sha, parents: c.parent ? [{ sha: c.parent }] : [], commit: { message: c.message, author: { name: 'Rikaz Owner', date: c.date } }, author: { login: 'rikaz-owner', avatar_url: 'https://avatars.githubusercontent.com/u/1' } });
    }
    return ok(out);
  }
  if (p === '/actions/runs') {
    for (const r of runs) if (r.status !== 'completed' && Date.now() > r._done) Object.assign(r, { status: 'completed', conclusion: 'success', updated_at: new Date().toISOString() });
    return ok({ workflow_runs: runs });
  }
  return { status: 404, data: { message: `fake GitHub: no route for ${method} ${p}` } };
}
// Someone else publishes a change to product an2 in the middle of our publish.
function simulateOtherAdmin() {
  const c = contentNow();
  c.products.find(p => p.id === 'an2').name = 'Fruit Jelly Mix (edited elsewhere)';
  head = addCommit({ 'content/products.json': JSON.stringify(c.products, null, 2) + '\n' }, head, 'Edited product "Fruit Jelly Mix" (other admin)');
}

let failures = 0, passed = 0;
const check = (cond, msg) => { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failures++; console.log('  ✖ ' + msg); } };

// ── Merge rules (no browser needed) ───────────────────────────────────────────────────────────────
{
  const store = await import('../admin/store.js');
  const base = store.normalize(JSON.parse(JSON.stringify(Object.fromEntries(['brands', 'products', 'settings'].map(k => [k, JSON.parse(readFileSync(join(ROOT, `content/${k}.json`), 'utf8'))])))));
  const copy = () => JSON.parse(JSON.stringify(base));
  const mk = (id, name) => ({ ...base.products.find(p => p.id === 'ke1'), id, name, sku: 'T-' + name });
  console.log('Merge rules');
  const mine = copy(), theirs = copy();
  mine.products.push(mk('ke10', 'Mine')); theirs.products.push(mk('ke10', 'Theirs'));
  mine.settings.countries.FR = { en: 'France', ar: 'فرنسا' }; theirs.settings.countries.GR = { en: 'Greece', ar: 'اليونان' };
  let m = store.merge(base, mine, theirs);
  const ids = m.content.products.filter(p => /^(Mine|Theirs)$/.test(p.name)).map(p => p.id + ':' + p.name).sort();
  check(ids.join() === 'ke10:Theirs,ke11:Mine', `two people adding a product at once keep both (${ids})`);
  check(m.notes.some(n => /ke11/.test(n)), 'and the owner is told about the new address');
  check(m.content.settings.countries.FR && m.content.settings.countries.GR, 'countries added on both sides are both kept');
  const del = copy(); del.products = del.products.filter(p => p.id !== 'ma7');
  const r = store.retire(base, del);
  check(r.settings.retired.products.includes('ma7'), 'a deleted product ID is retired');
  const { nextProductId } = await import('../admin/schema.js');
  check(nextProductId('maretti', r.products, r.settings.retired.products) === 'ma8', 'and never given to a new product');
  const ed = copy(); ed.products.find(p => p.id === 'an1').name = 'X';
  const ot = copy(); ot.products.find(p => p.id === 'an2').name = 'Y';
  m = store.merge(base, ed, ot);
  check(m.content.products.find(p => p.id === 'an1').name === 'X' && m.content.products.find(p => p.id === 'an2').name === 'Y' && !m.notes.length, 'edits to different products merge cleanly');
}

// ── Static server for the site ────────────────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const srv = http.createServer((q, s) => {
  let p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { s.writeHead(404); return s.end('not found'); }
  s.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' }); s.end(readFileSync(f));
}).listen(0, '127.0.0.1');
await new Promise(r => srv.on('listening', r));
const BASE = `http://127.0.0.1:${srv.address().port}/admin/`;

// ── Test runner ───────────────────────────────────────────────────────────────────────────────────
const req = createRequire(import.meta.url);
let playwright; try { playwright = req(req.resolve('playwright', { paths: [ROOT, execSync('npm root -g', { encoding: 'utf8' }).trim()] })); } catch { console.error('Playwright is not installed (npm i -g playwright).'); process.exit(1); }
const browser = await playwright.chromium.launch();
async function newPage(viewport = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', e => { failures++; console.log('  ✖ page error: ' + e.message); });
  page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && console.log('  console: ' + m.text()));
  page.on('dialog', d => d.accept());
  await ctx.route('https://api.github.com/**', async (route) => {
    const r = route.request();
    if (r.headers().authorization !== `Bearer ${TOKEN}`) return route.fulfill({ status: 401, json: { message: 'Bad credentials' } });
    const res = github(r.method(), r.url(), r.postData() ? JSON.parse(r.postData()) : null, r.headers().accept);
    const headers = { 'access-control-allow-origin': '*' };
    if ('raw' in res) return route.fulfill({ status: 200, headers, contentType: 'text/plain; charset=utf-8', body: typeof res.raw === 'string' ? res.raw : res.raw.toString('utf8') });
    return route.fulfill({ status: res.status, headers, json: res.data });
  });
  await ctx.route('https://avatars.githubusercontent.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: readFileSync(join(ROOT, 'assets/favicon-32.png')) }));
  await ctx.route('https://raw.githubusercontent.com/**', r => {
    const path = new URL(r.request().url()).pathname.split('/').slice(4).join('/'), f = fileAt(head, path);
    return f ? r.fulfill({ status: 200, body: f }) : r.fulfill({ status: 404 });
  });
  return page;
}
const shot = async (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, name + '.png'), fullPage: true });
const publishAll = async (page) => {
  await page.click('header .btn.publish');
  await page.click('text=Publish to website');
  await page.waitForSelector('.modal-h >> text=Published', { timeout: 15000 }).catch(async (e) => { throw new Error('publish did not finish: ' + await page.locator('.modal').textContent()); });
  await page.waitForSelector('.steps li.done >> text=Live on', { timeout: 30000 });
  await page.click('.modal-f >> text=Done');
};

try {
  console.log('Sign in');
  const page = await newPage();
  await page.goto(BASE);
  await page.waitForSelector('text=Sign in');
  await shot(page, '01-login');
  await page.fill('input[type=password]', 'wrong');
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('text=did not accept');
  check(true, 'a wrong key is refused with a clear message');
  await page.fill('input[type=password]', TOKEN);
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('text=Welcome');
  const stats = await page.$$eval('.stat b', els => els.map(e => e.textContent));
  check(stats[0] === '13' && stats[1] === '125', `overview shows 13 brands / 125 products (${stats.join(', ')})`);
  await page.waitForSelector('text=Site is live').catch(() => {});
  await shot(page, '02-overview');

  console.log('Edit a product');
  await page.click('nav >> text=Products');
  await page.waitForSelector('table.table');
  await shot(page, '03-products');
  await page.fill('input[type=search]', 'ANT-0101');
  check(await page.locator('tbody tr').count() === 1, 'search by SKU finds one product');
  await page.click('tbody tr');
  await page.waitForSelector('h1:has-text("Assorted Candy Mix")');
  await shot(page, '04-product-editor');
  await page.locator('.field:has(label:has-text("Product name")):has(.lang:text("EN")) input').fill('Assorted Candy Mix — Party Pack');
  await page.click('.savebar button.primary');
  await page.waitForSelector('header .count:text("1")');
  check(true, 'the change is counted as 1 unpublished change');
  await page.reload();
  await page.waitForSelector('header .count:text("1")');
  check(true, 'the draft survives a page reload');
  await publishAll(page);
  let c = contentNow();
  check(c.products.find(p => p.id === 'an1').name === 'Assorted Candy Mix — Party Pack', 'the edit is committed to content/products.json');
  check(commits.get(head).message.startsWith('Edited product "Assorted Candy Mix — Party Pack"'), 'commit message describes the change');
  check(await page.locator('header .btn.publish.none').count() === 1, 'nothing left to publish afterwards');

  console.log('Validation');
  await page.goto(BASE + '#/products/new?brand=kemo');
  await page.waitForSelector('h1:has-text("New product")');
  check(await page.locator('text=rikazfoods.ly/product/ke10/').count() === 1, 'a new Kemo product gets the next ID (ke10)');
  await page.click('.savebar button.primary');
  await page.waitForSelector('.err');
  const errs = await page.locator('.field .err').count();
  check(errs >= 5, `saving an empty form shows field errors (${errs})`);
  await shot(page, '05-validation');
  await page.reload();   // start the next flow without the error message still on screen
  await page.waitForSelector('h1:has-text("New product")');

  console.log('Add a product with a photo');
  const fill = async (label, lang, value) => page.locator(`.field:has(label:has-text("${label}"))${lang ? `:has(.lang:text("${lang}"))` : ''} :is(input,textarea)`).first().fill(value);
  await fill('Product name', 'EN', 'Riolet Swiss Roll — Pistachio');
  await fill('Product name', 'AR', 'ريوليه سويس رول — فستق');
  await fill('SKU', null, 'KEM-0199');
  await fill('Size', null, '150 g');
  await fill('Case quantity', null, '24 × 150 g');
  await fill('Shelf life', null, '9 months');
  await fill('Packaging', 'EN', 'Flow wrap');
  await fill('Packaging', 'AR', 'تغليف');
  await fill('English', 'EN', 'Soft sponge roll with pistachio cream.');
  await fill('Arabic', 'AR', 'كيك رول طري بكريمة الفستق.');
  await page.setInputFiles('.drop input[type=file]', join(ROOT, 'assets/brands/kemo-product-1.png'));
  await page.waitForSelector('.drop img[src^="blob:"]', { timeout: 15000 });
  check(true, 'the photo is processed in the browser and previewed');
  await shot(page, '06-new-product');
  await page.click('.savebar button.primary');
  await page.waitForSelector('h1:has-text("Riolet Swiss Roll — Pistachio")');
  check(page.url().endsWith('#/products/ke10'), 'after saving, the new product opens at its ID');
  await publishAll(page);
  c = contentNow();
  const ke10 = c.products.find(p => p.id === 'ke10');
  check(ke10 && /^assets\/brands\/ke10-\w{6}\.webp$/.test(ke10.img), `product committed with its photo path (${ke10 && ke10.img})`);
  const webp = ke10 && fileAt(head, ke10.img), png = ke10 && fileAt(head, ke10.img.replace('.webp', '.png'));
  check(webp && webp.slice(0, 4).toString() === 'RIFF' && webp.slice(8, 12).toString() === 'WEBP', `the .webp file is committed (${webp && webp.length} bytes)`);
  check(png && png.slice(1, 4).toString() === 'PNG', `the .png original is committed (${png && png.length} bytes)`);
  check(c.products.findIndex(p => p.id === 'ke10') === c.products.findIndex(p => p.id === 'ke9') + 1, 'new product is placed after the brand’s other products');

  console.log('Add a brand with a new country');
  await page.goto(BASE + '#/brands/new');
  await page.waitForSelector('h1:has-text("New brand")');
  await fill('Brand name', null, 'Délice Test');
  check(await page.locator('text=rikazfoods.ly/brand/delicetest/').count() === 1, 'brand ID is made from the name (delicetest)');
  await page.selectOption('.field:has(label:has-text("Category")) select', 'dairy');
  await page.selectOption('.field:has(label:has-text("Country of origin")) select', '+');
  await page.fill('.modal input >> nth=0', 'fr');
  await page.fill('.modal input >> nth=1', 'France');
  await page.fill('.modal input >> nth=2', 'فرنسا');
  await page.click('.modal-f >> text=Add country');
  await fill('English', 'EN', 'French dairy desserts.');
  await fill('Arabic', 'AR', 'حلويات ألبان فرنسية.');
  await page.locator('.field:has(label:has-text("English")) textarea').fill('A test brand story.');
  await page.locator('.field:has(label:has-text("Arabic")) textarea').fill('قصة علامة تجريبية.');
  await page.click('.swatch >> nth=2');
  await page.setInputFiles('.drop input[type=file]', join(ROOT, 'assets/brands/kemo-logo.png'));
  await page.waitForSelector('.drop img[src^="blob:"]', { timeout: 15000 });
  await shot(page, '07-new-brand');
  await page.click('.savebar button.primary');
  await page.waitForSelector('h1:has-text("Délice Test")');
  check(await page.locator('.toast.error').count() === 0, 'no error shown when saving a valid brand');
  check(page.url().endsWith('#/brands/delicetest'), 'brand saved and opened');

  console.log('Home page');
  await page.click('nav >> text=Home page');
  await page.waitForSelector('.slots');
  await page.click('.slot >> nth=1 >> text=Change');
  await page.fill('.modal input[type=search]', 'Swiss Roll — Pistachio');
  await page.click('.picker button >> nth=0');
  await shot(page, '08-home');
  await page.click('.slot >> nth=1 >> [aria-label="Move earlier"]');

  console.log('Publish while someone else publishes (merge)');
  failNextRefUpdate = 1;
  await publishAll(page);
  c = contentNow();
  check(c.brands.some(b => b.id === 'delicetest' && b.country === 'FR' && b.tint === '#FBEBEB'), 'new brand committed with country and colour');
  check(c.settings.countries.FR && c.settings.countries.FR.ar === 'فرنسا', 'new country committed');
  check(c.settings.heroProducts[0] === 'ke10', 'home page product moved to position 1 (' + c.settings.heroProducts + ')');
  check(c.products.find(p => p.id === 'an2').name === 'Fruit Jelly Mix (edited elsewhere)', 'the other admin’s change is kept (merge)');
  const logo = c.brands.find(b => b.id === 'delicetest').logo;
  check(fileAt(head, logo) && fileAt(head, logo.replace('.webp', '.png')), 'brand logo files committed');
  check(validate(c, { fileExists: (p) => existsSync(join(ROOT, p)) || fileAt(head, p) != null }).filter(p => p.level === 'error').length === 0, 'committed catalogue passes the build’s checks');

  console.log('Reorder, delete, undo');
  await page.click('nav >> text=Brands');
  await page.click('text=Change order');
  await page.click('[aria-label="Move My Motto up"]');
  await page.click('text=Done');
  await page.goto(BASE + '#/products/ma3');
  await page.waitForSelector('text=Delete this product');
  await page.click('text=Delete this product');
  await page.waitForURL(/#\/products\?brand=maretti/);
  await page.goto(BASE + '#/products/an3');
  check(await page.locator('text=featured on the home page').count() >= 1, 'a featured product cannot be deleted (explained)');
  await page.click('header .btn.publish');
  await page.waitForSelector('text=Deleted product “Bruschette');
  await shot(page, '09-publish-dialog');
  await page.click('text=Publish to website');
  await page.waitForSelector('.modal-h >> text=Published');
  await page.click('.modal-f >> text=Done');
  c = contentNow();
  check(!c.products.some(p => p.id === 'ma3'), 'product deleted');
  check(c.brands[0].id === 'mymotto', 'brand order changed');
  await page.click('nav >> text=History');
  await page.waitForSelector('.list li');
  await shot(page, '10-history');
  await page.locator('.list li').first().locator('text=Undo').click();
  await page.waitForSelector('header .count');
  await publishAll(page);
  c = contentNow();
  check(c.products.some(p => p.id === 'ma3'), 'undo brought the deleted product back');
  check(c.brands[0].id === 'antat', 'undo restored the brand order');

  console.log('Phone layout');
  const phone = await newPage({ width: 390, height: 844 });
  await phone.goto(BASE);
  await phone.fill('input[type=password]', TOKEN);
  await phone.click('button:has-text("Sign in")');
  await phone.waitForSelector('text=Welcome');
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(overflow <= 0, `no sideways scrolling on a phone (overflow ${overflow}px)`);
  await shot(phone, '11-phone-overview');
  await phone.goto(BASE + '#/products/co1');
  await phone.waitForSelector('h1');
  await shot(phone, '12-phone-product');
  const overflow2 = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(overflow2 <= 0, `product editor fits a phone (overflow ${overflow2}px)`);

  if (process.argv.includes('--export')) {   // write the final fake repository content for a build test
    const out = process.argv[process.argv.indexOf('--export') + 1];
    for (const [p, v] of trees.get(commits.get(head).tree)) { mkdirSync(dirname(join(out, p)), { recursive: true }); writeFileSync(join(out, p), v); }
  }
} catch (e) {
  failures++; console.log('  ✖ ' + e.message.split('\n')[0]);
} finally {
  await browser.close(); srv.close();
}
console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
