// check-i18n-parity.mjs: prove the English and Spanish pages keep the same structure and that
// no string was left untranslated.
// Usage: node scripts/check-i18n-parity.mjs [--self-test]
//
// Pairs checked when present: index.html with es/index.html, terms.html with es/terms.html,
// privacy.html with es/privacy.html. One side of a pair without the other is a failure.
// For each pair:
//   - the sequence of opening and closing tags is identical
//   - the attribute names of every element are identical, in order (aria-current is left out:
//     it marks the current language link and flips by design)
//   - id values are identical except the section ids that the language switch maps
//   - in-page href fragments are identical after the same id map
//   - every text node and every translatable attribute value of the Spanish page differs from
//     its English counterpart, unless it has no letters or is a proper name on the allowlist
//   - html lang is en-US on the English page and es-419 on the Spanish page
// Over the whole tree (html, css, js, md, xml, txt, outside node_modules, .git and _site):
//   - no em dash and no en dash
// --self-test mutates temporary copies and requires every mutation to fail.
// Node built-ins only. Failures print as "parity: file: reason". Success prints "parity: ok".

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PAIRS = [
  ['index.html', 'es/index.html'],
  ['terms.html', 'es/terms.html'],
  ['privacy.html', 'es/privacy.html'],
];

// Section ids that differ between languages (the same map as ID_MAP in js/main.js).
const ID_MAP = {
  'how-it-works': 'como-funciona',
  benefits: 'beneficios',
  security: 'seguridad',
  download: 'descarga',
  screens: 'pantallas',
  reputation: 'reputacion',
  verify: 'verifica',
};

// Strings that read the same in both languages.
const ALLOWLIST = new Set([
  'LatiFi',
  'LatiFi Wallet',
  'English',
  'Español',
  'Android',
  'Polygon Amoy',
  'UPC',
  'SI728',
  'FAQ',
  'Legal',
  'Sora',
  'Inter',
  'SIL OFL 1.1',
  'latifi.lang',
  'GitHub',
  'LoanBook',
  'Polygonscan',
  'latifi-contracts',
  'latifi-api',
  'latifi-android',
  'latifi-landing',
  'latifi-report',
  '0xccb8ad15a4954138c987a77924ceab468a843266',
]);

// Attributes whose value is read by people, on any element.
const TEXT_ATTRIBUTES = new Set(['aria-label', 'alt', 'title']);

// Meta tags whose content is read by people (matched on name or property).
const TEXT_META = new Set([
  'description',
  'keywords',
  'og:title',
  'og:description',
  'og:site_name',
  'twitter:title',
  'twitter:description',
  'twitter:image:alt',
]);

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style']);

// The dash characters, written as escapes so this file never contains one.
const DASH = /[–—]/;
const DASH_EXTENSIONS = new Set(['.html', '.css', '.js', '.md', '.xml', '.txt']);
const SKIP_DIRS = new Set(['node_modules', '.git', '_site']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    const known = ENTITIES[body.toLowerCase()];
    return known === undefined ? match : known;
  });
}

