// LatiFi landing behavior: language persistence, hash mapping between the two
// language pages, and anchor jumps that move keyboard focus to the section heading.
// No libraries, no HTML injection, no inline handlers (CSP: script-src 'self').
'use strict';

const LANG_KEY = 'latifi.lang';

// Section ids per language. English id on the left, Spanish id on the right.
// The id of the hero (top) and of the FAQ (faq) is the same in both languages.
const ID_MAP = {
  'how-it-works': 'como-funciona',
  benefits: 'beneficios',
  security: 'seguridad',
  download: 'descarga',
  faq: 'faq',
  top: 'top',
};

// The only two functions that touch browser storage. A blocked or full store
// must never break the page, so failures return null or do nothing.
function safeGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function safeSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    // Nothing to do: the page keeps the language of its URL.
  }
}

function pageLang() {
  return document.documentElement.lang.slice(0, 2).toLowerCase();
}

// Returns the hash for the target language ("#download" to "#descarga").
// Unknown ids come back unchanged.
function mapHash(hash, toLang) {
  if (!hash || hash.charAt(0) !== '#') {
    return hash || '';
  }
  const id = hash.slice(1);
  let mapped = null;
  if (toLang === 'es') {
    mapped = Object.prototype.hasOwnProperty.call(ID_MAP, id) ? ID_MAP[id] : null;
  } else {
    const entry = Object.keys(ID_MAP).find((key) => ID_MAP[key] === id);
    mapped = entry === undefined ? null : entry;
  }
  return mapped === null ? hash : '#' + mapped;
}

function prefersSmoothScroll() {
  return window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
}

function scrollToSection(section) {
  section.scrollIntoView({
    behavior: prefersSmoothScroll() ? 'smooth' : 'instant',
    block: 'start',
  });
}

// A shared link may carry the id of the other language (for example
// /es/#how-it-works). Rewrite it to the id this page owns and show that section.
function reconcileHash() {
  const hash = window.location.hash;
  if (!hash) {
    return;
  }
  let id;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch (error) {
    return;
  }
  if (document.getElementById(id)) {
    return;
  }
  const mapped = mapHash('#' + id, pageLang());
  const section = mapped === '#' + id ? null : document.getElementById(mapped.slice(1));
  if (!section) {
    return;
  }
  window.history.replaceState(null, '', mapped);
  scrollToSection(section);
}

// Runs on a click inside the language switch. Stores the choice before the
// browser navigates and carries the current section across the id map.
function onLanguageClick(event) {
  const link = event.target.closest('nav.lang-switch a');
  if (!link) {
    return;
  }
  const lang = (link.getAttribute('hreflang') || '').slice(0, 2).toLowerCase();
  if (lang !== 'en' && lang !== 'es') {
    return;
  }
  safeSet(LANG_KEY, lang);
  const base = (link.getAttribute('href') || '').split('#')[0];
  link.setAttribute('href', base + mapHash(window.location.hash, lang));
}

