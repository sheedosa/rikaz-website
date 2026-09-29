# Rikaz website (v2)

Exported from Claude Design. `index.html` is the design file; `support.js` is its runtime.
Static site — no build step. Serve locally with `python3 -m http.server` and open http://localhost:8000.

Live (GitHub Pages): https://sheedosa.github.io/rikaz-website/

## Notes
- **Images:** the page uses the optimised `.webp` files in `assets/`. The `.png` files next to them are the full-size originals. When you add or replace an image, add a matching `.webp` (≤ 800px for products, ≤ 480px for logos).
- **React** is self-hosted in `vendor/`, so it doesn't come from a CDN.
- **Page links** use the URL hash, e.g. `#/brands`, `#/brand/antat`, `#/product/an3`. This means the phone back button works, refresh keeps your page, and you can share a link to a single page.
