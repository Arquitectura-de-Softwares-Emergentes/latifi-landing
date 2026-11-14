# Accessibility report

Evidence record for the LatiFi landing page against WCAG 2.1 AA. Every automated result below can be reproduced with the commands in the [README](../README.md).

## Scope

- Standard: WCAG 2.1 AA, applied through the project rules in A11Y.md.
- Pages: six. The home page, the terms and conditions and the privacy policy, each in Spanish at the site root and in English (`index.html`, `terms.html`, `privacy.html` and their `en/` counterparts).
- Theme: light only. Dark mode stays an app feature.
- Not in scope: the Android app, which has its own accessibility work, and the YouTube player itself, whose controls and captions belong to YouTube.

## Contrast

Computed with the WCAG 2.1 relative luminance formula from the real `:root` tokens in `css/main.css`. The table is the output of `node scripts/check-contrast.mjs --markdown`, which fails when any pair drops below its minimum or drifts more than 0.02 from the ratio documented in the design contract. Result: `contrast: ok 23/23`.

| Foreground | Background | Computed | Documented | Minimum | Use | Result |
|---|---|---|---|---|---|---|
| `--color-text` `#101828` | `--color-white` `#ffffff` | 17.75:1 | 17.75:1 | 4.5:1 | body text | pass |
| `--color-text` `#101828` | `--color-surface-alt` `#f5f7fa` | 16.54:1 | 16.54:1 | 4.5:1 | body text on the alternate band | pass |
| `--color-muted` `#566174` | `--color-white` `#ffffff` | 6.25:1 | 6.25:1 | 4.5:1 | muted text | pass |
| `--color-muted` `#566174` | `--color-surface-alt` `#f5f7fa` | 5.83:1 | 5.83:1 | 4.5:1 | muted text on the alternate band | pass |
| `--color-navy-900` `#0b1f3a` | `--color-white` `#ffffff` | 16.52:1 | 16.52:1 | 4.5:1 | headings, secondary button label | pass |
| `--color-white` `#ffffff` | `--color-navy-900` `#0b1f3a` | 16.52:1 | 16.52:1 | 4.5:1 | text on Navy, primary button label | pass |
| `--color-on-navy-muted` `#dde3ea` | `--color-navy-900` `#0b1f3a` | 12.78:1 | 12.78:1 | 4.5:1 | secondary text on Navy | pass |
| `--color-lime-400` `#c6ff3d` | `--color-navy-900` `#0b1f3a` | 13.98:1 | 13.98:1 | 3:1 | focus ring on Navy, logo pulse, footer link hover | pass |
| `--color-navy-900` `#0b1f3a` | `--color-lime-400` `#c6ff3d` | 13.98:1 | 13.98:1 | 4.5:1 | lime button label | pass |
| `--color-navy-700` `#14407a` | `--color-white` `#ffffff` | 10.27:1 | 10.27:1 | 4.5:1 | links, nav and tab hover | pass |
| `--color-navy-700` `#14407a` | `--color-surface-alt` `#f5f7fa` | 9.57:1 | 9.57:1 | 4.5:1 | links on the alternate band | pass |
| `--color-navy-700` `#14407a` | `--color-soft` `#e8eef7` | 8.81:1 | 8.81:1 | 4.5:1 | icon glyph in circle | pass |
| `--color-green-600` `#0a7d5a` | `--color-white` `#ffffff` | 5.13:1 | 5.13:1 | 4.5:1 | emphasis text | pass |
| `--color-green-600` `#0a7d5a` | `--color-surface-alt` `#f5f7fa` | 4.78:1 | 4.78:1 | 4.5:1 | emphasis text on the alternate band | pass |
| `--color-green-600` `#0a7d5a` | `--color-green-50` `#e6f4ee` | 4.53:1 | 4.53:1 | 4.5:1 | Paid chip text | pass |
| `--color-white` `#ffffff` | `--color-green-600` `#0a7d5a` | 5.13:1 | 5.13:1 | 4.5:1 | step number on circle | pass |
| `--color-muted` `#566174` | `--color-divider` `#dde3ea` | 4.84:1 | 4.84:1 | 4.5:1 | reference row | pass |
| `--color-white` `#ffffff` | `--color-navy-700` `#14407a` | 10.27:1 | 10.27:1 | 4.5:1 | primary button hover (white label) | pass |
| `--color-navy-900` `#0b1f3a` | `--color-lime-300` `#d8ff7a` | 14.56:1 | n/a | 4.5:1 | lime button hover (Navy label) | pass |
| `--color-navy-900` `#0b1f3a` | `--color-soft` `#e8eef7` | 14.16:1 | n/a | 4.5:1 | secondary button hover, menu button hover, back to top hover | pass |
| `--color-text` `#101828` | `--color-soft` `#e8eef7` | 15.21:1 | n/a | 4.5:1 | body text on the soft tint | pass |
| `--focus-light` `#14407a` | `--color-white` `#ffffff` | 10.27:1 | 10.27:1 | 3:1 | focus ring on light surfaces | pass |
| `--focus-dark` `#c6ff3d` | `--color-navy-900` `#0b1f3a` | 13.98:1 | 13.98:1 | 3:1 | focus ring on Navy surfaces | pass |

