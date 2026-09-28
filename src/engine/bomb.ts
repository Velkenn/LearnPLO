// Double board bomb pots, played as pot limit Omaha. Everyone antes, there's no betting before
// the flop, and two boards come out. At showdown each pot is split in half (the odd chip goes to
// the top board), then each board is read on its own. Losing a board of a bigger pot means that
// player can't win the same board of the smaller pots; they keep playing the other board.
import type { Ante, Hand, Half, Pot, Settings, Showdown } from './types.ts';
import { ANTES } from '../config.ts';
import { newDeck, bestOmaha, cardTxt, cmp, describe } from './cards.ts';
import { active, commit, fromBtn, leftOf, logStreet, seatName, tableSize } from './hand.ts';
import { buildPots } from './pots.ts';
import { rand, rnd, shuffle } from './rng.ts';
import { fmt, roundU, seatList } from '../util.ts';

/** The ante from settings, falling back to $10. */
export const anteOf = (settings: Pick<Settings, 'ante'>): Ante => settings.ante in ANTES ? settings.ante : 10;

/** Deal a bomb pot (6 or 9 players) with the button on seat `btn`: antes in, two boards to come. */
export function newBombHand(settings: Settings, btn: number): Hand {
  const ante = anteOf(settings), { min, unit } = ANTES[ante];
  const r = rand();
  const calls = +settings.potCalls || 1;
  const n = tableSize(settings);
  const S: Hand = {
    btn, sb: 0, bb: min, unit, sbFull: false, deck: newDeck(), board: [], bottom: [], ante, freshB: null, pot: 0, street: 0,
    currentBet: 0, lastRaise: min, lastAgg: null, streetActions: 0, streetBets: 0, streetRaises: 0,
    log: [], caption: '', acting: null, mode: 'running',
    quizLeft: calls, potsThisStreet: 0, lastPot: null,
    // No betting before the flop, so pot calls come on the flop, turn, or river.
    quizStreet: calls > 1 ? (r < .65 ? 1 : r < .92 ? 2 : 3) : (r < .5 ? 1 : r < .82 ? 2 : 3),
    quizMin: 0, side: false, players: [], streetStart: Array(n).fill(0), cuts: [],
    peek: false, quiz: null, cq: null, sd: null, sel: { holes: {}, board: [] },
    sweep: null, ship: null, fresh: null, justCut: false,
  };
  for (let i = 0; i < n; i++) S.players.push({
    i, stack: roundU(ante * rnd(100, 250) * (1 + .5 * (calls - 1)), unit),
    committed: 0, totalIn: 0, folded: false, allin: false, acted: false, short: false, hole: [],
  });
  S.side = rand() < ({ off: 0, some: .35, often: .7 }[settings.side] ?? .35);
  if (S.side) {
    // Short stacks still cover the ante, and go all in after the flop.
    const seats = shuffle(S.players.map(p => p.i)), lv = [rnd(4, 10), rnd(12, 26)];
    for (let k = 0; k < (rand() < .35 ? 2 : 1); k++) { const sp = S.players[seats[k]]; sp.short = true; sp.stack = roundU(ante * lv[k], unit); }
  }
  for (let k = 0; k < 4; k++) for (let j = 1; j <= n; j++) S.players[leftOf(S, j)].hole.push(S.deck.pop()!);
  logStreet(S, `New hand, ${fmt(ante)} double board bomb pot${n === 9 ? ', 9-handed' : ''}. Button on Seat ${S.btn + 1}.`);
  // The antes go straight into the middle: that's the pot on the flop.
  S.players.forEach(p => { commit(p, ante); p.committed = 0; });
  S.pot = ante * n;
  S.streetStart = S.players.map(p => p.totalIn);
  S.log.push({ t: `Everyone antes ${fmt(ante)}. Pot is ${fmt(S.pot)}.` });
  S.caption = 'Antes are in';
  return S;
}

/** Split a pot between the boards: [top, bottom]. The odd chip goes to the top board. */
export const splitPot = (amount: number): [number, number] => [Math.ceil(amount / 2), Math.floor(amount / 2)];
export const BOARD_NAMES = ['top board', 'bottom board'] as const;

