# Rikaz website (v2)

Exported from Claude Design. `index.html` is the design file; `support.js` is its runtime.
Static site — serve locally with `python3 -m http.server` and open http://localhost:8000.

Live (GitHub Pages): https://sheedosa.github.io/rikaz-website/

## After editing `index.html`, run the build

```
node tools/build.mjs          # rebuild every page (+ any missing share images)
node tools/build.mjs --og     # also regenerate all share images (after changing products, logos or copy)
```

Then commit everything it changed. It needs Node 18+ and Playwright (`npm i -g playwright`) for the
prerender and share-image steps; `--no-prerender` skips those.

The build reads the data in `index.html` (brands, products, `SEO` copy) and writes:

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
- **Images:** the page uses the optimised `.webp` files in `assets/`. The `.png` files next to them are the full-size originals. When you add or replace an image, add a matching `.webp` (≤ 800px for products, ≤ 480px for logos).
- **Fonts** (Instrument Sans, Readex Pro) are self-hosted in `assets/fonts/`, so there are no Google requests.
  The other Arabic fonts in the design tool's `arabicFont` option are no longer loaded.
- **React** is self-hosted in `vendor/`, and the map (`libya-map.html`) is self-contained, so no page depends on a CDN.