No state relies on color alone. Chips, tabs, the current language and FAQ items also use an icon, weight, underline or native state.

## Lighthouse

`node scripts/lighthouse-check.mjs` serves a staged copy of the site under the same path prefix as GitHub Pages and audits all six pages with Lighthouse 13.6.0 (exact pin, lockfile). The gate is 90 or higher on Accessibility and SEO plus a list of required audits (color contrast, target size, `lang`, title, description, hreflang, canonical, image alt, heading order, ARIA and more). Scores of the last run, identical locally and on the GitHub runner:

| Page | Accessibility | SEO |
|---|---|---|
| `/` | 100 | 92 |
| `/en/` | 100 | 92 |
| `/terms.html` | 100 | 92 |
| `/privacy.html` | 100 | 92 |
| `/en/terms.html` | 100 | 92 |
| `/en/privacy.html` | 100 | 92 |

The 8 missing SEO points come from one audit, `robots-txt`. Lighthouse fetches `robots.txt` from the page, and the page CSP says `connect-src 'none'`, so the browser blocks the fetch. Relaxing the CSP for a score would undo a deliberate security decision, so the page keeps the stricter policy. The same command with `--live BASE_URL` audits the deployed site, and its result goes into the release record.

## Automated browser checks

`node scripts/ui-check.mjs` drives headless Chrome over the DevTools Protocol, one fresh browser context per scenario. Each scenario below fails the build when it breaks.

