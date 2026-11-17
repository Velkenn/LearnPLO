// Card face art as SVG strings: the full 52-card faces for share images, flyers and promo.
// The app keeps its plain index-and-suit cards, which read faster at small sizes.
// No DOM access, so node scripts can use it.
import type { Card, Suit } from '../engine/types.ts';
import { RC, RN, SUITN } from '../engine/cards.ts';

export const INK = { red: '#C3262E', blk: '#1A1A1A', gold: '#C99B2F', goldHi: '#E2BE5A', goldLo: '#8A6512', cream: '#FFFDF7', felt: '#1E6045' };
const red = (s: Suit) => s === 'h' || s === 'd';
export const suitInk = (s: Suit): string => (red(s) ? INK.red : INK.blk);

/** Suit shapes drawn in a 24-unit box. */
const SUIT_PATH: Record<Suit, string> = {
  s: 'M12 2.5S3.5 9 3.5 14.2c0 2.8 2.1 4.6 4.4 4.6 1.4 0 2.6-.6 3.3-1.6-.2 1.7-.9 3.2-2.4 4.3h6.4c-1.5-1.1-2.2-2.6-2.4-4.3.7 1 1.9 1.6 3.3 1.6 2.3 0 4.4-1.8 4.4-4.6C20.5 9 12 2.5 12 2.5z',
  h: 'M12 21s-7.5-4.6-9.6-9.2C.9 8.5 2.8 4.5 6.6 4.5c2.2 0 3.6 1.2 5.4 3.3 1.8-2.1 3.2-3.3 5.4-3.3 3.8 0 5.7 4 4.2 7.3C19.5 16.4 12 21 12 21z',
  d: 'M12 2c2.4 3.7 5 6.9 8 10-3 3.1-5.6 6.3-8 10-2.4-3.7-5-6.9-8-10 3-3.1 5.6-6.3 8-10z',
  c: 'M12 2.6a4.4 4.4 0 0 0-4.1 6 4.4 4.4 0 1 0 2.9 7.4c-.2 1.9-.9 3.5-2.5 4.9h7.4c-1.6-1.4-2.3-3-2.5-4.9a4.4 4.4 0 1 0 2.9-7.4 4.4 4.4 0 0 0-4.1-6z',
};

/** A suit symbol `size` units wide, centered on (x, y), optionally upside down. */
export function suitShape(s: Suit, x: number, y: number, size: number, fill = suitInk(s), flip = false): string {
  const k = size / 24;
  return `<path d="${SUIT_PATH[s]}" fill="${fill}" transform="translate(${x} ${y})${flip ? ' rotate(180)' : ''} scale(${+k.toFixed(4)}) translate(-12 -12)"/>`;
}

/** A casino chip seen from above, centered on (x, y). */
function chip(x: number, y: number, r: number, face: string, spot: string, s: Suit | null, symFill: string): string {
  const spots = Array.from({ length: 8 }, (_, i) =>
    `<rect x="${-r * .17}" y="${-r}" width="${r * .34}" height="${r * .24}" rx="${r * .04}" fill="${spot}" transform="rotate(${i * 45 + 22.5})"/>`).join('');
  return `<g transform="translate(${x} ${y})"><circle r="${r}" fill="${face}"/>${spots}`
    + `<circle r="${r * .7}" fill="none" stroke="${spot}" stroke-width="${r * .045}"/>`
    + (s ? suitShape(s, 0, 0, r * .8, symFill) : '') + '</g>';
}

/** A short stack of chips seen from slightly above: darker copies of the top chip peek out below it. */
function chipStack(x: number, y: number, r: number, face: string, edge: string, spot: string, s: Suit, symFill: string, n = 3): string {
  let g = '';
  for (let i = n - 1; i >= 1; i--) g += chip(x, y + i * r * .2, r, edge, spot, null, symFill).replace('<g ', '<g opacity=".9" ');
  return g + chip(x, y, r, face, spot, s, symFill);
}

