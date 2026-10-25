import React from 'react';

/**
 * RM-00-01: when the professional shell switches module, the page starts at the top and
 * keyboard / screen-reader focus lands on the new page's h1.
 *
 * The scrolling element is the document (`.app-frame` only sets a min-height and the sidebar
 * and top bar are sticky), so the reset targets `document.scrollingElement`.
 */
const HEADING_SELECTOR = '.app-page h1';
// Where focus may be taken from: nothing in particular, or the navigation chrome the user just used.
const CHROME_SELECTOR = '.app-sidebar, .app-topbar';
const HEADING_WAIT_MS = 3000;
// In drawer mode the shell closes the drawer after a navigation and returns focus to its menu button; that must not win over the new heading.
const DRAWER_RETURN_SELECTOR = '.app-menu-button';
const DRAWER_RETURN_WINDOW_MS = 600;

export function resetPageScroll(doc: Document = document) {
  const scroller = doc.scrollingElement ?? doc.documentElement;
  scroller.scrollTop = 0;
  scroller.scrollLeft = 0;
}

function mayMoveFocus(doc: Document) {
  const active = doc.activeElement;
  return !active || active === doc.body || active === doc.documentElement || active.closest(CHROME_SELECTOR) !== null;
}

/** Focuses the current page heading. Returns it when focus moved there, or null when there is no heading yet or the user already moved focus elsewhere. */
export function focusPageHeading(doc: Document = document) {
  const heading = doc.querySelector<HTMLElement>(HEADING_SELECTOR);
  if (!heading || !mayMoveFocus(doc)) return null;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
  return doc.activeElement === heading ? heading : null;
}

/** Focuses the heading as soon as the page renders it (pages may render their h1 after loading). Returns a cancel function. */
export function focusPageHeadingWhenReady(doc: Document = document) {
  const win = doc.defaultView;
  if (!win) return () => {};
  let cancelled = false;
  let observer: MutationObserver | null = null;
  let timer = 0;
  const releaseGuard: Array<() => void> = [];
  const guardDrawerReturn = (document_: Document, heading: HTMLElement) => {
    const onFocusIn = (event: FocusEvent) => {
      if (heading.isConnected && event.target instanceof win.Element && event.target.closest(DRAWER_RETURN_SELECTOR)) heading.focus({ preventScroll: true });
    };
    const release = () => document_.removeEventListener('focusin', onFocusIn);
    document_.addEventListener('focusin', onFocusIn);
    releaseGuard.push(release);
    win.setTimeout(release, DRAWER_RETURN_WINDOW_MS);
  };
  const stop = () => { cancelled = true; observer?.disconnect(); win.clearTimeout(timer); };
  const attempt = () => {
    if (cancelled) return;
    if (doc.querySelector(HEADING_SELECTOR)) { const heading = focusPageHeading(doc); stop(); if (heading) guardDrawerReturn(doc, heading); return; }
    if (!mayMoveFocus(doc)) stop();
  };
  const frame = win.requestAnimationFrame ? win.requestAnimationFrame(attempt) : win.setTimeout(attempt, 0);
  const root = doc.querySelector('.app-page');
  if (root && typeof win.MutationObserver === 'function') {
    observer = new win.MutationObserver(attempt);
    observer.observe(root, { childList: true, subtree: true });
  }
  timer = win.setTimeout(stop, HEADING_WAIT_MS);
  return () => { stop(); releaseGuard.forEach((release) => release()); if (win.cancelAnimationFrame) win.cancelAnimationFrame(frame); };
}

/** Call once with the current professional module id; runs only when the module actually changes (not on mount, not on re-renders). */
export function usePageResetOnModuleChange(module: string) {
  const previous = React.useRef(module);
  React.useEffect(() => {
    if (previous.current === module) return;
    previous.current = module;
    resetPageScroll();
    return focusPageHeadingWhenReady();
  }, [module]);
}
