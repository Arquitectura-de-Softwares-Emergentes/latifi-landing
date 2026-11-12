// check-meta.mjs: enforce the report 6.2.4 tag set on the six pages, plus robots.txt and sitemap.xml.
// Usage: node scripts/check-meta.mjs [--strict] [--self-test]
//   default      checks the pages that exist
//   --strict     fails when any of the six pages, robots.txt or sitemap.xml is missing
//   --self-test  applies one mutation per case to a temporary copy and requires the check to fail
// Failures print as "file: reason". Success prints "meta: ok". Size budget lines are informational
// and never fail the run. Node built-ins only.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSiteUrl } from './lib/site.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HOME_EN_KEYWORDS = 'microloans, P2P loans, blockchain, stablecoins, credit reputation, digital wallet, LatiFi Wallet, Peru';
const HOME_ES_KEYWORDS = 'microcréditos, préstamos P2P, blockchain, stablecoins, reputación crediticia, billetera digital, LatiFi Wallet, Perú';

// UI-SPEC "Meta tags per page" table. file is relative to the repo root, rel is the URL path
// below the site URL, twin is the rel of the same page in the other language.
const PAGES = [
  {
    file: 'index.html',
    rel: '',
    lang: 'en-US',
    locale: 'en_US',
    altLocale: 'es_LA',
    keywords: HOME_EN_KEYWORDS,
    title: 'LatiFi: P2P microloans with verifiable reputation',
    description: "LatiFi connects borrowers and lenders through blockchain-based P2P microloans. It never holds your funds and shows each applicant's reputation.",
  },
  {
    file: 'es/index.html',
    rel: 'es/',
    lang: 'es-419',
    locale: 'es_LA',
    altLocale: 'en_US',
    keywords: HOME_ES_KEYWORDS,
    title: 'LatiFi: microcréditos P2P con reputación verificable',
    description: 'LatiFi conecta a prestatarios y prestamistas con microcréditos P2P sobre blockchain. No custodia tu dinero y muestra la reputación de cada solicitante.',
  },
  {
    file: 'terms.html',
    rel: 'terms.html',
    lang: 'en-US',
    locale: 'en_US',
    altLocale: 'es_LA',
    keywords: null,
    title: 'LatiFi: terms and conditions',
    description: 'Conditions of use for LatiFi Wallet: rules for requesting, funding and repaying P2P microloans.',
  },
  {
    file: 'es/terms.html',
    rel: 'es/terms.html',
    lang: 'es-419',
    locale: 'es_LA',
    altLocale: 'en_US',
    keywords: null,
    title: 'LatiFi: términos y condiciones',
    description: 'Condiciones de uso de LatiFi Wallet: reglas para solicitar, fondear y pagar microcréditos P2P.',
  },
  {
    file: 'privacy.html',
    rel: 'privacy.html',
    lang: 'en-US',
    locale: 'en_US',
    altLocale: 'es_LA',
    keywords: null,
    title: 'LatiFi: privacy policy',
    description: 'How LatiFi handles your profile data and why it never holds your private keys or your funds.',
  },
  {
    file: 'es/privacy.html',
    rel: 'es/privacy.html',
    lang: 'es-419',
    locale: 'es_LA',
    altLocale: 'en_US',
    keywords: null,
    title: 'LatiFi: política de privacidad',
    description: 'Cómo LatiFi trata tus datos de perfil y por qué nunca custodia tus llaves privadas ni tus fondos.',
  },
];

// The English page of each pair is the counterpart used for en, en-US and x-default.
const ENGLISH_REL = { '': '', 'es/': '', 'terms.html': 'terms.html', 'es/terms.html': 'terms.html', 'privacy.html': 'privacy.html', 'es/privacy.html': 'privacy.html' };
const SPANISH_REL = { '': 'es/', 'es/': 'es/', 'terms.html': 'es/terms.html', 'es/terms.html': 'es/terms.html', 'privacy.html': 'es/privacy.html', 'es/privacy.html': 'es/privacy.html' };

const MAX_TITLE = 60;
const MAX_DESCRIPTION = 155;

function decode(text) {
  return text
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function parseAttrs(source) {
  const attrs = {};
  for (const match of source.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g)) {
    attrs[match[1].toLowerCase()] = decode(match[2]);
  }
  return attrs;
}

