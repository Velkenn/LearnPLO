import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doBet, doCall, doRaise, newHand, potMath } from '../src/engine/hand.ts';
import { buildPots, makeCut, newCutLevels, prepareCuts, roundBets } from '../src/engine/pots.ts';
import { seed } from '../src/engine/rng.ts';
import { DEFAULT_SETTINGS } from '../src/config.ts';
import type { Hand } from '../src/engine/types.ts';

function freshHand(extra: Partial<typeof DEFAULT_SETTINGS> = {}): Hand {
  seed(1);
  const S = newHand({ ...DEFAULT_SETTINGS, side: 'off', ...extra }, 0);
  seed(null);
  return S;
}

test('first in at $2/$5 pots it to $17', () => {
  const S = freshHand();
  const utg = S.players[3];
  assert.equal(potMath(S, utg).raiseTo, 17);
});

test('rounded pot at $2/$5: each blind counts as $5, so first in pots it to $20', () => {
  const S = freshHand({ potStyle: 'rounded' });
  const q = potMath(S, S.players[3]);
  assert.equal(q.exact, 17);
  assert.equal(q.raiseTo, 20);
});

test('rounded pot at $1/$3: the bring-in is $5 and first in pots it to $15', () => {
  const S = freshHand({ potStyle: 'rounded', stakes: '1/3' });
  assert.equal(S.currentBet, 5, 'bring-in');
  const [, , bb, s4, s5] = S.players;
  assert.equal(potMath(S, s4).raiseTo, 15);
  // Seat 4 pots it to $15; Seat 5 re-pots: blinds $5 + $15 + call $15 = $35, raise to $50.
  doRaise(S, s4, 15, true);
  assert.equal(potMath(S, s5).raiseTo, 50);
  // The big blind owes $12 more to call the $15.
  doRaise(S, s5, 50, true); S.currentBet = 15; s5.committed = 0; // (only s4's $15 stands for this check)
  const before = bb.stack; doCall(S, bb);
  assert.equal(before - bb.stack, 12);
});

test('rounded pot after the flop: the middle rounds up to the next $5', () => {
  // $37 in the middle, a $10 bet, then a pot: $40 + $10 + call $10 = $60, raise to $70.
  const S = freshHand({ potStyle: 'rounded' }); S.street = 1; S.pot = 37; S.currentBet = 10;
  S.players.forEach(p => { p.committed = 0; });
  S.players[1].committed = 10;
  const q = potMath(S, S.players[2]);
  assert.equal(q.exact, 67);
  assert.equal(q.raiseTo, 70);
});

test('rounded pot: all in for $63 plays as $60, and the $3 goes back', () => {
  const S = freshHand({ potStyle: 'rounded' }); S.street = 1; S.pot = 100; S.currentBet = 0;
  S.players.forEach(p => { p.committed = 0; });
  const p = S.players[4]; p.stack = 63;
  doBet(S, p, 63);
  assert.equal(p.committed, 60);
  assert.equal(p.kept, 3);
  assert.ok(p.allin);
  assert.equal(S.currentBet, 60);
  assert.match(S.log.at(-1)!.t, /\$3 back to Seat 5/);
  // True pot keeps every chip in play.
  const T = freshHand(); T.street = 1; T.currentBet = 0; T.players.forEach(x => { x.committed = 0; });
  T.players[4].stack = 63; doBet(T, T.players[4], 63);
  assert.equal(T.players[4].committed, 63);
});

test('re-pot: pot raise after a pot raise', () => {
  // $100 in the middle, Seat 1 bets $50, Seat 2 calls, Seat 3 pots: 3 × 50 + 100 + 50 = $300.
  const S = freshHand(); S.street = 1; S.pot = 100; S.currentBet = 50;
  S.players.forEach(p => { p.committed = 0; });
  S.players[1].committed = 50; S.players[2].committed = 50;
  const q = potMath(S, S.players[3]);
  assert.equal(q.raiseTo, 300);
  assert.equal(q.raiseTo, 3 * q.cb + q.rest, '3x rule');
});

test('raiser already has chips out: announce the total', () => {
  // Big blind $5 faces a $20 raise with $2 SB in: pot = 2 + 5 + 20 = 27, call 15 → 42, raise to 20 + 42 = 62.
  const S = freshHand();
  S.players[3].committed = 20; S.currentBet = 20;
  const q = potMath(S, S.players[2]);
  assert.equal(q.raiseTo, 62);
  assert.equal(q.addNow, 57);
});

