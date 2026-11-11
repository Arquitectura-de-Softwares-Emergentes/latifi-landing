// ui-check.mjs: drive the staged site in headless Chrome over the DevTools Protocol.
// Usage: node scripts/ui-check.mjs [--shots DIR] [scenario ...]
//   scenario names select a subset; without names every scenario runs.
//   --shots DIR  also writes PNG screenshots (1280, 1024, 600 and 320 wide, both languages) into DIR.
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
import { findChrome, freePort, listPages, readSiteUrl, serve, stage } from './lib/site.mjs';

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
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
};

async function newPage(connection, shotsDir) {
  const { browserContextId } = await connection.send('Target.createBrowserContext');
  const { targetId } = await connection.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => connection.send(method, params, sessionId);

  const errors = [];
  const requested = [];
  const failed = [];
  const requestUrls = new Map();
  connection.on(sessionId, (method, params) => {
    if (method === 'Network.requestWillBeSent') {
      requested.push(params.request.url);
      requestUrls.set(params.requestId, params.request.url);
    } else if (method === 'Network.loadingFailed') {
      failed.push(`${requestUrls.get(params.requestId) || params.requestId} (${params.errorText})`);
    } else if (method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails || {};
      errors.push(`exception: ${(details.exception && details.exception.description) || details.text}`);
    } else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      errors.push(`console.error: ${(params.args || []).map((arg) => arg.value || arg.description).join(' ')}`);
    } else if (method === 'Log.entryAdded') {
      const entry = params.entry;
      const violation = /content security policy/i.test(entry.text || '');
      if ((entry.level === 'error' || violation) && !String(entry.url || '').endsWith('favicon.ico')) {
        errors.push(`log: ${entry.text} ${entry.url || ''}`.trim());
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
    // Raw DevTools command for the page session (state tests that need emulation).
    cdp: (method, params) => send(method, params),
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
    requestedUrls: () => requested.slice(),
    failedRequests: () => failed.slice(),
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
  { code: 'en', path: '', section: 'download', label: 'Get the app', benefits: 'benefits', menuOpen: 'Open menu', menuClose: 'Close menu' },
  { code: 'es', path: 'es/', section: 'descarga', label: 'Descargar la app', benefits: 'beneficios', menuOpen: 'Abrir menú', menuClose: 'Cerrar menú' },
];

const STATUS_TEXT = {
  en: 'The download link goes live with the first release.',
  es: 'El enlace de descarga estará disponible con la primera versión.',
};

const VIDEO_ERROR = {
  en: 'The video could not load. Read the transcript instead.',
  es: 'No se pudo cargar el video. Lee la transcripción.',
};

function makeScenarios(base, siteDir) {
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

  scenario('fonts-loaded', async (t) => {
    for (const lang of LANGS) {
      await t.open(base + lang.path);
      // Wait for the faces the page actually used, then ask the browser what it holds.
      await t.evaluate('document.fonts.ready.then(() => true)');
      const state = await t.evaluate(`({
        sora600: document.fonts.check('600 16px Sora'),
        inter400: document.fonts.check('400 16px Inter'),
        inter600: document.fonts.check('600 16px Inter'),
        loaded: [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family).sort(),
        h1: getComputedStyle(document.querySelector('h1')).fontFamily,
        body: getComputedStyle(document.body).fontFamily,
      })`);
      assert(state.sora600, `${lang.code}: 600 16px Sora is not loaded`);
      assert(state.inter400, `${lang.code}: 400 16px Inter is not loaded`);
      assert(state.inter600, `${lang.code}: 600 16px Inter is not loaded`);
      assert(state.loaded.includes('Sora') && state.loaded.includes('Inter'),
        `${lang.code}: no loaded Sora or Inter face (loaded: ${state.loaded.join(', ') || 'none'})`);
      assert(/^"?Sora"?\s*,/.test(state.h1), `${lang.code}: h1 font stack is ${state.h1}`);
      assert(/^"?Inter"?\s*,/.test(state.body), `${lang.code}: body font stack is ${state.body}`);
    }
  });

  scenario('no-external-requests', async (t) => {
    const origin = new URL(base).origin;
    for (const lang of LANGS) {
      await t.open(base + lang.path);
      await t.evaluate('document.fonts.ready.then(() => true)');
    }
    const urls = t.requestedUrls();
    assert(urls.length > 0, 'no network request was recorded');
    // about: and data: URLs never leave the browser. Everything else must stay on the local origin.
    const external = urls.filter((url) => !/^(about|data):/.test(url) && new URL(url).origin !== origin);
    assert(external.length === 0, `requests outside ${origin}: ${external.join(', ')}`);
    const fonts = urls.filter((url) => url.endsWith('.woff2'));
    assert(fonts.length > 0, 'no font request was recorded, the check cannot prove the fonts are local');
  });

  // Reads the tab state the keyboard contract talks about.
  const tabState = (t) => t.evaluate(`(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const panel = (id) => document.getElementById(id);
    const shown = (el) => !el.hidden && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
    return {
      activeId: document.activeElement.id,
      selected: tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true').map((tab) => tab.id),
      tabbable: tabs.filter((tab) => tab.getAttribute('tabindex') === '0').map((tab) => tab.id),
      borrowerShown: shown(panel('panel-borrower')),
      lenderShown: shown(panel('panel-lender')),
    };
  })()`);

  scenario('tabs-keyboard', async (t) => {
    for (const lang of LANGS) {
      await t.open(base + lang.path);
      const list = await t.evaluate(`(() => {
        const el = document.querySelector('[role="tablist"]');
        const r = el.getBoundingClientRect();
        return { hidden: el.hidden, display: getComputedStyle(el).display, height: r.height,
          tablists: document.querySelectorAll('[role="tablist"]').length,
          label: el.getAttribute('aria-label'),
          h2: document.getElementById('how-title').textContent.trim() };
      })()`);
      assert(list.tablists === 1, `${lang.code}: ${list.tablists} tablists`);
      assert(!list.hidden && list.display !== 'none' && list.height > 0, `${lang.code}: the tablist is not visible with scripts on`);
      assert(list.label === list.h2, `${lang.code}: tablist aria-label "${list.label}" differs from the H2 "${list.h2}"`);
      let state = await tabState(t);
      assert(state.selected.join() === 'tab-borrower', `${lang.code}: selected on load is ${state.selected.join() || 'none'}`);
      assert(state.borrowerShown && !state.lenderShown, `${lang.code}: borrower panel ${state.borrowerShown}, lender panel ${state.lenderShown} on load`);
      assert(state.tabbable.join() === 'tab-borrower', `${lang.code}: tabindex 0 on ${state.tabbable.join() || 'none'} on load`);

      await t.evaluate("document.getElementById('tab-borrower').focus()");
      const steps = [
        ['ArrowRight', 'tab-lender'],
        ['Home', 'tab-borrower'],
        ['End', 'tab-lender'],
        ['Home', 'tab-borrower'],
        ['ArrowLeft', 'tab-lender'],
        ['ArrowRight', 'tab-borrower'],
      ];
      for (const [key, expected] of steps) {
        await t.press(key);
        state = await tabState(t);
        const other = expected === 'tab-lender' ? 'tab-borrower' : 'tab-lender';
        assert(state.activeId === expected, `${lang.code}: after ${key} focus is on ${state.activeId}, expected ${expected}`);
        assert(state.selected.join() === expected, `${lang.code}: after ${key} selected is ${state.selected.join() || 'none'}, expected ${expected}`);
        assert(state.tabbable.join() === expected, `${lang.code}: after ${key} tabindex 0 is on ${state.tabbable.join() || 'none'} (other tab ${other} must be -1)`);
        const wantLender = expected === 'tab-lender';
        assert(state.lenderShown === wantLender && state.borrowerShown === !wantLender,
          `${lang.code}: after ${key} the panels do not follow the selection`);
      }

      // Pointer activation selects too.
      await t.click('#tab-lender');
      state = await tabState(t);
      assert(state.selected.join() === 'tab-lender' && state.lenderShown && !state.borrowerShown, `${lang.code}: clicking the lender tab did not select it`);
    }
  });

  scenario('tabs-distinct-content', async (t) => {
    for (const lang of LANGS) {
      await t.open(base + lang.path);
      const titles = await t.evaluate(`({
        borrower: [...document.querySelectorAll('#panel-borrower .step h3')].map((h) => h.textContent.trim()),
        lender: [...document.querySelectorAll('#panel-lender .step h3')].map((h) => h.textContent.trim()),
      })`);
      assert(titles.borrower.length === 3 && titles.lender.length === 3, `${lang.code}: step titles are ${titles.borrower.length} and ${titles.lender.length}, expected 3 and 3`);
      const shared = titles.borrower.filter((title) => titles.lender.includes(title));
      assert(shared.length === 0, `${lang.code}: both panels share the step title ${shared.join(' | ')}`);
    }
  });

  scenario('no-js-panels', async (t) => {
    await t.disableScripts(true);
    for (const lang of LANGS) {
      await t.open(base + lang.path, { width: 320, height: 568 });
      const state = await t.evaluate(`(() => {
        const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, height: r.height, width: r.width }; };
        const list = document.querySelector('[role="tablist"]');
        const borrower = document.getElementById('panel-borrower');
        const lender = document.getElementById('panel-lender');
        const titles = [...document.querySelectorAll('.panel-title')];
        return {
          jsClass: document.documentElement.classList.contains('js'),
          tablistDisplay: getComputedStyle(list).display,
          borrower: box(borrower), lender: box(lender),
          titles: titles.map((h) => ({ tag: h.tagName, display: getComputedStyle(h).display, height: h.getBoundingClientRect().height })),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      })()`);
      assert(!state.jsClass, `${lang.code}: the js class is set with scripts disabled`);
      assert(state.tablistDisplay === 'none', `${lang.code}: the tablist display is ${state.tablistDisplay} without scripts`);
      assert(state.borrower.height > 0 && state.lender.height > 0, `${lang.code}: a panel has no height without scripts`);
      assert(state.lender.top >= state.borrower.top + state.borrower.height - 1, `${lang.code}: the panels are not stacked`);
      assert(state.titles.length === 2 && state.titles.every((h) => h.tag === 'H3' && h.display !== 'none' && h.height > 0),
        `${lang.code}: the panel titles are not both visible H3 headings without scripts`);
      assert(!state.overflow, `${lang.code}: horizontal overflow at 320px without scripts`);
    }
  });

  scenario('console-clean', async (t) => {
    const pages = listPages(siteDir);
    assert(pages.length >= 2, `only ${pages.length} pages found in the staged site`);
    for (const pagePath of pages) {
      await t.open(base + pagePath.slice(1));
      await t.evaluate('document.fonts.ready.then(() => true)');
      await sleep(150);
    }
    const errors = t.consoleErrors();
    assert(errors.length === 0, `console errors or CSP violations: ${errors.join(' | ')}`);
    const failed = t.failedRequests();
    assert(failed.length === 0, `failed requests: ${failed.join(' | ')}`);
  });

  scenario('video-slot-hidden', async (t) => {
    for (const lang of LANGS) {
      await t.open(base + lang.path);
      const state = await t.evaluate(`(() => {
        const slot = document.getElementById('video-slot');
        const frame = slot.querySelector('iframe');
        const r = slot.getBoundingClientRect();
        return { hidden: slot.hasAttribute('hidden'), height: r.height, width: r.width,
          loading: frame.getAttribute('loading'), src: frame.getAttribute('src'),
          dataSrc: frame.getAttribute('data-src'), frameCount: document.querySelectorAll('iframe').length,
          error: slot.querySelector('.video-error').hidden };
      })()`);
      assert(state.hidden, `${lang.code}: the video slot has no hidden attribute`);
      assert(state.height === 0 && state.width === 0, `${lang.code}: the hidden slot takes space (${state.width} by ${state.height})`);
      assert(state.loading === 'lazy', `${lang.code}: iframe loading is ${state.loading}`);
      assert(state.src === null && state.dataSrc === '', `${lang.code}: iframe src ${state.src}, data-src "${state.dataSrc}"`);
      assert(state.frameCount === 1 && state.error, `${lang.code}: unexpected iframe count or visible error line`);
    }
    const origin = new URL(base).origin;
    const outside = t.requestedUrls().filter((url) => !/^(about|data):/.test(url) && new URL(url).origin !== origin);
    assert(outside.length === 0, `requests outside ${origin}: ${outside.join(', ')}`);
  });

  scenario('video-error-offline', async (t) => {
    // Bypass the page CSP so the state test exercises main.js, not the frame-src block.
    await t.cdp('Page.setBypassCSP', { enabled: true });
    for (const lang of LANGS) {
      await t.open(base + lang.path);
      await t.evaluate(`(() => {
        const slot = document.getElementById('video-slot');
        slot.hidden = false;
        slot.querySelector('iframe').setAttribute('data-src', 'https://video-host.invalid/embed/latifi');
      })()`);
      await t.cdp('Network.emulateNetworkConditions', {
        offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
      });
      const started = Date.now();
      await t.evaluate("document.dispatchEvent(new CustomEvent('latifi:video-refresh'))");
      await t.waitFor(`(() => {
        const slot = document.getElementById('video-slot');
        const line = slot.querySelector('.video-error');
        const link = slot.querySelector('.video-transcript');
        const shown = (el) => !el.hidden && el.getBoundingClientRect().height > 0;
        return shown(line) && shown(link);
      })()`, `${lang.code}: error line and transcript link`, 1000);
      assert(Date.now() - started < 1500, `${lang.code}: the error line took too long`);
      const state = await t.evaluate(`({
        line: document.querySelector('#video-slot .video-error').textContent.trim(),
        link: document.querySelector('#video-slot .video-transcript').textContent.trim(),
        src: document.querySelector('#video-slot iframe').getAttribute('src'),
      })`);
      assert(state.line === VIDEO_ERROR[lang.code], `${lang.code}: error line is "${state.line}"`);
      assert(state.src === null, `${lang.code}: the iframe got a src while offline`);
      // A non-https value must keep the slot inert (T-06-09).
      await t.cdp('Network.emulateNetworkConditions', {
        offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
      });
      await t.evaluate(`(() => {
        document.querySelector('#video-slot .video-error').hidden = true;
        document.querySelector('#video-slot iframe').setAttribute('data-src', 'http://video-host.invalid/embed/latifi');
        document.dispatchEvent(new CustomEvent('latifi:video-refresh'));
      })()`);
      await sleep(300);
      const inert = await t.evaluate("document.querySelector('#video-slot iframe').getAttribute('src')");
      assert(inert === null, `${lang.code}: an http data-src reached the iframe (${inert})`);
    }
  });

  scenario('faq-native', async (t) => {
    for (const lang of LANGS) {
      await t.open(base + lang.path);
      const shape = await t.evaluate(`({
        items: document.querySelectorAll('#faq details.faq-item').length,
        groups: [...document.querySelectorAll('#faq .faq-group')].map((g) => g.querySelectorAll('details').length),
        titles: [...document.querySelectorAll('#faq .faq-group > h3')].length,
        open: document.querySelectorAll('#faq details[open]').length,
      })`);
      assert(shape.items === 7, `${lang.code}: ${shape.items} FAQ items`);
      assert(shape.groups.join() === '3,2,2' && shape.titles === 3, `${lang.code}: FAQ groups are ${shape.groups.join('/')} with ${shape.titles} titles`);
      assert(shape.open === 0, `${lang.code}: ${shape.open} FAQ items are open on load`);

      const openState = () => t.evaluate("[...document.querySelectorAll('#faq details')].map((d) => d.open ? 1 : 0).join('')");
      await t.evaluate("document.querySelectorAll('#faq summary')[0].focus()");
      await t.press('Space');
      assert((await openState()) === '1000000', `${lang.code}: Space on the first summary left ${await openState()}`);
      await t.evaluate("document.querySelectorAll('#faq summary')[4].focus()");
      await t.press('Enter');
      assert((await openState()) === '1000100', `${lang.code}: Enter on the fifth summary left ${await openState()}`);
      await t.evaluate("document.querySelectorAll('#faq summary')[0].focus()");
      await t.press('Space');
      assert((await openState()) === '0000100', `${lang.code}: closing the first item changed the others (${await openState()})`);
    }
  });

  scenario('counts', async (t) => {
    for (const lang of LANGS) {
      await t.open(base + lang.path);
      const counts = await t.evaluate(`({
        steps: document.querySelectorAll('li.step').length,
        features: document.querySelectorAll('article.feature').length,
        security: document.querySelectorAll('article.security-item').length,
        faq: document.querySelectorAll('details.faq-item').length,
      })`);
      const want = { steps: 6, features: 4, security: 4, faq: 7 };
      for (const key of Object.keys(want)) {
        assert(counts[key] === want[key], `${lang.code}: ${key} is ${counts[key]}, expected ${want[key]}`);
      }
    }
  });

  // ---- Header and menu (plan 06-04) ----

  const viewport = (t, width, height) => t.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  const menuState = (t) => t.evaluate(`(() => {
    const button = document.getElementById('menu-toggle');
    const panel = document.getElementById('site-nav');
    const b = button.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    return {
      expanded: button.getAttribute('aria-expanded'),
      label: button.getAttribute('aria-label'),
      controls: button.getAttribute('aria-controls'),
      buttonDisplay: getComputedStyle(button).display,
      buttonW: Math.round(b.width), buttonH: Math.round(b.height),
      panelDisplay: getComputedStyle(panel).display,
      panelHeight: p.height,
      panelHidden: panel.hidden,
      open: panel.hasAttribute('data-open'),
      activeId: document.activeElement.id,
      inPanel: panel.contains(document.activeElement),
      hash: location.hash,
    };
  })()`);

  scenario('menu-disclosure', async (t) => {
    for (const lang of LANGS) {
      await t.open(base + lang.path, { width: 390, height: 844 });
      let state = await menuState(t);
      assert(state.buttonDisplay !== 'none' && state.buttonW === 48 && state.buttonH === 48, `${lang.code}: menu button is ${state.buttonW} by ${state.buttonH} (${state.buttonDisplay}) at 390px`);
      assert(state.controls === 'site-nav', `${lang.code}: aria-controls is ${state.controls}`);
      assert(state.expanded === 'false' && state.label === lang.menuOpen, `${lang.code}: closed state is ${state.expanded} "${state.label}"`);
      assert(state.panelDisplay === 'none', `${lang.code}: the closed panel is displayed (${state.panelDisplay})`);

      // Closed panel: Tab from the button never lands inside it.
      await t.evaluate("document.getElementById('menu-toggle').focus()");
      for (let i = 0; i < 3; i += 1) {
        await t.press('Tab');
        state = await menuState(t);
        assert(!state.inPanel, `${lang.code}: Tab reached the closed panel`);
      }

      // Open with the pointer.
      await t.click('#menu-toggle');
      state = await menuState(t);
      assert(state.expanded === 'true' && state.label === lang.menuClose, `${lang.code}: open state is ${state.expanded} "${state.label}"`);
      assert(state.panelDisplay !== 'none' && state.panelHeight > 0 && state.open && !state.panelHidden, `${lang.code}: the open panel is not shown`);
      const linkCount = await t.evaluate("document.querySelectorAll('#site-nav .main-nav a').length");
      assert(linkCount === 5, `${lang.code}: ${linkCount} Main nav links, expected 5`);

      // Escape closes the panel and returns focus to the button.
      await t.evaluate("document.querySelector('#site-nav .main-nav a').focus()");
      await t.press('Escape');
      state = await menuState(t);
      assert(state.expanded === 'false' && state.panelDisplay === 'none', `${lang.code}: Escape did not close the panel`);
      assert(state.activeId === 'menu-toggle', `${lang.code}: after Escape focus is on "${state.activeId}", not the menu button`);

      // Keyboard opening: Enter on the button.
      await t.press('Enter');
      state = await menuState(t);
      assert(state.expanded === 'true', `${lang.code}: Enter on the button did not open the panel`);
      assert(!state.inPanel, `${lang.code}: opening moved focus into the panel (a disclosure does not trap or move focus)`);

      // Activating a link closes the panel and jumps to that section.
      await t.click(`#site-nav a[href="#${lang.benefits}"]`);
      await t.waitFor(`location.hash === '#${lang.benefits}'`, `${lang.code}: hash #${lang.benefits}`);
      state = await menuState(t);
      assert(state.expanded === 'false' && state.panelDisplay === 'none', `${lang.code}: a link did not close the panel`);
      await t.settleScroll();

      // Resizing to the full-menu width resets the panel and takes the button out of the tab order.
      await t.click('#menu-toggle');
      assert((await menuState(t)).expanded === 'true', `${lang.code}: could not reopen before the resize`);
      await viewport(t, 1280, 800);
      await sleep(150);
      state = await menuState(t);
      assert(state.expanded === 'false' && state.label === lang.menuOpen && !state.open, `${lang.code}: widening did not reset the state (${state.expanded}, "${state.label}")`);
      assert(state.panelDisplay !== 'none' && state.panelHeight > 0 && !state.panelHidden, `${lang.code}: the nav is not shown at 1280px`);
      assert(state.buttonDisplay === 'none', `${lang.code}: the menu button is displayed at 1280px`);
      await t.evaluate("document.getElementById('menu-toggle').focus()");
      assert((await t.evaluate("document.activeElement.id")) !== 'menu-toggle', `${lang.code}: the hidden menu button can take focus`);
      await viewport(t, 390, 844);
      await sleep(150);
      state = await menuState(t);
      assert(state.expanded === 'false' && state.panelDisplay === 'none', `${lang.code}: narrowing again did not leave the panel closed`);
    }
  });

  scenario('header-fit', async (t) => {
    for (const lang of LANGS) {
      for (const width of [1024, 1100, 1280]) {
        await t.open(base + lang.path, { width, height: 800 });
        const fit = await t.evaluate(`(() => {
          const header = document.querySelector('.site-header');
          const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
          const items = [...header.querySelectorAll('a, button')].filter(shown);
          const row = [...header.querySelectorAll('.main-nav a, .lang-switch a')];
          const centers = row.map((el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; });
          const overlaps = [];
          for (let i = 0; i < items.length; i += 1) {
            for (let j = i + 1; j < items.length; j += 1) {
              const a = items[i].getBoundingClientRect();
              const b = items[j].getBoundingClientRect();
              const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (w > 0.5 && h > 0.5) { overlaps.push(items[i].textContent.trim() + ' / ' + items[j].textContent.trim()); }
            }
          }
          const right = Math.max(...items.map((el) => el.getBoundingClientRect().right));
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            rowCount: row.length,
            spread: Math.max(...centers) - Math.min(...centers),
            overlaps,
            right, inner: innerWidth,
            height: header.getBoundingClientRect().height,
            menuButton: getComputedStyle(document.getElementById('menu-toggle')).display,
          };
        })()`);
        const where = `${lang.code} at ${width}px`;
        assert(!fit.overflow, `${where}: horizontal scroll`);
        assert(fit.rowCount === 7, `${where}: ${fit.rowCount} header links, expected 5 Main nav and 2 language`);
        assert(fit.spread <= 2, `${where}: the nav and language links are ${fit.spread.toFixed(1)}px apart vertically, not on one row`);
        assert(fit.overlaps.length === 0, `${where}: header items overlap: ${fit.overlaps.join(', ')}`);
        assert(fit.right <= fit.inner, `${where}: header content ends at ${fit.right}, beyond ${fit.inner}`);
        assert(Math.round(fit.height) === 64, `${where}: header height is ${fit.height}, expected 64`);
        assert(fit.menuButton === 'none', `${where}: the menu button is displayed`);
      }
    }
  });

  scenario('menu-no-js', async (t) => {
    await t.disableScripts(true);
    for (const lang of LANGS) {
      await t.open(base + lang.path, { width: 390, height: 844 });
      const state = await t.evaluate(`(() => {
        const links = [...document.querySelectorAll('.main-nav a, .lang-switch a')];
        const shown = (el) => { const r = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0; };
        return {
          jsClass: document.documentElement.classList.contains('js'),
          total: links.length,
          visible: links.filter(shown).length,
          button: getComputedStyle(document.getElementById('menu-toggle')).display,
          overflow: document.documentElement.scrollWidth > innerWidth,
          position: getComputedStyle(document.querySelector('.site-header')).position,
        };
      })()`);
      assert(!state.jsClass, `${lang.code}: the js class is set with scripts disabled`);
      assert(state.total === 7 && state.visible === 7, `${lang.code}: ${state.visible} of ${state.total} nav links visible without scripts`);
      assert(state.button === 'none', `${lang.code}: the menu button is displayed without scripts (${state.button})`);
      assert(!state.overflow, `${lang.code}: horizontal overflow at 390px without scripts`);
      assert(state.position !== 'sticky', `${lang.code}: the tall no-script header is sticky`);
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
    for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 800 }, { width: 600, height: 800 }, { width: 320, height: 640 }]) {
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

    const all = makeScenarios(server.base, site);
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
