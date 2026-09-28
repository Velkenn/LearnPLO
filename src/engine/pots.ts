// Side pots. When someone is all in for less, the dealer builds the side pot at the end of that
// betting round: from each bet this round, the all-in amount goes in the main pot and the rest
// starts the side pot. Chips from earlier rounds are already in the middle, in the main pot.
import type { Hand, Pot } from './types.ts';
import { active } from './hand.ts';

/** "Main pot", "Side pot", or "Side pot 2" depending on how many pots there are. */
export const potName = (k: number, total: number): string => k === 0 ? 'Main pot' : total > 2 ? `Side pot ${k}` : 'Side pot';
export const cutTop = (S: Hand): number => S.cuts.length ? S.cuts[S.cuts.length - 1].level : 0;
export const cutSum = (S: Hand): number => S.cuts.reduce((a, c) => a + c.amount, 0);

/** Each player's chips in the hand above a level (what's left after cutting pots below it). */
export function outAbove(S: Hand, lvl: number) {
  return S.players.filter(p => p.totalIn > lvl).map(p => ({ i: p.i, folded: p.folded, allin: p.allin, amt: p.totalIn - lvl }));
}

/** All-in levels that now need a side pot: a live all-in that someone else put in more than. */
export function newCutLevels(S: Hand): number[] {
  const last = cutTop(S);
  return [...new Set(active(S).filter(p => p.allin).map(p => p.totalIn))]
    .filter(L => L > last && S.players.some(x => x.totalIn > L))
    .sort((a, b) => a - b);
}

export function makeCut(S: Hand, L: number, prev: number): Pot {
  const parts = S.players.map(p => ({ i: p.i, folded: p.folded, amt: Math.max(0, Math.min(p.totalIn, L) - prev) })).filter(x => x.amt > 0);
  // This round's share: each bet this round, between the pot below and this all-in level.
  const start = (i: number) => Math.max(prev, S.streetStart?.[i] ?? 0);
  const roundParts = S.players.map(p => ({ i: p.i, folded: p.folded, amt: Math.max(0, Math.min(p.totalIn, L) - start(p.i)) })).filter(x => x.amt > 0);
  return {
    level: L, prev, parts, amount: parts.reduce((a, b) => a + b.amt, 0),
    roundParts, round: roundParts.reduce((a, b) => a + b.amt, 0),
    elig: active(S).filter(p => p.totalIn >= L).map(p => p.i), name: '',
  };
}

/** Each player's bet this round above a pot level: what's in front of them when the dealer builds pots. */
export function roundBets(S: Hand, prev: number) {
  return S.players
    .map(p => ({ i: p.i, folded: p.folded, allin: p.allin, amt: p.totalIn - Math.max(prev, S.streetStart?.[p.i] ?? 0) }))
    .filter(x => x.amt > 0);
}

/** Make (but don't commit) the pots for these all-in levels, and rename earlier pots to match. */
export function prepareCuts(S: Hand, levels: number[]): Pot[] {
  const base = S.cuts.length, total = base + levels.length + 1;
  let prev = cutTop(S);
  const pots = levels.map((L, j) => { const pt = makeCut(S, L, prev); prev = L; pt.idx = base + j; pt.name = potName(base + j, total); return pt; });
  S.cuts.forEach((c, k) => { c.name = potName(k, total); });
  return pots;
}

/** Commit built pots (safe to call twice for the same pot). */
export function commitCuts(S: Hand, pots: Pot[]): void {
  for (const pt of pots) if (!S.cuts.includes(pt)) S.cuts.push(pt);
}

/** All pots at showdown, from every live player's total. Matches the pots built during the hand. */
export function buildPots(S: Hand): Pot[] {
  const live = active(S);
  const levels = [...new Set(live.map(p => p.totalIn))].sort((a, b) => a - b);
  let prev = 0; const pots: Pot[] = [];
  for (const L of levels) {
    const parts = S.players.map(p => ({ i: p.i, folded: p.folded, amt: Math.max(0, Math.min(p.totalIn, L) - prev) })).filter(x => x.amt > 0);
    const amount = parts.reduce((a, b) => a + b.amt, 0);
    if (amount > 0) pots.push({ amount, parts, level: L, prev, elig: live.filter(p => p.totalIn >= L).map(p => p.i), name: '' });
    prev = L;
  }
  S.players.forEach(p => {
    const x = p.totalIn - prev;
    if (x > 0 && pots.length) { const last = pots[pots.length - 1]; last.amount += x; last.parts.push({ i: p.i, folded: p.folded, amt: x }); }
  });
  pots.forEach((pt, k) => { pt.name = potName(k, pots.length); });
  return pots;
}
