// Rikaz admin dashboard.
// Screens: Overview · Brands (+ editor) · Products (+ editor) · Home page · History · Help.
// Edits are kept as drafts in this browser until "Publish", which writes one commit to GitHub;
// the "Publish site" GitHub Action then rebuilds and deploys rikazfoods.ly.
import { html, render, useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } from './vendor/preact-htm.js';
import { REPO, SITE_URL } from './config.js';
import { createClient, explain, b64 } from './github.js';
import { STATUSES, HERO_SLOTS, cleanBrand, cleanProduct, nextProductId, newBrandId, slugify } from './schema.js';
import { prepareImage, randomTag } from './images.js';
import * as store from './store.js';

const Ctx = createContext(null);
const useApp = () => useContext(Ctx);
const TOKEN_KEY = 'rikaz-admin-token';
const RAW = (ref, path) => `https://raw.githubusercontent.com/${REPO.owner}/${REPO.name}/${ref}/${path}`;
const siteLink = (path) => SITE_URL + path;
const TINTS = ['#FBEFEA', '#FBECEC', '#FBEBEB', '#FBF0E3', '#FBF3E6', '#F6F1E3', '#F5EEE8', '#EAF3EC', '#EAF4EA', '#EAF2FB', '#E9F1FA', '#EAF0FA', '#EFEFEF'];

// ── Small helpers ─────────────────────────────────────────────────────────────────────────────────
const ago = (d) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };
const setToken = (t, remember) => { try { (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t); } catch {} };
const clearToken = () => { try { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); } catch {} };
const blobToB64 = async (blob) => b64.fromBytes(new Uint8Array(await blob.arrayBuffer()));
const set = (obj, path, value) => {   // immutable set: set(o, 'desc.en', 'x')
  const [k, ...rest] = path.split('.');
  return { ...obj, [k]: rest.length ? set(obj[k] || {}, rest.join('.'), value) : value };
};
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
const move = (arr, from, to) => { const a = [...arr]; const [x] = a.splice(from, 1); a.splice(to, 0, x); return a; };

