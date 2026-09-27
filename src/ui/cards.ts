// HTML for cards and chip stacks.
import type { Card } from '../engine/types.ts';
import { RC, RN, SUITN, SYM } from '../engine/cards.ts';

const face = (c: Card): string =>
  `<span class="ix"><b>${RC(c.r)}</b><i>${SYM[c.s]}</i></span><span class="pip" aria-hidden="true">${SYM[c.s]}</span>`;

export const cardHTML = (c: Card, cls = '', attrs = ''): string =>
  `<span class="card ${cls} s-${c.s}" ${attrs} role="img" aria-label="${RN[c.r]} of ${SUITN[c.s]}">${face(c)}</span>`;

export const cardBtn = (c: Card, cls: string, attrs: string): string =>
  `<button type="button" class="card md ${cls} s-${c.s}" ${attrs} aria-label="${RN[c.r]} of ${SUITN[c.s]}">${face(c)}</button>`;

/** Room chip colors: [value, face, edge spots]. */
const DENOMS: [number, string, string][] = [
  [1000, '#E2AE1C', '#6E4E00'], [500, '#6A3D9E', '#F3EEF9'], [100, '#1C1C1C', '#F2F2F2'],
  [25, '#1F7A40', '#F2F2F2'], [5, '#B52F2A', '#F7F1E6'], [1, '#EFEAE0', '#2A58A6'],
];

/** Stacks of chips making `amt`, fewest chips first by denomination, `cap` chips tall at most. */
export function chipStacks(amt: number, cap: number): string {
  let r = amt; const out: string[] = [];
  for (const [v, c, e] of DENOMS) {
    const n = Math.floor(r / v);
    if (n) { out.push(`<span class="stack" style="--c:${c};--e:${e}">${'<i></i>'.repeat(Math.max(0, Math.min(n, cap) - 1))}</span>`); r -= n * v; }
  }
  return `<span class="stacks" aria-hidden="true">${out.join('')}</span>`;
}
