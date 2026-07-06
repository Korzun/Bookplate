# Bookplate — logo kit (ex-libris monogram)

An engraved **ex-libris plate**: an octagonal double-rule cartouche with a serif
**B** monogram, a diamond divider and a *BOOKPLATE* wordmark — a personal-library
ownership stamp, which is exactly what a bookplate is. Colour lives only on the
app-icon tile; everything else is `currentColor`, so the mark takes on the
surrounding text colour (perfect for the Home Assistant sidebar and README).

All lettering is converted to **vector outlines** — the SVGs need no fonts installed.

## Two tiers (use the right one for the size)

| Tier | File | Use |
| ---- | ---- | --- |
| **Everyday mark** — frame + B | `svg/bookplate-mark.svg` | Sidebar, favicon, inline, anything ≤ ~64px. Legible to ~24px. |
| **Ornate crest** — + divider + BOOKPLATE | `svg/bookplate-crest.svg` | README hero, splash, store/large icons ≥ ~128px. |

The crest's fine detail (rule, BOOKPLATE wordmark) is meant for large sizes and gracefully
falls away when small — so never use the crest as a favicon; use the everyday mark.

## Colours

| Token | Hex | Use |
| ----- | --- | --- |
| Brand | `#1777FF` | Icon tile (flat) |
| Brand gradient | `#3696fe` → `#0758d9` | Icon tile (default) |
| Engraving ink | `#0b1f3a` | Line art on paper (README/print) |
| Paper | `#F5F5F7` | Line art on dark |
| Page dark | `#0E0F11` | Splash background |

`#1777FF / #3696fe / #0758d9` are the app's own `blue.500 / .400 / .700`
(`app/client/src/provider/theme/theme.ts`).

## Files

```
svg/
  bookplate-mark.svg            everyday mark, currentColor (primary)
  bookplate-crest.svg           ornate crest, currentColor (large/hero)
  bookplate-icon.svg            app tile, blue gradient + everyday mark (master)
  bookplate-icon-flat.svg       app tile, flat #1777FF (crisper tiny)
  bookplate-icon-crest.svg      app tile, blue + ornate crest (store/splash)
  bookplate-icon-maskable.svg   full-bleed, safe-zone padded (Android/PWA)
png/
  icon-{16..1024}.png           app tile raster (everyday mark)
  icon-crest-512.png            app tile raster (crest)
  apple-touch-icon-180.png
  icon-maskable-512.png
  ha-icon-256.png               crest tile — rename to icon.png for HA add-on
  ha-icon-simple-256.png        everyday-mark tile alt
  mark-ink-*.png / mark-paper-*.png     line mark (transparent), ink & paper
  crest-ink-*.png / crest-paper-*.png   line crest (transparent)
  splash-dark-1600x1000.png / splash-light-1600x1000.png
  readme-hero-1200x520.png
favicon.ico                     multi-res 16/32/48 (everyday mark)
favicon.svg                     scalable favicon (flat everyday mark)
site.webmanifest                PWA icons 192/512 + maskable
```

## Web `<head>`

```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon-180.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#1777FF">
```

## Home Assistant add-on

Use a 256×256 `icon.png` at the add-on root — `png/ha-icon-256.png` (crest) for a
premium look, or `png/ha-icon-simple-256.png` if you prefer the plain mark.

## Inline SVG

`bookplate-mark.svg` uses `currentColor`, so it inherits text colour; override with
`svg { color: #1777FF }` if you want it branded.