const Icon = ({ d, size = 18 }) => html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d.split('|').map(p => html`<path d=${p} />`)}</svg>`;
const I = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z|M20 20l-4-4',
  plus: 'M12 5v14|M5 12h14',
  up: 'M12 19V5|M6 11l6-6 6 6',
  down: 'M12 5v14|M6 13l6 6 6-6',
  left: 'M19 12H5|M11 6l-6 6 6 6',
  right: 'M5 12h14|M13 6l6 6-6 6',
  ext: 'M14 4h6v6|M20 4l-9 9|M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  undo: 'M9 14L4 9l5-5|M4 9h10a6 6 0 0 1 0 12h-3',
  trash: 'M4 7h16|M10 11v6|M14 11v6|M6 7l1 13h10l1-13|M9 7V4h6v3',
  check: 'M5 12l5 5 9-10',
  image: 'M4 5h16v14H4z|M4 16l5-5 4 4 3-3 4 4|M15 9.5a.5.5 0 1 0 1 0 .5.5 0 0 0-1 0',
};

// Image from the repository, a photo waiting to be published, or (right after publishing, before the site is
// rebuilt) the copy on GitHub.
function Img({ path, alt = '', ...rest }) {
  const { imgUrl, base } = useApp();
  const [fallback, setFallback] = useState(false);
  useEffect(() => setFallback(false), [path]);
  if (!path) return null;
  const src = imgUrl(path) || (fallback ? RAW(base.sha, path) : '../' + path);
  return html`<img src=${src} alt=${alt} loading="lazy" onError=${() => !fallback && setFallback(true)} ...${rest} />`;
}
const Thumb = ({ product, tint, size }) => product && product.img
  ? html`<div class="thumb" style=${{ background: tint || '#EEF2EF', ...(size ? { width: size, height: size } : {}) }}><${Img} path=${product.img} /></div>`
  : html`<div class="thumb none" style=${size ? { width: size, height: size } : {}}>No photo</div>`;

function Field({ label, lang, hint, error, optional, children, style }) {
  return html`<div class=${'field' + (error ? ' bad' : '')} style=${style}>
    ${label && html`<label>${label}${lang && html`<span class="lang">${lang}</span>`}${optional && html`<span class="opt">optional</span>`}</label>`}
    ${children}
    ${error ? html`<div class="err">${error}</div>` : hint && html`<div class="hint">${hint}</div>`}
  </div>`;
}
const Text = ({ value, onInput, ar, multiline, ...rest }) => multiline
  ? html`<textarea value=${value || ''} onInput=${e => onInput(e.target.value)} dir=${ar ? 'rtl' : 'auto'} lang=${ar ? 'ar' : 'en'} ...${rest} />`
  : html`<input type="text" value=${value || ''} onInput=${e => onInput(e.target.value)} dir=${ar ? 'rtl' : 'auto'} lang=${ar ? 'ar' : 'en'} ...${rest} />`;

function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose && onClose();
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [onClose]);
  return html`<div class="overlay" onMouseDown=${e => e.target === e.currentTarget && onClose && onClose()}>
    <div class=${'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label=${title}>
      <div class="modal-h"><h2>${title}</h2><span class="spacer" />${onClose && html`<button class="btn ghost icon" onClick=${onClose} aria-label="Close">✕</button>`}</div>
      <div class="modal-b">${children}</div>
      ${footer && html`<div class="modal-f">${footer}</div>`}
    </div>
  </div>`;
}

// Photo picker with drag-and-drop. `kind`: 'product' | 'logo'. Calls onPicked(prepared) with the processed image.
function ImageDrop({ path, kind, tint, onPicked, label }) {
  const [busy, setBusy] = useState(false), [over, setOver] = useState(false), [error, setError] = useState(null);
  const take = async (file) => {
    if (!file) return;
    setBusy(true); setError(null);
    try { await onPicked(await prepareImage(file, kind)); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return html`<div>
    <div class=${'drop' + (kind === 'logo' ? ' logo' : '') + (over ? ' over' : '')} style=${{ background: path ? (tint || '#fff') : '#fff' }}
      onDragOver=${e => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
      onDrop=${e => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]); }}>
      ${path ? html`<${Img} path=${path} alt="" />` : html`<div class="ph"><${Icon} d=${I.image} size=${34} /><b>${label || 'Add a photo'}</b><div class="small">Drop it here or tap to choose</div></div>`}
      <input type="file" accept="image/*" aria-label=${label || 'Choose a photo'} onChange=${e => { take(e.target.files[0]); e.target.value = ''; }} />
      ${busy && html`<div class="busy">Preparing photo…</div>`}
    </div>
    ${error ? html`<div class="err" style="margin-top:6px">${error}</div>` : html`<div class="hint" style="margin-top:6px">${path ? 'Tap the picture or drop a new one to replace it.' : kind === 'logo' ? 'PNG with a transparent background looks best.' : 'A pack shot on a white or transparent background looks best.'}</div>`}
  </div>`;
}

// ── Routing (hash based: #/products/an3) ──────────────────────────────────────────────────────────
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), q: Object.fromEntries(new URLSearchParams(query)) };
}
const go = (to) => { location.hash = to; };
let leaveGuard = null;   // set by editors with unsaved changes

// ══ App ═══════════════════════════════════════════════════════════════════════════════════════════
function App() {
  const [token, setTok] = useState(getToken());
  const [session, setSession] = useState(null);   // { api, user, branch }
  const [bootError, setBootError] = useState(null);
  const [base, setBase] = useState(null);         // { sha, brands, products, settings }
  const [draft, setDraftRaw] = useState(null);
  const [imgUrls, setImgUrls] = useState({});     // path → object URL for photos not yet on the site
  const [route, setRoute] = useState(parseRoute());
  const [toasts, setToasts] = useState([]);
  const [publishing, setPublishing] = useState(false);
  const [deploy, setDeploy] = useState(null);     // { state: 'busy'|'live'|'fail'|'slow', sha, url, since }
  const [notice, setNotice] = useState(null);

  const toast = useCallback((msg, kind) => {
    const id = Math.random();
    setToasts(t => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'error' ? 7000 : 3800);
  }, []);

  // Routing with a guard for unsaved editor changes.
  useEffect(() => {
    let last = location.hash;
    const on = () => {
      if (leaveGuard && !leaveGuard()) { history.replaceState(null, '', last); return; }
      leaveGuard = null; last = location.hash; setRoute(parseRoute()); scrollTo(0, 0);
    };
    addEventListener('hashchange', on);
    const unload = (e) => { if (leaveGuard) { e.preventDefault(); e.returnValue = ''; } };
    addEventListener('beforeunload', unload);
    return () => { removeEventListener('hashchange', on); removeEventListener('beforeunload', unload); };
  }, []);

  // Keep drafts in this browser.
  const setDraft = useCallback((next) => {
    setDraftRaw(prev => {
      const value = typeof next === 'function' ? next(prev) : next;
      return value;
    });
  }, []);
  useEffect(() => { if (base && draft && session) store.save({ base, draft }, session.user.login); }, [base, draft]);
  // Another tab of the dashboard saved a draft: adopt it, so two open tabs never overwrite each other's work.
  useEffect(() => {
    if (!session) return;
    const on = (e) => {
      if (e.key !== store.SAVED_KEY || !e.newValue) return;
      try {
        const s = JSON.parse(e.newValue);
        if (s.login !== session.user.login || (baseRef.current && store.same(s.base, baseRef.current) && store.same(s.draft, draftRef.current))) return;
        setBase(s.base); setDraftRaw(s.draft);
      } catch {}
    };
    addEventListener('storage', on);
    return () => removeEventListener('storage', on);
  }, [session]);

  // Sign in → load the catalogue.
  useEffect(() => {
    if (!token) return;
    let stop = false;
    (async () => {
      setBootError(null);
      try {
        const api = createClient(token);
        const [user, repo] = await Promise.all([api.user(), api.repo()]);
        if (!repo.permissions || !repo.permissions.push) throw new Error(`Your GitHub account (${user.login}) can view the Rikaz repository but cannot change it. Ask the site owner to add you as a collaborator with write access.`);
        const branch = repo.default_branch;
        const sha = await api.head(branch);
        const latest = store.normalize(await api.content(sha));
        const saved = store.loadSaved(user.login);
        let b = { sha, ...latest }, d = store.clone(latest), note = null;
        if (saved && store.changes(saved.base, saved.draft).length) {
          if (saved.base.sha === sha) { b = saved.base; d = saved.draft; }
          else {
            const m = store.merge(saved.base, saved.draft, latest);
            d = m.content;
            note = { kind: 'info', text: 'The catalogue was updated on GitHub since your last visit. Your unpublished changes are kept on top of the newest version.', notes: m.notes };
          }
        }
        // Photos waiting to be published.
        const keys = await store.pendingImages.keys().catch(() => []);
        const used = store.referencedImages(d), urls = {};
        for (const k of keys) {
          if (!used.has(k)) { store.pendingImages.del(k).catch(() => {}); continue; }
          const blob = await store.pendingImages.get(k);
          if (blob) urls[k] = URL.createObjectURL(blob);
        }
        if (stop) return;
        setSession({ api, user, branch });
        setBase(b); setDraftRaw(d); setImgUrls(urls); setNotice(note);
      } catch (e) {
        if (stop) return;
        if (e.status === 401) { clearToken(); setTok(null); setBootError('GitHub did not accept that access key. It may be mistyped, expired or deleted.'); return; }
        setBootError(explain(e));
      }
    })();
    return () => { stop = true; };
  }, [token]);

  // Follow the "Publish site" workflow for a commit until the site is live.
  const watchId = useRef(0);
  const watchDeploy = useCallback((sha, since = Date.now()) => {
    if (!session) return;
    const me = ++watchId.current;   // only the newest publish updates the status
    const setDeploy_ = (v) => me === watchId.current && setDeploy(v);
    setDeploy({ state: 'busy', sha, since });
    let tries = 0;
    const tick = async () => {
      if (me !== watchId.current) return;
      tries++;
      try {
        const { workflow_runs: runs = [] } = await session.api.runs(session.branch);
        const mine = runs.find(r => r.head_sha === sha);
        // A newer publish can replace a queued run; then the newest run carries this change too.
        const newer = runs.filter(r => mine ? new Date(r.created_at) > new Date(mine.created_at) : new Date(r.created_at).getTime() >= since - 60000);
        const run = mine && mine.conclusion !== 'cancelled' ? mine : newer.find(r => r.conclusion !== 'cancelled') || mine;
        if (run && run.status === 'completed') {
          if (run.conclusion === 'success') { setDeploy_({ state: 'live', sha, url: run.html_url, at: run.updated_at }); return; }
          if (run.conclusion !== 'cancelled' && run.conclusion !== 'skipped') { setDeploy_({ state: 'fail', sha, url: run.html_url }); return; }
        }
        if (Date.now() - since > 15 * 60000) { setDeploy_({ state: 'slow', sha, url: run && run.html_url }); return; }
      } catch {}
      setTimeout(tick, tries < 10 ? 6000 : 12000);
    };
    setTimeout(tick, 4000);
  }, [session]);

  // Coming back to the tab with nothing unpublished: pick up changes published elsewhere (another admin, another device).
  useEffect(() => {
    if (!session) return;
    const on = async () => {
      if (document.visibilityState !== 'visible' || !baseRef.current || store.changes(baseRef.current, draftRef.current).length) return;
      try {
        const sha = await session.api.head(session.branch);
        if (sha === baseRef.current.sha) return;
        const latest = store.normalize(await session.api.content(sha));
        if (store.changes(baseRef.current, draftRef.current).length) return;   // edited meanwhile: merge happens at publish
        setBase({ sha, ...latest }); setDraftRaw(store.clone(latest));
      } catch {}
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [session]);
  const baseRef = useRef(null), draftRef = useRef(null);
  baseRef.current = base; draftRef.current = draft;

  // On start, show the state of the latest publish.
  useEffect(() => {
    if (!session) return;
    session.api.runs(session.branch).then(({ workflow_runs: runs = [] }) => {
      const r = runs.find(x => x.conclusion !== 'cancelled' && x.conclusion !== 'skipped');
      if (!r) return;
      if (r.status !== 'completed') watchDeploy(r.head_sha, new Date(r.created_at).getTime());
      else setDeploy({ state: r.conclusion === 'success' ? 'live' : 'fail', sha: r.head_sha, url: r.html_url, at: r.updated_at });
    }).catch(() => {});
  }, [session]);

  // Store a newly picked photo; returns its path in the repository.
  const addImage = useCallback(async (prepared, stem) => {
    const name = `assets/brands/${stem}-${randomTag()}`;
    const display = `${name}.${prepared.ext}`;
    await store.pendingImages.put(display, prepared.display);
    if (prepared.ext === 'webp') await store.pendingImages.put(`${name}.png`, prepared.original);
    setImgUrls(u => ({ ...u, [display]: URL.createObjectURL(prepared.display) }));
    return display;
  }, []);

  const signOut = () => {
    const pending = base && draft && store.changes(base, draft).length;
    if (pending && !confirm(`You have ${pending} unpublished change(s). They stay saved in this browser and will be here when you sign in again. Sign out?`)) return;
    clearToken(); setTok(null); setSession(null); setBase(null); setDraftRaw(null);
  };

  if (!token) return html`<${Login} error=${bootError} onToken=${(t, remember) => { setToken(t, remember); setBootError(null); setTok(t); }} />`;
  if (bootError) return html`<div class="loading"><div style="max-width:460px;text-align:center;padding:20px">
    <h1 style="margin-bottom:10px">Could not open the dashboard</h1><p class="muted">${bootError}</p>
    <div class="row" style="justify-content:center;margin-top:16px"><button class="btn primary" onClick=${() => location.reload()}>Try again</button><button class="btn" onClick=${signOut}>Sign out</button></div></div></div>`;
  if (!session || !draft) return html`<div class="loading"><div><div class="spinner" /><div>Loading the catalogue…</div></div></div>`;

  const ctx = {
    ...session, base, draft, setDraft, toast, imgUrls, addImage, deploy, publishing, setPublishing, watchDeploy, setBase, notice, setNotice,
    imgUrl: (p) => imgUrls[p],
    pending: store.changes(base, draft),
    tintOf: (brandId) => (draft.brands.find(b => b.id === brandId) || {}).tint || '#EEF2EF',
    brandOf: (id) => draft.brands.find(b => b.id === id),
  };
  const [top, a, b] = route.parts;
  let page;
  if (!top) page = html`<${Overview} />`;
  else if (top === 'brands' && a === 'new') page = html`<${BrandEditor} key="new" />`;
  else if (top === 'brands' && a) page = html`<${BrandEditor} key=${a} id=${a} />`;
  else if (top === 'brands') page = html`<${Brands} />`;
  else if (top === 'products' && a === 'new') page = html`<${ProductEditor} key=${'new' + (route.q.brand || '')} brandId=${route.q.brand} />`;
  else if (top === 'products' && a) page = html`<${ProductEditor} key=${a} id=${a} />`;
  else if (top === 'products') page = html`<${Products} q=${route.q} />`;
  else if (top === 'home') page = html`<${HomePage} />`;
  else if (top === 'history') page = html`<${History} />`;
  else if (top === 'help') page = html`<${Help} />`;
  else page = html`<div class="empty"><h1>Page not found</h1><p><a href="#/">Back to the overview</a></p></div>`;

  return html`<${Ctx.Provider} value=${ctx}>
    <${TopBar} route=${top || ''} onSignOut=${signOut} />
    <main class="page">${page}</main>
    ${publishing && html`<${PublishDialog} onClose=${() => setPublishing(false)} />`}
    <div class="toasts" role="status" aria-live="polite">${toasts.map(t => html`<div class=${'toast ' + (t.kind || '')} key=${t.id}>${t.msg}</div>`)}</div>
  <//>`;
}