/** Court emblems in a 100 x 64 box centered on (x, y): K a pit boss crown, Q a tiara, J a chip runner's stack. */
function crown(x: number, y: number, w: number, s: Suit, ink = suitInk(s)): string {
  const k = w / 100;
  return `<g transform="translate(${x} ${y}) scale(${k}) translate(-50 -32)">`
    + `<path d="M8 50 2 10l24 20L50 0l24 30 24-20-6 40z" fill="${INK.gold}" stroke="${INK.goldLo}" stroke-width="2.5" stroke-linejoin="round"/>`
    + `<rect x="6" y="48" width="88" height="14" rx="2" fill="${INK.gold}" stroke="${INK.goldLo}" stroke-width="2.5"/>`
    + `<circle cx="2" cy="10" r="5" fill="${INK.goldHi}" stroke="${INK.goldLo}" stroke-width="2"/><circle cx="50" cy="2" r="6" fill="${INK.goldHi}" stroke="${INK.goldLo}" stroke-width="2"/><circle cx="98" cy="10" r="5" fill="${INK.goldHi}" stroke="${INK.goldLo}" stroke-width="2"/>`
    + `<circle cx="28" cy="55" r="4" fill="${ink}"/><circle cx="72" cy="55" r="4" fill="${ink}"/>`
    + suitShape(s, 50, 55, 13, ink) + suitShape(s, 50, 30, 20, ink) + '</g>';
}

function tiara(x: number, y: number, w: number, s: Suit, ink = suitInk(s)): string {
  const k = w / 100;
  return `<g transform="translate(${x} ${y}) scale(${k}) translate(-50 -32)">`
    + `<path d="M6 52C10 34 22 22 34 26c4-14 10-22 16-24 6 2 12 10 16 24 12-4 24 8 28 26z" fill="${INK.gold}" stroke="${INK.goldLo}" stroke-width="2.5" stroke-linejoin="round"/>`
    + `<path d="M6 52h88v8H6z" fill="${INK.gold}" stroke="${INK.goldLo}" stroke-width="2.5" stroke-linejoin="round"/>`
    + `${[[34, 26, 4.5], [66, 26, 4.5], [50, 2, 5.5], [15, 38, 3.5], [85, 38, 3.5]].map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${INK.goldHi}" stroke="${INK.goldLo}" stroke-width="2"/>`).join('')}`
    + `<circle cx="22" cy="48" r="3.5" fill="${ink}"/><circle cx="78" cy="48" r="3.5" fill="${ink}"/>`
    + suitShape(s, 50, 34, 24, ink) + '</g>';
}

function runnerStack(x: number, y: number, w: number, s: Suit, ink = suitInk(s)): string {
  // Side view of a short stack of chips: alternating suit color and cream, with edge stripes.
  const k = w / 100;
  let g = `<g transform="translate(${x} ${y}) scale(${k}) translate(-50 -32)">`;
  const rows = 4;
  for (let i = 0; i < rows; i++) {
    const yy = 50 - i * 13, face = i % 2 ? INK.cream : ink, mark = i % 2 ? ink : INK.cream;
    g += `<rect x="14" y="${yy}" width="72" height="12" rx="3" fill="${face}" stroke="${INK.goldLo}" stroke-width="1.6"/>`;
    for (const mx of [22, 46, 70]) g += `<rect x="${mx}" y="${yy + 2}" width="8" height="8" rx="1" fill="${mark}"/>`;
  }
  return g + `<ellipse cx="50" cy="11" rx="36" ry="7" fill="${INK.gold}" stroke="${INK.goldLo}" stroke-width="1.6"/>` + suitShape(s, 50, 11, 11, ink) + '</g>';
}

const COURT: Record<number, typeof crown> = { 11: runnerStack, 12: tiara, 13: crown };

/** Small art the app shows in a card's corner for aces and court cards (24-unit box). Empty for 2 to 10.
 *  Pass `currentColor` as `ink` to follow the card's CSS color (four-color deck). */
export function emblemSVG(c: Card, ink = suitInk(c.s)): string {
  if (c.r === 14) {
    const sp = c.s === 's';
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${chip(12, 12, 11.5, ink, sp ? INK.gold : INK.cream, c.s, sp ? INK.gold : INK.cream)}</svg>`;
  }
  const f = COURT[c.r];
  return f ? `<svg viewBox="0 0 24 24" aria-hidden="true">${f(12, 12, 24, c.s, ink)}</svg>` : '';
}