| Scenario | What it proves |
|---|---|
| `skip-link` | The skip link is the first Tab stop, is visible on focus and jumps to the main landmark |
| `cta-download` | The Get the app buttons scroll to the Download section and move focus to its heading, with no overflow at 320 px |
| `lang-switch-persist` | The language switch changes `lang` and stores the choice |
| `lang-hash-map` | A stored language keeps the visitor on the matching section after a redirect |
| `storage-blocked` | The page works when `localStorage` throws, with no redirect and no error |
| `no-js` | Without JavaScript the nav is visible, tab panels are stacked and the FAQ still opens |
| `download-status` | While `data-placeholder` exists the link stays a normal link (never `aria-disabled`) and the Download section carries no status line or notice |
| `fonts-loaded` | The self-hosted font faces load |
| `no-external-requests` | The page makes no request outside its own origin |
| `tabs-keyboard` | The tabs follow the ARIA pattern: arrows, Home, End, selected state |
| `tabs-distinct-content` | Both tab panels have three distinct steps |
| `no-js-panels` | Tab panels stay readable without scripts |
| `console-clean` | No console errors and no CSP violations on any page |
| `video-embed` | The product video is visible with a title, a lazy `youtube-nocookie.com` frame that makes no request until it nears the viewport, a matching CSP `frame-src` and a visible link to the video on YouTube |
| `video-error-offline` | A failing video shows the error line and the YouTube link |
| `faq-native` | The FAQ has seven native `details` items and keyboard behavior comes from the browser |
| `counts` | Section, step, card and question counts match the design contract |
| `menu-disclosure` | The menu button is 48 by 48, names its panel, reports its state and closes with Escape |
| `header-fit` | The header fits at 1024 px in both languages |
| `menu-no-js` | The navigation works without JavaScript |
| `segment-buttons` | I'm a borrower and I'm a lender select the tab and move focus to it |
| `hero-layout` | The hero buttons and chips stack at Compact width and sit in a row at wide widths |
| `example-card` | The example card is one article with its title, note, four terms and labeled progress bar |
| `footer-links` | The footer has four legal links and a Legal nav |
| `overflow-320` | No horizontal scroll at 320 CSS px (SC 1.4.10) |
| `text-zoom-200` | Text at 200 percent does not clip or force horizontal scroll (SC 1.4.4) |
| `spacing-override` | The SC 1.4.12 text spacing overrides do not clip content |
| `targets-48` | Every interactive element is at least 48 by 48 CSS px, with the menu open and closed |
| `legal-structure` | The legal pages have the full tag set, hreflang pairs, one h1 and working footer links |
| `legal-overflow` | A 200 character unbroken token wraps inside the column at 320 px |
| `reduced-motion` | Transitions and entrance animations stay within 1 s, stop under reduced motion, and smooth scrolling turns off |
| `reel-structure` | The "in action" section exists in both languages between How it works and Screens, with three muted videos that carry a poster and an `aria-label` |
| `reel-overflow` | The "in action" section causes no horizontal overflow at 320, 600, 1024 and 1280 px |
| `reel-no-js` | Without JavaScript the videos keep their native controls and the custom buttons stay hidden |
| `reel-buttons` | Each video has a visible play and pause button of at least 48 px, no video autoplays under `prefers-reduced-motion: reduce`, and the button label toggles between the play and pause texts (WCAG 2.2.2) |
| `back-to-top` | Back to top is hidden at the top, appears after scrolling, is at least 48 px, is not a live region and moves focus to the top |
| `sticky-header-focus` | The sticky header never covers the focused element while tabbing (SC 2.4.11) |

Guards that run before the browser: `scripts/check-i18n-a11y.sh` (language attribute, skip link, single `main`, title and hreflang on every HTML file), `scripts/check-i18n-parity.mjs` (the Spanish root pages and the English `en/` pages share one structure) and `scripts/check-csp.sh` (CSP and no inline styles or handlers).

## Visual additions

The home pages carry app screenshots, three flat illustrations and an authored icon set. Rules that keep them accessible:

- Every screenshot has a text alternative that describes the screen in the page language. The Spanish pages use only the Spanish captures. Decorative art (`loop.svg`, `trust.svg`) has an empty `alt`. The money path diagram (`flow.svg`) has a full description plus a caption.
- Phone frames are drawn in CSS. Images carry `width` and `height`, so nothing shifts while they load.
- The screen gallery is a labelled `region` that takes keyboard focus, so the arrow keys scroll it. It uses scroll-snap, has no autoplay and shows all screens side by side from 1024 px. `scripts/ui-check.mjs` exempts that one region from the clipping and overflow measurements, because horizontal scrolling inside it is the intended behavior.
- Icons share one 2 px rounded stroke on a 24 px grid and are `aria-hidden` next to a visible label.
- Reputation numbers (0 to 1000, +20, -5, -200, 1 to 6) come from the scoring policy. The page states no user counts, amounts or rates.

## Criteria map