// ── Top bar ───────────────────────────────────────────────────────────────────────────────────────
function TopBar({ route, onSignOut }) {
  const { user, pending, setPublishing, deploy } = useApp();
  const [open, setOpen] = useState(false);
  const tabs = [['', 'Overview'], ['brands', 'Brands'], ['products', 'Products'], ['home', 'Home page'], ['history', 'History']];
  return html`<header class="top"><div class="top-in">
    <a class="brandmark" href="#/"><img src="../assets/logo-horizontal-white.webp" alt="Rikaz" /><span>Admin</span></a>
    <nav class="nav">${tabs.map(([k, l]) => html`<a href=${'#/' + k} class=${route === k ? 'on' : ''}>${l}</a>`)}</nav>
    <div class="top-right">
      <${DeployPill} deploy=${deploy} />
      <button class=${'btn publish' + (pending.length ? '' : ' none')} onClick=${() => setPublishing(true)} title="Publish your changes to the website">
        <span class="lbl">${pending.length ? 'Publish changes' : 'Publish'}</span>${pending.length ? html`<span class="count">${pending.length}</span>` : html`<${Icon} d=${I.check} />`}
      </button>
      <div class="menu">
        <button class="btn ghost icon" style="padding:0;border:0" onClick=${() => setOpen(!open)} aria-label="Account menu"><img class="avatar" src=${user.avatar_url} alt="" /></button>
        ${open && html`<div class="menu-pop" onClick=${() => setOpen(false)}>
          <div class="who">Signed in as <b>${user.login}</b></div>
          <a href=${SITE_URL} target="_blank" rel="noopener">View website ↗</a>
          <a href="#/help">Help</a>
          <button onClick=${onSignOut}>Sign out</button>
        </div>`}
      </div>
    </div>
  </div></header>`;
}
function DeployPill({ deploy }) {
  if (!deploy) return null;
  const t = { busy: ['busy', 'Publishing…'], live: ['live', 'Site is live'], fail: ['fail', 'Publish failed'], slow: ['busy', 'Still publishing…'] }[deploy.state];
  const href = deploy.state === 'live' ? SITE_URL : deploy.url;
  return href ? html`<a class=${'pill hide-sm ' + t[0]} href=${href} target="_blank" rel="noopener" style="text-decoration:none">${t[1]}</a>` : html`<span class=${'pill hide-sm ' + t[0]}>${t[1]}</span>`;
}

// ── Sign in ───────────────────────────────────────────────────────────────────────────────────────
function Login({ onToken, error }) {
  const [t, setT] = useState(''), [remember, setRemember] = useState(true);
  const submit = (e) => { e.preventDefault(); const v = t.trim(); if (v) onToken(v, remember); };
  return html`<div class="login">
    <div class="login-l">
      <img src="../assets/logo-horizontal-white.webp" alt="Rikaz" style="height:40px;align-self:flex-start" />
      <div><h1>Manage your brands and products</h1><p>Add products, update details and photos, and publish to rikazfoods.ly — all from here.</p></div>
      <div class="small" style="opacity:.6">Rikaz admin · signs in with GitHub</div>
      <img class="mark" src="../assets/mark-white.webp" alt="" />
    </div>
    <div class="login-r"><form class="login-box" onSubmit=${submit}>
      <h1 style="font-size:24px">Sign in</h1>
      <p class="muted" style="margin-top:6px">Paste your GitHub access key. You only need to do this once on each device.</p>
      ${error && html`<div class="notice error" style="margin:12px 0">${error}</div>`}
      <${Field} label="GitHub access key" hint="It starts with github_pat_ or ghp_">
        <input type="password" value=${t} onInput=${e => setT(e.target.value)} placeholder="github_pat_…" autocomplete="off" spellcheck="false" autofocus />
      <//>
      <label class="row small" style="margin:12px 0 16px;gap:8px"><input type="checkbox" checked=${remember} onChange=${e => setRemember(e.target.checked)} /> Keep me signed in on this device</label>
      <button class="btn primary" style="width:100%" disabled=${!t.trim()}>Sign in</button>
      <details style="margin-top:24px"><summary>How do I get an access key?</summary>
        <ol style="margin-top:10px">
          <li>Sign in to <a href="https://github.com" target="_blank" rel="noopener">github.com</a> with the account that has access to the Rikaz website.</li>
          <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Settings → Developer settings → Fine-grained tokens → Generate new token</a>.</li>
          <li>Name it “Rikaz admin”, pick an expiry (for example 1 year).</li>
          <li>Under <b>Repository access</b> choose <b>Only select repositories</b> → <b>${REPO.owner}/${REPO.name}</b>.</li>
          <li>Under <b>Permissions</b> set <b>Contents</b> to <b>Read and write</b> and <b>Actions</b> to <b>Read-only</b>.</li>
          <li>Click <b>Generate token</b>, copy it and paste it above.</li>
        </ol>
        <p class="small muted">If the repository belongs to someone else's account and it does not appear in step 4, use a <a href=${'https://github.com/settings/tokens/new?scopes=public_repo&description=Rikaz%20admin'} target="_blank" rel="noopener">classic token</a> with only the <b>public_repo</b> box ticked instead. Note that a classic token can change every public repository your account can write to, so keep it extra safe.</p>
      </details>
    </form></div>
  </div>`;
}

// ── Overview ──────────────────────────────────────────────────────────────────────────────────────
function Overview() {
  const { draft, pending, setPublishing, api, branch, user, notice, setNotice } = useApp();
  const [recent, setRecent] = useState(null);
  useEffect(() => { api.history(branch).then(c => setRecent(c.slice(0, 5))).catch(() => setRecent([])); }, []);
  const P = draft.products;
  const problems = useMemo(() => store.validate(draft), [draft]);
  const noPhoto = P.filter(p => !p.img), empty = draft.brands.filter(b => !P.some(p => p.brand === b.id));
  return html`
    <div class="page-head"><div><h1>Welcome, ${user.name ? user.name.split(' ')[0] : user.login}</h1><div class="sub">Here is your catalogue at a glance.</div></div>
      <div class="quick"><a class="btn primary" href="#/products/new"><${Icon} d=${I.plus} /> Add product</a><a class="btn" href="#/brands/new"><${Icon} d=${I.plus} /> Add brand</a><a class="btn" href=${SITE_URL} target="_blank" rel="noopener">View website <${Icon} d=${I.ext} size=${15} /></a></div></div>
    ${notice && html`<div class=${'notice ' + notice.kind} style="margin-bottom:16px"><div style="flex:1">${notice.text}${notice.notes && notice.notes.length ? html`<ul>${notice.notes.map(n => html`<li>${n}</li>`)}</ul>` : ''}</div><button class="btn ghost sm" onClick=${() => setNotice(null)}>Dismiss</button></div>`}
    <div class="grid cols-4" style="margin-bottom:16px">
      <a class="card stat" href="#/brands" style="text-decoration:none"><b>${draft.brands.length}</b><span>Brands</span></a>
      <a class="card stat" href="#/products" style="text-decoration:none"><b>${P.length}</b><span>Products</span></a>
      <a class="card stat" href="#/products?status=stock" style="text-decoration:none"><b>${P.filter(p => p.status === 'stock').length}</b><span>In stock</span></a>
      <a class="card stat" href="#/products?status=soon" style="text-decoration:none"><b>${P.filter(p => p.status === 'soon').length}</b><span>Coming soon</span></a>
    </div>
    <div class="grid cols-2">
      <div class="card">
        <h2>Unpublished changes</h2>
        ${pending.length ? html`<ul class="list">${pending.slice(0, 6).map(c => html`<li><span class="pill draft">${{ add: 'New', edit: 'Edited', remove: 'Deleted', order: 'Order' }[c.kind]}</span> ${c.label}</li>`)}</ul>
          ${pending.length > 6 && html`<p class="small muted">…and ${pending.length - 6} more</p>`}
          <button class="btn gold" style="margin-top:12px" onClick=${() => setPublishing(true)}>Review and publish</button>`
        : html`<p class="muted">Nothing waiting. Every change you make is saved here as a draft until you press <b>Publish</b>.</p>`}
      </div>
      <div class="card">
        <h2>Recent activity</h2>
        ${recent === null ? html`<p class="muted">Loading…</p>` : recent.length ? html`<ul class="list">${recent.map(c => html`<li>${c.author && html`<img class="avatar" style="width:24px;height:24px;border:0" src=${c.author.avatar_url} alt="" />`}<span>${c.commit.message.split('\n')[0]}</span><span class="when">${ago(c.commit.author.date)}</span></li>`)}</ul>
          <a href="#/history" class="small">See full history →</a>` : html`<p class="muted">No changes yet.</p>`}
      </div>
    </div>
    ${(noPhoto.length || empty.length || problems.some(p => p.level === 'error')) && html`<div class="card" style="margin-top:16px">
      <h2>Needs attention</h2>
      <ul class="list">
        ${problems.filter(p => p.level === 'error').slice(0, 8).map(p => html`<li><span class="pill fail">Fix</span> <${ProblemLink} p=${p} /></li>`)}
        ${noPhoto.map(p => html`<li><span class="pill soon">Photo</span> <a href=${'#/products/' + p.id}>${p.name}</a> <span class="muted">has no photo yet</span></li>`)}
        ${empty.map(b => html`<li><span class="pill soon">Empty</span> <a href=${'#/brands/' + b.id}>${b.name}</a> <span class="muted">has no products yet</span></li>`)}
      </ul>
    </div>`}`;
}
function ProblemLink({ p }) {
  const [type, id] = p.where.split(':');
  const href = type === 'brand' ? '#/brands/' + id : type === 'product' ? '#/products/' + id : '#/home';
  return html`<span><a href=${href}>${type === 'settings' ? 'Home page' : id}</a> — ${p.msg}</span>`;
}

