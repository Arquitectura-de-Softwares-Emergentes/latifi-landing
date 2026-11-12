// site.mjs: shared helpers for the verification harness (stage, serve, find Chrome, list pages).
// Node built-ins only. Every caller derives its root from import.meta.url, never from the cwd.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Repository root: scripts/lib/site.mjs sits two levels below it.
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// What the static site is made of. Anything else (scripts, docs, .git, .github, node_modules)
// never reaches the staged copy.
const ALLOWED_FILES = ['index.html', 'terms.html', 'privacy.html', 'robots.txt', 'sitemap.xml'];
const ALLOWED_DIRS = ['css', 'js', 'img'];
const ES_DIR = 'es';

const REQUIRED_FILES = [
  'index.html',
  'es/index.html',
  'terms.html',
  'privacy.html',
  'es/terms.html',
  'es/privacy.html',
  'css/main.css',
  'js/main.js',
  'img/og-latifi.png',
  'robots.txt',
  'sitemap.xml',
];

const PAGE_PATHS = [
  ['/', 'index.html'],
  ['/es/', 'es/index.html'],
  ['/terms.html', 'terms.html'],
  ['/privacy.html', 'privacy.html'],
  ['/es/terms.html', 'es/terms.html'],
  ['/es/privacy.html', 'es/privacy.html'],
];

const TEXT_EXTENSIONS = new Set(['.html', '.xml', '.txt']);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export function readSiteUrl(root = repoRoot) {
  return readFileSync(path.join(root, 'scripts', 'site-url.txt'), 'utf8').trim();
}

function copyTree(srcDir, destDir, filter) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') {
      continue;
    }
    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(from, to, filter);
    } else if (entry.isFile() && filter(entry.name)) {
      cpSync(from, to);
    }
  }
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

// stage({src, dest, baseUrl, strict}): copy the allowlist into dest. With baseUrl, every
// occurrence of the site URL inside the staged html, xml and txt files becomes baseUrl.
// Returns the number of files copied.
export function stage({ src, dest, baseUrl, strict = false }) {
  const from = path.resolve(src);
  const to = path.resolve(dest);

  // rmSync below is recursive: never let it reach the source tree or one of its parents.
  const rel = path.relative(to, from);
  if (to === path.parse(to).root || rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    console.error(`stage: refusing to use ${to} as destination (it contains the source ${from})`);
    process.exit(1);
  }

  if (strict) {
    const missing = REQUIRED_FILES.filter((file) => !existsSync(path.join(from, file)));
    if (missing.length > 0) {
      for (const file of missing) {
        console.error(`${file}: missing from the site`);
      }
      process.exit(1);
    }
  }

  const siteUrl = baseUrl ? readSiteUrl(from) : null;

  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });

  for (const file of ALLOWED_FILES) {
    if (existsSync(path.join(from, file))) {
      cpSync(path.join(from, file), path.join(to, file));
    }
  }
  for (const dir of ALLOWED_DIRS) {
    if (existsSync(path.join(from, dir))) {
      copyTree(path.join(from, dir), path.join(to, dir), () => true);
    }
  }
  if (existsSync(path.join(from, ES_DIR))) {
    copyTree(path.join(from, ES_DIR), path.join(to, ES_DIR), (name) => name.endsWith('.html'));
  }

  const files = listFiles(to);
  if (baseUrl) {
    for (const file of files) {
      if (TEXT_EXTENSIONS.has(path.extname(file))) {
        const text = readFileSync(file, 'utf8');
        if (text.includes(siteUrl)) {
          writeFileSync(file, text.split(siteUrl).join(baseUrl));
        }
      }
    }
  }
  return files.length;
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// serve({dir, prefix, port}): static server on 127.0.0.1 that answers under the URL path prefix,
// exactly as GitHub Pages does for a project site. Resolves to {origin, base, port, close}.
export function serve({ dir, prefix = '/', port = 0 }) {
  const root = path.resolve(dir);
  const mount = prefix.endsWith('/') ? prefix : prefix + '/';

  const send = (res, status, body, type = 'text/plain; charset=utf-8', extra = {}) => {
    res.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    });
    res.end(body);
  };

  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'Method not allowed');
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    } catch (error) {
      send(res, 400, 'Bad request');
      return;
    }
    if (pathname.includes('\0')) {
      send(res, 400, 'Bad request');
      return;
    }
    if (pathname === mount.slice(0, -1) && mount !== '/') {
      send(res, 301, '', 'text/plain; charset=utf-8', { Location: mount });
      return;
    }
    if (!pathname.startsWith(mount)) {
      send(res, 404, 'Not found');
      return;
    }
    // Normalize after decoding, then require the result to stay inside dir (T-06-04).
    const relative = path.posix.normalize('/' + pathname.slice(mount.length)).slice(1);
    let target = path.join(root, relative);
    if (target !== root && !target.startsWith(root + path.sep)) {
      send(res, 404, 'Not found');
      return;
    }
    try {
      if (statSync(target).isDirectory()) {
        target = path.join(target, 'index.html');
      }
      const body = readFileSync(target);
      const type = CONTENT_TYPES[path.extname(target)] || 'application/octet-stream';
      send(res, 200, req.method === 'HEAD' ? '' : body, type);
    } catch (error) {
      send(res, 404, 'Not found');
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const bound = server.address().port;
      const origin = `http://127.0.0.1:${bound}`;
      resolve({
        origin,
        base: origin + mount,
        port: bound,
        close: () => new Promise((done) => {
          server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  });
}

// findChrome(): CHROME_PATH, then the macOS app, then common binaries on PATH. Null when none.
export function findChrome() {
  const candidates = [];
  if (process.env.CHROME_PATH) {
    candidates.push(process.env.CHROME_PATH);
  }
  candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium']) {
    try {
      const found = execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (found) {
        return found;
      }
    } catch (error) {
      // not on PATH, try the next name
    }
  }
  return null;
}

// listPages(dir): page paths (relative to the site base, starting with "/") that exist in dir.
export function listPages(dir) {
  return PAGE_PATHS.filter(([, file]) => existsSync(path.join(dir, file))).map(([page]) => page);
}