| SC | Criterion | Mechanism | Check that proves it |
|---|---|---|---|
| 1.1.1 | Non-text content | Images carry `alt`, decorative icons carry `aria-hidden="true"`, icon-only controls carry `aria-label` | Lighthouse `image-alt` and `button-name` audits |
| 1.3.1 | Info and relationships | One h1 per page, no skipped heading levels, labeled sections and navs, real `ol`, `ul` and `details` | `check-i18n-a11y.sh`, `counts`, `legal-structure`, Lighthouse `heading-order` and `list` |
| 1.4.3 | Contrast (minimum) | Tokens chosen for 4.5:1 text and 3:1 parts, state pairs included | `check-contrast.mjs` (23 pairs), Lighthouse `color-contrast` |
| 1.4.4 | Resize text | Relative units, no fixed heights on text containers | `text-zoom-200` |
| 1.4.10 | Reflow | Single column layout at 320 CSS px, `overflow-wrap: anywhere` on long tokens | `overflow-320`, `legal-overflow` |
| 1.4.12 | Text spacing | No fixed heights or clipped overflow on text | `spacing-override` |
| 2.1.1 | Keyboard | Native controls, tabs with arrows, Home and End, menu with Escape | `tabs-keyboard`, `menu-disclosure`, `faq-native`, `back-to-top`, manual pass |
| 2.4.1 | Bypass blocks | Skip link first, landmarks, headings | `skip-link`, `check-i18n-a11y.sh` |
| 2.4.7 | Focus visible | `:focus-visible` outline 3 px with 2 px offset, `#14407a` on light and `#c6ff3d` on Navy | The two focus rows of the contrast table, `sticky-header-focus`, manual pass |
| 2.4.11 | Focus not obscured (minimum) | `scroll-padding-top` matches the sticky header; legal pages use a non sticky header | `sticky-header-focus` |
| 2.5.3 | Label in name | Visible link and button text is part of the accessible name | Lighthouse accessibility audits, manual pass |
| 2.5.8 | Target size (minimum) | 48 by 48 CSS px targets with spacing | `targets-48`, Lighthouse `target-size` |
| 3.1.1 | Language of page | `lang` on every `html` element (`en` and `es-419`) | `check-i18n-a11y.sh`, Lighthouse `html-has-lang` and `html-lang-valid` |
| 3.1.2 | Language of parts | `lang` and `hreflang` on the language switch links | The switch markup, `check-i18n-parity.mjs` |
| 4.1.2 | Name, role, value | Native elements first; ARIA only for the tabs and the menu disclosure, with state attributes | `tabs-keyboard`, `menu-disclosure`, Lighthouse `aria-*` audits |

## Manual pass

Scripts cannot judge screen reader speech or how a focus ring feels. Before every public release, one person runs this list on the deployed site in English and in Spanish, then records the result in the phase UAT file.

Keyboard only, from the first Tab:

- [ ] The first stop is the skip link, it is visible, and Enter moves focus to the main content.
- [ ] Tab order follows the visual order, and every stop shows a clear focus ring on light and on Navy surfaces.
- [ ] The language switch changes language and keeps the page.
- [ ] How it works: arrow keys, Home and End move between the two tabs, and the panel changes.
- [ ] The FAQ opens and closes with Enter and Space.
- [ ] At a narrow window the menu opens with its button, and Escape closes it and returns focus to the button.
- [ ] Back to top appears after scrolling and works by keyboard.
- [ ] Nothing traps focus.

VoiceOver (Safari) or NVDA:

- [ ] The landmarks list shows banner, navigation, main and contentinfo, each named where there is more than one navigation.
- [ ] The headings list has one h1 and no skipped levels.
- [ ] The tabs announce their role, label and selected state.
- [ ] FAQ items announce expanded or collapsed.
- [ ] The menu button announces its name and expanded state.
- [ ] The Download button announces its name and is a normal link, while `data-placeholder` is present.
- [ ] The language switch links are announced in their own language.

Also open the live site on a physical phone, in portrait and landscape, in both languages: no horizontal scroll, readable text and comfortable touch targets.

## Known limits

- SEO scores 92 instead of 100 because the strict CSP blocks the `robots.txt` fetch that Lighthouse makes. See the Lighthouse section.
- On a project site, `robots.txt` and `sitemap.xml` live under the repository path. Crawlers read `robots.txt` only at the host root, so the file mostly documents intent until a custom domain exists.
- `js/main.js` is above the 8 KB size target. It is a target, not a gate.
- The manual pass is recorded outside this repository. This file holds the checklist, not the results.
- The legal text was reviewed by the project owner, not by a lawyer. The open points are tracked in the phase summary.
- The three short app clips in the "in action" section are muted, never autoplay under reduced motion and carry a pause button. They have no audio track, so they need no captions; each has a text description in its caption. The product video slot below Benefits is off. When it is enabled it needs captions and a transcript, and the pages need a `frame-src` entry. See the README.