// ── Brands ────────────────────────────────────────────────────────────────────────────────────────
function Brands() {
  const { draft, setDraft, base, toast } = useApp();
  const [q, setQ] = useState(''), [ordering, setOrdering] = useState(false);
  const count = (id) => draft.products.filter(p => p.brand === id).length;
  const list = draft.brands.filter(b => !q || b.name.toLowerCase().includes(q.toLowerCase()));
  const shift = (i, d) => setDraft(c => ({ ...c, brands: move(c.brands, i, i + d) }));
  return html`
    <div class="page-head"><div><h1>Brands</h1><div class="sub">${draft.brands.length} brands · shown on the website in this order</div></div>
      <div class="row">${!ordering && html`<button class="btn" onClick=${() => setOrdering(true)}>Change order</button>`}<a class="btn primary" href="#/brands/new"><${Icon} d=${I.plus} /> Add brand</a></div></div>
    ${ordering ? html`<div class="card" style="max-width:620px">
        <p class="muted">Use the arrows to move brands. This is the order on the “Our Brands” page and in the logo strip.</p>
        <ol class="sortlist">${draft.brands.map((b, i) => html`<li key=${b.id}>
          <span class="n">${i + 1}</span>
          <div class="thumb" style=${{ background: b.tint }}><${Img} path=${b.logo} /></div>
          <div class="grow"><b>${b.name}</b><span class="small muted">${count(b.id)} products</span></div>
          <button class="btn icon" disabled=${i === 0} onClick=${() => shift(i, -1)} aria-label=${'Move ' + b.name + ' up'}><${Icon} d=${I.up} /></button>
          <button class="btn icon" disabled=${i === draft.brands.length - 1} onClick=${() => shift(i, 1)} aria-label=${'Move ' + b.name + ' down'}><${Icon} d=${I.down} /></button>
        </li>`)}</ol>
        <button class="btn primary" onClick=${() => { setOrdering(false); toast('Order saved as a draft. Publish when ready.'); }}>Done</button>
      </div>`
    : html`<div class="toolbar"><div class="search"><${Icon} d=${I.search} /><input type="search" placeholder="Search brands" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search brands" /></div></div>
      <div class="bcards">
        ${list.map(b => html`<a class="bcard" href=${'#/brands/' + b.id} key=${b.id}>
          <div class="logo" style=${{ background: b.tint }}><${Img} path=${b.logo} alt=${b.name + ' logo'} /></div>
          <div class="meta"><div class="row"><h3>${b.name}</h3>${store.itemChanged(base, draft, 'brand', b.id) && html`<span class="pill draft">Draft</span>`}</div>
            <div class="small muted">${count(b.id)} products · ${(draft.settings.countries[b.country] || {}).en || b.country}</div></div>
        </a>`)}
        ${!q && html`<a class="bcard add" href="#/brands/new"><span><${Icon} d=${I.plus} /> Add a brand</span></a>`}
      </div>
      ${!list.length && html`<div class="empty">No brands match “${q}”.</div>`}`}`;
}

function useEditor(initial) {
  const [form, setForm] = useState(initial);
  const [tried, setTried] = useState(false);
  const [shownInitial, setShownInitial] = useState(initial);
  const dirty = JSON.stringify(form) !== JSON.stringify(shownInitial);
  // The stored item changed underneath the form (another tab, another admin, a merge): show the new
  // version if nothing is being edited; otherwise keep the edits and say so.
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (JSON.stringify(initial) === JSON.stringify(shownInitial)) return;
    if (!dirty) { setForm(initial); setShownInitial(initial); setStale(false); }
    else setStale(true);
  }, [JSON.stringify(initial)]);
  useEffect(() => {
    leaveGuard = dirty ? () => confirm('You have unsaved changes on this page. Leave without saving them?') : null;
    return () => { leaveGuard = null; };
  }, [dirty]);
  const upd = (path) => (v) => setForm(f => set(f, path, v));
  const reset = (v) => { setForm(v); setShownInitial(v); setStale(false); };
  return { form, setForm: reset, edit: setForm, upd, dirty, tried, setTried, stale };
}
const errorsFor = (problems, where) => Object.fromEntries(problems.filter(p => p.where === where && p.level === 'error').reverse().map(p => [p.field, p.msg]));

function BrandEditor({ id }) {
  const { draft, setDraft, base, toast, addImage, setPublishing } = useApp();
  const existing = id && draft.brands.find(b => b.id === id);
  const blank = { id: '', name: '', logo: '', cat: 'snacks', country: '', tint: '#EFEFEF', desc: { en: '', ar: '' }, story: { en: '', ar: '' } };
  const initial = useMemo(() => existing ? store.clone(existing) : blank, [id, JSON.stringify(existing || null)]);
  const { form, setForm, edit, upd, dirty, tried, setTried, stale } = useEditor(initial);
  const [addingCountry, setAddingCountry] = useState(false);
  if (id && !existing) return html`<div class="empty"><h1>Brand not found</h1><p>It may have been deleted. <a href="#/brands">Back to brands</a></p></div>`;

  const isNew = !existing;
  const candidate = cleanBrand({ ...form, id: isNew ? newBrandId(form.name, draft.brands, draft.settings.retired.brands) : form.id });
  const problems = store.validate({ ...draft, brands: isNew ? [...draft.brands, candidate] : draft.brands.map(b => b.id === id ? candidate : b) });
  const errs = errorsFor(problems, 'brand:' + candidate.id);
  const shown = tried ? errs : {};
  const products = draft.products.filter(p => p.brand === id);
  const countries = draft.settings.countries;

  const save = () => {
    setTried(true);
    if (Object.keys(errs).length) { toast('Please fix the highlighted fields.', 'error'); return; }
    setDraft(c => ({ ...c, brands: isNew ? [...c.brands, candidate] : c.brands.map(b => b.id === id ? candidate : b) }));
    leaveGuard = null;
    toast(isNew ? `“${candidate.name}” added as a draft. Publish when ready.` : 'Saved as a draft. Publish when ready.');
    if (isNew) go('#/brands/' + candidate.id); else setForm(store.clone(candidate));
  };
  const remove = () => {
    if (products.length) return;
    if (!confirm(`Delete the brand “${existing.name}”? Its page will be removed from the website when you publish.`)) return;
    leaveGuard = null;
    setDraft(c => ({ ...c, brands: c.brands.filter(b => b.id !== id) }));
    toast(`“${existing.name}” deleted (draft). Publish to remove it from the website.`);
    go('#/brands');
  };
  const shiftProduct = (pid, d) => setDraft(c => {
    const own = c.products.filter(p => p.brand === id).map(p => p.id), i = own.indexOf(pid), other = own[i + d];
    if (other == null) return c;
    const a = c.products.findIndex(p => p.id === pid), b = c.products.findIndex(p => p.id === other);
    const list = [...c.products]; [list[a], list[b]] = [list[b], list[a]];
    return { ...c, products: list };
  });

  return html`
    <a class="back" href="#/brands"><${Icon} d=${I.left} size=${16} /> All brands</a>
    <div class="page-head"><div><h1>${isNew ? 'New brand' : existing.name}</h1>
      <div class="sub">${isNew ? (form.name ? html`Web address: <span class="mono">rikazfoods.ly/brand/${candidate.id}/</span>` : 'Fill in the details below, then save.') : html`<a href=${siteLink('brand/' + id + '/')} target="_blank" rel="noopener">rikazfoods.ly/brand/${id}/ ↗</a> ${store.itemChanged(base, draft, 'brand', id) && html`<span class="pill draft">Unpublished changes</span>`}`}</div></div></div>
    ${stale && html`<div class="notice warn" style="margin-bottom:16px"><div style="flex:1">This brand was changed elsewhere (another tab or another admin) while you were editing. Saving will replace that version with what you see here.</div><button class="btn sm" onClick=${() => setForm(initial)}>Load the new version</button></div>`}
    <div class="editor">
      <div class="editor-side">
        <div class="card">
          <div class="section-title">Logo</div>
          <${ImageDrop} kind="logo" path=${form.logo} tint=${form.tint} label="Add the logo" onPicked=${async (img) => upd('logo')(await addImage(img, (slugify(form.name) || 'brand') + '-logo'))} />
          ${shown.logo && html`<div class="err">${shown.logo}</div>`}
          <div class="section-title" style="margin-top:20px">Background colour</div>
          <div class="hint" style="margin-bottom:8px">The soft colour behind this brand's logo and products.</div>
          <div class="row" style="align-items:flex-start">
            <input type="color" value=${/^#[0-9a-f]{6}$/i.test(form.tint) ? form.tint : '#EFEFEF'} onInput=${e => upd('tint')(e.target.value.toUpperCase())} aria-label="Pick a colour" />
            <div class="swatches" style="flex:1">${TINTS.map(c => html`<button type="button" class=${'swatch' + (form.tint === c ? ' on' : '')} style=${{ background: c }} onClick=${() => upd('tint')(c)} aria-label=${'Use ' + c} />`)}</div>
          </div>
          ${shown.tint && html`<div class="err">${shown.tint}</div>`}
        </div>
        ${!isNew && html`<div class="card">
          <div class="row" style="margin-bottom:10px"><div class="section-title" style="margin:0">Products (${products.length})</div><span class="spacer" /><a class="btn sm" href=${'#/products/new?brand=' + id}><${Icon} d=${I.plus} size=${15} /> Add</a></div>
          ${products.length ? html`<ol class="sortlist">${products.map((p, i) => html`<li key=${p.id} style="padding:6px 8px">
            <${Thumb} product=${p} tint=${form.tint} size=${40} />
            <a class="grow" href=${'#/products/' + p.id} style="text-decoration:none;color:inherit"><b class="small">${p.name}</b></a>
            <button class="btn icon" disabled=${i === 0} onClick=${() => shiftProduct(p.id, -1)} aria-label="Move up"><${Icon} d=${I.up} size=${15} /></button>
            <button class="btn icon" disabled=${i === products.length - 1} onClick=${() => shiftProduct(p.id, 1)} aria-label="Move down"><${Icon} d=${I.down} size=${15} /></button>
          </li>`)}</ol><div class="hint">The arrows set the order on the brand's page.</div>` : html`<p class="muted small">No products yet.</p>`}
        </div>`}
      </div>
      <div class="card" style="padding:0">
        <div class="form-sec">
          <div class="section-title">Basics</div>
          <div class="form-grid">
            <${Field} label="Brand name" error=${shown.name} style="grid-column:span 1"><${Text} value=${form.name} onInput=${upd('name')} placeholder="e.g. Kemo" /><//>
            <${Field} label="Category" error=${shown.cat}>
              <select value=${form.cat} onChange=${e => upd('cat')(e.target.value)}>${Object.entries(draft.settings.categories).map(([k, v]) => html`<option value=${k}>${v.en}</option>`)}</select>
            <//>
            <${Field} label="Country of origin" error=${shown.country}>
              <select value=${form.country} onChange=${e => e.target.value === '+' ? (setAddingCountry(true), e.target.value = form.country) : upd('country')(e.target.value)}>
                <option value="" disabled>Choose…</option>
                ${Object.entries(countries).sort((a, b) => a[1].en.localeCompare(b[1].en)).map(([k, v]) => html`<option value=${k}>${v.en}</option>`)}
                <option value="+">+ Add another country…</option>
              </select>
            <//>
          </div>
        </div>
        <div class="form-sec">
          <div class="section-title">Short description</div>
          <p class="hint" style="margin-top:-8px">One line, shown on the brand card.</p>
          <div class="pair">
            <${Field} label="English" lang="EN" error=${shown['desc.en']}><${Text} value=${form.desc.en} onInput=${upd('desc.en')} placeholder="Swiss rolls, sponge layer cakes and brownies." /><//>
            <${Field} label="Arabic" lang="AR" error=${shown['desc.ar']}><${Text} ar value=${form.desc.ar} onInput=${upd('desc.ar')} /><//>
          </div>
        </div>
        <div class="form-sec">
          <div class="section-title">Story</div>
          <p class="hint" style="margin-top:-8px">A short paragraph about the brand, shown at the top of its page.</p>
          <div class="pair">
            <${Field} label="English" lang="EN" error=${shown['story.en']}><${Text} multiline rows="6" value=${form.story.en} onInput=${upd('story.en')} /><//>
            <${Field} label="Arabic" lang="AR" error=${shown['story.ar']}><${Text} multiline rows="6" ar value=${form.story.ar} onInput=${upd('story.ar')} /><//>
          </div>
        </div>
        ${!isNew && html`<div class="form-sec"><div class="section-title">Delete</div>
          ${products.length ? html`<p class="muted small">To delete this brand, first delete or move its ${products.length} product(s).</p>` : html`<button class="btn danger" onClick=${remove}><${Icon} d=${I.trash} size=${16} /> Delete this brand</button>`}
        </div>`}
      </div>
    </div>
    <${SaveBar} dirty=${dirty} isNew=${isNew} onSave=${save} onCancel=${() => isNew ? (leaveGuard = null, go('#/brands')) : setForm(initial)} setPublishing=${setPublishing} />
    ${addingCountry && html`<${AddCountry} onClose=${() => setAddingCountry(false)} onAdded=${(code) => { upd('country')(code); setAddingCountry(false); }} />`}`;
}