function readHead(html) {
  const headMatch = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html);
  const head = headMatch ? headMatch[1] : '';
  const metas = [];
  const links = [];
  for (const match of head.matchAll(/<(meta|link)\b([^>]*)>/gi)) {
    (match[1].toLowerCase() === 'meta' ? metas : links).push(parseAttrs(match[2]));
  }
  const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(head);
  const htmlLang = /<html\b[^>]*\blang="([^"]*)"/i.exec(html);
  return { metas, links, title: titleMatch ? decode(titleMatch[1].trim()) : null, htmlLang: htmlLang ? htmlLang[1] : null };
}

function byteLength(text) {
  return Buffer.byteLength(text, 'utf8');
}

// Every absolute URL must begin with the site URL. Returns the local path below the site root.
function localPathOf(url, siteUrl) {
  return url.startsWith(siteUrl) ? url.slice(siteUrl.length) : null;
}

function checkPage(root, siteUrl, page, fail) {
  const html = readFileSync(path.join(root, page.file), 'utf8');
  const { metas, links, title, htmlLang } = readHead(html);
  const name = page.file;
  const meta = (key, value) => metas.find((m) => m[key] === value);
  const content = (key, value) => {
    const found = meta(key, value);
    return found ? found.content : undefined;
  };
  const expectUrl = siteUrl + page.rel;

  if (htmlLang !== page.lang) {
    fail(name, `html lang is ${htmlLang}, expected ${page.lang}`);
  }

  // title and description
  if (title !== page.title) {
    fail(name, `title is "${title}", expected "${page.title}"`);
  }
  if (title && [...title].length > MAX_TITLE) {
    fail(name, `title has ${[...title].length} characters, the limit is ${MAX_TITLE}`);
  }
  const description = content('name', 'description');
  if (description !== page.description) {
    fail(name, `description is "${description}", expected "${page.description}"`);
  }
  if (description && [...description].length > MAX_DESCRIPTION) {
    fail(name, `description has ${[...description].length} characters, the limit is ${MAX_DESCRIPTION}`);
  }

  // keywords: required on the home pages, free on the legal pages
  const keywords = content('name', 'keywords');
  if (page.keywords !== null && keywords !== page.keywords) {
    fail(name, `keywords are "${keywords}", expected "${page.keywords}"`);
  }

  if (content('name', 'author') !== 'LatiFi') {
    fail(name, 'author must be LatiFi');
  }
  if (content('name', 'robots') !== 'index, follow') {
    fail(name, 'robots must be "index, follow"');
  }
  if (!metas.some((m) => m.charset && m.charset.toLowerCase() === 'utf-8')) {
    fail(name, 'charset utf-8 is missing');
  }

  // viewport without zoom blockers (SC 1.4.4)
  const viewport = content('name', 'viewport');
  if (viewport === undefined) {
    fail(name, 'viewport is missing');
  } else {
    const normalized = viewport.toLowerCase().replace(/\s+/g, '');
    if (normalized !== 'width=device-width,initial-scale=1') {
      fail(name, `viewport is "${viewport}", expected "width=device-width, initial-scale=1"`);
    }
    if (/user-scalable|maximum-scale|minimum-scale/.test(normalized)) {
      fail(name, 'viewport blocks zoom');
    }
  }

  if (content('name', 'theme-color') !== '#0B1F3A') {
    fail(name, 'theme-color must be #0B1F3A');
  }

  // icon link whose file exists
  const icon = links.find((l) => (l.rel || '').split(/\s+/).includes('icon'));
  if (!icon || !icon.href) {
    fail(name, 'icon link is missing');
  } else {
    const iconPath = path.resolve(path.dirname(path.join(root, page.file)), icon.href);
    if (!existsSync(iconPath)) {
      fail(name, `icon file ${icon.href} does not exist`);
    }
  }

  // canonical
  const canonical = links.find((l) => l.rel === 'canonical');
  if (!canonical || !canonical.href) {
    fail(name, 'canonical is missing');
  } else {
    if (!canonical.href.startsWith(siteUrl)) {
      fail(name, `canonical ${canonical.href} does not begin with the site URL`);
    }
    if (canonical.href !== expectUrl) {
      fail(name, `canonical is ${canonical.href}, expected ${expectUrl}`);
    }
  }

  // hreflang alternates: en, en-US, es-419, x-default, absolute, including the page itself
  const alternates = links.filter((l) => l.rel === 'alternate' && l.hreflang);
  const expectedAlternates = {
    en: siteUrl + ENGLISH_REL[page.rel],
    'en-US': siteUrl + ENGLISH_REL[page.rel],
    'es-419': siteUrl + SPANISH_REL[page.rel],
    'x-default': siteUrl + ENGLISH_REL[page.rel],
  };
  for (const [lang, href] of Object.entries(expectedAlternates)) {
    const found = alternates.filter((l) => l.hreflang === lang);
    if (found.length !== 1) {
      fail(name, `hreflang ${lang} appears ${found.length} times, expected once`);
      continue;
    }
    if (!found[0].href.startsWith(siteUrl)) {
      fail(name, `hreflang ${lang} is not absolute under the site URL (${found[0].href})`);
    } else if (found[0].href !== href) {
      fail(name, `hreflang ${lang} is ${found[0].href}, expected ${href}`);
    }
  }
  if (alternates.length !== 4) {
    fail(name, `found ${alternates.length} hreflang alternates, expected 4`);
  }

  // Open Graph
  if (content('property', 'og:title') !== page.title) {
    fail(name, 'og:title must equal the title');
  }
  if (content('property', 'og:description') !== page.description) {
    fail(name, 'og:description must equal the description');
  }
  if (content('property', 'og:type') !== 'website') {
    fail(name, 'og:type must be website');
  }
  if (content('property', 'og:site_name') !== 'LatiFi') {
    fail(name, 'og:site_name must be LatiFi');
  }
  if (content('property', 'og:url') !== expectUrl) {
    fail(name, `og:url must equal the canonical ${expectUrl}`);
  }
  if (content('property', 'og:locale') !== page.locale) {
    fail(name, `og:locale must be ${page.locale}`);
  }
  if (content('property', 'og:locale:alternate') !== page.altLocale) {
    fail(name, `og:locale:alternate must be ${page.altLocale}`);
  }
  for (const [key, value] of [['property', 'og:image'], ['name', 'twitter:image']]) {
    const image = content(key, value);
    if (!image) {
      fail(name, `${value} is missing`);
      continue;
    }
    const local = localPathOf(image, siteUrl);
    if (local === null) {
      fail(name, `${value} ${image} is not absolute under the site URL`);
    } else if (!existsSync(path.join(root, local))) {
      fail(name, `${value} points at ${local}, which does not exist`);
    }
  }

  // Twitter
  if (content('name', 'twitter:card') !== 'summary_large_image') {
    fail(name, 'twitter:card must be summary_large_image');
  }
  if (content('name', 'twitter:title') !== page.title) {
    fail(name, 'twitter:title must equal the title');
  }
  if (content('name', 'twitter:description') !== page.description) {
    fail(name, 'twitter:description must equal the description');
  }
  if (!content('name', 'twitter:image:alt')) {
    fail(name, 'twitter:image:alt is missing');
  }
}

