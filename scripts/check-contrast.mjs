// check-contrast.mjs: WCAG 2.1 contrast of every token pair the pages use, computed from the real
// custom properties in css/main.css (A11Y.md: computed, never estimated).
// Usage: node scripts/check-contrast.mjs [--markdown]
//   default     one line per pair, then "contrast: ok N/N"
//   --markdown  the same pairs as a markdown table for the accessibility report
// Rules:
//   - every token in TOKENS must exist in :root and carry the UI-SPEC hex value
//   - every pair must reach its threshold (4.5 for text, 3 for large text and UI parts)
//   - where the UI-SPEC documents a ratio, the computed one must agree within 0.02
//   - hex colors written outside the :root block only produce a warning
// Failures print as "contrast: reason", exit code 1. Node built-ins only.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS_FILES = ['css/main.css', 'css/legal.css'];

// UI-SPEC Color table: token name to hex.
const TOKENS = {
  '--color-white': '#ffffff',
  '--color-surface-alt': '#f5f7fa',
  '--color-navy-900': '#0b1f3a',
  '--color-navy-700': '#14407a',
  '--color-lime-400': '#c6ff3d',
  '--color-lime-300': '#d8ff7a',
  '--color-green-600': '#0a7d5a',
  '--color-green-50': '#e6f4ee',
  '--color-text': '#101828',
  '--color-muted': '#566174',
  '--color-divider': '#dde3ea',
  '--color-soft': '#e8eef7',
  '--color-on-navy-muted': '#dde3ea',
  '--focus-light': '#14407a',
  '--focus-dark': '#c6ff3d',
};

const TEXT = 4.5;
const UI = 3;

// [foreground token, background token, documented ratio or null, threshold, where it applies]
// The first 17 rows are the UI-SPEC "Measured contrast pairs" table, in order.
export const PAIRS = [
  ['--color-text', '--color-white', 17.75, TEXT, 'body text'],
  ['--color-text', '--color-surface-alt', 16.54, TEXT, 'body text on the alternate band'],
  ['--color-muted', '--color-white', 6.25, TEXT, 'muted text'],
  ['--color-muted', '--color-surface-alt', 5.83, TEXT, 'muted text on the alternate band'],
  ['--color-navy-900', '--color-white', 16.52, TEXT, 'headings, secondary button label'],
  ['--color-white', '--color-navy-900', 16.52, TEXT, 'text on Navy, primary button label'],
  ['--color-on-navy-muted', '--color-navy-900', 12.78, TEXT, 'secondary text on Navy'],
  ['--color-lime-400', '--color-navy-900', 13.98, UI, 'focus ring on Navy, logo pulse, footer link hover'],
  ['--color-navy-900', '--color-lime-400', 13.98, TEXT, 'lime button label'],
  ['--color-navy-700', '--color-white', 10.27, TEXT, 'links, nav and tab hover'],
  ['--color-navy-700', '--color-surface-alt', 9.57, TEXT, 'links on the alternate band'],
  ['--color-navy-700', '--color-soft', 8.81, TEXT, 'icon glyph in circle'],
  ['--color-green-600', '--color-white', 5.13, TEXT, 'emphasis text'],
  ['--color-green-600', '--color-surface-alt', 4.78, TEXT, 'emphasis text on the alternate band'],
  ['--color-green-600', '--color-green-50', 4.53, TEXT, 'Paid chip text'],
  ['--color-white', '--color-green-600', 5.13, TEXT, 'step number on circle'],
  ['--color-muted', '--color-divider', 4.84, TEXT, 'reference row'],
  // State pairs the pages really use and the UI-SPEC does not list as rows.
  ['--color-white', '--color-navy-700', 10.27, TEXT, 'primary button hover (white label)'],
  ['--color-navy-900', '--color-lime-300', null, TEXT, 'lime button hover (Navy label)'],
  ['--color-navy-900', '--color-soft', null, TEXT, 'secondary button hover, menu button hover, back to top hover'],
  ['--color-text', '--color-soft', null, TEXT, 'body text on the soft tint'],
  ['--focus-light', '--color-white', 10.27, UI, 'focus ring on light surfaces'],
  ['--focus-dark', '--color-navy-900', 13.98, UI, 'focus ring on Navy surfaces'],
];

