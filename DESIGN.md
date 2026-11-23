# Design

Direction phase D0. Evolution of the current theme (`vibora-frontend/src/styles/_tema.scss`): same lime, same token architecture, new neutral base, rounder shapes, sportier landing. Visual proof: `docs/design/d0-mockup.html`.

## Visual world

A night-court scoreboard that also works in daylight. Charcoal surfaces with a slight cool slate cast, one electric lime used sparingly as the "ball", and white type. Large rounded cards (20 to 24 px) and pill controls echo a padel ball and court glass. Blue is never a UI colour: it only enters through court photos, so photography is the only cool element on an otherwise charcoal and lime page.

- Dark (default): page `#1C2124`, cards `#262C30`, lime accent, an olive-to-lime gradient as a brand moment (landing only). The login and register screens keep their current layout and brand panel; only their colours move to the new tokens.
- Light: soft gray page `#ECEDEA`, white cards, pale-lime accent cards `#E2F37A`, charcoal contrast blocks carrying lime.
- Two modes of use: **Persuade** (public landing: photos, display type, full ambition) and **Operate** (agenda, bookings, matches, admin: palette, radii and pills, but never a photo behind working UI).

## Colour tokens

Contrast measured with the WCAG 2.x relative-luminance formula. AA targets: text 4.5, large text 3, UI components 3.

### Dark (default)

| Token | Value | Use | Pair and ratio |
|---|---|---|---|
| `--page` | `#1C2124` | page background | n/a |
| `--card` | `#262C30` | cards, sheets | vs page 1.15 (separation by radius and outline-variant, not by contrast) |
| `--raised` | `#2F363B` | inputs, hover, nested areas | n/a |
| `--text` | `#F1F3EE` | body, headings | on page 14.54, card 12.65, raised 10.98 |
| `--text-2` | `#A9B2B7` | secondary text | on page 7.54, card 6.56, raised 5.69 |
| `--lime` | `#D4F25A` | accent, primary fill, focus ring, links | on page 12.88, card 11.21 |
| `--on-lime` | `#161B00` | text on lime | 13.98 |
| `--pale` | `#E2F37A` | pale-lime accent card | with `--on-pale` `#1C2124`: 13.41 |
| `--outline` | `#78838A` | control borders, slot borders | vs page 4.19, card 3.64, surface-container-high 3.16 (UI 3:1 OK; outlined controls must not sit on surface-container-highest, 2.7) |
| `--outline-variant` | `#363D42` | decorative dividers | decorative only |
| `--ok` / `--on-ok-c` on `--ok-c` | `#7FD99A` / `#B5F0C4` on `#12391F` | success | ok on card 8.28; container pair 9.95 |
| `--warn` | `#F5B84A`; container `#4A3300`, text `#FFE0A3` | warning | on card 7.97; container pair 9.32 |
| `--err` | `#FFB4AB`; container `#6B1A14`, text `#FFDAD6` | error | on card 8.33; container pair 9.11 |
| `--info` | `#7FD0C4` (teal, not blue); container `#0F3F3A`, text `#C4F0E8` | info | on card 7.89; container pair 9.47 |
| `--s1` / `--s2` / `--s3` / `--s4` | `#D4F25A` / `#F0834A` / `#5CC7B5` / `#A9B2B7` | chart series | on card 11.21 / 5.42 / 6.93 / 6.56 (3:1 non-text OK) |
| heat 0 to 4 | `#2A3410` `#46590F` `#A6C93A` `#D4F25A` `#E2F37A` | calendar/heat scale | text: white (11.77), white (6.97), ink `#161B00` (9.27), ink (13.98), ink `#1C2124` (13.41) |

### Light

