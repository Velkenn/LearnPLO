// Plays thousands of seeded hands through the engine with no screen and checks the invariants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newHand } from '../src/engine/hand.ts';
import { playHand, type Hooks } from '../src/engine/loop.ts';
import { awardPot, buildShowdown, curPot, gradePicks, liveElig, losersOf } from '../src/engine/showdown.ts';
import { seed } from '../src/engine/rng.ts';
import { DEFAULT_SETTINGS } from '../src/config.ts';
import type { Hand, Settings } from '../src/engine/types.ts';

interface Tally { hands: number; potCalls: number; repots: number; cuts: number; showdowns: number; multiPot: number; chops: number; mucks: number }

async function run(settings: Settings, hands: number, firstSeed: number, t: Tally): Promise<void> {
  for (let n = 0; n < hands; n++) {
    seed(firstSeed + n);
    const S: Hand = newHand(settings, n % 6);
    const chips = S.players.reduce((a, p) => a + p.stack + p.committed, 0);
    let finished = false;
    const hooks: Hooks = {
      render() {}, sleep: () => Promise.resolve(), current: () => true, actionDelay: () => 0,
      async askPot(p, q) {
        t.potCalls++; if (q.repotOf) t.repots++;
        assert.equal(q.raiseTo, q.cb + q.total + q.toCall, 'call, then raise the pot');
        assert.equal(q.raiseTo, 3 * q.cb + q.rest, '3x rule');
        assert.ok(q.addNow <= p.stack, 'raiser can afford it');
      },
      async askCuts(pots) {
        t.cuts += pots.length;
        for (const pt of pots) assert.equal(pt.amount, pt.parts.reduce((a, x) => a + x.amt, 0));
      },
      uncontested() { finished = true; },
      showdown() {
        t.showdowns++;
        const sd = buildShowdown(S);
        const total = S.players.reduce((a, p) => a + p.totalIn, 0);
        assert.equal(S.pot, total, 'pot equals everything put in');
        assert.equal(sd.pots.reduce((a, p) => a + p.amount, 0), S.pot, 'pots add up to the pot');
        S.cuts.forEach((c, k) => assert.equal(sd.pots[k].amount, c.amount, 'cut during the hand matches showdown pot'));
        if (S.cuts.length) assert.equal(sd.pots.length, S.cuts.length + 1, 'one open pot after the cuts');
        if (sd.pots.length > 1) t.multiPot++;
        // Read side pots first; losers muck before the next pot.
        for (sd.step = 0; sd.step < sd.order.length; sd.step++) {
          const pt = curPot(sd);
          const live = liveElig(sd, pt);
          assert.ok(pt.winners!.every(w => live.includes(w)), 'a winner never mucked');
          if (pt.winners!.length > 1) t.chops++;
          // The engine's own best hand for the first winner must grade correct, with every winner picked.
          const holes: Record<number, number[]> = {};
          pt.winners!.forEach(w => { holes[w] = sd.rows.find(r => r.i === w)!.best.hole; });
          const board = sd.rows.find(r => r.i === pt.winners![0])!.best.board;
          if (live.length > 1) assert.ok(gradePicks(S, pt, holes, board).ok, 'correct read grades right');
          awardPot(S, sd, pt);
          const lost = losersOf(sd, pt); lost.forEach(i => sd.mucked.add(i)); t.mucks += lost.length;
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

test('thousands of hands keep chips, pots, and cuts consistent', async () => {
  const t: Tally = { hands: 0, potCalls: 0, repots: 0, cuts: 0, showdowns: 0, multiPot: 0, chops: 0, mucks: 0 };
  const base = { ...DEFAULT_SETTINGS };
  await run({ ...base, side: 'off', potCalls: 1 }, 500, 1000, t);
  await run({ ...base, side: 'often', potCalls: 1 }, 800, 5000, t);
  await run({ ...base, side: 'often', potCalls: 3, sbFull: true }, 800, 9000, t);
  await run({ ...base, side: 'some', potCalls: 2, stakes: '25/50' }, 500, 13000, t);
  console.log(t);
  assert.ok(t.potCalls > 1000 && t.repots > 100, 'pot calls and re-pots happen');
  assert.ok(t.cuts > 200 && t.multiPot > 200, 'side pots happen');
  assert.ok(t.chops > 0 && t.mucks > 0, 'chops and mucks happen');
});
