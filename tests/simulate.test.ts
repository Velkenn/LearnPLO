// Plays thousands of seeded hands through the engine with no screen and checks the invariants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newHand, posOf } from '../src/engine/hand.ts';
import { playHand, type Hooks } from '../src/engine/loop.ts';
import { awardPot, buildShowdown, curPot, gradePicks, liveElig, losersOf, readMiss } from '../src/engine/showdown.ts';
import { seed } from '../src/engine/rng.ts';
import { DEFAULT_SETTINGS } from '../src/config.ts';
import type { Hand, Settings } from '../src/engine/types.ts';

interface Tally { hands: number; potCalls: number; repots: number; cuts: number; showdowns: number; multiPot: number; chops: number; mucks: number; misreads: number; kept?: number }

async function run(settings: Settings, hands: number, firstSeed: number, t: Tally): Promise<void> {
  for (let n = 0; n < hands; n++) {
    seed(firstSeed + n);
    const S: Hand = newHand(settings, n % settings.seats);
    assert.equal(S.players.length, settings.seats);
    const chips = S.players.reduce((a, p) => a + p.stack + p.committed, 0);
    let finished = false;
    const hooks: Hooks = {
      render() {}, sleep: () => Promise.resolve(), current: () => true, actionDelay: () => 0,
      async askPot(p, q) {
        t.potCalls++; if (q.repotOf) t.repots++;
        assert.equal(q.exact, q.cb + q.total + q.toCall, 'call, then raise the pot');
        assert.equal(q.exact, 3 * q.cb + q.rest, '3x rule');
        if (S.rounded) {
          assert.equal(q.raiseTo, Math.ceil(q.exact / 5) * 5, 'rounded pot: round up to the next $5');
          assert.equal(q.cb % 5, 0, 'rounded pot: the last bet is a $5 amount');
          const restOut = q.raiseTo - 3 * q.cb; // what the 3x rule shows as "everything else", rounded up
          assert.ok(restOut >= 0 && restOut % 5 === 0, `rounded pot: 3x rule's everything else is a $5 amount (${restOut})`);
        } else assert.equal(q.raiseTo, q.exact);
        assert.ok(q.addNow <= p.stack, 'raiser can afford it');
      },
      async askCuts(pots) {
        t.cuts += pots.length;
        for (const pt of pots) {
          assert.equal(pt.amount, pt.parts.reduce((a, x) => a + x.amt, 0));
          // The dealer builds from this round's bets; the rest of the pot was already in the middle.
          assert.ok(pt.round! > 0, 'only pots that take something from this round are asked');
          assert.equal(pt.round, pt.roundParts!.reduce((a, x) => a + x.amt, 0));
          const earlier = S.players.reduce((a, p) => a + Math.max(0, Math.min(S.streetStart[p.i], pt.level) - pt.prev), 0);
          assert.equal(pt.amount, earlier + pt.round!, 'pot = earlier rounds + this round');
          if (S.street === 0) assert.equal(pt.round, pt.amount, 'preflop, the whole pot is this round');
        }
      },
      uncontested() { finished = true; },
      showdown() {
        t.showdowns++;
        const sd = buildShowdown(S);
        const total = S.players.reduce((a, p) => a + p.totalIn, 0);
        assert.equal(S.pot, total, 'pot equals everything put in');
        assert.equal(sd.pots.reduce((a, p) => a + p.amount, 0), S.pot, 'pots add up to the pot');
        S.cuts.forEach((c, k) => assert.equal(sd.pots[k].amount, c.amount, 'cut during the hand matches showdown pot'));
        S.cuts.forEach((c, k) => { if (k) assert.ok(c.level > S.cuts[k - 1].level, 'pots kept in order'); });
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
          // Wrong reads get the right mistake type: a losing hand shipped, or only one side of a chop.
          const loser = live.find(i => !pt.winners!.includes(i));
          if (loser != null) {
            const best = sd.rows.find(r => r.i === loser)!.best;
            const g = gradePicks(S, pt, { [loser]: best.hole }, best.board);
            assert.ok(!g.ok);
            assert.match(readMiss(S, sd, pt, g.picks).miss, /^(wrong-winner|omaha-rule)$/);
            t.misreads++;
          }
          if (pt.winners!.length > 1) {
            const w = pt.winners![0];
            const g = gradePicks(S, pt, { [w]: holes[w] }, board);
            assert.ok(!g.ok, 'picking one winner of a chop is wrong');
            assert.equal(readMiss(S, sd, pt, g.picks).miss, 'missed-chop');
          }
          awardPot(S, sd, pt);
          const lost = losersOf(sd, pt); lost.forEach(i => sd.mucked.add(i)); t.mucks += lost.length;
        }
        finished = true;
      },
    };
    await playHand(S, hooks);
    assert.ok(finished, 'hand finished');
    // Rounded pot: an all-in's odd chips went back to them (kept), so they count too.
    const after = S.players.reduce((a, p) => a + p.stack + (p.kept || 0), 0);
    assert.equal(after, chips, `chips conserved (seed ${firstSeed + n})`);
    if (S.rounded) {
      for (const p of S.players) {
        // Every bet is a $5 amount; only the blinds (and what a blind folded) can be odd.
        const blind = posOf(S, p) === 'SB' || posOf(S, p) === 'BB';
        if (!blind || !p.folded) assert.equal(p.totalIn % 5, 0, `rounded pot: $5 amounts (seed ${firstSeed + n}, seat ${p.i + 1}, ${p.totalIn})`);
        assert.ok((p.kept || 0) < 5, 'at most $4 goes back');
      }
      t.kept = (t.kept || 0) + S.players.filter(p => p.kept).length;
    }
    t.hands++;
  }
  seed(null);
}

