// lighthouse-check.mjs: gate Lighthouse Accessibility and SEO on a staged copy of the site.
// Usage: node scripts/lighthouse-check.mjs
// Env:   MIN_SCORE (default 0.90), LIGHTHOUSE_BIN, CHROME_PATH
//
// The staged copy is served under the same path prefix as the Pages site, with the site URL
// rewritten to the local origin, so canonical, hreflang and og URLs match the served host.
// Failures print as "page: reason". Exit code 1 on any failure.

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

function pct(score) {
  return score === null || score === undefined ? ' n/a' : String(Math.round(score * 100)).padStart(4);
}

async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error('lighthouse-check: no Chrome binary found (set CHROME_PATH)');
    return 1;
  }

  const prefix = new URL(readSiteUrl(ROOT)).pathname;
  const work = mkdtempSync(path.join(os.tmpdir(), 'latifi-lh-'));
  let server;
  let failures = 0;
  try {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}${prefix}`;
    const site = path.join(work, 'site');
    stage({ src: ROOT, dest: site, baseUrl: base });
    server = await serve({ dir: site, prefix, port });

    const pages = listPages(site);
    console.log(`lighthouse-check: ${pages.length} pages, minimum score ${Math.round(MIN_SCORE * 100)}`);
    console.log('page                    a11y   seo');

    for (const page of pages) {
      const url = server.base + page.slice(1);
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
        const audit = report.audits[id];
        if (!audit || audit.scoreDisplayMode === 'notApplicable') {
          continue;
        }
        if (audit.score !== 1) {
          console.log(`${page}: audit ${id} did not pass (${audit.title})`);
          failures += 1;
        }
      }
    }
  } finally {
    if (server) {
      await server.close();
    }
    rmSync(work, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.log(`lighthouse-check: ${failures} failure(s)`);
    return 1;
  }
  console.log('lighthouse-check: ok');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`lighthouse-check: ${error.message}`);
    process.exit(1);
  },
);
