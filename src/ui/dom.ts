// Tiny DOM helpers.

/** An element that is always on the page. */
export const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;

/** An element that may not exist right now (inputs inside the popup, etc). */
export const $q = <T extends HTMLElement = HTMLElement>(sel: string): T | null => document.querySelector(sel) as T | null;

export const readAmount = (el: HTMLInputElement | null): number =>
  el ? parseInt(String(el.value).replace(/[^0-9]/g, ''), 10) : NaN;

export const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
