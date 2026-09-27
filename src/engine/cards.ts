// Deck, five-card ranking, and best Omaha hand (exactly two hole cards + three board cards).
import type { Best, Card, Score, Suit } from './types.ts';
import { rand } from './rng.ts';

export const RN: Record<number, string> = { 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'jack', 12: 'queen', 13: 'king', 14: 'ace' };
export const RP: Record<number, string> = { 2: 'twos', 3: 'threes', 4: 'fours', 5: 'fives', 6: 'sixes', 7: 'sevens', 8: 'eights', 9: 'nines', 10: 'tens', 11: 'jacks', 12: 'queens', 13: 'kings', 14: 'aces' };
export const RC = (r: number): string => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[r] || String(r);
export const SYM: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const SUITN: Record<Suit, string> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
export const cardTxt = (c: Card): string => `${RC(c.r)}${SYM[c.s]}`;

export function newDeck(): Card[] {
  const d: Card[] = [];
  for (const s of ['s', 'h', 'd', 'c'] as Suit[]) for (let r = 2; r <= 14; r++) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

/** Rank exactly five cards. Categories: 8 straight flush … 0 high card. */
export function eval5(cs: Card[]): Score {
  const rs = cs.map(c => c.r).sort((a, b) => b - a);
  const flush = cs.every(c => c.s === cs[0].s);
  const cnt: Record<number, number> = {};
  rs.forEach(r => { cnt[r] = (cnt[r] || 0) + 1; });
  const g = Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a] || b - a);
  const c = g.map(r => cnt[r]);
  let sh = 0;
  if (g.length === 5) { if (rs[0] - rs[4] === 4) sh = rs[0]; else if (rs[0] === 14 && rs[1] === 5) sh = 5; }
  if (sh && flush) return [8, sh];
  if (c[0] === 4) return [7, ...g];
  if (c[0] === 3 && c[1] === 2) return [6, ...g];
  if (flush) return [5, ...rs];
  if (sh) return [4, sh];
  if (c[0] === 3) return [3, ...g];
  if (c[0] === 2 && c[1] === 2) return [2, ...g];
  if (c[0] === 2) return [1, ...g];
  return [0, ...rs];
}

export function cmp(a: Score, b: Score): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; }
  return 0;
}

export function combos(arr: number[], k: number): number[][] {
  const out: number[][] = [];
  (function go(s: number, acc: number[]) {
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let i = s; i < arr.length; i++) { acc.push(i); go(i + 1, acc); acc.pop(); }
  })(0, []);
  return out;
}
export const C42 = combos([0, 1, 2, 3], 2);
export const C53 = combos([0, 1, 2, 3, 4], 3);

/** Best Omaha hand: exactly two of four hole cards and three of five board cards. */
export function bestOmaha(hole: Card[], board: Card[]): Best {
  let best: Best | null = null;
  for (const h of C42) for (const b of C53) {
    const five = [hole[h[0]], hole[h[1]], board[b[0]], board[b[1]], board[b[2]]];
    const sc = eval5(five);
    if (!best || cmp(sc, best.score) > 0) best = { score: sc, hole: h, board: b, cards: five };
  }
  return best as Best;
}

/** Best five from any cards, ignoring the Omaha two-card rule (used to explain mistakes). */
export function bestAny(cards: Card[]): Score {
  let best: Score | null = null;
  for (const k of combos(cards.map((_, i) => i), 5)) { const sc = eval5(k.map(i => cards[i])); if (!best || cmp(sc, best) > 0) best = sc; }
  return best as Score;
}

/** Best hand a specific pair of hole cards makes with any three board cards. */
export function bestWithPair(hole: Card[], pair: number[], board: Card[]): Score {
  let best: Score | null = null;
  for (const b of C53) { const sc = eval5([...pair.map(k => hole[k]), ...b.map(k => board[k])]); if (!best || cmp(sc, best) > 0) best = sc; }
  return best as Score;
}

export function describe(s: Score): string {
  switch (s[0]) {
    case 8: return s[1] === 14 ? 'a royal flush' : `a straight flush, ${RN[s[1]]} high`;
    case 7: return `four of a kind, ${RP[s[1]]}`;
    case 6: return `a full house, ${RP[s[1]]} full of ${RP[s[2]]}`;
    case 5: return `a flush, ${RN[s[1]]} high`;
    case 4: return `a straight, ${RN[s[1]]} high`;
    case 3: return `three of a kind, ${RP[s[1]]}`;
    case 2: return `two pair, ${RP[s[1]]} and ${RP[s[2]]}`;
    case 1: return `a pair of ${RP[s[1]]}`;
    default: return `${RN[s[1]]} high`;
  }
}
