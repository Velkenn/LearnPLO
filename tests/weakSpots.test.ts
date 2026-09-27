import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weakSpots, accuracy } from '../src/data/weakSpots.ts';
import type { AttemptRow } from '../src/data/store.ts';

let clock = 0;
const row = (kind: string, correct: boolean, detail: Record<string, unknown>, extra: Partial<AttemptRow> = {}): AttemptRow => ({
  kind, correct, timed_out: false, ms: 5000, detail,
  created_at: new Date(Date.UTC(2026, 8, 27, 12, 0, clock++)).toISOString(), ...extra,
});
const times = (n: number, make: (i: number) => AttemptRow): AttemptRow[] => Array.from({ length: n }, (_, i) => make(i));

test('accuracy and average time per drill; timeouts miss and leave the average alone', () => {
  const rows = [
    row('pot', true, { street: 0 }, { ms: 4000 }),
    row('pot', false, { street: 1, miss: 'skipped-call' }, { ms: 8000 }),
    row('pot', false, { street: 2 }, { timed_out: true, ms: null }),
    row('read', true, { pots: 1, hand: 5 }),
  ];
  const r = weakSpots(rows);
  const pot = r.drills.find(d => d.kind === 'pot')!;
  assert.equal(pot.n, 3);
  assert.equal(pot.right, 1);
  assert.equal(pot.timeouts, 1);
  assert.equal(pot.avgMs, 6000);
  assert.equal(r.drills.find(d => d.kind === 'cut')!.n, 0);
  assert.equal(r.total, 4);
  assert.equal(r.since, rows[0].created_at);
});

test('re-pots, side pots, and chops are split out as their own situations', () => {
  const rows = [
    ...times(6, i => row('pot', i < 2, { street: 1, repot: true })),     // re-pots: 2 of 6
    ...times(6, () => row('pot', true, { street: 0, repot: false })),    // preflop: 6 of 6
    ...times(5, i => row('cut', i < 3, { pot: 'Side pot 2', dead: false })),
    ...times(5, () => row('cut', true, { pot: 'Main pot', dead: true })),
    ...times(8, i => row('read', i < 4, { chop: true, pots: 1, contenders: 2, hand: 3 })), // chops: 4 of 8
    ...times(4, () => row('read', true, { chop: false, pots: 1, contenders: 3, hand: 5 })),
  ];
  const r = weakSpots(rows);
  const sit = (key: string) => r.drills.flatMap(d => d.situations).find(s => s.key === key)!;
  assert.deepEqual([sit('pot-repot').n, sit('pot-repot').right], [6, 2]);
  assert.equal(sit('pot-postflop'), undefined, 're-pots are not also counted as first pots');
  assert.equal(accuracy(sit('pot-preflop')), 1);
  assert.equal(sit('cut-side').n, 5);
  assert.equal(sit('cut-dead').right, 5);
  assert.equal(sit('read-chop').n, 8);
  assert.deepEqual([sit('read-single').n, sit('read-single').right], [12, 8]);
  assert.equal(sit('read-sides'), undefined, 'situations with no answers are left out');
  assert.equal(sit('read-flush').n, 4);
  assert.equal(sit('read-multiway').n, 4);
  // Weakest first (re-pots 33%, chops 50%, side-pot cuts 60%); spots at 90% or better never show.
  assert.deepEqual(r.focus.map(f => f.key), ['pot-repot', 'read-chop', 'cut-side']);
});

test('a handful of misses is not a weak spot yet', () => {
  const r = weakSpots(times(4, () => row('cut', false, { pot: 'Main pot' })));
  assert.equal(r.focus.length, 0);
});

test('mistakes are counted by type, most common first, plain miscounts last; old rows without a type are skipped', () => {
  const rows = [
    ...times(3, () => row('cut', false, { pot: 'Main pot', miss: 'dead-money' })),
    row('pot', false, { street: 1, miss: 'high' }),
    row('pot', false, { street: 1, miss: 'low' }),
    row('read', false, { pots: 1 }, { timed_out: true, ms: null }),
    row('read', false, { pots: 1 }),                           // logged before mistake types
    row('read', false, { pots: 1, miss: 'no-such-code' }),
  ];
  const r = weakSpots(rows);
  assert.deepEqual(r.misses.map(m => [m.kind, m.label, m.n]), [
    ['cut', 'Left out dead money', 3],
    ['read', 'Ran out of time', 1],
    ['pot', 'Other miscounts', 2],
  ]);
});

test('no answers yet', () => {
  const r = weakSpots([]);
  assert.equal(r.total, 0);
  assert.equal(r.since, null);
  assert.deepEqual(r.drills.map(d => d.n), [0, 0, 0]);
});