// Tolerant tokenizer: tags with attributes, text nodes. Comments, the doctype and the bodies of
// script and style elements are skipped.
export function tokenize(html) {
  const tokens = [];
  let i = 0;
  const n = html.length;
  while (i < n) {
    if (html[i] !== '<') {
      const end = html.indexOf('<', i);
      const stop = end === -1 ? n : end;
      tokens.push({ type: 'text', text: html.slice(i, stop) });
      i = stop;
      continue;
    }
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html[i + 1] === '!' || html[i + 1] === '?') {
      const end = html.indexOf('>', i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    const nameMatch = /^<(\/?)([a-zA-Z][^\s/>]*)/.exec(html.slice(i, i + 80));
    if (!nameMatch) {
      tokens.push({ type: 'text', text: '<' });
      i += 1;
      continue;
    }
    const closing = nameMatch[1] === '/';
    const name = nameMatch[2].toLowerCase();
    let j = i + nameMatch[0].length;
    const attrs = [];
    let selfClosing = false;
    while (j < n && html[j] !== '>') {
      if (/\s/.test(html[j])) {
        j += 1;
      } else if (html[j] === '/') {
        selfClosing = true;
        j += 1;
      } else {
        selfClosing = false;
        const attrMatch = /^[^\s=>/]+/.exec(html.slice(j));
        const attrName = attrMatch[0].toLowerCase();
        j += attrMatch[0].length;
        let value = '';
        const rest = /^\s*=\s*/.exec(html.slice(j, j + 40));
        if (rest) {
          j += rest[0].length;
          if (html[j] === '"' || html[j] === "'") {
            const quote = html[j];
            const close = html.indexOf(quote, j + 1);
            const stop = close === -1 ? n : close;
            value = html.slice(j + 1, stop);
            j = stop + 1;
          } else {
            const bare = /^[^\s>]*/.exec(html.slice(j));
            value = bare[0];
            j += bare[0].length;
          }
        }
        attrs.push({ name: attrName, value: decode(value) });
      }
    }
    i = j < n ? j + 1 : n;
    tokens.push({ type: 'tag', name, closing, selfClosing, attrs });
    if (!closing && RAW_TEXT.has(name)) {
      const lower = html.toLowerCase();
      const end = lower.indexOf('</' + name, i);
      i = end === -1 ? n : end;
    }
  }
  return tokens;
}

function collapse(text) {
  return decode(text).replace(/\s+/g, ' ').trim();
}

// Reduce a token list to what the checks compare.
export function summarize(html) {
  const tokens = tokenize(html);
  const sequence = [];
  const elements = [];
  const texts = [];
  const attrTexts = [];
  const ids = [];
  const hrefs = [];
  let htmlLang = null;
  for (const token of tokens) {
    if (token.type === 'text') {
      const text = collapse(token.text);
      if (text !== '') {
        texts.push(text);
      }
      continue;
    }
    sequence.push((token.closing ? '/' : '') + token.name);
    if (token.closing) {
      continue;
    }
    const attrNames = token.attrs.map((attr) => attr.name).filter((name) => name !== 'aria-current');
    elements.push({ name: token.name, attrs: attrNames });
    if (token.name === 'html') {
      const lang = token.attrs.find((attr) => attr.name === 'lang');
      htmlLang = lang ? lang.value : null;
    }
    let metaKey = null;
    if (token.name === 'meta') {
      const key = token.attrs.find((attr) => attr.name === 'name' || attr.name === 'property');
      metaKey = key ? key.value.toLowerCase() : null;
    }
    for (const attr of token.attrs) {
      if (attr.name === 'id') {
        ids.push(attr.value);
      } else if (attr.name === 'href' && attr.value.startsWith('#')) {
        hrefs.push(attr.value.slice(1));
      } else if (TEXT_ATTRIBUTES.has(attr.name) && attr.value.trim() !== '') {
        attrTexts.push({ label: `${token.name}[${attr.name}]`, text: collapse(attr.value) });
      } else if (attr.name === 'content' && metaKey && TEXT_META.has(metaKey)) {
        attrTexts.push({ label: `meta[${metaKey}]`, text: collapse(attr.value) });
      }
    }
  }
  return { sequence, elements, texts, attrTexts, ids, hrefs, htmlLang };
}

function exempt(text) {
  return !/\p{L}/u.test(text) || ALLOWLIST.has(text);
}

function firstDifference(a, b) {
  const length = Math.min(a.length, b.length);
  for (let k = 0; k < length; k += 1) {
    if (a[k] !== b[k]) {
      return k;
    }
  }
  return length;
}

function short(text) {
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

// Compare one pair of already-read files. Returns an array of failure strings.
export function comparePair(enName, enHtml, esName, esHtml) {
  const failures = [];
  const fail = (file, reason) => failures.push(`${file}: ${reason}`);
  const en = summarize(enHtml);
  const es = summarize(esHtml);

  if (en.htmlLang !== 'en-US') {
    fail(enName, `html lang is "${en.htmlLang}", expected en-US`);
  }
  if (es.htmlLang !== 'es-419') {
    fail(esName, `html lang is "${es.htmlLang}", expected es-419`);
  }

  if (en.sequence.join(' ') !== es.sequence.join(' ')) {
    const at = firstDifference(en.sequence, es.sequence);
    fail(esName, `tag structure differs from ${enName} at tag ${at + 1} (${en.sequence[at] || 'end'} against ${es.sequence[at] || 'end'}), ${en.sequence.length} against ${es.sequence.length} tags`);
    return failures;
  }

  en.elements.forEach((element, k) => {
    const other = es.elements[k];
    if (element.attrs.join(' ') !== other.attrs.join(' ')) {
      fail(esName, `attributes of <${element.name}> number ${k + 1} differ from ${enName} (${element.attrs.join(' ') || 'none'} against ${other.attrs.join(' ') || 'none'})`);
    }
  });

  const mapId = (id) => (Object.prototype.hasOwnProperty.call(ID_MAP, id) ? ID_MAP[id] : id);
  if (en.ids.length !== es.ids.length) {
    fail(esName, `${es.ids.length} ids against ${en.ids.length} in ${enName}`);
  } else {
    en.ids.forEach((id, k) => {
      if (mapId(id) !== es.ids[k]) {
        fail(esName, `id "${es.ids[k]}" should be "${mapId(id)}" (${enName} has "${id}")`);
      }
    });
  }
  if (en.hrefs.length !== es.hrefs.length) {
    fail(esName, `${es.hrefs.length} in-page links against ${en.hrefs.length} in ${enName}`);
  } else {
    en.hrefs.forEach((href, k) => {
      if (mapId(href) !== es.hrefs[k]) {
        fail(esName, `in-page link "#${es.hrefs[k]}" should be "#${mapId(href)}"`);
      }
    });
  }

  if (en.texts.length !== es.texts.length) {
    fail(esName, `${es.texts.length} text nodes against ${en.texts.length} in ${enName}`);
  } else {
    en.texts.forEach((text, k) => {
      if (es.texts[k] === text && !exempt(text)) {
        fail(esName, `untranslated text "${short(text)}"`);
      }
    });
  }
  if (en.attrTexts.length !== es.attrTexts.length) {
    fail(esName, `${es.attrTexts.length} translatable attributes against ${en.attrTexts.length} in ${enName}`);
  } else {
    en.attrTexts.forEach((entry, k) => {
      if (es.attrTexts[k].text === entry.text && !exempt(entry.text)) {
        fail(esName, `untranslated ${entry.label} "${short(entry.text)}"`);
      }
    });
  }
  return failures;
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        walk(path.join(dir, entry.name), out);
      }
    } else if (entry.isFile() && DASH_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

// Run every check against the tree at root. Returns an array of failure strings.
export function check(root) {
  const failures = [];
  let found = 0;
  for (const [enName, esName] of PAIRS) {
    const enPath = path.join(root, enName);
    const esPath = path.join(root, esName);
    const hasEn = existsSync(enPath);
    const hasEs = existsSync(esPath);
    if (hasEn !== hasEs) {
      failures.push(`${hasEn ? esName : enName}: missing, its pair ${hasEn ? enName : esName} exists`);
      continue;
    }
    if (hasEn) {
      found += 1;
      failures.push(...comparePair(enName, readFileSync(enPath, 'utf8'), esName, readFileSync(esPath, 'utf8')));
    }
  }
  if (found === 0 && failures.length === 0) {
    failures.push('index.html: no page pairs found');
  }
  for (const file of walk(root, [])) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, k) => {
      if (DASH.test(line)) {
        failures.push(`${path.relative(root, file)}: em dash or en dash on line ${k + 1}`);
      }
    });
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

function selfTest() {
  const work = mkdtempSync(path.join(os.tmpdir(), 'latifi-parity-'));
  let problems = 0;
  const copyTree = (name) => {
    const dest = path.join(work, name);
    mkdirSync(dest, { recursive: true });
    for (const pair of PAIRS) {
      for (const file of pair) {
        if (existsSync(path.join(REPO, file))) {
          mkdirSync(path.dirname(path.join(dest, file)), { recursive: true });
          cpSync(path.join(REPO, file), path.join(dest, file));
        }
      }
    }
    return dest;
  };

  const edit = (file, change) => (root) => {
    const target = path.join(root, file);
    const before = readFileSync(target, 'utf8');
    const after = change(before);
    if (after === before) {
      throw new Error(`mutation did not change ${file}`);
    }
    writeFileSync(target, after);
  };

  const mutations = [
    {
      name: 'English sentence left in the Spanish page',
      apply: edit('es/index.html', (text) => text.replace('Crea tu billetera.', 'Create your wallet.')),
    },
    {
      name: 'list item removed from the Spanish page',
      apply: edit('es/index.html', (text) => text.replace(/\s*<li class="step">[\s\S]*?<\/li>/, '')),
    },
    {
      name: 'dash added to the English page',
      apply: edit('index.html', (text) => text.replace('Create your wallet.', 'Create your wallet – now.')),
    },
  ];

  try {
    const clean = copyTree('clean');
    const baseline = check(clean);
    if (baseline.length > 0) {
      console.log(`parity self-test: the unmodified copy already fails: ${baseline[0]}`);
      problems += 1;
    }
    mutations.forEach((mutation, k) => {
      const root = copyTree(`mutation-${k}`);
      try {
        mutation.apply(root);
      } catch (error) {
        console.log(`parity self-test: cannot apply "${mutation.name}": ${error.message}`);
        problems += 1;
        return;
      }
      const found = check(root);
      if (found.length === 0) {
        console.log(`parity self-test: NOT CAUGHT: ${mutation.name}`);
        problems += 1;
      } else {
        console.log(`parity self-test: caught: ${mutation.name} (${found[0]})`);
      }
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  if (problems > 0) {
    return 1;
  }
  console.log('parity self-test: ok');
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    return selfTest();
  }
  const failures = check(REPO);
  if (failures.length > 0) {
    for (const failure of failures) {
      console.log(`parity: ${failure}`);
    }
    return 1;
  }
  console.log('parity: ok');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
