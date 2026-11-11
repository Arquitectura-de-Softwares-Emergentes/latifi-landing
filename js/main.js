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

document.addEventListener('click', (event) => {
  onLanguageClick(event);
  onAnchorClick(event);
});

reconcileHash();
