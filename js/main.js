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

document.addEventListener('click', (event) => {
  onLanguageClick(event);
  onAnchorClick(event);
});

reconcileHash();
initTabs();

export { selectTab };
