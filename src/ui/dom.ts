// Tiny DOM helpers.

/** An element that is always on the page. */
export const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;

/** An element that may not exist right now (inputs inside the popup, etc). */
export const $q = <T extends HTMLElement = HTMLElement>(sel: string): T | null => document.querySelector(sel) as T | null;

export const readAmount = (el: HTMLInputElement | null): number =>
  el ? parseInt(String(el.value).replace(/[^0-9]/g, ''), 10) : NaN;

/** The sheets that open under the header, and the header button for each. */
const SHEETS: Record<string, string> = { sheet: 'gear', spots: 'spotsBtn', daily: 'dailyOpen', feedback: 'feedbackOpen', stats: 'acctStats' };
export const sheetOpen = (id: string): boolean => !!document.getElementById(id)?.classList.contains('open');
/** Open one sheet (settings, weak spots, daily challenge, feedback, stats) and close the others. null closes them all. */
export function showSheet(id: string | null): void {
  for (const [sheet, btn] of Object.entries(SHEETS)) {
    document.getElementById(sheet)?.classList.toggle('open', sheet === id);
    document.getElementById(btn)?.setAttribute('aria-expanded', String(sheet === id));
  }
}

export const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Replace an element's markup, for pages that redraw whole sections (the instructor view, the
 * join page). Skips the redraw when nothing changed, and keeps the cursor in the box that had it,
 * so a redraw from something finishing in the background doesn't interrupt typing. Pages keep
 * what's typed in their state, so the new markup carries it.
 */
const drawn = new WeakMap<HTMLElement, string>();
export function redraw(el: HTMLElement, html: string): void {
  if (drawn.get(el) === html) return;
  const active = document.activeElement as HTMLInputElement | null;
  const id = active && el.contains(active) ? active.id : '';
  const sel = id && typeof active!.selectionStart === 'number' ? [active!.selectionStart, active!.selectionEnd] as const : null;
  el.innerHTML = html;
  drawn.set(el, html);
  if (!id) return;
  const again = document.getElementById(id) as HTMLInputElement | null;
  if (!again) return;
  again.focus();
  if (sel) try { again.setSelectionRange(sel[0], sel[1]); } catch { /* not a text box */ }
}
