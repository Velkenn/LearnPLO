// Double board bomb pots: plays thousands of seeded hands with no screen and checks the invariants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newBombHand, buildBombShowdown, awardHalf, contested, liveOn, losersOn, markGone, needsSplit, scooper, splitMiss, splitPot } from '../src/engine/bomb.ts';
import { playHand, type Hooks } from '../src/engine/loop.ts';
import { curPot, gradePicks, readMiss, rowBest } from '../src/engine/showdown.ts';
import { cardTxt } from '../src/engine/cards.ts';
import { seed } from '../src/engine/rng.ts';
import { DEFAULT_SETTINGS } from '../src/config.ts';
import type { Hand, Settings } from '../src/engine/types.ts';

interface Tally { hands: number; potCalls: number; repots: number; cuts: number; showdowns: number; multiPot: number; splits: number; oddSplits: number; reads: number; chops: number; scoops: number; quarters: number; halfMucks: number }
const fresh = (): Tally => ({ hands: 0, potCalls: 0, repots: 0, cuts: 0, showdowns: 0, multiPot: 0, splits: 0, oddSplits: 0, reads: 0, chops: 0, scoops: 0, quarters: 0, halfMucks: 0 });

async function run(settings: Settings, hands: number, firstSeed: number, t: Tally): Promise<void> {
  for (let n = 0; n < hands; n++) {
    seed(firstSeed + n);
    const S: Hand = newBombHand(settings, n % settings.seats);
    const ante = settings.ante;
    assert.equal(S.players.length, settings.seats);
    assert.equal(S.pot, ante * settings.seats, 'antes make the pot');
    assert.ok(S.players.every(p => p.totalIn === ante && p.committed === 0 && !p.allin), 'everyone antes and is still in');
    const chips = S.players.reduce((a, p) => a + p.stack, 0) + S.pot;
    let finished = false;
    const hooks: Hooks = {
      render() {}, sleep: () => Promise.resolve(), current: () => true, actionDelay: () => 0,
      async askPot(p, q) {
        t.potCalls++; if (q.repotOf) t.repots++;
        assert.ok(S.street >= 1, 'no betting before the flop');
        assert.equal(q.raiseTo, q.cb + q.total + q.toCall, 'call, then raise the pot');
        assert.equal(q.raiseTo, 3 * q.cb + q.rest, '3x rule');
        assert.equal(q.sbAlt, null, 'no blinds in a bomb pot');
        assert.ok(q.addNow <= p.stack, 'raiser can afford it');
      },
      async askCuts(pots) {
        t.cuts += pots.length;
        assert.ok(S.street >= 1);
        for (const pt of pots) {
          assert.ok(pt.round! > 0);
          const earlier = S.players.reduce((a, p) => a + Math.max(0, Math.min(S.streetStart[p.i], pt.level) - pt.prev), 0);
          assert.equal(pt.amount, earlier + pt.round!, 'pot = earlier rounds (antes included) + this round');
        }
      },
      uncontested() { finished = true; },
      showdown() {
        t.showdowns++;
        assert.equal(S.board.length, 5); assert.equal(S.bottom!.length, 5);
        const seen = [...S.board, ...S.bottom!, ...S.players.flatMap(p => p.hole)].map(cardTxt);
        assert.equal(new Set(seen).size, seen.length, 'every card dealt once');
        const sd = buildBombShowdown(S);
        assert.equal(sd.pots.reduce((a, p) => a + p.amount, 0), S.pot, 'pots add up to the pot');
        S.cuts.forEach((c, k) => assert.equal(sd.pots[k].amount, c.amount, 'cut during the hand matches showdown pot'));
        if (sd.pots.length > 1) t.multiPot++;
        for (sd.step = 0; sd.step < sd.order.length; sd.step++) {
          const pt = curPot(sd), [top, bottom] = pt.halves!;
          assert.equal(top.amount + bottom.amount, pt.amount, 'halves add up');
          assert.ok(top.amount - bottom.amount === pt.amount % 2, 'top board gets the odd chip');
          if (needsSplit(sd, pt)) {
            t.splits++; if (pt.amount % 2) t.oddSplits++;
            if (pt.amount % 2) assert.equal(splitMiss(bottom.amount, pt.amount).miss, 'odd-chip');
          }
          for (const b of [0, 1] as const) {
            const h = pt.halves![b], live = liveOn(sd, pt, b);
            assert.ok(h.winners.every(w => live.includes(w)), 'a winner never lost this board of a bigger pot');
            if (contested(sd, pt, b)) {
              t.reads++;
              const cards = b ? S.bottom! : S.board;
              const holes: Record<number, number[]> = {};
              h.winners.forEach(w => { holes[w] = rowBest(sd.rows.find(r => r.i === w)!, b).hole; });
              const board = rowBest(sd.rows.find(r => r.i === h.winners[0])!, b).board;
              assert.ok(gradePicks(S, h, holes, board, cards).ok, 'correct read grades right');
              const loser = live.find(i => !h.winners.includes(i));
              if (loser != null) {
                const best = rowBest(sd.rows.find(r => r.i === loser)!, b);
                const g = gradePicks(S, h, { [loser]: best.hole }, best.board, cards);
                assert.ok(!g.ok);
                assert.match(readMiss(S, sd, h, g.picks, b).miss, /^(wrong-winner|omaha-rule)$/);
              }
              if (h.winners.length > 1) t.chops++;
            }
            const before = S.players.map(p => p.stack);
            awardHalf(S, sd, pt, b);
            const paid = S.players.reduce((a, p, i) => a + p.stack - before[i], 0);
            assert.equal(paid, h.amount, 'a half pays exactly its amount');
            const lost = markGone(sd, pt, b);
            t.halfMucks += lost.filter(i => !sd.mucked.has(i)).length;
          }
          if (scooper(pt) != null && pt.elig.length > 1) t.scoops++;
          if (pt.halves!.some(h => h.winners.length > 1) && pt.halves!.some(h => h.winners.length === 1)) t.quarters++;
          assert.deepEqual(losersOn(sd, pt, 0), [], 'after the read, nobody left to lose the top board');
        }
        finished = true;
      },
    };
    await playHand(S, hooks);
    assert.ok(finished, 'hand finished');
    const after = S.players.reduce((a, p) => a + p.stack, 0);
    assert.equal(after, chips, `chips conserved (seed ${firstSeed + n})`);
    t.hands++;
  }
  seed(null);
}

