// Tiny DOM helpers.

/** An element that is always on the page. */
export const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;

/** An element that may not exist right now (inputs inside the popup, etc). */
export const $q = <T extends HTMLElement = HTMLElement>(sel: string): T | null => document.querySelector(sel) as T | null;

export const readAmount = (el: HTMLInputElement | null): number =>
  el ? parseInt(String(el.value).replace(/[^0-9]/g, ''), 10) : NaN;

/** The sheets that open under the header, and the header button for each. */
const SHEETS: Record<string, string> = { sheet: 'gear', spots: 'spotsBtn', daily: 'dailyOpen' };
export const sheetOpen = (id: string): boolean => !!document.getElementById(id)?.classList.contains('open');
/** Open one sheet (settings, weak spots, daily challenge) and close the others. null closes them all. */
export function showSheet(id: string | null): void {
  for (const [sheet, btn] of Object.entries(SHEETS)) {
    document.getElementById(sheet)?.classList.toggle('open', sheet === id);
    document.getElementById(btn)?.setAttribute('aria-expanded', String(sheet === id));
  }
}

export const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
