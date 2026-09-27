// Dealing a hand, betting actions, pot-raise math, and the computer players' decisions.
import type { Hand, Player, PotQ, Settings } from './types.ts';
import { POS, STAKES, STREETS } from '../config.ts';
import { newDeck, cardTxt } from './cards.ts';
import { rand, rnd, pick } from './rng.ts';
import { fmt, roundU } from '../util.ts';

export const active = (S: Hand): Player[] => S.players.filter(p => !p.folded);
export const seatName = (p: Player): string => `Seat ${p.i + 1}`;
export const posOf = (S: Hand, p: Player): string => POS[(p.i - S.btn + 6) % 6];

export function say(S: Hand, p: Player, txt: string): void {
  S.caption = `${seatName(p)} ${txt}`;
  S.log.push({ t: `${seatName(p)} (${posOf(S, p)}) ${txt}` });
}
export const logStreet = (S: Hand, t: string): void => { S.log.push({ t, st: true }); };

export function commit(p: Player, amt: number): number {
  amt = Math.min(amt, p.stack);
  p.stack -= amt; p.committed += amt; p.totalIn += amt;
  if (p.stack === 0) p.allin = true;
  return amt;
}

/** Deal a new six-handed hand with the button on seat `btn`, blinds posted. */
export function newHand(settings: Settings, btn: number): Hand {
  const [sb, bb, unit] = STAKES[settings.stakes] || STAKES['2/5'];
  const r = rand();
  const calls = +settings.potCalls || 1;
  const S: Hand = {
    btn, sb, bb, unit, sbFull: !!settings.sbFull, deck: newDeck(), board: [], pot: 0, street: 0,
    currentBet: 0, lastRaise: bb, lastAgg: null, streetActions: 0, streetBets: 0, streetRaises: 0,
    log: [], caption: '', acting: null, mode: 'running',
    quizLeft: calls, potsThisStreet: 0, lastPot: null,
    quizStreet: calls > 1 ? (r < .5 ? 0 : r < .9 ? 1 : 2) : (r < .35 ? 0 : r < .75 ? 1 : r < .95 ? 2 : 3),
    quizMin: rnd(0, 3), side: false, players: [], cuts: [],
    peek: false, quiz: null, cq: null, sd: null, sel: { holes: {}, board: [] },
    sweep: null, ship: null, fresh: null, justCut: false,
  };
  for (let i = 0; i < 6; i++) S.players.push({
    i, stack: roundU(bb * rnd(250, 500) * (1 + .5 * (calls - 1)), unit),
    committed: 0, totalIn: 0, folded: false, allin: false, acted: false, short: false, hole: [],
  });
  S.side = rand() < ({ off: 0, some: .35, often: .7 }[settings.side] ?? .35);
  if (S.side) {
    const seats = [0, 1, 2, 3, 4, 5].sort(() => rand() - .5), lv = [rnd(15, 40), rnd(55, 95)];
    for (let k = 0; k < (rand() < .35 ? 2 : 1); k++) { const sp = S.players[seats[k]]; sp.short = true; sp.stack = roundU(bb * lv[k], unit); }
  }
  for (let k = 0; k < 4; k++) for (let j = 1; j <= 6; j++) S.players[(S.btn + j) % 6].hole.push(S.deck.pop()!);
  logStreet(S, `New hand, ${settings.stakes} PLO. Button on Seat ${S.btn + 1}.${S.sbFull ? ' Small blind counts as a full blind.' : ''}`);
  const sbP = S.players[(S.btn + 1) % 6], bbP = S.players[(S.btn + 2) % 6];
  commit(sbP, sb); say(S, sbP, `posts ${fmt(sb)}`);
  commit(bbP, bb); say(S, bbP, `posts ${fmt(bb)}`);
  S.currentBet = bb; S.lastAgg = bbP.i; S.caption = 'Blinds are up';
  return S;
}

