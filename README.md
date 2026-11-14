# latifi-landing

The public website of LatiFi, a peer to peer lending app for Android that runs on a test network. This repository holds a static site in Spanish (the root pages) and English (the `en/` folder): plain HTML5, CSS3 and a small JavaScript file, with no build step and no runtime libraries. The only dependency is Lighthouse, which the checks use and which never reaches the site.

Pages:

| Page | Spanish (root, default) | English |
| ---- | ----------------------- | ------- |
| Home | `index.html` | `en/index.html` |
| Terms and conditions | `terms.html` | `en/terms.html` |
| Privacy policy | `privacy.html` | `en/privacy.html` |

Spanish is the primary language and `x-default` points to it. A small inline script sends a visitor who chose English (`localStorage` key `latifi.lang` set to `en`) from a Spanish page to `en/<page>`, and a visitor who chose Spanish from an English page to `../<page>`.

Everything else the site publishes is `css/`, `js/`, `img/`, `robots.txt` and `sitemap.xml`. The deploy copies only that allowlist, see `scripts/stage-site.mjs`.

## Run the checks locally

You need Node 22 or newer and Google Chrome. Set `CHROME_PATH` when Chrome is not in a standard place. Install the tooling once:

```
npm ci --ignore-scripts
```

Then run the checks. `npm run check` runs the Node ones in order.

```
bash scripts/check-i18n-a11y.sh            # language, landmarks, skip link, hreflang guard
bash scripts/check-i18n-a11y.test.sh       # guard self-test
bash scripts/check-csp.sh                  # CSP and inline code guard
bash scripts/check-csp.test.sh             # CSP guard self-test
node scripts/check-meta.mjs --self-test    # meta tags, canonical, hreflang, sitemap, robots
node scripts/check-meta.mjs --strict
node scripts/check-i18n-parity.mjs --self-test
node scripts/check-i18n-parity.mjs         # Spanish (root) and English (en/) pages carry the same structure
node scripts/check-contrast.mjs            # WCAG contrast computed from the real CSS tokens
node scripts/ui-check.mjs                  # browser scenarios in headless Chrome
node scripts/lighthouse-check.mjs          # Accessibility and SEO of six pages, 90 or higher
```

The Nu HTML Checker and lychee (link and fragment check) run only in CI. The release flow and the branch rules are in [CONTRIBUTING.md](CONTRIBUTING.md). The accessibility evidence is in [docs/A11Y-REPORT.md](docs/A11Y-REPORT.md).

## Images

App screenshots live in `img/app/` as WebP at 320 and 640 px wide, one set per language (`-en` and `-es`). To refresh one, export the PNG at the same aspect ratio and run `cwebp -q 78 -m 6 -sharp_yuv -resize 640 1436 in.png -o img/app/NAME-LANG-640.webp`, then repeat at 320 by 718. The illustrations `loop.svg`, `flow.svg` and `trust.svg` and the icon sprite `icons.svg` are plain SVG and carry no text, so both languages share them.

## Deploy

A push to `main` (a release merge) runs `.github/workflows/pages.yml`. It stages the allowlisted files in strict mode, so the job fails when an expected file is missing, and publishes them to GitHub Pages over HTTPS. Pull requests never deploy.

## Replace the download link

Until Phase 7 provides the real distribution URL, the Download for Android button points at the page itself and carries `data-placeholder="true"`. The page shows no status line or notice about it: the button is a placeholder link until the real URL exists.

To switch it on, make two edits in each of `index.html` and `en/index.html`, in the Download section:

1. Set the `href` of the link (Descargar para Android, or Download for Android) to the real distribution URL.
2. Remove the `data-placeholder="true"` attribute from that same link.

Run `node scripts/ui-check.mjs` afterwards. If the new URL leaves the site, check the CSP: a plain link needs no change, because `default-src 'none'` does not restrict navigation.

## Product video

The "About the product" video is a YouTube embed (`https://www.youtube-nocookie.com/embed/e3YCgq88J7c`) in the slot with `id="video-slot"` on both home pages. The frame stays empty until the visitor scrolls within 200 px of it, then `js/main.js` copies `data-src` to `src`. The CSP carries `frame-src https://www.youtube-nocookie.com`, and a link to the video on YouTube sits under the player.

To change the video, edit the `data-src` attribute and the YouTube link on both pages, then run `bash scripts/check-csp.sh`, `node scripts/ui-check.mjs` and `node scripts/check-i18n-parity.mjs`. If the host changes, update the CSP `frame-src` and both privacy pages too.

## Change the site URL

Every canonical, hreflang, Open Graph and sitemap URL is absolute and starts with the value in `scripts/site-url.txt`. To move the site to another address (a custom domain, for example), run one command:

```
node scripts/set-site-url.mjs --dry-run https://new.example.org/
node scripts/set-site-url.mjs https://new.example.org/
```

The new URL must start with `https://` and end with a slash. The command rewrites every html, xml and txt file outside `node_modules`, `.git` and `_site`, then rewrites `scripts/site-url.txt`. After it runs, execute `node scripts/check-meta.mjs --strict` and `bash scripts/check-csp.sh`, then commit and release. The legal URLs that the Android app uses change with the site URL, so update its configuration in the same release.

## Legal URLs for the Android app

The app reads two settings, `LATIFI_TERMS_URL` and `LATIFI_PRIVACY_URL`. Use the site URL from `scripts/site-url.txt` plus these paths:

| Setting | Spanish | English |
| ------- | ------- | ------- |
| `LATIFI_TERMS_URL` | `terms.html` | `en/terms.html` |
| `LATIFI_PRIVACY_URL` | `privacy.html` | `en/privacy.html` |

With the default site URL, the Spanish terms page is `https://arquitectura-de-softwares-emergentes.github.io/latifi-landing/terms.html`. GitHub Pages serves these paths with the `.html` extension, so keep it.

## Analytics

The site has none: no cookies, no analytics and no tracking. The one value it stores is the chosen language in `localStorage`, and it never leaves the device. If anyone ever adds analytics or cookies, change the privacy pages first, in both languages, and then the code.
