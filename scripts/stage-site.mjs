// stage-site.mjs: copy the publishable site into a directory.
// Usage: node scripts/stage-site.mjs [--strict] [--base URL] SRC DEST
//   --strict  fail when a required page or asset is missing
//   --base    replace the site URL from scripts/site-url.txt with URL in html, xml and txt files
// Prints the number of files copied.

import { stage } from './lib/site.mjs';

const args = process.argv.slice(2);
let strict = false;
let baseUrl;
const positional = [];

for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--strict') {
    strict = true;
  } else if (args[i] === '--base') {
    i += 1;
    baseUrl = args[i];
  } else {
    positional.push(args[i]);
  }
}

if (positional.length !== 2 || (baseUrl !== undefined && !baseUrl)) {
  console.error('usage: node scripts/stage-site.mjs [--strict] [--base URL] SRC DEST');
  process.exit(2);
}

const [src, dest] = positional;
const count = stage({ src, dest, baseUrl, strict });
console.log(`staged ${count} files into ${dest}`);