function AddCountry({ onClose, onAdded }) {
  const { draft, setDraft } = useApp();
  const [c, setC] = useState({ code: '', en: '', ar: '' }), [err, setErr] = useState(null);
  const add = () => {
    const code = c.code.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return setErr('Use the 2-letter country code, e.g. FR for France.');
    if (draft.settings.countries[code]) return onAdded(code);
    if (!c.en.trim() || !c.ar.trim()) return setErr('Enter the country name in English and Arabic.');
    setDraft(d => ({ ...d, settings: { ...d.settings, countries: { ...d.settings.countries, [code]: { en: c.en.trim(), ar: c.ar.trim() } } } }));
    onAdded(code);
  };
  return html`<${Modal} title="Add a country" onClose=${onClose} footer=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${add}>Add country</button>`}>
    ${err && html`<div class="notice error" style="margin-bottom:12px">${err}</div>`}
    <div class="grid" style="grid-template-columns:110px 1fr 1fr">
      <${Field} label="Code" hint="2 letters"><${Text} value=${c.code} onInput=${v => setC({ ...c, code: v })} maxlength="2" placeholder="FR" /><//>
      <${Field} label="English name"><${Text} value=${c.en} onInput=${v => setC({ ...c, en: v })} placeholder="France" /><//>
      <${Field} label="Arabic name"><${Text} ar value=${c.ar} onInput=${v => setC({ ...c, ar: v })} placeholder="فرنسا" /><//>
    </div>
  <//>`;
}

function SaveBar({ dirty, isNew, onSave, onCancel, extra }) {
  const { pending, setPublishing } = useApp();
  if (!dirty && !isNew && !pending.length) return null;
  return html`<div class="savebar"><div class="savebar-in">
    ${dirty || isNew ? html`<span class="small muted hide-sm">${isNew ? 'Not saved yet' : 'You have unsaved changes'}</span>` : pending.length ? html`<span class="small muted hide-sm">Saved as a draft · ${pending.length} change(s) waiting to be published</span>` : html`<span class="small muted hide-sm">Everything is published</span>`}
    <span class="spacer" />${extra}
    ${(dirty || isNew) && html`<button class="btn" onClick=${onCancel}>${isNew ? 'Cancel' : 'Undo edits'}</button>`}
    ${dirty || isNew ? html`<button class="btn primary" onClick=${onSave}><${Icon} d=${I.check} /> ${isNew ? 'Save' : 'Save changes'}</button>`
      : pending.length ? html`<button class="btn gold" onClick=${() => setPublishing(true)}>Publish ${pending.length} change(s)</button>` : ''}
  </div></div>`;
}

// ── Products ──────────────────────────────────────────────────────────────────────────────────────
function Products({ q }) {
  const { draft, base, tintOf, brandOf } = useApp();
  const [text, setText] = useState(q.q || '');
  const brand = q.brand || '', status = q.status || '';
  const setQ = (k, v) => { const n = { ...q, [k]: v }; Object.keys(n).forEach(x => !n[x] && delete n[x]); history.replaceState(null, '', '#/products' + (Object.keys(n).length ? '?' + new URLSearchParams(n) : '')); dispatchEvent(new HashChangeEvent('hashchange')); };
  const t = text.trim().toLowerCase();
  const list = draft.products.filter(p => (!brand || p.brand === brand) && (!status || (status === 'nophoto' ? !p.img : p.status === status))
    && (!t || [p.name, p.nameAr, p.sku, p.id, (brandOf(p.brand) || {}).name].some(s => s && s.toLowerCase().includes(t))));
  return html`
    <div class="page-head"><div><h1>Products</h1><div class="sub">${draft.products.length} products across ${draft.brands.length} brands</div></div>
      <a class="btn primary" href=${'#/products/new' + (brand ? '?brand=' + brand : '')}><${Icon} d=${I.plus} /> Add product</a></div>
    <div class="toolbar">
      <div class="search"><${Icon} d=${I.search} /><input type="search" placeholder="Search by name, SKU or brand" value=${text} onInput=${e => setText(e.target.value)} aria-label="Search products" /></div>
      <select style="width:auto;min-width:170px" value=${brand} onChange=${e => setQ('brand', e.target.value)} aria-label="Filter by brand"><option value="">All brands</option>${draft.brands.map(b => html`<option value=${b.id}>${b.name}</option>`)}</select>
      <select style="width:auto;min-width:160px" value=${status} onChange=${e => setQ('status', e.target.value)} aria-label="Filter by status"><option value="">Any status</option><option value="stock">In stock</option><option value="soon">Coming soon</option><option value="nophoto">Missing photo</option></select>
      <span class="small muted">${list.length} shown</span>
    </div>
    ${list.length ? html`<table class="table">
      <thead><tr><th style="width:76px"></th><th>Product</th><th>Brand</th><th>SKU</th><th>Status</th></tr></thead>
      <tbody>${list.map(p => html`<tr key=${p.id} onClick=${() => go('#/products/' + p.id)}>
        <td class="c-thumb"><${Thumb} product=${p} tint=${tintOf(p.brand)} /></td>
        <td class="pname"><b><a href=${'#/products/' + p.id} style="color:inherit;text-decoration:none">${p.name}</a> ${store.itemChanged(base, draft, 'product', p.id) && html`<span class="pill draft">Draft</span>`}</b><span lang="ar" dir="rtl">${p.nameAr}</span>${p.size ? html`<span> · ${p.size}</span>` : ''}</td>
        <td class="c-brand">${(brandOf(p.brand) || {}).name}</td>
        <td class="c-sku mono">${p.sku}</td>
        <td><span class=${'pill ' + p.status}>${STATUSES[p.status] || p.status}</span></td>
      </tr>`)}</tbody></table>`
    : html`<div class="card empty">No products match these filters. <button class="btn sm" onClick=${() => { setText(''); go('#/products'); }}>Clear filters</button></div>`}`;
}