export function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function ratio(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function readRootTokens(css) {
  const tokens = {};
  for (const block of css.matchAll(/:root\s*\{([\s\S]*?)\}/g)) {
    for (const declaration of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      tokens[declaration[1]] = declaration[2].trim().toLowerCase();
    }
  }
  return tokens;
}

function hexLiteralsOutsideRoot(file, css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:root\s*\{[\s\S]*?\}/g, '');
  const found = [];
  for (const line of stripped.split('\n')) {
    for (const match of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      if (!/url\(\s*['"]?[^)]*#/.test(line)) {
        found.push(`${file}: hex literal ${match[0]} outside :root (use a token)`);
      }
    }
  }
  return found;
}

function main() {
  const markdown = process.argv.includes('--markdown');
  const mainCss = readFileSync(path.join(ROOT, CSS_FILES[0]), 'utf8');
  const tokens = readRootTokens(mainCss);
  const failures = [];

  for (const [name, expected] of Object.entries(TOKENS)) {
    if (!(name in tokens)) {
      failures.push(`token ${name} is missing from :root in ${CSS_FILES[0]}`);
    } else if (tokens[name] !== expected) {
      failures.push(`token ${name} is ${tokens[name]}, the UI-SPEC value is ${expected}`);
    }
  }

  const warnings = [];
  for (const file of CSS_FILES) {
    if (existsSync(path.join(ROOT, file))) {
      warnings.push(...hexLiteralsOutsideRoot(file, readFileSync(path.join(ROOT, file), 'utf8')));
    }
  }

  const rows = [];
  let passed = 0;
  for (const [fg, bg, documented, threshold, where] of PAIRS) {
    if (!(fg in tokens) || !(bg in tokens)) {
      failures.push(`pair ${fg} on ${bg} cannot be computed (token missing)`);
      continue;
    }
    const value = ratio(tokens[fg], tokens[bg]);
    const shown = value.toFixed(2);
    let state = 'pass';
    if (value < threshold) {
      state = 'FAIL';
      failures.push(`${fg} ${tokens[fg]} on ${bg} ${tokens[bg]} is ${shown}:1, below ${threshold}:1 (${where})`);
    } else if (documented !== null && Math.abs(value - documented) > 0.02) {
      state = 'FAIL';
      failures.push(`${fg} on ${bg} computes ${shown}:1 but the UI-SPEC documents ${documented.toFixed(2)}:1`);
    } else {
      passed += 1;
    }
    rows.push({ fg, bg, fgHex: tokens[fg], bgHex: tokens[bg], shown, documented, threshold, where, state });
  }

  if (markdown) {
    console.log('| Foreground | Background | Computed | Documented | Minimum | Use | Result |');
    console.log('|---|---|---|---|---|---|---|');
    for (const row of rows) {
      const documented = row.documented === null ? 'n/a' : `${row.documented.toFixed(2)}:1`;
      console.log(`| \`${row.fg}\` \`${row.fgHex}\` | \`${row.bg}\` \`${row.bgHex}\` | ${row.shown}:1 | ${documented} | ${row.threshold}:1 | ${row.where} | ${row.state} |`);
    }
  } else {
    for (const row of rows) {
      const documented = row.documented === null ? 'n/a' : `${row.documented.toFixed(2)}`;
      console.log(`${row.state.padEnd(4)} ${row.shown.padStart(5)}:1 (min ${row.threshold}, doc ${documented.padStart(5)}) ${row.fg} on ${row.bg}: ${row.where}`);
    }
  }

  warnings.forEach((line) => console.error(`warning: ${line}`));
  if (failures.length > 0) {
    failures.forEach((line) => console.log(`contrast: ${line}`));
    return 1;
  }
  console.log(`contrast: ok ${passed}/${rows.length}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