function checkRobots(root, siteUrl, fail, strict) {
  const file = path.join(root, 'robots.txt');
  if (!existsSync(file)) {
    if (strict) {
      fail('robots.txt', 'missing');
    }
    return;
  }
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).map((line) => line.trim());
  if (!lines.includes('User-agent: *')) {
    fail('robots.txt', 'User-agent: * is missing');
  }
  if (!lines.includes('Allow: /')) {
    fail('robots.txt', 'Allow: / is missing');
  }
  if (lines.some((line) => /^Disallow:\s*\/\s*$/i.test(line))) {
    fail('robots.txt', 'Disallow: / blocks the whole site');
  }
  const sitemap = lines.filter((line) => /^Sitemap:/i.test(line));
  const expected = `Sitemap: ${siteUrl}sitemap.xml`;
  if (sitemap.length !== 1 || sitemap[0] !== expected) {
    fail('robots.txt', `Sitemap line must be exactly "${expected}"`);
  }
}

function checkSitemap(root, siteUrl, fail, strict, pages) {
  const file = path.join(root, 'sitemap.xml');
  if (!existsSync(file)) {
    if (strict) {
      fail('sitemap.xml', 'missing');
    }
    return;
  }
  const xml = readFileSync(file, 'utf8');
  if (!/^<\?xml\b[^>]*\?>\s*<urlset\b/.test(xml) || !/<\/urlset>\s*$/.test(xml)) {
    fail('sitemap.xml', 'not a urlset document');
    return;
  }
  if (!xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"') || !xml.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"')) {
    fail('sitemap.xml', 'the sitemap and xhtml namespaces are required');
  }
  // Well formed: every opening tag has its closing tag, in order.
  const stack = [];
  for (const match of xml.matchAll(/<(\/?)([A-Za-z:]+)([^>]*?)(\/?)>/g)) {
    const [, closing, tag, , selfClosing] = match;
    if (selfClosing) {
      continue;
    }
    if (closing) {
      if (stack.pop() !== tag) {
        fail('sitemap.xml', `mismatched closing tag </${tag}>`);
        return;
      }
    } else {
      stack.push(tag);
    }
  }
  if (stack.length > 0) {
    fail('sitemap.xml', `unclosed tag <${stack.pop()}>`);
    return;
  }

  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
  const locs = entries.map((entry) => (/<loc>([^<]*)<\/loc>/.exec(entry) || [])[1]);
  const expectedLocs = pages.map((page) => siteUrl + page.rel);
  for (const expected of expectedLocs) {
    if (!locs.includes(expected)) {
      fail('sitemap.xml', `missing url ${expected}`);
    }
  }
  if (entries.length !== expectedLocs.length) {
    fail('sitemap.xml', `has ${entries.length} url entries, expected ${expectedLocs.length}`);
  }
  for (const [index, entry] of entries.entries()) {
    const loc = locs[index];
    if (!loc || !loc.startsWith(siteUrl)) {
      fail('sitemap.xml', `loc ${loc} does not begin with the site URL`);
    }
    const rel = loc ? loc.slice(siteUrl.length) : '';
    const alternates = [...entry.matchAll(/<xhtml:link\b([^>]*)\/>/g)].map((m) => parseAttrs(m[1]));
    if (alternates.length !== 4) {
      fail('sitemap.xml', `${loc} has ${alternates.length} xhtml:link alternates, expected 4`);
    }
    if (rel in ENGLISH_REL) {
      const expected = {
        en: siteUrl + ENGLISH_REL[rel],
        'en-US': siteUrl + ENGLISH_REL[rel],
        'es-419': siteUrl + SPANISH_REL[rel],
        'x-default': siteUrl + ENGLISH_REL[rel],
      };
      for (const [lang, href] of Object.entries(expected)) {
        const found = alternates.find((a) => a.hreflang === lang);
        if (!found || found.rel !== 'alternate' || found.href !== href) {
          fail('sitemap.xml', `${loc} alternate ${lang} must be ${href}`);
        }
      }
    }
  }
}