function ProductEditor({ id, brandId }) {
  const { draft, setDraft, base, toast, addImage, tintOf } = useApp();
  const existing = id && draft.products.find(p => p.id === id);
  const firstBrand = (brandId && draft.brands.some(b => b.id === brandId)) ? brandId : '';
  const blank = { id: '', brand: firstBrand, img: null, name: '', nameAr: '', size: '', sku: '', status: 'stock', shelf: '', pack: { en: '', ar: '' }, caseQty: '', desc: { en: '', ar: '' } };
  const initial = useMemo(() => existing ? { ...store.clone(existing), img: existing.img || null, size: existing.size || '', shelf: existing.shelf || '', caseQty: existing.caseQty || '' } : blank, [id, JSON.stringify(existing || null)]);
  const { form, setForm, edit, upd, dirty, tried, setTried, stale } = useEditor(initial);
  if (id && !existing) return html`<div class="empty"><h1>Product not found</h1><p>It may have been deleted. <a href="#/products">Back to products</a></p></div>`;

  const isNew = !existing;
  const newId = isNew && form.brand ? nextProductId(form.brand, draft.products, draft.settings.retired.products) : null;
  const candidate = cleanProduct({ ...form, id: isNew ? (newId || 'new1') : form.id });
  const others = draft.products.filter(p => p.id !== candidate.id);
  const problems = store.validate({ ...draft, products: isNew ? [...draft.products, candidate] : draft.products.map(p => p.id === id ? candidate : p) });
  const errs = errorsFor(problems, 'product:' + candidate.id);
  if (!form.brand) errs.brand = 'Choose a brand.';
  const warns = problems.filter(p => p.where === 'product:' + candidate.id && p.level === 'warning' && p.field === 'sku');
  const shown = tried ? errs : {};
  const featured = !isNew && draft.settings.heroProducts.includes(id);
  const tint = tintOf(form.brand);
  const similar = draft.products.filter(p => p.brand === form.brand && p.id !== id);

  const save = () => {
    setTried(true);
    if (Object.keys(errs).length) { toast('Please fix the highlighted fields.', 'error'); return; }
    setDraft(c => {
      if (!isNew) return { ...c, products: c.products.map(p => p.id === id ? candidate : p) };
      const after = c.products.map(p => p.brand).lastIndexOf(candidate.brand);   // keep a brand's products together
      const list = [...c.products]; list.splice(after < 0 ? list.length : after + 1, 0, candidate);
      return { ...c, products: list };
    });
    leaveGuard = null;
    toast(isNew ? `“${candidate.name}” added as a draft. Publish when ready.` : 'Saved as a draft. Publish when ready.');
    if (isNew) go('#/products/' + candidate.id); else setForm({ ...initial, ...candidate, img: candidate.img || null, size: candidate.size || '', shelf: candidate.shelf || '', caseQty: candidate.caseQty || '' });
  };
  const remove = () => {
    if (featured) return;
    if (!confirm(`Delete “${existing.name}”? Its page will be removed from the website when you publish.`)) return;
    leaveGuard = null;
    setDraft(c => ({ ...c, products: c.products.filter(p => p.id !== id) }));
    toast(`“${existing.name}” deleted (draft). Publish to remove it from the website.`);
    go('#/products?brand=' + existing.brand);
  };
  // Copy the shared details (pack, case size, shelf life…) from another product of the same brand.
  const copyFrom = (pid) => {
    const s = draft.products.find(p => p.id === pid); if (!s) return;
    edit(f => ({ ...f, size: s.size || '', shelf: s.shelf || '', caseQty: s.caseQty || '', pack: { ...s.pack }, status: s.status }));
    toast(`Copied size, packaging, case and shelf life from “${s.name}”.`);
  };

  return html`
    <a class="back" href=${'#/products' + (form.brand ? '?brand=' + form.brand : '')}><${Icon} d=${I.left} size=${16} /> Products</a>
    <div class="page-head"><div><h1>${isNew ? 'New product' : existing.name}</h1>
      <div class="sub">${isNew ? (newId ? html`Web address: <span class="mono">rikazfoods.ly/product/${newId}/</span>` : 'Start by choosing the brand.') : html`<a href=${siteLink('product/' + id + '/')} target="_blank" rel="noopener">rikazfoods.ly/product/${id}/ ↗</a> ${store.itemChanged(base, draft, 'product', id) && html`<span class="pill draft">Unpublished changes</span>`}`}</div></div></div>
    ${stale && html`<div class="notice warn" style="margin-bottom:16px"><div style="flex:1">This product was changed elsewhere (another tab or another admin) while you were editing. Saving will replace that version with what you see here.</div><button class="btn sm" onClick=${() => setForm(initial)}>Load the new version</button></div>`}
    <div class="editor">
      <div class="editor-side">
        <div class="card">
          <div class="section-title">Photo</div>
          <${ImageDrop} kind="product" path=${form.img} tint=${tint} onPicked=${async (img) => upd('img')(await addImage(img, (isNew ? newId || 'product' : id)))} />
          ${form.img && html`<button class="btn ghost sm" style="margin-top:6px" onClick=${() => upd('img')(null)}>Remove photo</button>`}
        </div>
        ${featured && html`<div class="notice info"><div>This product is featured on the <a href="#/home">home page</a>.</div></div>`}
      </div>
      <div class="card" style="padding:0">
        <div class="form-sec">
          <div class="section-title">Basics</div>
          <div class="form-grid">
            <${Field} label="Brand" error=${shown.brand}>
              <select value=${form.brand} onChange=${e => upd('brand')(e.target.value)}><option value="" disabled>Choose a brand…</option>${draft.brands.map(b => html`<option value=${b.id}>${b.name}</option>`)}</select>
            <//>
            <${Field} label="Status" error=${shown.status}>
              <select value=${form.status} onChange=${e => upd('status')(e.target.value)}>${Object.entries(STATUSES).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select>
            <//>
            <${Field} label="SKU" error=${shown.sku} hint=${warns.length ? html`<span style="color:var(--amber)">${warns[0].msg}</span>` : 'Your product code, e.g. KEM-0101'}><${Text} value=${form.sku} onInput=${upd('sku')} class="mono" /><//>
          </div>
          <div class="pair" style="margin-top:16px">
            <${Field} label="Product name" lang="EN" error=${shown.name}><${Text} value=${form.name} onInput=${upd('name')} placeholder="Riolet Swiss Roll — Cocoa" /><//>
            <${Field} label="Product name" lang="AR" error=${shown.nameAr}><${Text} ar value=${form.nameAr} onInput=${upd('nameAr')} /><//>
          </div>
        </div>
        <div class="form-sec">
          <div class="row" style="margin-bottom:14px"><div class="section-title" style="margin:0">Pack details</div><span class="spacer" />
            ${similar.length > 0 && html`<select style="width:auto;min-height:34px;padding:4px 30px 4px 10px;font-size:13px" value="" onChange=${e => copyFrom(e.target.value)} aria-label="Copy details from another product"><option value="">Copy from another product…</option>${similar.map(p => html`<option value=${p.id}>${p.name}</option>`)}</select>`}
          </div>
          <div class="form-grid">
            <${Field} label="Size" optional hint="e.g. 250 ml, 1 kg, 40 g"><${Text} value=${form.size} onInput=${upd('size')} /><//>
            <${Field} label="Case quantity" optional hint="e.g. 24 × 250 ml"><${Text} value=${form.caseQty} onInput=${upd('caseQty')} /><//>
            <${Field} label="Shelf life" optional hint="e.g. 12 months"><${Text} value=${form.shelf} onInput=${upd('shelf')} /><//>
          </div>
          <p class="hint" style="margin-top:10px">Write sizes in English (kg, g, ml, L, months) — the Arabic site translates the units automatically. Leave a box empty to show “On request”.</p>
          <div class="pair" style="margin-top:16px">
            <${Field} label="Packaging" lang="EN" error=${shown['pack.en']} hint="e.g. Can, Pillow bag, Gift box"><${Text} value=${form.pack.en} onInput=${upd('pack.en')} /><//>
            <${Field} label="Packaging" lang="AR" error=${shown['pack.ar']}><${Text} ar value=${form.pack.ar} onInput=${upd('pack.ar')} /><//>
          </div>
        </div>
        <div class="form-sec">
          <div class="section-title">Description</div>
          <div class="pair">
            <${Field} label="English" lang="EN" error=${shown['desc.en']}><${Text} multiline rows="4" value=${form.desc.en} onInput=${upd('desc.en')} /><//>
            <${Field} label="Arabic" lang="AR" error=${shown['desc.ar']}><${Text} multiline rows="4" ar value=${form.desc.ar} onInput=${upd('desc.ar')} /><//>
          </div>
        </div>
        ${!isNew && html`<div class="form-sec"><div class="section-title">Delete</div>
          ${featured ? html`<p class="muted small">This product is featured on the home page. Replace it on the <a href="#/home">Home page</a> screen first, then you can delete it.</p>`
            : html`<button class="btn danger" onClick=${remove}><${Icon} d=${I.trash} size=${16} /> Delete this product</button>`}
        </div>`}
      </div>
    </div>
    <${SaveBar} dirty=${dirty} isNew=${isNew} onSave=${save} onCancel=${() => isNew ? (leaveGuard = null, go('#/products')) : setForm(initial)} />`;
}