/** Where the pips go on 2 to 10, in a 250 x 350 card: [x, y], upside down below the middle. */
const L = 82, M = 125, R = 168, T = 80, B = 270, MID = 175;
const q1 = T + (B - T) / 3, q2 = T + 2 * (B - T) / 3;
const PIPS: Record<number, [number, number][]> = {
  2: [[M, T], [M, B]],
  3: [[M, T], [M, MID], [M, B]],
  4: [[L, T], [R, T], [L, B], [R, B]],
  5: [[L, T], [R, T], [M, MID], [L, B], [R, B]],
  6: [[L, T], [R, T], [L, MID], [R, MID], [L, B], [R, B]],
  7: [[L, T], [R, T], [M, (T + MID) / 2], [L, MID], [R, MID], [L, B], [R, B]],
  8: [[L, T], [R, T], [M, (T + MID) / 2], [L, MID], [R, MID], [M, (MID + B) / 2], [L, B], [R, B]],
  9: [[L, T], [R, T], [L, q1], [R, q1], [M, MID], [L, q2], [R, q2], [L, B], [R, B]],
  10: [[L, T], [R, T], [M, (T + q1) / 2], [L, q1], [R, q1], [L, q2], [R, q2], [M, (q2 + B) / 2], [L, B], [R, B]],
};

const FONT = `'Barlow Condensed','Arial Narrow','Roboto Condensed',sans-serif`;

/** The FeltReady "Card F" mark in a 100-unit box (cream card, green F, gold spade). */
export function logoMark(x: number, y: number, size: number, card = INK.felt, ink = INK.cream, spade = INK.gold): string {
  const k = size / 100;
  return `<g transform="translate(${x} ${y}) scale(${k}) translate(-50 -50) rotate(-8 50 50)"><rect x="20" y="7" width="60" height="86" rx="10" fill="${card}"/>`
    + `<rect x="36" y="25" width="11" height="50" fill="${ink}"/><rect x="36" y="25" width="30" height="11" fill="${ink}"/><rect x="36" y="45" width="23" height="10" fill="${ink}"/>`
    + `<path d="${SUIT_PATH.s}" fill="${spade}" transform="translate(58 62) scale(0.62)"/></g>`;
}

export interface FaceOpts { border?: boolean; radius?: number }

/** A complete card face as an SVG, 250 x 350 units (poker size). */
export function cardSVG(c: Card, o: FaceOpts = {}): string {
  const ink = suitInk(c.s), rad = o.radius ?? 16;
  const idx = (flip: boolean) => `<g${flip ? ' transform="rotate(180 125 175)"' : ''}>`
    + `<text x="31" y="60" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="58" letter-spacing="-2" fill="${ink}">${RC(c.r)}</text>`
    + suitShape(c.s, 31, 84, 30, ink) + '</g>';
  let art = '';
  if (c.r <= 10) {
    art = PIPS[c.r].map(([x, y]) => suitShape(c.s, x, y, 54, ink, y > MID)).join('');
  } else if (c.r === 14) {
    const sp = c.s === 's';
    art = chipStack(125, 152, 66, ink, red(c.s) ? '#8E1A20' : '#3B3B3B', sp ? INK.gold : INK.cream, c.s, sp ? INK.gold : INK.cream)
      + (sp ? logoMark(125, 286, 62) : '');
  } else {
    // Court: a felt green panel in a gold frame, double ended like a classic deck.
    const half = COURT[c.r](125, 106, 118, c.s);
    art = `<rect x="54" y="22" width="142" height="306" rx="8" fill="${INK.felt}" stroke="${INK.gold}" stroke-width="3.5"/>`
      + `<rect x="61" y="29" width="128" height="292" rx="5" fill="none" stroke="${INK.goldHi}" stroke-width="1.2" opacity=".8"/>`
      + `<path d="M61 175h46M143 175h46" stroke="${INK.goldHi}" stroke-width="1.4" opacity=".8"/>`
      + suitShape(c.s, 125, 175, 22, INK.gold)
      + [[74, 44, 0], [176, 44, 0], [74, 306, 1], [176, 306, 1]].map(([x, y, f]) => suitShape(c.s, x, y, 13, INK.gold, !!f)).join('')
      + half + `<g transform="rotate(180 125 175)">${half}</g>`;
  }
  const edge = o.border === false ? '' : ` stroke="#CFC7B4" stroke-width="2"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350" role="img" aria-label="${RN[c.r]} of ${SUITN[c.s]}">`
    + `<rect x="1" y="1" width="248" height="348" rx="${rad}" fill="${INK.cream}"${edge}/>${art}${idx(false)}${idx(true)}</svg>`;
}