test('out in front lists the most recent bet first, back to the blinds', () => {
  // Button on Seat 1: Seat 2 posts $2, Seat 3 posts $5. Seat 4 calls, Seat 5 raises to $20, Seat 6 calls.
  const S = freshHand();
  const [, sb, bb, s4, s5, s6] = S.players;
  doCall(S, s4); doRaise(S, s5, 20, false); doCall(S, s6);
  const seats = (q: ReturnType<typeof potMath>) => q.bets.map(b => b.i + 1);
  assert.deepEqual(seats(potMath(S, S.players[0])), [6, 5, 4, 3, 2]);
  // The small blind calls the $20: now theirs is the most recent.
  doCall(S, sb);
  assert.deepEqual(seats(potMath(S, bb)), [2, 6, 5, 4, 3]);
});

test('main pot and side pot with dead money', () => {
  const S = freshHand();
  // Seat 1 all in for 100; Seats 2 and 3 in for 300; Seat 4 folded after putting in 20.
  S.players.forEach(p => { p.totalIn = 0; p.folded = true; p.allin = false; });
  Object.assign(S.players[1], { totalIn: 100, folded: false, allin: true });
  Object.assign(S.players[2], { totalIn: 300, folded: false });
  Object.assign(S.players[3], { totalIn: 300, folded: false });
  Object.assign(S.players[4], { totalIn: 20, folded: true });
  S.pot = 720;
  assert.deepEqual(newCutLevels(S), [100]);
  const main = makeCut(S, 100, 0);
  assert.equal(main.amount, 320);
  assert.deepEqual(main.elig.sort(), [1, 2, 3]);
  const pots = buildPots(S);
  assert.deepEqual(pots.map(p => p.amount), [320, 400]);
  assert.deepEqual(pots.map(p => p.name), ['Main pot', 'Side pot']);
});

test('two all-ins make main, side pot 1, and side pot 2', () => {
  const S = freshHand();
  S.players.forEach(p => { p.totalIn = 0; p.folded = true; p.allin = false; });
  Object.assign(S.players[0], { totalIn: 50, folded: false, allin: true });
  Object.assign(S.players[1], { totalIn: 200, folded: false, allin: true });
  Object.assign(S.players[2], { totalIn: 500, folded: false });
  Object.assign(S.players[3], { totalIn: 500, folded: false });
  const cuts = prepareCuts(S, newCutLevels(S));
  assert.deepEqual(cuts.map(c => [c.name, c.amount]), [['Main pot', 200], ['Side pot 1', 450]]);
  assert.deepEqual(buildPots(S).map(p => p.amount), [200, 450, 600]);
});

test("building the side pot counts this round's bets only", () => {
  // Seat 2 starts with $150 and puts in $50 preflop; Seats 3 and 4 call. On the flop Seat 2 is
  // all in for the last $100 and both call (and bet on). The main pot takes $100 from each of the
  // three bets this round: $300. The $150 from preflop is already in the middle.
  const S = freshHand();
  S.players.forEach(p => { p.totalIn = 0; p.folded = true; p.allin = false; });
  Object.assign(S.players[2], { totalIn: 150, folded: false, allin: true });
  Object.assign(S.players[3], { totalIn: 350, folded: false });
  Object.assign(S.players[4], { totalIn: 350, folded: false });
  S.streetStart = [0, 0, 50, 50, 50, 0];
  S.street = 1;
  const [main] = prepareCuts(S, newCutLevels(S));
  assert.equal(main.round, 300);
  assert.equal(main.amount, 450, 'the whole main pot: $150 from preflop plus $300 this round');
  assert.deepEqual(roundBets(S, 0).map(b => b.amt), [100, 300, 300]);
});

test('dead money this round goes in up to the all-in amount', () => {
  // Flop: Seat 1 bets $40 and folds to a raise; Seat 2 is all in for $100; Seat 3 puts in $300.
  const S = freshHand();
  S.players.forEach(p => { p.totalIn = 20; p.folded = true; p.allin = false; });
  Object.assign(S.players[1], { totalIn: 60, folded: true });
  Object.assign(S.players[2], { totalIn: 120, folded: false, allin: true });
  Object.assign(S.players[3], { totalIn: 320, folded: false });
  S.streetStart = [20, 20, 20, 20, 20, 20];
  const [main] = prepareCuts(S, newCutLevels(S));
  assert.equal(main.round, 240, '$100 + $100 + $40 dead');
});