test('bomb pots: thousands of hands keep chips, halves, and reads consistent', async () => {
  const t = fresh();
  const base: Settings = { ...DEFAULT_SETTINGS };
  await run({ ...base, side: 'off', potCalls: 1, ante: 10 }, 500, 41000, t);
  await run({ ...base, side: 'often', potCalls: 2, ante: 5 }, 700, 45000, t);
  await run({ ...base, side: 'often', potCalls: 3, ante: 25 }, 500, 49000, t);
  await run({ ...base, side: 'some', potCalls: 2, ante: 10, seats: 9 }, 600, 53000, t);
  console.log('bomb', t);
  assert.ok(t.potCalls > 1000 && t.repots > 100, 'pot calls and re-pots happen');
  assert.ok(t.cuts > 200 && t.multiPot > 200, 'side pots happen');
  assert.ok(t.splits > 1000 && t.oddSplits > 100, 'splits, some with an odd chip');
  assert.ok(t.chops > 0 && t.scoops > 100 && t.quarters > 0, 'chops, scoops, and quarters happen');
  assert.ok(t.halfMucks > 0, 'players lose one board of a pot and keep playing the other');
});

test('bomb pot deal: antes, no blinds, two boards, one burn per street', () => {
  seed(3);
  const S = newBombHand({ ...DEFAULT_SETTINGS, seats: 9, ante: 25 }, 8);
  seed(null);
  assert.equal(S.pot, 225);
  assert.ok(S.players.every(p => p.hole.length === 4 && p.committed === 0));
  assert.equal(S.deck.length, 52 - 36);
  assert.deepEqual(S.bottom, []);
  assert.ok(S.quizStreet >= 1, 'pot calls wait for the flop');
});

test('splitting a pot: the odd chip goes to the top board', () => {
  assert.deepEqual(splitPot(375), [188, 187]);
  assert.deepEqual(splitPot(400), [200, 200]);
  assert.equal(splitMiss(187, 375).miss, 'odd-chip');
  assert.equal(splitMiss(375, 375).miss, 'whole');
  assert.equal(splitMiss(190, 375).miss, 'high');
  assert.equal(splitMiss(150, 400).miss, 'low');
});