| Token | Value | Use | Pair and ratio |
|---|---|---|---|
| `--page` | `#ECEDEA` | page background | n/a |
| `--card` | `#FFFFFF` | cards | vs page 1.18 (separation by radius and outline-variant) |
| `--raised` | `#F5F6F3` | inputs, nested areas | n/a |
| `--text` | `#1C2124` | body, headings | on page 13.83, card 16.25 |
| `--text-2` | `#4A5358` | secondary text | on page 6.69, card 7.87, taken-slot `#E2E4E0` 6.15 |
| `--lime` | `#D4F25A` | **fill only**: primary buttons, selected slot, accents on charcoal | never text on light |
| `--on-lime` | `#1C2124` | text on lime | 12.88 |
| `--accent-text` | `#4A5A00` | links, text-sized accents, focus ring | on card 7.63, page 6.49 |
| `--pale` | `#E2F37A` | pale-lime accent card | with `#1C2124`: 13.41 |
| `--block` | `#1C2124` | charcoal contrast block | lime text on it 12.88; `--text` on it (`#F1F3EE`) 14.54 |
| `--outline` | `#6B7378` | control borders, slot borders | vs card 4.83, page 4.11 |
| `--outline-variant` | `#CBCFCB` | decorative dividers | decorative only |
| `--ok` | `#1E6B34`; container `#C3F0CE`, text `#002110` | success | on card 6.55; container pair 13.61 |
| `--warn` | `#7A4B00`; container `#FFDDAA`, text `#2A1800` | warning | on card 7.41; container pair 13.16 |
| `--err` | `#B3261E`; container `#FFDAD6`, text `#410002` | error | on card 6.54; container pair 13.26 |
| `--info` | `#1B6B63`; container `#C4EEE8`, text `#00201D` | info | on card 6.31; container pair 13.67 |
| `--s1` / `--s2` / `--s3` / `--s4` | `#5E7000` / `#C2501C` / `#1B7A6E` / `#5E676C` | chart series | on white 5.54 / 4.71 / 5.18 / 5.78 |
| heat 0 to 4 | `#EAF3BD` `#CFE57A` `#9DBB2E` `#5E7000` `#33400A` | heat scale | text: ink `#161B00` (15.16, 12.71, 8.05), white (5.54, 11.18) |

Rules: lime is a fill under charcoal text in light mode, never body text on light. Never gray text on a coloured surface: tint from the surface hue or use the pair above. Charts must also encode by label, pattern or position, not colour alone.

## Typography

Family: `'Manrope Variable', Manrope, system-ui, sans-serif` (already self-hosted). Tracking floor `-0.04em`; body measure 65 to 75 ch; headings `text-wrap: balance`; tabular numerals (`font-variant-numeric: tabular-nums`) in prices, times and KPIs.

| Role | Size | Weight | Line | Tracking | Where |
|---|---|---|---|---|---|
| Display | `clamp(3rem, 9vw, 6rem)` | 800 | 0.95 | -0.03em | landing hero only (Persuade) |
| Mission | `clamp(1.75rem, 4.2vw, 3.25rem)` | 700 | 1.15 | -0.02em | landing mission sentence |
| Stat number | `clamp(3rem, 7vw, 5rem)` | 800 | 1 | -0.03em | stat cards |
| H1 | 2rem | 800 | 1.15 | -0.02em | app page title |
| H2 | 1.5rem | 700 | 1.2 | -0.01em | section |
| H3 | 1.125rem | 700 | 1.3 | 0 | card title |
| Body | 1rem | 400 | 1.55 | 0 | default |
| Small | 0.875rem | 500 | 1.45 | 0 | meta, labels |
| Caption | 0.75rem | 600 | 1.4 | 0.02em | slot price, badges (never below 12 px) |

## Radii and spacing

- Radii: `--r-sm 10px` (chips, slots), `--r-md 16px` (inputs, small cards, dialogs), `--r-lg 20px` (cards), `--r-xl 24px` (large and stat cards), `--r-hero 32px` (hero container), `--r-pill 999px` (buttons, nav, tags, photo pills).
- Spacing (4 px base): 4, 8, 12, 16, 24, 32, 48, 64, 96. Inside cards 20 to 24 px; between related items 8 to 12; between sections 64 to 96 (landing) or 24 to 32 (app). More space above a heading than below it. Page gutter 16 px on phones, 32 px and up on desktop.

## Components

