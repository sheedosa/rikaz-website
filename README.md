# Rikaz website (v2)

Exported from Claude Design. `index.html` is the design file; `support.js` is its runtime.
The visual system (type scale, buttons, cards, reveal/parallax motion) lives in the `<helmet><style>` block at the top of the
template in `index.html`; the data and page logic sit in the `data-dc-script` block at the bottom.
Static site — serve locally with `python3 -m http.server` and open http://localhost:8000.

Live: https://rikazfoods.ly/ (GitHub Pages, custom domain set by the `CNAME` file)

## Catalogue and admin dashboard

Brands, products, the home-page product spread, categories and countries live in **`content/`**:
`brands.json`, `products.json` and `settings.json`. The owner edits them in the dashboard at
**https://rikazfoods.ly/admin/** (sign-in with a GitHub access key; see [`docs/ADMIN-GUIDE.md`](docs/ADMIN-GUIDE.md)).

- The dashboard runs entirely in the browser (`admin/`, no build step) and talks straight to the GitHub API.
  Edits are drafts in the browser until **Publish**, which writes one commit (JSON + photos). If someone else
  published meanwhile, changes are merged item by item.
- Every push to the default branch runs **`.github/workflows/publish.yml`**: it runs the build, commits the
  generated pages back and deploys to GitHub Pages. One-time setup: *Settings → Pages → Source: GitHub Actions*.
- The build checks the catalogue with the same rules as the dashboard (`admin/schema.js`). On any error it stops
  without writing anything, so the live site keeps its last good version.
- You can still edit `content/*.json` by hand. Don't edit the block between `// content:start` and
  `// content:end` in `index.html`: the build writes it from `content/`.
- `node tools/test-admin.mjs` runs an end-to-end test of the dashboard against a fake GitHub API.

## After editing `index.html` (or `content/`) locally, run the build

```
node tools/build.mjs          # rebuild every page (+ share images whose content changed)
node tools/build.mjs --og     # regenerate all share images (e.g. after changing the card design)
```

Then commit everything it changed. It needs Node 18+ and Playwright (`npm i -g playwright`) for the
prerender and share-image steps; `--no-prerender` skips those.

The build reads `content/*.json` and the `SEO` copy in `index.html`, and writes:

- **One real page per route and language**: `brands/`, `brand/antat/`, `product/an3/`, `ar/…` (66 pages).
  Each has its own title, description, canonical URL, `hreflang` (EN/AR), Open Graph + Twitter tags and
  schema.org JSON-LD (organisation, breadcrumbs, product details).
- **A prerendered snapshot** of each page (desktop + mobile), so search engines, AI crawlers and slow
  phones get the real content straight away. The app replaces it as soon as it starts.
- **Share images** in `assets/og/` (1200×630): a site card per language plus one per brand and product.
- `sitemap.xml`, `robots.txt`, `site.webmanifest` and `404.html`.

Don't edit the generated pages by hand. Change `index.html` and rebuild.

## Notes
- **URLs:** pages use clean paths (`brands/`, `ar/brand/antat/`); old `#/…` links redirect automatically.
  Links are real `<a href>` links, so they can be crawled and opened in a new tab.
- **SEO copy:** titles and descriptions live in the `SEO` object inside `index.html`'s script.
- **Custom domain:** set `SITE_URL` at the top of `tools/build.mjs`, add a `CNAME` file, and rebuild.
  `robots.txt` only takes effect at the root of a domain, so it starts working once the site has its own domain.
- **Contact details for search engines** (phone, address, opening hours, social profiles) are in `ORG` at the top of `tools/build.mjs`.
- **Images:** the page uses the optimised `.webp` files in `assets/`. The `.png` files next to them are the full-size originals. When you add or replace an image, add a matching `.webp` (≤ 800px for products, ≤ 480px for logos). The dashboard does this automatically for photos uploaded there.
- **Fonts** (Instrument Sans, Readex Pro) are self-hosted in `assets/fonts/`, so there are no Google requests.
  The other Arabic fonts in the design tool's `arabicFont` option are no longer loaded.
- **React** is self-hosted in `vendor/`, and the map (`libya-map.html`) is self-contained, so no page depends on a CDN.
