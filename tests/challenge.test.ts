import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerKey, challengeFingerprint, challengeMix, dealChallengeHand, goodMix, pickDaySeed, replayChallenge, CHALLENGE_HANDS, type ChallengeAnswer } from '../src/engine/challenge.ts';
import { seed } from '../src/engine/rng.ts';

const DAY = 20260927;
const clone = (a: ChallengeAnswer[][]): ChallengeAnswer[][] => JSON.parse(JSON.stringify(a));

test('the same day deals the same hands; each hand of a day is different', () => {
  const a = dealChallengeHand(DAY, 0), b = dealChallengeHand(DAY, 0), c = dealChallengeHand(DAY, 1);
  seed(null);
  assert.deepEqual(a.players.map(p => p.hole), b.players.map(p => p.hole));
  assert.deepEqual(a.deck, b.deck);
  assert.notDeepEqual(a.players.map(p => p.hole), c.players.map(p => p.hole));
  assert.equal(a.btn, 0); assert.equal(c.btn, 1);
});

test('the answer key grades perfect, over many days', async () => {
  for (let d = 0; d < 60; d++) {
    const day = (DAY + d * 7919) >>> 0;
    const key = await answerKey(day);
    const r = await replayChallenge(day, key);
    assert.equal(r.mismatch, false, `day ${day}`);
    assert.equal(r.right, r.total, `day ${day}`);
    assert.equal(r.hands.length, CHALLENGE_HANDS);
  }
});

test('wrong answers count as wrong; the rest still count', async () => {
  const day = await pickDaySeed(DAY);
  const key = await answerKey(day), total = key.flat().length;
  const a = clone(key);
  const pot = a.flat().find(x => x.k === 'pot') as { v: number };
  pot.v += 5;
  const cut = a.flat().find(x => x.k === 'cut') as { v: number };
  cut.v = null as unknown as number; // timed out
  const read = a.flat().find(x => x.k === 'read') as { board: number[] };
  read.board = read.board.map(b => (b + 1) % 5).sort(); // a different three board cards
  const r = await replayChallenge(day, a);
  assert.equal(r.mismatch, false);
  assert.ok(r.right <= total - 2 && r.right >= total - 3, `${r.right} of ${total}`);
});

test('answers that do not line up with the questions are flagged', async () => {
  const day = await pickDaySeed(DAY);
  const key = await answerKey(day);
  const short = clone(key); const h = short.findIndex(x => x.length > 0); short[h].pop();
  assert.equal((await replayChallenge(day, short)).mismatch, true, 'missing an answer');
  const extra = clone(key); extra[0].push({ k: 'pot', v: 10 });
  assert.equal((await replayChallenge(day, extra)).mismatch, true, 'one answer too many');
  assert.equal((await replayChallenge(day, key.slice(0, 4))).mismatch, true, 'a hand missing');
  assert.equal((await replayChallenge(day, 'nonsense' as unknown as ChallengeAnswer[][])).mismatch, true);
});

test('malformed reads are graded wrong, not crashes', async () => {
  const day = await pickDaySeed(DAY);
  const key = await answerKey(day);
  const bad = [
    { holes: { 0: [0, 9] }, board: [0, 1, 2] },
    { holes: { 7: [0, 1] }, board: [0, 1, 2] },
    { holes: { 0: [1, 1] }, board: [0, 1, 2] },
    { holes: {}, board: [0, 1, 2] },
    { holes: { 0: [0, 1] }, board: [0, 1] },
    { holes: { 0: [0, 1] }, board: [0, 0, 1] },
    { holes: null, board: null },
    { holes: { '1.5': [0, 1] }, board: [0, 1, 2] },
  ];
  for (const b of bad) {
    const a = clone(key); const read = a.flat().find(x => x.k === 'read')!;
    Object.assign(read, b);
    const r = await replayChallenge(day, a);
    assert.equal(r.right, r.total - 1, JSON.stringify(b));
  }
});

test('picked days ask a good mix of questions, and picking is repeatable', async () => {
  let direct = 0;
  for (let n = 0; n < 40; n++) {
    const start = (n * 2654435761) >>> 0;
    const s = await pickDaySeed(start);
    if (s === start) direct++;
    assert.ok(goodMix(await challengeMix(s)), `seed ${s}`);
    assert.equal(await pickDaySeed(start), s);
  }
  console.log({ goodOnFirstTry: `${direct}/40` });
});

test('fingerprint is stable for this engine (compare with the deployed function)', async () => {
  const f = await challengeFingerprint();
  assert.match(f, /^[0-9a-f]{8}$/);
  assert.equal(await challengeFingerprint(), f);
  console.log({ fingerprint: f });
});