// checkSite(root, {strict}): returns the failure lines.
export function checkSite(root, { strict = false } = {}) {
  const failures = [];
  const fail = (file, reason) => failures.push(`${file}: ${reason}`);
  const siteUrl = readSiteUrl(root);
  if (!/^https:\/\/.+\/$/.test(siteUrl)) {
    fail('scripts/site-url.txt', 'must be an https URL that ends with a slash');
  }
  const present = [];
  for (const page of PAGES) {
    if (existsSync(path.join(root, page.file))) {
      present.push(page);
    } else if (strict) {
      fail(page.file, 'missing');
    }
  }
  for (const page of present) {
    checkPage(root, siteUrl, page, fail);
  }
  checkRobots(root, siteUrl, fail, strict);
  checkSitemap(root, siteUrl, fail, strict, strict || present.length === PAGES.length ? PAGES : present);
  return failures;
}

function printBudgets(root) {
  const size = (relative) => {
    const file = path.join(root, relative);
    return existsSync(file) ? statSync(file).size : null;
  };
  const line = (label, value, budget, unit) => {
    if (value === null) {
      console.log(`budget: ${label} not found`);
      return;
    }
    const state = value <= budget ? 'within' : 'over';
    console.log(`budget: ${label} ${value} bytes of ${budget} (${state}, ${unit}, not a gate)`);
  };
  line('css/main.css', size('css/main.css'), 30720, 'target 30 KB');
  line('js/main.js', size('js/main.js'), 8192, 'target 8 KB');
  let longest = { bytes: 0, file: null };
  for (const page of PAGES) {
    const file = path.join(root, page.file);
    if (!existsSync(file)) {
      continue;
    }
    const html = readFileSync(file, 'utf8');
    for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      const bytes = byteLength(match[1]);
      if (bytes > longest.bytes) {
        longest = { bytes, file: page.file };
      }
    }
  }
  line(`longest inline script (${longest.file})`, longest.file ? longest.bytes : null, 400, 'target 400 bytes');
}