// In-page links to a section: scroll, move focus to the section heading so a
// screen reader announces where the visitor landed, and record the hash.
function onAnchorClick(event) {
  if (event.defaultPrevented || event.button !== 0) {
    return;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  const link = event.target.closest('a[href^="#"]');
  if (!link) {
    return;
  }
  const href = link.getAttribute('href');
  const section = href.length > 1 ? document.getElementById(href.slice(1)) : null;
  if (!section || section.tagName !== 'SECTION') {
    return;
  }
  event.preventDefault();
  scrollToSection(section);
  const heading = section.querySelector('h1, h2') || section;
  heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
  if (window.location.hash !== href) {
    window.history.pushState(null, '', href);
  }
}

// Tabs (How it works). The markup ships the tablist with the hidden attribute and both
// panels visible, so without this script the content stays stacked and readable.
const TAB_PREFIX = 'tab-';

function tabList() {
  return document.querySelector('[role="tablist"]');
}

// Selects the tab called name ("borrower" or "lender"): aria-selected, roving tabindex and
// panel visibility move together. options.focus moves keyboard focus to that tab.
function selectTab(name, options) {
  const list = tabList();
  if (!list) {
    return;
  }
  const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
  const wanted = tabs.find((tab) => tab.id === TAB_PREFIX + name);
  if (!wanted) {
    return;
  }
  tabs.forEach((tab) => {
    const selected = tab === wanted;
    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    tab.setAttribute('tabindex', selected ? '0' : '-1');
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    if (panel) {
      panel.hidden = !selected;
    }
  });
  if (options && options.focus) {
    wanted.focus();
  }
}

function onTabKeydown(event) {
  const tab = event.target.closest('[role="tab"]');
  if (!tab || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return;
  }
  const tabs = Array.from(tab.parentNode.querySelectorAll('[role="tab"]'));
  const index = tabs.indexOf(tab);
  let next = -1;
  if (event.key === 'ArrowRight') {
    next = (index + 1) % tabs.length;
  } else if (event.key === 'ArrowLeft') {
    next = (index - 1 + tabs.length) % tabs.length;
  } else if (event.key === 'Home') {
    next = 0;
  } else if (event.key === 'End') {
    next = tabs.length - 1;
  }
  if (next < 0) {
    return;
  }
  event.preventDefault();
  selectTab(tabs[next].id.slice(TAB_PREFIX.length), { focus: true });
}

function initTabs() {
  const list = tabList();
  if (!list) {
    return;
  }
  const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
  if (tabs.length === 0) {
    return;
  }
  list.removeAttribute('hidden');
  const current = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') || tabs[0];
  selectTab(current.id.slice(TAB_PREFIX.length));
  list.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) {
      selectTab(tab.id.slice(TAB_PREFIX.length));
    }
  });
  list.addEventListener('keydown', onTabKeydown);
}

// Video slot (Benefits). The slot ships with the hidden attribute and an empty data-src, so
// it is inert: no request, no space. A maintainer sets an https URL in data-src and removes
// hidden. Only an https URL is ever used, and the CSP still blocks the frame until the exact
// origin is added to frame-src (T-06-09).
const VIDEO_TIMEOUT_MS = 8000;
const VIDEO_REFRESH_EVENT = 'latifi:video-refresh';
let stopVideo = null;

// Returns the URL when raw is an absolute https URL, otherwise null.
function httpsUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : null;
  } catch (error) {
    return null;
  }
}

function initVideo() {
  if (stopVideo) {
    stopVideo();
    stopVideo = null;
  }
  const slot = document.getElementById('video-slot');
  if (!slot || slot.hidden) {
    return;
  }
  const frame = slot.querySelector('iframe');
  const problem = slot.querySelector('.video-error');
  const url = frame ? httpsUrl(frame.getAttribute('data-src') || '') : null;
  if (!frame || !problem || url === null) {
    return;
  }

  problem.hidden = true;
  let observer = null;
  let timer = null;
  let finished = false;

  const release = () => {
    finished = true;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    window.removeEventListener('offline', fail);
    window.removeEventListener('online', retry);
    frame.removeEventListener('load', loaded);
    frame.removeEventListener('error', fail);
  };
  function fail() {
    release();
    problem.hidden = false;
  }
  function loaded() {
    release();
  }
  function retry() {
    initVideo();
  }
  const activate = () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (finished) {
      return;
    }
    if (window.navigator.onLine === false) {
      fail();
      window.addEventListener('online', retry);
      return;
    }
    timer = window.setTimeout(fail, VIDEO_TIMEOUT_MS);
    frame.setAttribute('src', url);
  };

  frame.addEventListener('load', loaded);
  frame.addEventListener('error', fail);
  window.addEventListener('offline', fail);
  stopVideo = release;

  if (window.navigator.onLine === false) {
    activate();
  } else if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        activate();
      }
    }, { rootMargin: '200px' });
    observer.observe(frame);
  } else {
    activate();
  }
}