// ── Home page (featured products) ─────────────────────────────────────────────────────────────────
function HomePage() {
  const { draft, setDraft, tintOf, brandOf } = useApp();
  const [picking, setPicking] = useState(null);   // slot index
  const ids = draft.settings.heroProducts;
  const setIds = (next) => setDraft(c => ({ ...c, settings: { ...c.settings, heroProducts: next } }));
  const errors = store.validate(draft).filter(p => p.where === 'settings' && p.field === 'heroProducts');
  return html`
    <div class="page-head"><div><h1>Home page</h1><div class="sub">The ${HERO_SLOTS} products in the large display at the top of the home page.</div></div>
      <a class="btn" href=${SITE_URL} target="_blank" rel="noopener">See it on the website <${Icon} d=${I.ext} size=${15} /></a></div>
    ${errors.length > 0 && html`<div class="notice error" style="margin-bottom:16px"><div>${errors.map(e => html`<div>${e.msg}</div>`)}</div></div>`}
    <div class="slots">${Array.from({ length: HERO_SLOTS }, (_, i) => {
      const p = draft.products.find(x => x.id === ids[i]);
      return html`<div class=${'slot' + (i === 0 ? ' main' : '')} key=${i}>
        <div class="pic" style=${{ background: p ? tintOf(p.brand) : 'var(--bg)' }}>${p && p.img ? html`<${Img} path=${p.img} />` : html`<span class="muted small">Empty</span>`}</div>
        <div class="info"><div class="tag">${i === 0 ? 'Position 1 · Main' : 'Position ' + (i + 1)}</div><b>${p ? p.name : '—'}</b><span class="small muted">${p ? (brandOf(p.brand) || {}).name : ''}</span></div>
        <div class="acts">
          <button class="btn sm" style="flex:1" onClick=${() => setPicking(i)}>Change</button>
          <button class="btn icon sm" disabled=${i === 0} onClick=${() => setIds(move(ids, i, i - 1))} aria-label="Move earlier"><${Icon} d=${I.left} size=${15} /></button>
          <button class="btn icon sm" disabled=${i === HERO_SLOTS - 1} onClick=${() => setIds(move(ids, i, i + 1))} aria-label="Move later"><${Icon} d=${I.right} size=${15} /></button>
        </div>
      </div>`;
    })}</div>
    <p class="hint" style="margin-top:14px">Position 1 is the biggest picture and loads first. Products need a photo to be featured. Changes are saved as a draft — press Publish to put them live.</p>
    ${picking !== null && html`<${ProductPicker} exclude=${ids.filter((_, i) => i !== picking)} onClose=${() => setPicking(null)} onPick=${(pid) => { const n = [...ids]; n[picking] = pid; setIds(n); setPicking(null); }} />`}`;
}
function ProductPicker({ exclude, onPick, onClose }) {
  const { draft, tintOf, brandOf } = useApp();
  const [q, setQ] = useState('');
  const t = q.toLowerCase();
  const list = draft.products.filter(p => p.img && !exclude.includes(p.id) && (!t || [p.name, (brandOf(p.brand) || {}).name].some(s => s.toLowerCase().includes(t))));
  return html`<${Modal} title="Choose a product" onClose=${onClose} wide>
    <div class="search" style="max-width:none;margin-bottom:14px"><${Icon} d=${I.search} /><input type="search" placeholder="Search products" value=${q} onInput=${e => setQ(e.target.value)} autofocus /></div>
    <div class="picker">${list.map(p => html`<button key=${p.id} onClick=${() => onPick(p.id)}>
      <div class="pic" style=${{ background: tintOf(p.brand) }}><${Img} path=${p.img} /></div>
      <small><b>${p.name}</b><br /><span class="muted">${(brandOf(p.brand) || {}).name}</span></small>
    </button>`)}</div>
    ${!list.length && html`<div class="empty">No products with photos match.</div>`}
  <//>`;
}

// ── Publish ───────────────────────────────────────────────────────────────────────────────────────
function PublishDialog({ onClose }) {
  const app = useApp();
  const { api, branch, base, draft, setDraft, setBase, pending, toast, watchDeploy } = app;
  const [step, setStep] = useState('review');   // review | saving | done | error
  const [error, setError] = useState(null), [notes, setNotes] = useState([]);
  const problems = store.validate(draft), errors = problems.filter(p => p.level === 'error');

  const publish = async () => {
    setStep('saving'); setError(null);
    try {
      let attempt = 0, notesAll = [];
      while (true) {
        attempt++;
        const head = await api.head(branch);
        let target = draft, ref = base;
        if (head !== base.sha) {
          const latest = store.normalize(await api.content(head));
          const m = store.merge(base, draft, latest);
          target = m.content; ref = { sha: head, ...latest }; notesAll = m.notes;
          const errs = store.validate(target).filter(p => p.level === 'error');
          if (errs.length) {   // someone else's change conflicts with ours: show the merged result for fixing
            setBase({ sha: head, ...latest }); setDraft(target);
            throw new Error(`The catalogue was changed by someone else while you were editing, and some of your changes no longer fit: ${errs.map(e => e.msg).join(' ')} Fix these, then publish again.`);
          }
        }
        target = store.retire(ref, target);
        const list = store.changes(ref, target);
        if (!list.length) { setBase({ sha: head, ...target }); setDraft(store.clone(target)); setStep('done'); setNotes(['Nothing to publish — the website already has these changes.']); return; }
        const used = store.referencedImages(target), keys = await store.pendingImages.keys();
        const files = [
          { path: 'content/brands.json', text: store.fileText(target.brands) },
          { path: 'content/products.json', text: store.fileText(target.products) },
          { path: 'content/settings.json', text: store.fileText(target.settings) },
        ];
        const uploads = keys.filter(k => used.has(k)), known = store.referencedImages(ref);
        for (const k of uploads) files.push({ path: k, base64: await blobToB64(await store.pendingImages.get(k)) });
        // A new photo whose file was lost from this browser (e.g. browser data cleared) must be added again.
        const lost = [];
        for (const p of used) if (!uploads.includes(p) && !known.has(p) && !(await api.exists(p, ref.sha))) lost.push(p);
        if (lost.length) {
          const who = [...target.products.filter(p => lost.includes(p.img)).map(p => p.name), ...target.brands.filter(b => lost.includes(b.logo)).map(b => b.name + ' (logo)')];
          throw new Error(`These photos are no longer stored in this browser, please add them again: ${[...new Set(who)].join(', ')}.`);
        }
        try {
          const commit = await api.commit({ branch, parentSha: ref.sha, files, message: store.commitMessage(list) });
          for (const k of uploads) store.pendingImages.del(k).catch(() => {});   // other tabs may still need the rest
          setBase({ sha: commit.sha, ...target }); setDraft(store.clone(target));
          setNotes(notesAll); setStep('done');
          watchDeploy(commit.sha);
          return;
        } catch (e) {
          if (e.status === 409 && attempt < 4) { await new Promise(r => setTimeout(r, 1500 * attempt)); continue; }   // branch moved during the save: merge again and retry
          throw e;
        }
      }
    } catch (e) { setError(explain(e)); setStep('error'); }
  };
  const discard = () => {
    if (!confirm(`Throw away all ${pending.length} unpublished change(s)? This cannot be undone.`)) return;
    setDraft(store.clone({ brands: base.brands, products: base.products, settings: base.settings }));
    store.pendingImages.clear().catch(() => {});
    toast('Unpublished changes discarded.'); onClose();
  };

  if (step === 'done') return html`<${Modal} title="Published" onClose=${onClose} footer=${html`<button class="btn primary" onClick=${onClose}>Done</button>`}>
    <${DeploySteps} />
    ${notes.length > 0 && html`<div class="notice info" style="margin-top:12px"><div>${notes.map(n => html`<div>${n}</div>`)}</div></div>`}
    <p class="muted small" style="margin-top:12px">You can close this window and keep working — the status in the top bar shows when the site is live.</p>
  <//>`;
  return html`<${Modal} title=${pending.length ? `Publish ${pending.length} change${pending.length > 1 ? 's' : ''}` : 'Publish'} onClose=${step === 'saving' ? null : onClose}
    footer=${step === 'saving' ? html`<span class="muted">Saving to GitHub…</span>` : html`
      ${pending.length > 0 && html`<button class="btn danger" style="margin-inline-end:auto" onClick=${discard}>Discard all</button>`}
      <button class="btn" onClick=${onClose}>${pending.length ? 'Keep editing' : 'Close'}</button>
      ${pending.length > 0 && html`<button class="btn gold" disabled=${errors.length > 0} onClick=${publish}>Publish to website</button>`}`}>
    ${step === 'error' && html`<div class="notice error" style="margin-bottom:14px">${error}</div>`}
    ${!pending.length ? html`<p class="muted">There are no unpublished changes. Everything you see here is already on the website.</p>` : html`
      ${errors.length > 0 && html`<div class="notice error" style="margin-bottom:14px"><div><b>Fix these first:</b><ul>${errors.map(p => html`<li onClick=${onClose}><${ProblemLink} p=${p} /></li>`)}</ul></div></div>`}
      <ul class="list">${pending.map(c => html`<li><span class="pill draft">${{ add: 'New', edit: 'Edited', remove: 'Deleted', order: 'Order' }[c.kind]}</span> ${c.label}</li>`)}</ul>
      <p class="muted small" style="margin-top:12px">Publishing saves these changes on GitHub and rebuilds the website. It usually takes 3–5 minutes for everything to appear. Every publish can be undone from History.</p>`}
    ${step === 'saving' && html`<ul class="steps" style="margin-top:12px"><li class="now"><i />Saving your changes</li></ul>`}
  <//>`;
}
function DeploySteps() {
  const { deploy } = useApp();
  const s = deploy ? deploy.state : 'busy';
  const cls = (i) => s === 'live' ? 'done' : s === 'fail' ? (i < 1 ? 'done' : 'bad') : (i < 1 ? 'done' : i === 1 ? 'now' : '');
  return html`<ul class="steps">
    <li class=${cls(0)}><i>✓</i>Changes saved on GitHub</li>
    <li class=${cls(1)}><i>${s === 'fail' ? '!' : s === 'live' ? '✓' : ''}</i>${s === 'fail' ? 'Building the website failed — the website still shows the previous version' : 'Building the website (about 3–5 minutes)'}</li>
    <li class=${cls(2)}><i>${s === 'live' ? '✓' : ''}</i>${s === 'live' ? html`Live on <a href=${SITE_URL} target="_blank" rel="noopener">rikazfoods.ly</a>` : 'Live on rikazfoods.ly'}</li>
  </ul>
  ${s === 'fail' && deploy.url && html`<p class="small"><a href=${deploy.url} target="_blank" rel="noopener">See what went wrong on GitHub ↗</a> — your changes are saved; ask your developer to take a look.</p>`}
  ${s === 'slow' && html`<p class="small muted">This is taking longer than usual. <a href=${deploy.url || '#'} target="_blank" rel="noopener">Check progress on GitHub ↗</a></p>`}`;
}