/** Showdown for a double board hand: every pot gets a top-board half and a bottom-board half. */
export function buildBombShowdown(S: Hand): Showdown {
  const rows = active(S).map(p => ({ i: p.i, best: bestOmaha(p.hole, S.board), best2: bestOmaha(p.hole, S.bottom!) }));
  const pots = buildPots(S);
  pots.forEach(pt => {
    const er = rows.filter(r => pt.elig.includes(r.i));
    const half = (board: 0 | 1, amount: number): Half => {
      const score = (r: typeof rows[number]) => (board ? r.best2 : r.best).score;
      let top = score(er[0]);
      er.forEach(r => { if (cmp(score(r), top) > 0) top = score(r); });
      return { board, amount, top, winners: er.filter(r => cmp(score(r), top) === 0).map(r => r.i) };
    };
    const [a, b] = splitPot(pt.amount);
    pt.halves = [half(0, a), half(1, b)];
  });
  logStreet(S, 'Showdown');
  rows.forEach(r => { const p = S.players[r.i]; S.log.push({ t: `${seatName(p)} shows <span class="lc">${p.hole.map(cardTxt).join(' ')}</span>` }); });
  return {
    rows, pots, order: pots.map((_, k) => k).reverse(), step: 0, phase: 'read', results: {}, mucked: new Set(),
    part: 'split', reads: {}, gone: [new Set(), new Set()], splits: {},
  };
}

/** Players still in the running for one board of a pot. */
export const liveOn = (sd: Showdown, pt: Pot, board: 0 | 1, gone?: Set<number>): number[] =>
  pt.elig.filter(i => !(gone ?? sd.gone![board]).has(i));
/** Players who lose this board of the pot (they can't win it in smaller pots). */
export const losersOn = (sd: Showdown, pt: Pot, board: 0 | 1): number[] =>
  liveOn(sd, pt, board).filter(i => !pt.halves![board].winners.includes(i));

/** A board of a pot needs a read: two or more hands can still win it. */
export const contested = (sd: Showdown, pt: Pot, board: 0 | 1): boolean => liveOn(sd, pt, board).length >= 2;
/** The pot needs splitting: some board is contested, or the two halves go to different players. */
export function needsSplit(sd: Showdown, pt: Pot): boolean {
  const a = liveOn(sd, pt, 0), b = liveOn(sd, pt, 1);
  return a.length > 1 || b.length > 1 || a[0] !== b[0];
}

/** Record that this board of the pot was read: its losers can't win this board of smaller pots. */
export function markGone(sd: Showdown, pt: Pot, board: 0 | 1): number[] {
  const lost = losersOn(sd, pt, board);
  lost.forEach(i => sd.gone![board].add(i));
  // Out on both boards: the hand is mucked.
  lost.forEach(i => { if (sd.gone![0].has(i) && sd.gone![1].has(i)) sd.mucked.add(i); });
  return lost;
}

/** Pay one board's half of a pot. A chop splits it evenly; the odd chip goes to the first winner left of the button. */
export function awardHalf(S: Hand, sd: Showdown, pt: Pot, board: 0 | 1): Half {
  const h = pt.halves![board], winners = h.winners;
  const share = Math.floor(h.amount / winners.length); h.share = share; h.awarded = true;
  const rem = h.amount - share * winners.length;
  if (rem) {
    const first = [...winners].sort((a, b) => fromBtn(S, a) - fromBtn(S, b))[0];
    h.odd = { seat: first, amt: rem }; S.players[first].stack += rem;
  }
  winners.forEach(i => { S.players[i].stack += share; });
  if (pt.halves!.every(x => x.awarded)) pt.awarded = true;
  const where = sd.pots.length > 1 ? `the ${BOARD_NAMES[board]} of ${pt.name === 'Main pot' ? 'the main pot' : pt.name.toLowerCase()}` : `the ${BOARD_NAMES[board]}`;
  S.log.push({ t: `${seatList(winners)} ${winners.length > 1 ? 'split' : 'wins'} ${where} (${fmt(h.amount)})${pt.elig.length > 1 ? ` with ${describe(h.top)}` : ', uncontested'}` });
  return h;
}

/** The one player who takes both boards of a pot (a scoop), or null. */
export const scooper = (pt: Pot): number | null => {
  const [a, b] = pt.halves!;
  return a.winners.length === 1 && b.winners.length === 1 && a.winners[0] === b.winners[0] ? a.winners[0] : null;
};

/**
 * Why a split answer was wrong, with a short code for the weak spots page. odd-chip: gave the top
 * board the smaller half of an odd pot. whole: the whole pot. Anything else is too high or too low.
 */
export type SplitMiss = 'odd-chip' | 'whole' | 'high' | 'low';
export function splitMiss(v: number, amount: number): { miss: SplitMiss; text: string } {
  const [top, bottom] = splitPot(amount);
  if (top !== bottom && v === bottom) return { miss: 'odd-chip', text: `The odd ${fmt(top - bottom)} goes to the top board, so the top gets the bigger half.` };
  if (v === amount) return { miss: 'whole', text: `That's the whole pot. Half goes to each board.` };
  return v > top ? { miss: 'high', text: `Too high by ${fmt(v - top)}.` } : { miss: 'low', text: `Too low by ${fmt(top - v)}.` };
}