// Self-test: each mutation edits a temporary copy and the check must then fail.
const COPY = ['index.html', 'terms.html', 'privacy.html', 'robots.txt', 'sitemap.xml', 'css', 'js', 'img', 'es', 'scripts/site-url.txt'];

function copyTo(root, dest) {
  for (const entry of COPY) {
    const from = path.join(root, entry);
    if (existsSync(from)) {
      mkdirSync(path.dirname(path.join(dest, entry)), { recursive: true });
      cpSync(from, path.join(dest, entry), { recursive: true });
    }
  }
}

function edit(dest, file, transform) {
  const target = path.join(dest, file);
  const before = readFileSync(target, 'utf8');
  const after = transform(before);
  if (after === before) {
    throw new Error(`self-test mutation changed nothing in ${file}`);
  }
  writeFileSync(target, after);
}

const MUTATIONS = [
  ['title over 60 characters', (dest) => edit(dest, 'index.html', (s) => s.replace('<title>LatiFi: P2P microloans with verifiable reputation</title>', '<title>LatiFi: P2P microloans with verifiable reputation for everyone in Peru and beyond</title>'))],
  ['canonical removed', (dest) => edit(dest, 'terms.html', (s) => s.replace(/\s*<link rel="canonical"[^>]*>/, ''))],
  ['relative hreflang', (dest) => edit(dest, 'es/index.html', (s) => s.replace(/(<link rel="alternate" hreflang="es-419" href=")[^"]*(")/, '$1/latifi-landing/es/$2'))],
  ['wrong og:locale', (dest) => edit(dest, 'privacy.html', (s) => s.replace('<meta property="og:locale" content="en_US">', '<meta property="og:locale" content="es_LA">'))],
  ['missing og:image file', (dest) => rmSync(path.join(dest, 'img', 'og-latifi.png'))],
  ['user-scalable no in the viewport', (dest) => edit(dest, 'es/terms.html', (s) => s.replace('initial-scale=1"', 'initial-scale=1, user-scalable=no"'))],
  ['sitemap missing one URL', (dest) => edit(dest, 'sitemap.xml', (s) => s.replace(/\s*<url>\s*<loc>[^<]*es\/privacy\.html<\/loc>[\s\S]*?<\/url>/, ''))],
  ['robots.txt without the Sitemap line', (dest) => edit(dest, 'robots.txt', (s) => s.replace(/^Sitemap:.*$/m, ''))],
];

function selfTest() {
  const work = mkdtempSync(path.join(os.tmpdir(), 'latifi-meta-'));
  let passed = 0;
  try {
    const baseline = path.join(work, 'baseline');
    copyTo(REPO, baseline);
    const baselineFailures = checkSite(baseline, { strict: true });
    if (baselineFailures.length > 0) {
      console.log('self-test: the unmodified copy already fails:');
      baselineFailures.forEach((line) => console.log(`  ${line}`));
      return 1;
    }
    for (const [label, mutate] of MUTATIONS) {
      const dest = path.join(work, `case-${passed}-${label.replace(/\W+/g, '-')}`);
      copyTo(REPO, dest);
      mutate(dest);
      const failures = checkSite(dest, { strict: true });
      if (failures.length > 0) {
        passed += 1;
        console.log(`  caught: ${label}`);
      } else {
        console.log(`  NOT CAUGHT: ${label}`);
        return 1;
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`PASS ${passed}/${MUTATIONS.length}`);
  return passed === MUTATIONS.length ? 0 : 1;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    return selfTest();
  }
  const failures = checkSite(REPO, { strict: args.includes('--strict') });
  printBudgets(REPO);
  if (failures.length > 0) {
    failures.forEach((line) => console.log(line));
    return 1;
  }
  console.log('meta: ok');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