/** Pot-limit raise for player p: call first, then raise the size of the pot. */
export function potMath(S: Hand, p: Player): PotQ {
  const cb = S.currentBet, mine = p.committed, toCall = cb - mine;
  const bets = S.players.filter(x => x.committed > 0).map(x => ({ i: x.i, amt: x.committed, folded: x.folded }));
  const sumC = bets.reduce((a, b) => a + b.amt, 0);
  const sbP = S.players[(S.btn + 1) % 6];
  const sbApplies = S.street === 0 && sbP !== p && sbP.committed === S.sb && S.sb < S.bb;
  const adj = sbApplies && S.sbFull ? S.bb - S.sb : 0;
  const total = S.pot + sumC + adj, after = total + toCall, raiseTo = cb + after, addNow = raiseTo - mine;
  const sbAlt = sbApplies ? (S.sbFull ? raiseTo - (S.bb - S.sb) : raiseTo + (S.bb - S.sb)) : null;
  return { seat: p.i, pos: posOf(S, p), street: S.street, middle: S.pot, cb, mine, toCall, bets, total, after, raiseTo, addNow, rest: total - cb - mine, adj, sbSeat: sbP.i, sbAlt };
}
export const othersCanCall = (S: Hand, p: Player, to: number): boolean =>
  active(S).some(x => x !== p && x.stack + x.committed >= to);

export function doFold(S: Hand, p: Player): void { p.folded = true; p.acted = true; say(S, p, 'folds'); }
export function doCheck(S: Hand, p: Player): void { p.acted = true; say(S, p, 'checks'); }
export function doCall(S: Hand, p: Player): void {
  const put = commit(p, S.currentBet - p.committed); p.acted = true;
  say(S, p, p.allin ? `calls all in for ${fmt(put)}` : `calls ${fmt(put)}`);
}
const resetOthers = (S: Hand, p: Player): void => { S.players.forEach(x => { if (x !== p) x.acted = false; }); };
export function doBet(S: Hand, p: Player, amt: number): void {
  commit(p, amt); S.currentBet = p.committed; S.lastRaise = amt; S.lastAgg = p.i; S.streetBets++; p.acted = true; resetOthers(S, p);
  say(S, p, `bets ${fmt(amt)}${p.allin ? ', all in' : ''}`);
}
export function doRaise(S: Hand, p: Player, to: number, isPot: boolean, isRepot = false): void {
  const prev = S.currentBet; commit(p, to - p.committed);
  S.currentBet = to; S.lastRaise = to - prev; S.lastAgg = p.i; S.streetRaises++; p.acted = true; resetOthers(S, p);
  say(S, p, (isPot ? `${isRepot ? 're-pots' : 'pots'}, raise to ${fmt(to)}` : `raises to ${fmt(to)}`) + (p.allin ? ', all in' : ''));
}

/** A raise smaller than pot (full pot raises are saved for the quiz). */
function tryRaise(S: Hand, p: Player): boolean {
  const q = potMath(S, p); const min = S.currentBet + S.lastRaise, max = q.raiseTo;
  if (max < min) return false;
  let to = roundU(min + (max - min) * rand() * (S.street === 0 ? .5 : .6), S.unit);
  to = Math.min(Math.max(to, min), max);
  if (to === max) return false;
  if (to - p.committed > p.stack || !othersCanCall(S, p, to)) return false;
  doRaise(S, p, to, false); return true;
}
function betSize(S: Hand, p: Player, quizHere: boolean): number {
  const pot = S.pot;
  const shortsIn = S.side && active(S).some(x => x.short);
  let b = roundU(pot * pick(shortsIn ? [.66, .75, 1] : [.33, .5, .66, .75, 1]), S.unit);
  if (b > pot) b = pot;
  b = Math.max(b, Math.min(S.bb, pot));
  const pool = active(S).filter(x => !x.short && !x.allin);
  const eff = Math.min(...(pool.length ? pool : active(S)).map(x => x.stack));
  if (quizHere) { const cap = Math.floor((eff - pot) / 4 / S.unit) * S.unit; if (cap >= S.bb) b = Math.min(b, cap); }
  return Math.max(1, Math.min(b, eff, p.stack));
}
function canFold(S: Hand, p: Player): boolean {
  if (p.short || active(S).length <= 2) return false;
  if (S.side && active(S).filter(x => !x.short).length <= 2) return false;
  return true;
}

/** Is it time for this player to say "Pot"? Returns the question if so. */
export function potCallDue(S: Hand, p: Player): PotQ | null {
  const quizHere = S.quizLeft > 0 && S.street === S.quizStreet;
  if (!(quizHere && S.currentBet > 0 && S.streetActions >= S.quizMin)) return null;
  const q = potMath(S, p);
  if (q.addNow > p.stack || !othersCanCall(S, p, q.raiseTo)) return null;
  q.repotOf = S.potsThisStreet > 0 ? S.lastPot : null;
  return q;
}