// ── History ───────────────────────────────────────────────────────────────────────────────────────
function History() {
  const { api, branch, draft, setDraft, toast } = useApp();
  const [items, setItems] = useState(null), [page, setPage] = useState(1), [more, setMore] = useState(false), [busy, setBusy] = useState(null), [err, setErr] = useState(null);
  useEffect(() => {
    api.history(branch, page).then(c => { setItems(x => [...(page === 1 ? [] : x || []), ...c]); setMore(c.length === 25); }).catch(e => setErr(explain(e)));
  }, [page]);

  // Undo = put every item that commit changed back the way it was before, as a draft to review and publish.
  const undo = async (c) => {
    if (!c.parents.length) return;
    if (!confirm('Undo this change? The affected brands and products go back to how they were before it. You can review the result before publishing.')) return;
    setBusy(c.sha);
    try {
      const [before, after] = await Promise.all([api.content(c.parents[0].sha), api.content(c.sha)]).then(r => r.map(store.normalize));
      let next = store.clone(draft), count = 0;
      const notes = [];
      for (const k of ['brands', 'products']) {
        let here = 0;
        const b = new Map(before[k].map(x => [x.id, x])), a = new Map(after[k].map(x => [x.id, x]));
        for (const id of new Set([...b.keys(), ...a.keys()])) {
          if (store.same(b.get(id), a.get(id))) continue;
          const now = next[k].find(x => x.id === id);
          if (a.has(id) && now && !store.same(now, a.get(id))) notes.push(`“${now.name}” was changed again later; it was set back anyway.`);
          if (!b.has(id)) next[k] = next[k].filter(x => x.id !== id);                       // was added → remove
          else if (next[k].some(x => x.id === id)) next[k] = next[k].map(x => x.id === id ? b.get(id) : x);
          else { const i = before[k].findIndex(x => x.id === id); next[k].splice(Math.min(i, next[k].length), 0, b.get(id)); }   // was deleted → restore
          count++; here++;
        }
        const order = (list) => list.map(x => x.id).join();
        if (order(before[k]) !== order(after[k]) && here === 0) { next[k] = [...before[k].filter(x => next[k].some(y => y.id === x.id)).map(x => next[k].find(y => y.id === x.id)), ...next[k].filter(x => !before[k].some(y => y.id === x.id))]; count++; }
      }
      for (const key of ['heroProducts', 'countries', 'categories']) if (!store.same(before.settings[key], after.settings[key])) {
        if (!store.same(next.settings[key], after.settings[key])) notes.push(key === 'heroProducts' ? 'The home page products were changed again later; they were set back anyway.' : `The ${key} list was changed again later; it was set back anyway.`);
        next.settings = { ...next.settings, [key]: before.settings[key] }; count++;
      }
      if (!count) { toast('That change has nothing to undo.'); return; }
      setDraft(next);
      toast(`Undo prepared as a draft (${count} item${count > 1 ? 's' : ''}). Review it, then press Publish.`);
      if (notes.length) setTimeout(() => toast(notes.join(' ')), 400);
    } catch (e) { toast(explain(e), 'error'); } finally { setBusy(null); }
  };

  return html`
    <div class="page-head"><div><h1>History</h1><div class="sub">Every published change to brands, products and the home page.</div></div></div>
    ${err && html`<div class="notice error">${err}</div>`}
    ${items === null && !err ? html`<p class="muted">Loading…</p>` : items && html`<div class="card" style="padding:6px 20px">
      <ul class="list">${items.map(c => {
        const [title, , ...rest] = c.commit.message.split('\n');
        const lines = rest.filter(l => l.startsWith('- ')).map(l => l.slice(2));
        return html`<li key=${c.sha} style="align-items:flex-start">
          ${c.author ? html`<img class="avatar" style="width:32px;height:32px;border:0;margin-top:2px" src=${c.author.avatar_url} alt="" />` : html`<span class="avatar" style="width:32px;height:32px;border:0;background:var(--line)" />`}
          <div style="flex:1;min-width:0"><b>${title}</b>
            <div class="small muted">${(c.author && c.author.login) || c.commit.author.name} · ${ago(c.commit.author.date)}</div>
            ${lines.length > 1 && html`<details class="small" style="margin-top:4px"><summary style="font-weight:500">${lines.length} changes</summary><ul style="margin:6px 0 0;padding-inline-start:18px">${lines.map(l => html`<li>${l}</li>`)}</ul></details>`}
          </div>
          <button class="btn sm" disabled=${busy === c.sha || !c.parents.length} onClick=${() => undo(c)}><${Icon} d=${I.undo} size=${15} /> ${busy === c.sha ? 'Working…' : 'Undo'}</button>
        </li>`;
      })}</ul>
      ${!items.length && html`<div class="empty">No changes yet.</div>`}
      ${more && html`<div style="padding:12px 0"><button class="btn" onClick=${() => setPage(page + 1)}>Show older changes</button></div>`}
    </div>`}`;
}

// ── Help ──────────────────────────────────────────────────────────────────────────────────────────
function Help() {
  return html`<div class="card prose" style="max-width:760px">
    <h1>How the dashboard works</h1>
    <h2>1. Make changes</h2>
    <ul>
      <li><b>Add a product:</b> Products → <i>Add product</i>. Choose the brand first, then fill in the names (English and Arabic), SKU, pack details and description, and add a photo. Press <b>Save</b>.</li>
      <li><b>Edit a product:</b> click it in the Products list, change what you need, press <b>Save changes</b>.</li>
      <li><b>Brands:</b> same idea under Brands. The arrows on a brand page set the order of its products; <i>Change order</i> on the Brands page sets the order of brands.</li>
      <li><b>Home page:</b> choose the ${HERO_SLOTS} products shown in the big display at the top of the home page.</li>
    </ul>
    <h2>2. Publish</h2>
    <p>Saved changes are <b>drafts</b>: they stay in this browser and are not on the website yet. When you are ready, press <b>Publish</b> (top right). The website updates in about 3–5 minutes; the status in the top bar turns to <b>Site is live</b>.</p>
    <p>You can make many changes and publish them together. Drafts are kept even if you close the browser — but only on this device.</p>
    <h2>3. Undo</h2>
    <p>Every publish is listed in <b>History</b>. <i>Undo</i> puts things back the way they were before that change (as a draft you can check and then publish).</p>
    <h2>Tips</h2>
    <ul>
      <li><b>Photos:</b> use a clear pack shot on a white or transparent background. The dashboard resizes and optimises it for you.</li>
      <li><b>Sizes and units:</b> write them in English (250 ml, 1 kg, 12 months). The Arabic website translates the units automatically.</li>
      <li><b>Empty boxes:</b> leave size, case quantity or shelf life empty and the website shows “On request”.</li>
      <li><b>Coming soon:</b> set a product's status to <i>Coming soon</i> to show it with that label.</li>
      <li><b>Web addresses</b> of products and brands never change once created, so links you share keep working.</li>
    </ul>
    <h2>Sign-in key</h2>
    <p>Your GitHub access key is stored only in this browser. If it expires, sign out (menu at top right) and sign in with a new one. Never share it — anyone with the key can change the website.</p>
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