- **Pill nav**: one rounded-pill bar floating over the hero (or at the top of the app shell). Wordmark left, 3 to 4 links, one lime pill CTA right. Solid translucent charcoal, no decorative blur. On phones links collapse to a menu button; wordmark and CTA stay. Height 56 px, targets at least 44 px.
- **Pill buttons**: height 48 px (44 minimum), radius pill, weight 700. Primary: lime fill, `--on-lime` text. Secondary: transparent, 1.5 px `--outline` border, `--text`. On photos the secondary uses a white 1.5 px border and white text over the overlay. States: hover (+6% lighten or `--raised`), focus-visible (2 px `--lime` or `--accent-text` ring, 2 px offset), disabled (40% opacity plus no pointer), loading (spinner replaces icon, label kept).
- **Cards**: `--card`, radius 20 to 24 px, no heavy shadow; separation by surface step and `--outline-variant` hairline. Variants: default, pale-lime (`--pale`, charcoal text), block (`--block`, white text, lime accent), photo card (photo slot plus overlay). Never nest cards.
- **Stat card**: one big number (stat number style), one sentence of context, nothing else. Pale-lime or block variant. Use at most one or two per view; no sparklines or rings.
- **Slots (agenda)**: free = outlined `--outline`, shows time and price; taken = `--raised` with diagonal hatch and the word "Ocupada"; selected = lime fill, check icon and the word "Seleccionada". State is never colour alone.
- **Open-match card**: title (court, day, time), "Faltan N · X € por jugador", avatar circles (filled = joined, dashed = open spot), pill CTA "Unirme".
- **KPI row**: Operate only. Label, tabular number, delta as text ("+4 % vs. mes anterior"). Cards in a row; wraps to 2 columns on phones.
- **Photo slot rules**: rounded container with `object-fit: cover`; focal point set per image. Any text over a photo needs an overlay: at least `rgba(14,18,21,0.55)` uniform plus a bottom gradient to `rgba(14,18,21,0.85)` where the headline sits; white text over the lightest expected pixel must still reach 4.5:1 (body) or 3:1 (large) - verify against the real photo, not the placeholder. Placeholder label format: "foto: pista", "foto: palas", "foto: jugadores". No logos visible in any photo. Inline photo pills (mission sentence) are decorative: `aria-hidden`, empty alt.
- **Brand gradient**: olive-to-lime (`#1C2124` to `#3A4A0C` to `#9DB82A`) only as a backdrop in Persuade surfaces (not on the auth screens, which keep their current design with remapped colours); text sits on the dark end (white on `#3A4A0C` is 9.7:1), never on the lime end.

## Persuade vs Operate

| | Persuade (landing) | Operate (app) |
|---|---|---|
| Photos | hero, pills, photo cards | none behind working UI; avatars only |
| Type | display and mission sizes | H1 and below |
| Colour | gradient, lime blocks, pale-lime cards | charcoal/white surfaces, lime only for primary action and selection |
| Density | generous, 64 to 96 px sections | compact, 24 to 32 px |
| Motion | one authored moment (hero headline rise) | 150 to 200 ms state changes only |
| Radii/pills | same | same |

Also in both: themed text selection, caret, scrollbars and focus rings from the palette; `prefers-reduced-motion` respected.

## Mapping to `_tema.scss`

Architecture unchanged (`mat.theme-overrides`, `--app-*`, `--viz-*`, `--marca-*`). Only values change.

**Dark** (`html:not([data-theme='light'])`)