/** Make the pot raise after the dealer has announced it. */
export function makePotRaise(S: Hand, p: Player, q: PotQ): void {
  doRaise(S, p, q.raiseTo, true, !!q.repotOf);
  S.potsThisStreet++; S.lastPot = { seat: p.i, to: q.raiseTo }; S.quizLeft--; S.streetActions++;
  if (S.quizLeft > 0) {
    if (rand() < .6) S.quizMin = S.streetActions + (rand() < .6 ? 0 : 1);
    else S.quizStreet = Math.min(3, S.street + 1);
  }
}

/** A computer player's normal (non-pot) action. */
export function decide(S: Hand, p: Player): void {
  const toCall = S.currentBet - p.committed;
  const quizHere = S.quizLeft > 0 && S.street === S.quizStreet;
  if (p.short) {
    if (toCall > 0) doCall(S, p);
    else if (S.currentBet > 0) doCheck(S, p);
    else doBet(S, p, Math.max(1, Math.min(S.pot, p.stack)));
    S.streetActions++; return;
  }
  if (toCall > 0) {
    const cf = canFold(S, p);
    if (toCall > p.stack && cf) doFold(S, p);
    else {
      const afterPot = S.potsThisStreet > 0;
      const foldP = afterPot ? .45 : (S.street === 0 ? .4 : .3);
      const r = rand();
      if (cf && r < foldP) doFold(S, p);
      else if (S.streetRaises === 0 && !afterPot && r > .88 && tryRaise(S, p)) { /* raised */ }
      else doCall(S, p);
    }
  } else if (S.currentBet > 0) {
    doCheck(S, p); // big blind option
  } else {
    const betP = quizHere ? .85 : (S.side && active(S).some(x => x.short)) ? .75 : .35;
    if (S.streetBets === 0 && rand() < betP) doBet(S, p, betSize(S, p, quizHere)); else doCheck(S, p);
  }
  S.streetActions++;
}

export function roundDone(S: Hand): boolean {
  const acts = S.players.filter(p => !p.folded && !p.allin);
  if (acts.length === 0) return true;
  if (acts.length === 1 && acts[0].committed >= S.currentBet) return true;
  return acts.every(p => p.acted && p.committed === S.currentBet);
}

export function startStreet(S: Hand): void {
  S.streetActions = 0; S.streetBets = 0; S.streetRaises = 0; S.potsThisStreet = 0; S.lastPot = null;
  S.players.forEach(p => { p.acted = false; });
  if (S.street > 0) { S.currentBet = 0; S.lastRaise = S.bb; S.lastAgg = null; }
  if (S.street === S.quizStreet && S.street > 0) S.quizMin = Math.min(rnd(1, 2), Math.max(1, active(S).length - 1));
}

function returnUncalled(S: Hand): void {
  let top: Player | null = null;
  S.players.forEach(p => { if (!top || p.committed > top.committed) top = p; });
  const t = top as Player | null;
  if (!t || !t.committed) return;
  const second = Math.max(0, ...S.players.filter(p => p !== t).map(p => p.committed));
  if (t.committed > second) {
    const d = t.committed - second;
    t.committed -= d; t.totalIn -= d; t.stack += d; t.allin = t.stack === 0;
    S.log.push({ t: `Uncalled ${fmt(d)} returned to ${seatName(t)}` });
  }
}

/** Bring the bets in: return any uncalled bet, then move everything to the middle. */
export function collect(S: Hand): void {
  returnUncalled(S);
  S.sweep = S.players.filter(p => p.committed > 0).map(p => ({ i: p.i, amt: p.committed }));
  S.players.forEach(p => { S.pot += p.committed; p.committed = 0; });
}

export function dealBoard(S: Hand, st: number): void {
  S.deck.pop(); // burn
  const n = st === 1 ? 3 : 1; S.fresh = [];
  for (let k = 0; k < n; k++) { const c = S.deck.pop()!; S.fresh.push(S.board.length); S.board.push(c); }
  logStreet(S, `${STREETS[st]}: ${S.board.map(cardTxt).join(' ')}`);
  S.caption = `${STREETS[st]} is out`;
}
