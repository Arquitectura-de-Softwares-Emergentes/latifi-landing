// ui-check.mjs: drive the staged site in headless Chrome over the DevTools Protocol.
// Usage: node scripts/ui-check.mjs [--shots DIR] [scenario ...]
//   scenario names select a subset; without names every scenario runs.
//   --shots DIR  also writes PNG screenshots (1280x800 and 320x640, both languages) into DIR.
// Env:   CHROME_PATH
//
// Node built-ins plus the global WebSocket and fetch only. Each scenario runs in its own
// browser context, so storage never leaks from one scenario into the next.
// Prints one line per scenario and ends with "ui-check: ok N/N". Exit code 1 on any failure.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, freePort, readSiteUrl, serve, stage } from './lib/site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Minimal DevTools Protocol client
// ---------------------------------------------------------------------------

class Connection {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (message) => this.dispatch(JSON.parse(message.data)));
    ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error('DevTools connection closed'));
      }
      this.pending.clear();
    });
  }

  static open(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new Connection(ws)));
      ws.addEventListener('error', () => reject(new Error(`cannot open ${url}`)));
    });
  }

  dispatch(message) {
    if (message.id !== undefined) {
      const entry = this.pending.get(message.id);
      if (!entry) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(`${entry.method}: ${message.error.message}`));
      } else {
        entry.resolve(message.result || {});
      }
      return;
    }
    const key = message.sessionId || '';
    for (const handler of this.listeners.get(key) || []) {
      handler(message.method, message.params || {});
    }
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId;
    this.nextId += 1;
    const payload = { id, method, params };
    if (sessionId) {
      payload.sessionId = sessionId;
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(payload));
    });
  }

  on(sessionId, handler) {
    const key = sessionId || '';
    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }
    this.listeners.get(key).push(handler);
  }

  close() {
    this.ws.close();
  }
}

async function launchChrome(chromePath) {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'latifi-chrome-'));
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--no-sandbox',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );

  const portFile = path.join(profile, 'DevToolsActivePort');
  let wsUrl = null;
  for (let i = 0; i < 100 && !wsUrl; i += 1) {
    if (existsSync(portFile)) {
      const [port, wsPath] = readFileSync(portFile, 'utf8').split('\n');
      if (port && wsPath) {
        wsUrl = `ws://127.0.0.1:${port}${wsPath}`;
      }
    }
    if (!wsUrl) {
      await sleep(100);
    }
  }
  if (!wsUrl) {
    child.kill('SIGKILL');
    throw new Error('Chrome did not publish a DevTools port');
  }

  const connection = await Connection.open(wsUrl);
  const stop = async () => {
    try {
      connection.close();
    } catch (error) {
      // already closed
    }
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(3000)]);
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { connection, stop };
}

// ---------------------------------------------------------------------------
// Page helper handed to every scenario
// ---------------------------------------------------------------------------

const KEYS = {
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
};