test('thousands of hands keep chips, pots, and cuts consistent', async () => {
  const t: Tally = { hands: 0, potCalls: 0, repots: 0, cuts: 0, showdowns: 0, multiPot: 0, chops: 0, mucks: 0, misreads: 0 };
  const base = { ...DEFAULT_SETTINGS };
  await run({ ...base, side: 'off', potCalls: 1 }, 500, 1000, t);
  await run({ ...base, side: 'often', potCalls: 1 }, 800, 5000, t);
  await run({ ...base, side: 'often', potCalls: 3 }, 800, 9000, t);
  await run({ ...base, side: 'some', potCalls: 2, stakes: '25/50' }, 500, 13000, t);
  console.log(t);
  assert.ok(t.potCalls > 1000 && t.repots > 100, 'pot calls and re-pots happen');
  assert.ok(t.cuts > 200 && t.multiPot > 200, 'side pots happen');
  assert.ok(t.chops > 0 && t.mucks > 0, 'chops and mucks happen');
  assert.ok(t.misreads > 100, 'wrong reads were classified');
});

test('nine-handed hands play out the same way', async () => {
  const t: Tally = { hands: 0, potCalls: 0, repots: 0, cuts: 0, showdowns: 0, multiPot: 0, chops: 0, mucks: 0, misreads: 0 };
  const base = { ...DEFAULT_SETTINGS, seats: 9 as const };
  await run({ ...base, side: 'off', potCalls: 1 }, 400, 21000, t);
  await run({ ...base, side: 'often', potCalls: 2 }, 600, 25000, t);
  await run({ ...base, side: 'often', potCalls: 3, stakes: '1/2' }, 400, 29000, t);
  console.log('9-handed', t);
  assert.ok(t.potCalls > 800 && t.repots > 50, 'pot calls and re-pots happen');
  assert.ok(t.cuts > 100 && t.multiPot > 100, 'side pots happen');
  assert.ok(t.chops > 0 && t.mucks > 0, 'chops and mucks happen');
});

test('rounded pot: $1/$3, $2/$5 and $5/$10, six- and nine-handed', async () => {
  const t: Tally = { hands: 0, potCalls: 0, repots: 0, cuts: 0, showdowns: 0, multiPot: 0, chops: 0, mucks: 0, misreads: 0, kept: 0 };
  const base = { ...DEFAULT_SETTINGS, potStyle: 'rounded' as const };
  await run({ ...base, stakes: '1/3', side: 'often', potCalls: 3 }, 600, 41000, t);
  await run({ ...base, stakes: '2/5', side: 'often', potCalls: 2 }, 400, 45000, t);
  await run({ ...base, stakes: '1/3', side: 'some', potCalls: 3, seats: 9 }, 400, 49000, t);
  await run({ ...base, stakes: '5/10', side: 'often', potCalls: 1 }, 200, 53000, t);
  console.log('rounded', t);
  assert.ok(t.potCalls > 800 && t.repots > 50, 'pot calls and re-pots happen');
  assert.ok(t.cuts > 100, 'side pots happen');
  assert.ok(t.kept! > 30, 'all-ins with odd chips happen');
});

test('nine-handed positions and blinds go around the button', () => {
  seed(7);
  const S = newHand({ ...DEFAULT_SETTINGS, seats: 9 }, 8); // button on Seat 9
  seed(null);
  assert.deepEqual(S.players.map(p => posOf(S, p)), ['SB', 'BB', 'UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO', 'BTN']);
  assert.equal(S.players[8].committed, 0);
  assert.equal(S.players[0].committed, S.sb, 'seat 1 is the small blind');
  assert.equal(S.players[1].committed, S.bb, 'seat 2 is the big blind');
  assert.ok(S.players.every(p => p.hole.length === 4));
  assert.equal(S.deck.length, 52 - 36);
  assert.equal(S.streetStart.length, 9);
});