// Hero segment buttons ("I'm a borrower", "I'm a lender"): select that tab, scroll to How it
// works and put keyboard focus on the selected tab. Without scripts the link is a plain jump.
function onSegmentClick(event) {
  if (event.defaultPrevented || event.button !== 0) {
    return;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  const link = event.target.closest('a[data-segment]');
  if (!link) {
    return;
  }
  const href = link.getAttribute('href') || '';
  const section = href.length > 1 ? document.getElementById(href.slice(1)) : null;
  const segment = link.getAttribute('data-segment');
  const tab = document.getElementById(TAB_PREFIX + segment);
  if (!section || !tab) {
    return;
  }
  event.preventDefault();
  selectTab(segment);
  scrollToSection(section);
  tab.focus({ preventScroll: true });
  if (window.location.hash !== href) {
    window.history.pushState(null, '', href);
  }
}

// Menu disclosure (header). Below FULL_MENU_MIN the Main nav and the language switch live in a
// panel that the menu button opens. It is a disclosure, not a modal: no focus trap. The labels of
// the button come from data attributes, so no visible string lives in this script.
// FULL_MENU_MIN must equal the full-menu media query in css/main.css.
const FULL_MENU_MIN = 1024;

function initMenu() {
  const button = document.getElementById('menu-toggle');
  const panel = document.getElementById('site-nav');
  if (!button || !panel) {
    return;
  }
  const wide = window.matchMedia('(min-width: ' + FULL_MENU_MIN + 'px)');
  const isOpen = () => button.getAttribute('aria-expanded') === 'true';

  // One place changes every part of the state, so the attributes can never disagree.
  const setOpen = (open) => {
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    const label = button.getAttribute(open ? 'data-label-close' : 'data-label-open');
    if (label) {
      button.setAttribute('aria-label', label);
    }
    if (open) {
      panel.setAttribute('data-open', '');
    } else {
      panel.removeAttribute('data-open');
    }
    panel.hidden = wide.matches ? false : !open;
  };

  button.addEventListener('click', () => {
    setOpen(!isOpen());
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) {
      setOpen(false);
      button.focus();
    }
  });
  panel.addEventListener('click', (event) => {
    if (isOpen() && event.target.closest('a')) {
      setOpen(false);
    }
  });
  wide.addEventListener('change', () => {
    setOpen(false);
  });
  setOpen(false);
}

// Runs fn at most once per animation frame while the page scrolls.
function onScrollFrame(fn) {
  let queued = false;
  window.addEventListener('scroll', () => {
    if (queued) {
      return;
    }
    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      fn();
    });
  }, { passive: true });
  fn();
}

// The header gets its level 2 shadow once the page has scrolled a little.
function initHeaderShadow() {
  const header = document.querySelector('.site-header');
  if (!header) {
    return;
  }
  onScrollFrame(() => {
    header.classList.toggle('is-scrolled', window.scrollY > 8);
  });
}

// Back to top: shown after two viewport heights of scroll. It is not announced (no live region);
// activating it jumps to the top and moves keyboard focus to the hero container.
function initBackToTop() {
  const link = document.querySelector('.back-to-top');
  const top = document.getElementById('top');
  if (!link || !top) {
    return;
  }
  onScrollFrame(() => {
    link.hidden = window.scrollY <= window.innerHeight * 2;
  });
  link.addEventListener('click', (event) => {
    event.preventDefault();
    // A jump, not an animation: two screens of smooth scrolling take longer than 500 ms in Chrome.
    window.scrollTo({ top: 0, behavior: 'instant' });
    top.focus({ preventScroll: true });
  });
}

document.addEventListener('click', (event) => {
  onLanguageClick(event);
  onSegmentClick(event);
  onAnchorClick(event);
});

// A maintainer or a test can dispatch this event on the document after changing the slot.
document.addEventListener(VIDEO_REFRESH_EVENT, initVideo);

reconcileHash();
initMenu();
initHeaderShadow();
initBackToTop();
initTabs();
initVideo();

export { selectTab };
