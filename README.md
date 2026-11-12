# latifi-landing

The public website of LatiFi, a peer to peer lending app for Android that runs on a test network. This repository holds a static site in English and Spanish: plain HTML5, CSS3 and a small JavaScript file, with no build step and no runtime libraries. The only dependency is Lighthouse, which the checks use and which never reaches the site.

Pages:

| Page | English | Spanish |
| ---- | ------- | ------- |
| Home | `index.html` | `es/index.html` |
| Terms and conditions | `terms.html` | `es/terms.html` |
| Privacy policy | `privacy.html` | `es/privacy.html` |

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
node scripts/check-i18n-parity.mjs         # English and Spanish pages carry the same structure
node scripts/check-contrast.mjs            # WCAG contrast computed from the real CSS tokens
node scripts/ui-check.mjs                  # browser scenarios in headless Chrome
node scripts/lighthouse-check.mjs          # Accessibility and SEO of six pages, 90 or higher
```

The Nu HTML Checker and lychee (link and fragment check) run only in CI. The release flow and the branch rules are in [CONTRIBUTING.md](CONTRIBUTING.md). The accessibility evidence is in [docs/A11Y-REPORT.md](docs/A11Y-REPORT.md).

## Deploy

A push to `main` (a release merge) runs `.github/workflows/pages.yml`. It stages the allowlisted files in strict mode, so the job fails when an expected file is missing, and publishes them to GitHub Pages over HTTPS. Pull requests never deploy.

## Replace the download link

Until Phase 7 provides the real distribution URL, the Download for Android button points at the page itself and carries `data-placeholder="true"`. While that attribute exists, the status line "The download link goes live with the first release" stays visible.

To switch it on, make two edits in each of `index.html` and `es/index.html`, in the Download section:

1. Set the `href` of the link (Download for Android, or Descargar para Android) to the real distribution URL.
2. Remove the `data-placeholder="true"` attribute from that same link.

The status line hides itself once the attribute is gone. Run `node scripts/ui-check.mjs` afterwards. If the new URL leaves the site, check the CSP: a plain link needs no change, because `default-src 'none'` does not restrict navigation.

## Enable the product video

The video slot ships hidden and inert. It makes no request and takes no space. To enable it, do this on both home pages, with a video that has captions:

1. Set the `data-src` attribute of the slot iframe to an `https` URL. Other schemes are ignored.
2. Remove the `hidden` attribute from the `figure` with `id="video-slot"` and from the `div` with `id="video-transcript"`.
3. Write the transcript inside the `video-transcript` block, and make sure the video has captions.
4. Add the video origin to the CSP meta tag of both pages as a `frame-src` directive, for example `frame-src https://www.youtube-nocookie.com`. Without it the browser blocks the frame, and the page shows the error line and the transcript link.
5. Run `bash scripts/check-csp.sh`, `node scripts/ui-check.mjs` and `node scripts/check-i18n-parity.mjs`.
6. Update the privacy pages if the video host changes what the visitor shares. They already name the video frame as the only optional external request.

## Change the site URL

Every canonical, hreflang, Open Graph and sitemap URL is absolute and starts with the value in `scripts/site-url.txt`. To move the site to another address (a custom domain, for example), run one command:

```
node scripts/set-site-url.mjs --dry-run https://new.example.org/
node scripts/set-site-url.mjs https://new.example.org/
```

The new URL must start with `https://` and end with a slash. The command rewrites every html, xml and txt file outside `node_modules`, `.git` and `_site`, then rewrites `scripts/site-url.txt`. After it runs, execute `node scripts/check-meta.mjs --strict` and `bash scripts/check-csp.sh`, then commit and release. The legal URLs that the Android app uses change with the site URL, so update its configuration in the same release.

## Legal URLs for the Android app

The app reads two settings, `LATIFI_TERMS_URL` and `LATIFI_PRIVACY_URL`. Use the site URL from `scripts/site-url.txt` plus these paths:

| Setting | English | Spanish |
| ------- | ------- | ------- |
| `LATIFI_TERMS_URL` | `terms.html` | `es/terms.html` |
| `LATIFI_PRIVACY_URL` | `privacy.html` | `es/privacy.html` |

With the default site URL, the English terms page is `https://arquitectura-de-softwares-emergentes.github.io/latifi-landing/terms.html`. GitHub Pages serves these paths with the `.html` extension, so keep it.

## Analytics

The site has none: no cookies, no analytics and no tracking. The one value it stores is the chosen language in `localStorage`, and it never leaves the device. If anyone ever adds analytics or cookies, change the privacy pages first, in both languages, and then the code.