async function newPage(connection, shotsDir) {
  const { browserContextId } = await connection.send('Target.createBrowserContext');
  const { targetId } = await connection.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => connection.send(method, params, sessionId);

  const errors = [];
  connection.on(sessionId, (method, params) => {
    if (method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails || {};
      errors.push(`exception: ${(details.exception && details.exception.description) || details.text}`);
    } else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      errors.push(`console.error: ${(params.args || []).map((arg) => arg.value || arg.description).join(' ')}`);
    } else if (method === 'Log.entryAdded' && params.entry.level === 'error') {
      if (!String(params.entry.url || '').endsWith('favicon.ico')) {
        errors.push(`log: ${params.entry.text} ${params.entry.url || ''}`.trim());
      }
    }
  });

  await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Log.enable'), send('Network.enable')]);
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      const details = result.exceptionDetails;
      throw new Error(`evaluate failed: ${(details.exception && details.exception.description) || details.text}`);
    }
    return result.result.value;
  };

  const waitFor = async (expression, label, timeout = 5000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) {
          return;
        }
      } catch (error) {
        // the document may be mid-navigation, try again
      }
      await sleep(50);
    }
    throw new Error(`timed out waiting for ${label}`);
  };

  // Wait until the page has loaded and its URL stopped changing (redirects included).
  const settleNavigation = async () => {
    let last = null;
    let stable = 0;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      let state = null;
      try {
        state = await evaluate('({ ready: document.readyState, href: location.href })');
      } catch (error) {
        state = null;
      }
      if (state && state.ready === 'complete' && state.href !== 'about:blank' && state.href === last) {
        stable += 1;
        if (stable >= 5) {
          return;
        }
      } else {
        stable = 0;
      }
      last = state ? state.href : null;
      await sleep(60);
    }
    throw new Error('page did not settle');
  };

  // Wait until smooth scrolling has finished.
  const settleScroll = async () => {
    let last = null;
    let stable = 0;
    for (let i = 0; i < 100; i += 1) {
      const y = await evaluate('Math.round(window.scrollY)');
      stable = y === last ? stable + 1 : 0;
      if (stable >= 5) {
        return;
      }
      last = y;
      await sleep(50);
    }
    throw new Error('scroll did not settle');
  };

  const page = {
    async open(url, viewport = { width: 1280, height: 800 }) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await send('Page.navigate', { url });
      await settleNavigation();
    },
    // Leave the current document so the next open() is a full load, not a fragment jump.
    async blank() {
      await send('Page.navigate', { url: 'about:blank' });
      await waitFor("location.href === 'about:blank'", 'about:blank');
    },
    evaluate,
    waitFor,
    settleNavigation,
    settleScroll,
    async press(name) {
      const spec = KEYS[name];
      if (!spec) {
        throw new Error(`unknown key ${name}`);
      }
      const base = {
        key: spec.key,
        code: spec.code,
        windowsVirtualKeyCode: spec.keyCode,
        nativeVirtualKeyCode: spec.keyCode,
      };
      await send('Input.dispatchKeyEvent', { type: spec.text ? 'keyDown' : 'rawKeyDown', ...base, text: spec.text });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    async click(selector) {
      const point = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) { return null; }
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`);
      if (!point) {
        throw new Error(`nothing matches ${selector}`);
      }
      const mouse = { x: point.x, y: point.y, button: 'left', clickCount: 1 };
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...mouse });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...mouse });
    },
    async addNewDocumentScript(source) {
      await send('Page.addScriptToEvaluateOnNewDocument', { source });
    },
    async disableScripts(disabled) {
      await send('Emulation.setScriptExecutionDisabled', { value: disabled });
    },
    async screenshot(name) {
      const metrics = await send('Page.getLayoutMetrics');
      const size = metrics.cssContentSize || metrics.contentSize;
      const shot = await send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
      });
      if (!shotsDir) {
        return null;
      }
      mkdirSync(shotsDir, { recursive: true });
      const file = path.join(shotsDir, `${name}.png`);
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      return file;
    },
    consoleErrors: () => errors.slice(),
  };

  const dispose = async () => {
    try {
      await connection.send('Target.disposeBrowserContext', { browserContextId });
    } catch (error) {
      // the browser may already be gone
    }
  };
  return { page, dispose };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const LANGS = [
  { code: 'en', path: '', section: 'download', label: 'Get the app' },
  { code: 'es', path: 'es/', section: 'descarga', label: 'Descargar la app' },
];

const STATUS_TEXT = {
  en: 'The download link goes live with the first release.',
  es: 'El enlace de descarga estará disponible con la primera versión.',
};

function makeScenarios(base) {
  const scenarios = [];
  const scenario = (name, run) => scenarios.push({ name, run });

  scenario('skip-link', async (t) => {
    for (const lang of LANGS) {
      await t.open(base + lang.path);
      await t.press('Tab');
      const first = await t.evaluate(`(() => {
        const el = document.activeElement;
        const r = el.getBoundingClientRect();
        return { cls: el.className, href: el.getAttribute('href'),
          inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.width > 0 };
      })()`);
      assert(first.cls === 'skip-link', `${lang.code}: first Tab stop is "${first.cls}", not the skip link`);
      assert(first.href === '#main', `${lang.code}: skip link href is ${first.href}`);
      assert(first.inside, `${lang.code}: skip link is not inside the viewport on focus`);
      await t.press('Enter');
      await t.waitFor("document.querySelector('main').contains(document.activeElement)", `${lang.code}: focus inside main`);
      const hash = await t.evaluate('location.hash');
      assert(hash === '#main', `${lang.code}: hash is ${hash} after the skip link`);
    }
  });

  scenario('cta-download', async (t) => {
    for (const lang of LANGS) {
      for (const how of ['mouse', 'keyboard']) {
        // 320 wide: the page is tall enough for the jump to matter and overflow would show.
        await t.open(base + lang.path, { width: 320, height: 568 });
        const overflow = await t.evaluate('document.documentElement.scrollWidth > innerWidth');
        assert(!overflow, `${lang.code}: horizontal overflow at 320px`);
        if (how === 'mouse') {
          await t.click('.hero .btn-primary');
        } else {
          await t.evaluate("document.querySelector('.hero .btn-primary').focus()");
          await t.press('Enter');
        }
        await t.waitFor(`location.hash === '#${lang.section}'`, `${lang.code}/${how}: hash #${lang.section}`);
        await t.settleScroll();
        const state = await t.evaluate(`(() => {
          const active = document.activeElement;
          const section = document.getElementById(${JSON.stringify(lang.section)});
          const r = section.getBoundingClientRect();
          return { activeId: active.id, activeTag: active.tagName,
            inSection: section.contains(active), top: r.top, height: innerHeight };
        })()`);
        assert(state.activeTag === 'H2' && state.activeId === 'download-title',
          `${lang.code}/${how}: focus is on ${state.activeTag}#${state.activeId}, not the Download heading`);
        assert(state.inSection, `${lang.code}/${how}: focused heading is outside the Download section`);
        assert(state.top >= -1 && state.top < state.height, `${lang.code}/${how}: section top ${state.top} is outside the viewport`);
      }
    }
  });

  scenario('lang-switch-persist', async (t) => {
    await t.open(base);
    await t.click('nav.lang-switch a[hreflang="es-419"]');
    await t.waitFor("location.pathname.endsWith('/es/index.html')", 'Spanish page after the click');
    await t.settleNavigation();
    assert((await t.evaluate("localStorage.getItem('latifi.lang')")) === 'es', 'latifi.lang is not es after clicking Español');
    assert((await t.evaluate("document.documentElement.lang")) === 'es-419', 'Spanish page has the wrong lang');

    await t.open(base);
    const afterEn = await t.evaluate('location.pathname');
    assert(afterEn.endsWith('/es/'), `English URL with es stored ended on ${afterEn}`);

    await t.click('nav.lang-switch a[hreflang="en"]');
    await t.waitFor("location.pathname.endsWith('/index.html') && !location.pathname.includes('/es/')", 'English page after the click');
    await t.settleNavigation();
    assert((await t.evaluate("localStorage.getItem('latifi.lang')")) === 'en', 'latifi.lang is not en after clicking English');

    await t.open(base + 'es/');
    const afterEs = await t.evaluate('location.pathname');
    assert(!afterEs.includes('/es/'), `Spanish URL with en stored ended on ${afterEs}`);
    assert((await t.evaluate("document.documentElement.lang")) === 'en-US', 'English page has the wrong lang');
  });

  scenario('lang-hash-map', async (t) => {
    // Inline entry script: stored language differs, the hash crosses the id map.
    await t.open(base);
    await t.evaluate("localStorage.setItem('latifi.lang', 'es')");
    await t.blank();
    await t.open(base + '#download');
    let state = await t.evaluate(`({ path: location.pathname, hash: location.hash,
      visible: !!document.getElementById('descarga') && document.getElementById('descarga').getBoundingClientRect().top < innerHeight })`);
    assert(state.path.endsWith('/es/'), `en#download with es stored ended on ${state.path}`);
    assert(state.hash === '#descarga', `hash is ${state.hash}, expected #descarga`);
    assert(state.visible, 'Download section is not visible on the Spanish page');

    await t.evaluate("localStorage.setItem('latifi.lang', 'en')");
    await t.blank();
    await t.open(base + 'es/#descarga');
    state = await t.evaluate(`({ path: location.pathname, hash: location.hash,
      visible: !!document.getElementById('download') && document.getElementById('download').getBoundingClientRect().top < innerHeight })`);
    assert(!state.path.includes('/es/'), `es#descarga with en stored ended on ${state.path}`);
    assert(state.hash === '#download', `hash is ${state.hash}, expected #download`);
    assert(state.visible, 'Download section is not visible on the English page');

    // reconcileHash in main.js: nothing stored, an id of the other language in the URL.
    await t.evaluate("localStorage.clear()");
    await t.blank();
    await t.open(base + 'es/#download');
    state = await t.evaluate(`({ path: location.pathname, hash: location.hash })`);
    assert(state.path.endsWith('/es/'), `es#download without storage ended on ${state.path}`);
    assert(state.hash === '#descarga', `reconcileHash left ${state.hash}, expected #descarga`);
  });

  scenario('storage-blocked', async (t) => {
    // Seed a stored language first, then block the store: a throwing getItem must not redirect.
    await t.open(base);
    await t.evaluate("localStorage.setItem('latifi.lang', 'es')");
    await t.addNewDocumentScript(`(() => {
      const blocked = function () { throw new DOMException('blocked', 'SecurityError'); };
      Storage.prototype.getItem = blocked;
      Storage.prototype.setItem = blocked;
    })()`);
    await t.open(base);
    const path1 = await t.evaluate('location.pathname');
    assert(!path1.includes('/es/'), `page redirected to ${path1} although storage throws`);
    await t.click('nav.lang-switch a[hreflang="es-419"]');
    await t.waitFor("location.pathname.endsWith('/es/index.html')", 'Spanish page with blocked storage');
    await t.settleNavigation();
    await t.open(base + 'es/');
    const path2 = await t.evaluate('location.pathname');
    assert(path2.endsWith('/es/'), `Spanish page moved to ${path2} although storage throws`);
    const errors = t.consoleErrors();
    assert(errors.length === 0, `console errors with blocked storage: ${errors.join(' | ')}`);
  });

  scenario('no-js', async (t) => {
    await t.disableScripts(true);
    for (const lang of LANGS) {
      await t.open(base + lang.path);
      const state = await t.evaluate(`({
        href: document.querySelector('.hero .btn-primary').getAttribute('href'),
        target: !!document.getElementById(${JSON.stringify(lang.section)}),
        status: document.querySelector('.status').textContent.trim(),
        display: getComputedStyle(document.querySelector('.status')).display,
      })`);
      assert(state.href === `#${lang.section}`, `${lang.code}: hero button href is ${state.href}`);
      assert(state.target, `${lang.code}: no section with id ${lang.section}`);
      assert(state.status === STATUS_TEXT[lang.code], `${lang.code}: status text is "${state.status}"`);
      assert(state.display !== 'none', `${lang.code}: status line is hidden without scripts`);
    }
  });

  scenario('download-status', async (t) => {
    for (const lang of LANGS) {
      await t.open(base + lang.path);
      const state = await t.evaluate(`(() => {
        const link = document.querySelector('#${lang.section} [data-placeholder]');
        const status = document.querySelector('#${lang.section} .status');
        const r = status ? status.getBoundingClientRect() : null;
        return {
          hasLink: !!link,
          disabled: link ? link.getAttribute('aria-disabled') : null,
          href: link ? link.getAttribute('href') : null,
          display: status ? getComputedStyle(status).display : null,
          height: r ? r.height : 0,
          text: status ? status.textContent.trim() : '',
        };
      })()`);
      assert(state.hasLink, `${lang.code}: the Download link has no data-placeholder`);
      assert(state.disabled === null, `${lang.code}: the Download link carries aria-disabled`);
      assert(state.href === `#${lang.section}`, `${lang.code}: Download link href is ${state.href}`);
      assert(state.display !== null && state.display !== 'none' && state.height > 0, `${lang.code}: status line is not visible`);
      assert(state.text === STATUS_TEXT[lang.code], `${lang.code}: status text is "${state.text}"`);
    }
  });

  return scenarios;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function takeShots(connection, base, shotsDir) {
  const { page, dispose } = await newPage(connection, shotsDir);
  const written = [];
  try {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 320, height: 640 }]) {
      for (const lang of LANGS) {
        await page.open(base + lang.path, viewport);
        written.push(await page.screenshot(`${lang.code}-${viewport.width}`));
      }
    }
  } finally {
    await dispose();
  }
  return written;
}

