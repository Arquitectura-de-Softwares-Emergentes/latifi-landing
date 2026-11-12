// lighthouse-check.mjs: gate Lighthouse Accessibility and SEO on all six pages.
// Usage: node scripts/lighthouse-check.mjs [--live BASE_URL]
//   default          audit a staged copy of the site served locally
//   --live BASE_URL  skip staging and audit BASE_URL plus each page path (BASE_URL must be https)
// Env:   MIN_SCORE (default 0.90), PAGES (comma separated page paths such as "/,/es/" to narrow
//        the run), LIGHTHOUSE_BIN, CHROME_PATH
//
// The staged copy is served under the same path prefix as the Pages site, with the site URL
// rewritten to the local origin, so canonical, hreflang and og URLs match the served host.
// Failures print as "page: reason". Success prints "lighthouse: ok N pages". Exit code 1 on any failure.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, freePort, listPages, readSiteUrl, serve, stage } from './lib/site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_SCORE = Number(process.env.MIN_SCORE || '0.90');

const REQUIRED_AUDITS = [
  'color-contrast',
  'target-size',
  'html-has-lang',
  'html-lang-valid',
  'document-title',
  'meta-description',
  'hreflang',
  'canonical',
  'is-crawlable',
  'link-text',
  'crawlable-anchors',
  'image-alt',
  'heading-order',
  'tabindex',
  'button-name',
  'link-name',
  'aria-valid-attr',
  'aria-allowed-attr',
  'aria-required-children',
  'aria-required-parent',
  'aria-roles',
  'list',
  'listitem',
];

function lighthouseBin() {
  if (process.env.LIGHTHOUSE_BIN) {
    return process.env.LIGHTHOUSE_BIN;
  }
  const local = path.join(ROOT, 'node_modules', '.bin', 'lighthouse');
  return existsSync(local) ? local : 'lighthouse';
}

// Async on purpose: the static server lives in this process and must keep answering.
function runLighthouse(url, chromePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      lighthouseBin(),
      [
        url,
        '--only-categories=accessibility,seo',
        '--output=json',
        '--quiet',
        '--chrome-flags=--headless=new --no-sandbox',
      ],
      { env: { ...process.env, CHROME_PATH: chromePath }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`lighthouse exited with ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`));
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch (error) {
        reject(new Error(`lighthouse printed no JSON: ${error.message}`));
      }
    });
  });
}

// parseArgs(argv): returns {live} where live is a normalized https base URL or null.
// Throws on an unknown option or a base URL that does not start with https.
function parseArgs(argv) {
  let live = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--live') {
      const value = argv[i + 1];
      if (!value || !value.startsWith('https://')) {
        throw new Error('--live needs a base URL that starts with https://');
      }
      live = value.endsWith('/') ? value : value + '/';
      i += 1;
    } else {
      throw new Error(`unknown option ${argv[i]}`);
    }
  }
  return { live };
}

function narrow(pages) {
  const wanted = (process.env.PAGES || '').split(',').map((page) => page.trim()).filter(Boolean);
  if (wanted.length === 0) {
    return pages;
  }
  const unknown = wanted.filter((page) => !pages.includes(page));
  if (unknown.length > 0) {
    throw new Error(`PAGES names unknown page(s): ${unknown.join(', ')}`);
  }
  return pages.filter((page) => wanted.includes(page));
}

function pct(score) {
  return score === null || score === undefined ? ' n/a' : String(Math.round(score * 100)).padStart(4);
}

async function audit(base, pages, chromePath) {
  let failures = 0;
  console.log(`lighthouse-check: ${pages.length} pages, minimum score ${Math.round(MIN_SCORE * 100)}`);
  console.log('page                    a11y   seo');

  for (const page of pages) {
    const url = base + page.slice(1);
    let report;
    try {
      report = await runLighthouse(url, chromePath);
    } catch (error) {
      console.log(`${page}: ${error.message}`);
      failures += 1;
      continue;
    }
    const a11y = report.categories.accessibility.score;
    const seo = report.categories.seo.score;
    console.log(`${page.padEnd(22)} ${pct(a11y)}  ${pct(seo)}`);
    if (a11y === null || a11y < MIN_SCORE) {
      console.log(`${page}: accessibility score below ${MIN_SCORE}`);
      failures += 1;
    }
    if (seo === null || seo < MIN_SCORE) {
      console.log(`${page}: seo score below ${MIN_SCORE}`);
      failures += 1;
    }
    for (const id of REQUIRED_AUDITS) {
      const result = report.audits[id];
      if (!result || result.scoreDisplayMode === 'notApplicable') {
        continue;
      }
      if (result.score !== 1) {
        console.log(`${page}: audit ${id} did not pass (${result.title})`);
        failures += 1;
      }
    }
  }
  return failures;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`lighthouse-check: ${error.message}`);
    return 1;
  }

  const chromePath = findChrome();
  if (!chromePath) {
    console.error('lighthouse-check: no Chrome binary found (set CHROME_PATH)');
    return 1;
  }

  let failures = 0;
  let count = 0;
  if (options.live) {
    const pages = narrow(listPages(ROOT));
    count = pages.length;
    failures = await audit(options.live, pages, chromePath);
  } else {
    const prefix = new URL(readSiteUrl(ROOT)).pathname;
    const work = mkdtempSync(path.join(os.tmpdir(), 'latifi-lh-'));
    let server;
    try {
      const port = await freePort();
      const base = `http://127.0.0.1:${port}${prefix}`;
      const site = path.join(work, 'site');
      stage({ src: ROOT, dest: site, baseUrl: base });
      server = await serve({ dir: site, prefix, port });
      const pages = narrow(listPages(site));
      count = pages.length;
      failures = await audit(server.base, pages, chromePath);
    } finally {
      if (server) {
        await server.close();
      }
      rmSync(work, { recursive: true, force: true });
    }
  }

  if (failures > 0) {
    console.log(`lighthouse-check: ${failures} failure(s)`);
    return 1;
  }
  console.log(`lighthouse: ok ${count} pages`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`lighthouse-check: ${error.message}`);
    process.exit(1);
  },
);
