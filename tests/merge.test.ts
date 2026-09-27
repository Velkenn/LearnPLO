import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addStats, answered, cleanSettings, pickMemberSettings, pickMemberStats } from '../src/data/merge.ts';
import { DEFAULT_SETTINGS } from '../src/config.ts';

const st = (pt: number, pr = 0, extra: Record<string, number> = {}) => ({ pr, pt, rr: 0, rt: 0, sr: 0, st: 0, streak: 0, best: 0, ...extra });

test('account stats win unless this device has newer ones', () => {
  assert.equal(pickMemberStats(st(10), st(4), null, null).pt, 10);
  assert.equal(pickMemberStats(st(10), st(12), null, null).pt, 12, 'last save may not have reached the server');
});

test('a new account starts from this visit and older device stats', () => {
  const s = pickMemberStats(null, null, st(3, 2, { best: 2, streak: 2 }), st(20, 15, { best: 9, streak: 1 }));
  assert.equal(s.pt, 23);
  assert.equal(s.pr, 17);
  assert.equal(s.best, 9);
  assert.equal(s.streak, 2, 'current streak comes from this visit');
});

test('a new account with nothing to bring starts clean', () => {
  assert.equal(answered(pickMemberStats(null, null, st(0), null)), 0);
});

test('addStats sums counters and times', () => {
  const s = addStats(st(2, 1, { ptime: 3000, pn: 2 }), st(3, 3, { ptime: 1000, pn: 3 }));
  assert.equal(s.pt, 5); assert.equal(s.ptime, 4000); assert.equal(s.pn, 5);
});

test('settings from the account ignore unknown or wrong-typed values', () => {
  const s = cleanSettings({ timer: 'fast', potCalls: 3, bogus: 1, showPot: 'yes' });
  assert.equal(s.timer, 'fast');
  assert.equal(s.potCalls, 3);
  assert.equal(s.showPot, DEFAULT_SETTINGS.showPot);
  assert.equal((s as unknown as Record<string, unknown>).bogus, undefined);
});

test('first sign-in keeps settings made on this device before accounts', () => {
  assert.equal(pickMemberSettings(null, { timer: 'relaxed' }).timer, 'relaxed');
  assert.equal(pickMemberSettings({ timer: 'fast' }, { timer: 'relaxed' }).timer, 'fast');
  assert.deepEqual(pickMemberSettings({}, null), DEFAULT_SETTINGS);
});
