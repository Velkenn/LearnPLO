// Showdown: who can win each pot, who mucks, grading a read, and paying the pot.
import type { Hand, Pot, Score, Showdown } from './types.ts';
import { bestAny, bestOmaha, bestWithPair, cmp, eval5, describe, cardTxt } from './cards.ts';
import { active, fromBtn, seatName, logStreet } from './hand.ts';
import { buildPots } from './pots.ts';
import { fmt, seatList } from '../util.ts';

export function buildShowdown(S: Hand): Showdown {
  const rows = active(S).map(p => ({ i: p.i, best: bestOmaha(p.hole, S.board) }));
  const pots = buildPots(S);
  pots.forEach(pt => {
    const er = rows.filter(r => pt.elig.includes(r.i));
    let top = er[0].best.score;
    er.forEach(r => { if (cmp(r.best.score, top) > 0) top = r.best.score; });
    pt.top = top;
    pt.winners = er.filter(r => cmp(r.best.score, top) === 0).map(r => r.i);
  });
  logStreet(S, 'Showdown');
  rows.forEach(r => { const p = S.players[r.i]; S.log.push({ t: `${seatName(p)} shows <span class="lc">${p.hole.map(cardTxt).join(' ')}</span>` }); });
  return { rows, pots, order: pots.map((_, k) => k).reverse(), step: 0, phase: 'read', results: {}, mucked: new Set() };
}

export const curPot = (sd: Showdown): Pot => sd.pots[sd.order[sd.step]];

/** Players still holding cards for a pot. Anyone who lost a bigger pot has mucked. */
export const liveElig = (sd: Showdown, pt: Pot, gone?: Set<number>): number[] =>
  pt.elig.filter(i => !(gone || sd.mucked).has(i));
export const losersOf = (sd: Showdown, pt: Pot): number[] => liveElig(sd, pt).filter(i => !pt.winners!.includes(i));
export const muckAfter = (sd: Showdown, pt: Pot): Set<number> => new Set([...sd.mucked, ...losersOf(sd, pt)]);

/** Pay a pot. The odd chip in a chop goes to the first winner left of the button. */
export function awardPot(S: Hand, sd: Showdown, pt: Pot): void {
  const winners = pt.winners!;
  const share = Math.floor(pt.amount / winners.length); pt.share = share; pt.awarded = true;
  const rem = pt.amount - share * winners.length;
  if (rem) {
    const first = [...winners].sort((a, b) => fromBtn(S, a) - fromBtn(S, b))[0];
    pt.odd = { seat: first, amt: rem }; S.players[first].stack += rem;
  }
  winners.forEach(i => { S.players[i].stack += share; });
  const multi = sd.pots.length > 1;
  S.log.push({ t: `${seatList(winners)} ${winners.length > 1 ? 'split' : 'wins'} ${multi ? `the ${pt.name.toLowerCase()} (${fmt(pt.amount)})` : fmt(pt.amount)}${pt.elig.length > 1 ? ` with ${describe(pt.top!)}` : ', uncontested'}` });
}

/** Grade the dealer's picks: hole cards per seat plus three board cards. */
export function gradePicks(S: Hand, pt: Pot, holes: Record<number, number[]>, board: number[]): { picks: { seat: number; score: Score }[]; ok: boolean } {
  const seats = Object.keys(holes).map(Number);
  const picks = seats.map(s => {
    const p = S.players[s];
    let sc = eval5([...holes[s].map(k => p.hole[k]), ...board.map(k => S.board[k])]);
    // In a chop, a second winner may play different board cards than the first.
    if (seats.length > 1 && pt.winners!.includes(s) && cmp(sc, pt.top!) !== 0) {
      const alt = bestWithPair(p.hole, holes[s], S.board);
      if (cmp(alt, pt.top!) === 0) sc = alt;
    }
    return { seat: s, score: sc };
  });
  const ok = picks.every(x => pt.winners!.includes(x.seat) && cmp(x.score, pt.top!) === 0) && pt.winners!.every(w => seats.includes(w));
  return { picks, ok };
}

export type ReadMiss = 'omaha-rule' | 'wrong-winner' | 'wrong-five' | 'missed-chop';

/**
 * Why a wrong read was wrong, and the seat it's about.
 * omaha-rule: shipped to a losing hand that looks better than it is, because its best five out of
 * all nine cards isn't a legal Omaha hand (exactly two hole cards). wrong-winner: shipped to any
 * other losing hand. wrong-five: right player, cards that don't make their best hand.
 * missed-chop: right hand, but not every winner was picked.
 */
export function readMiss(S: Hand, sd: Showdown, pt: Pot, picks: { seat: number; score: Score }[]): { miss: ReadMiss; seat: number } {
  const winners = pt.winners!;
  const bad = picks.find(x => !winners.includes(x.seat));
  if (bad) {
    const row = sd.rows.find(r => r.i === bad.seat)!;
    const any = bestAny([...S.players[bad.seat].hole, ...S.board]);
    return { miss: any[0] > row.best.score[0] ? 'omaha-rule' : 'wrong-winner', seat: bad.seat };
  }
  const wrong5 = picks.find(x => cmp(x.score, pt.top!) !== 0);
  if (wrong5) return { miss: 'wrong-five', seat: wrong5.seat };
  return { miss: 'missed-chop', seat: winners.find(w => !picks.some(x => x.seat === w))! };
}