async function main() {
  const args = process.argv.slice(2);
  let shotsDir = null;
  const names = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--shots') {
      i += 1;
      shotsDir = args[i] ? path.resolve(args[i]) : null;
      if (!shotsDir) {
        console.error('ui-check: --shots needs a directory');
        return 2;
      }
    } else {
      names.push(args[i]);
    }
  }

  const chromePath = findChrome();
  if (!chromePath) {
    console.error('ui-check: no Chrome binary found (set CHROME_PATH)');
    return 1;
  }

  const prefix = new URL(readSiteUrl(ROOT)).pathname;
  const work = mkdtempSync(path.join(os.tmpdir(), 'latifi-ui-'));
  let server;
  let browser;
  let passed = 0;
  let total = 0;
  try {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}${prefix}`;
    const site = path.join(work, 'site');
    stage({ src: ROOT, dest: site, baseUrl: base });
    server = await serve({ dir: site, prefix, port });
    browser = await launchChrome(chromePath);

    const all = makeScenarios(server.base);
    const unknown = names.filter((name) => !all.some((item) => item.name === name));
    if (unknown.length > 0) {
      console.error(`ui-check: unknown scenario ${unknown.join(', ')}`);
      return 2;
    }
    const selected = names.length > 0 ? all.filter((item) => names.includes(item.name)) : all;
    total = selected.length;

    for (const item of selected) {
      const { page, dispose } = await newPage(browser.connection, shotsDir);
      try {
        await Promise.race([
          item.run(page),
          sleep(60000).then(() => { throw new Error('scenario timed out after 60s'); }),
        ]);
        passed += 1;
        console.log(`PASS ${item.name}`);
      } catch (error) {
        console.log(`FAIL ${item.name}: ${error.message}`);
      } finally {
        await dispose();
      }
    }

    if (shotsDir) {
      const files = await takeShots(browser.connection, server.base, shotsDir);
      for (const file of files) {
        console.log(`shot ${file}`);
      }
    }
  } finally {
    if (browser) {
      await browser.stop();
    }
    if (server) {
      await server.close();
    }
    rmSync(work, { recursive: true, force: true });
  }

  if (passed !== total) {
    console.log(`ui-check: failed ${total - passed} of ${total}`);
    return 1;
  }
  console.log(`ui-check: ok ${passed}/${total}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`ui-check: ${error.message}`);
    process.exit(1);
  },
);