| Token | Now | New |
|---|---|---|
| `background`, `surface`, `surface-dim` | `#0b0c0a` | `#1C2124` |
| `surface-container-lowest` | `#070806` | `#171C1F` |
| `surface-container-low` | `#141511` | `#20262A` |
| `surface-container` | `#1b1d18` | `#262C30` (card) |
| `surface-container-high`, `surface-variant` | `#23251f` | `#2F363B` |
| `surface-container-highest`, `surface-bright` | `#2b2e26`, `#33362d` | `#384046` |
| `on-surface`, `on-background` | `#f2f3ee` | `#F1F3EE` |
| `on-surface-variant` | `#a9ad9f` | `#A9B2B7` |
| `outline` / `outline-variant` | `#7b7f70` / `#2e3129` | `#78838A` / `#363D42` (outline is 3.16 on `surface-container-high`, the lowest surface where dialogs and menus sit; 3.64 or more on page and card) |
| `primary`, `surface-tint`, `--app-foco` | `#d4f25a` | unchanged |
| `on-primary` | `#1a2100` | `#161B00` |
| `inverse-surface` / `inverse-on-surface` | `#e8eadf` / `#1b1d18` | `#E8EBE6` / `#1C2124` |
| `inverse-primary` (snackbar action) | `#546500` | `#4A5A00` set explicitly (6.3 on `inverse-surface`) |
| `--app-exito`, `--app-aviso`, `--app-error` family | existing | unchanged hues; contrast stays above 7 on the new card (checked: 8.28, 7.97, 8.33) |
| `--app-info` family | blue `#7db9f5` ... | teal `#7FD0C4`, container `#0F3F3A`, on-container `#C4F0E8`, on-info `#06231F` |
| `--viz-serie-1/2` | blue `#3987e5`, orange `#d95926` | lime `#D4F25A`, orange `#F0834A`; add `--viz-serie-3 #5CC7B5`, `--viz-serie-4 #A9B2B7` |
| `--viz-calor-0..4` | blue ramp | lime ramp `#2A3410 #46590F #A6C93A #D4F25A #E2F37A`; texts white, white, ink, ink, ink |
| `--marca-fondo` | `#10120d` | `#1C2124`; `--marca-degradado` (brand gradient above) is deferred to the landing slice |

**Light** (`html[data-theme='light']`)

| Token | Now | New |
|---|---|---|
| `background`, `surface` | `#fafbf3` | `#ECEDEA` |
| `surface-container-lowest`, `-low` | `#ffffff` | `#FFFFFF` (card) |
| `surface-container` | `#eef0e4` | `#F5F6F3` |
| `surface-container-high`, `-highest`, `surface-variant`, `surface-dim` | warm olive grays | `#E2E4E0`, `#D9DCD7`, `#E2E4E0`, `#D9DCD7` |
| `on-surface`, `on-background` | `#1a1d12` | `#1C2124` |
| `on-surface-variant` | `#45483c` | `#4A5358` |
| `outline` / `outline-variant` | `#75796a` / `#c5c8b7` | `#6B7378` / `#CBCFCB` |
| `primary`, `surface-tint`, `--app-foco` | `#546500` | `#4A5A00` (text-safe) |
| `primary-container` / `on-primary-container` | `#d2ef58` / `#181e00` | `#D4F25A` / `#1C2124`; filled buttons should use the container (component token), so they read lime as in the dark theme |
| `secondary-container` | `#dfe7b3` | `#B8C093` (neutral olive tonal, 1.51 against the lime `primary-container`) with `on-secondary-container #1C2124` (8.5). The pale lime `#E2F37A` lives only in `--app-pale` for highlight cards |
| `inverse-surface` / `inverse-on-surface` | `#2e3226` / `#f0f2e1` | `#1C2124` / `#F1F3EE` (also the charcoal block) |
| `--app-info` family | blue | teal `#1B6B63`, container `#C4EEE8`, on-container `#00201D` |
| `--app-error` family | `#ba1a1a` | `#B3261E` (6.54 on white) |
| `--viz-serie-1..4` | blue, orange | `#5E7000`, `#C2501C`, `#1B7A6E`, `#5E676C` |
| `--viz-calor-0..4` | blue ramp | `#EAF3BD #CFE57A #9DBB2E #5E7000 #33400A`; texts ink, ink, ink, white, white |
| `--marca-*` | fixed dark in both themes | unchanged logic, new base `#1C2124` |

**Shape**: `corner-small 10px` (unchanged), `corner-medium 16px` (unchanged), `corner-large 20px` (unchanged), `corner-extra-large 28px` (unchanged). The new radii (`corner-extra-large` to 32px, and the `--r-*` app tokens: `--r-xl 24px`, `--r-hero 32px`, `--r-pill`) are deferred to the component slice (D4): the palette slice is colour-only and the login card must not change shape. Not a token change: Material buttons already render as pills.

**New app tokens**: `--app-pale` / `--app-sobre-pale`, `--app-bloque` / `--app-sobre-bloque`, `--viz-serie-3/4` (reserved in the theme, unused until the landing and component slices). `--marca-degradado` and the `--r-*` radii return with those slices.

Out of scope for D0: implementing any of this in `vibora-frontend/` (D1), the logo asset, real photography.
