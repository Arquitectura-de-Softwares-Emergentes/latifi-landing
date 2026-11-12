// set-site-url.mjs: change the public base URL of the site everywhere with one command.
// Usage: node scripts/set-site-url.mjs [--dry-run] NEW_URL
//   NEW_URL must start with https:// and end with a slash.
//   The old URL is the content of scripts/site-url.txt. Every html, xml and txt file outside
//   node_modules, .git and _site has the old URL replaced, then site-url.txt is rewritten.
//   --dry-run lists the files that would change and writes nothing.
// Node built-ins only. The root comes from import.meta.url, never from the cwd.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '_site']);
const EXTENSIONS = new Set(['.html', '.xml', '.txt']);

const args = process.argv.slice(2);
let dryRun = false;
const positional = [];
for (const arg of args) {
  if (arg === '--dry-run') {
    dryRun = true;
  } else {
    positional.push(arg);
  }
}

function fail(message) {
  console.error(`set-site-url: ${message}`);
  console.error('usage: node scripts/set-site-url.mjs [--dry-run] NEW_URL');
  process.exit(2);
}

if (positional.length !== 1) {
  fail('expected exactly one NEW_URL');
}
const newUrl = positional[0];
if (!newUrl.startsWith('https://')) {
  fail(`NEW_URL must start with https:// (got ${newUrl})`);
}
if (!newUrl.endsWith('/')) {
  fail(`NEW_URL must end with a slash (got ${newUrl})`);
}
if (/\s/.test(newUrl)) {
  fail('NEW_URL must not contain whitespace');
}

const urlFile = path.join(ROOT, 'scripts', 'site-url.txt');
const oldUrl = readFileSync(urlFile, 'utf8').trim();
if (!oldUrl) {
  fail('scripts/site-url.txt is empty');
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        out.push(...walk(path.join(dir, entry.name)));
      }
    } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const changed = [];
if (newUrl !== oldUrl) {
  for (const file of walk(ROOT)) {
    const text = readFileSync(file, 'utf8');
    if (text.includes(oldUrl)) {
      changed.push(path.relative(ROOT, file));
      if (!dryRun) {
        writeFileSync(file, text.split(oldUrl).join(newUrl));
      }
    }
  }
  if (!dryRun) {
    writeFileSync(urlFile, `${newUrl}\n`);
  }
}

for (const file of changed) {
  console.log(`${dryRun ? 'would change' : 'changed'}: ${file}`);
}
if (newUrl === oldUrl) {
  console.log('set-site-url: the URL is already set, nothing to do');
} else {
  console.log(`set-site-url: ${dryRun ? 'dry run, ' : ''}${changed.length} files, ${oldUrl} -> ${newUrl}`);
}
