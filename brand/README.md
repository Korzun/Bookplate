# Bookplate — logo kit (ex-libris monogram)

An engraved **ex-libris plate**: an octagonal double-rule cartouche with a serif
**B** monogram, a diamond divider and a *BOOKPLATE* wordmark — a personal-library
ownership stamp, which is exactly what a bookplate is. The kit is **ink on paper**:
tiles are engraving ink with the mark cut out in paper, and the loose marks are
`currentColor`, so they take on the surrounding text colour (perfect for the Home
Assistant sidebar and README). Brand blue survives as an accent — the logo
wordmark and the app's own UI — not as a tile colour.

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
| Engraving ink | `#0b1f3a` | Icon tile, line art on paper (README/print) |
| Paper | `#F5F5F7` | The mark cut out of a tile, line art on dark |
| Page dark | `#0E0F11` | Splash background |
| Brand | `#1777FF` | App UI accent only — no longer used in the kit |

`#1777FF` is the app's own `blue.500` (`app/client/src/provider/theme/theme.ts`).
The tiles used to be a blue gradient (`#3696fe → #0758d9`); they are solid ink now
because the everyday mark in paper-on-ink holds far more contrast at 16–32px, and a
flat plate matches the engraved register of the login screen and the README hero —
a gradient reads as glossy app-store chrome, which is the opposite of the idea.

## Files

```
svg/
  bookplate-mark.svg            everyday mark, currentColor (primary)
  bookplate-crest.svg           ornate crest, currentColor (large/hero)
  bookplate-icon.svg            app tile, solid ink + everyday mark (master)
  bookplate-icon-crest.svg      app tile, solid ink + ornate crest (store/large)
  bookplate-icon-maskable.svg   full-bleed, safe-zone padded (Android/PWA)
  bookplate-logo.svg            horizontal lockup on a paper plate, all ink
png/
  icon-{16..1024}.png           app tile raster (everyday mark)
  icon-crest-512.png            app tile raster (crest)
  apple-touch-icon-180.png
  icon-maskable-512.png
  ha-icon-256.png               everyday-mark tile — rename to icon.png for HA add-on
  ha-logo-720x200.png           horizontal lockup — rename to logo.png for HA add-on
  mark-ink-*.png / mark-paper-*.png     line mark (transparent), ink & paper
  crest-ink-*.png / crest-paper-*.png   line crest (transparent)
  splash-dark-1600x1000.png / splash-light-1600x1000.png   line crest, centred
  readme-hero-1200x520.png
favicon.ico                     multi-res 16/32/48 (everyday mark)
favicon.svg                     scalable favicon (flat everyday mark)
site.webmanifest                PWA icons 192/512 + maskable
```

Everything above except the line-art rasters (`mark-*`, `crest-*`) and the hero is
generated — edit the SVG, then run:

```bash
node scripts/generate-brand-icons.mjs
```

That also refreshes the iOS launch screens and copies what the web client serves into
`app/client/public`, so the kit and the app cannot drift apart.

## Web `<head>`

```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon-180.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#0b1f3a">
```

## Home Assistant add-on

The add-on root needs **two different shapes**, and they are not interchangeable:

| File | Source | Shape |
| ---- | ------ | ----- |
| `icon.png` | `png/ha-icon-256.png` | square tile, shown in the add-on list |
| `logo.png` | `png/ha-logo-720x200.png` | wide lockup, shown on the add-on page |

`icon.png` uses the **everyday mark**, not the crest: at the size the add-on list
actually renders it, the crest's inner rule and *BOOKPLATE* wordmark collapse into
noise, while the bare monogram stays readable.

`logo.png` is the **banner**, not a big icon — Home Assistant recommends roughly a
250×100 shape, so the square tile does not belong there. The lockup ships at 720×200
(3.6∶1) for retina.

It sits on an opaque **paper plate** with rounded corners rather than on transparency.
Home Assistant serves one PNG to a theme that flips, and ink art has no contrast left
on a dark card — ink is 1.01∶1 against `#1e1e1e`, i.e. invisible. The plate gives the
ink its own ground, so the banner reads the same in both themes, and on a light card
the paper is near enough to the card that it reads as a plain lockup.

## Inline SVG

`bookplate-mark.svg` uses `currentColor`, so it inherits text colour; override with
`svg { color: #1777FF }` if you want it branded.
