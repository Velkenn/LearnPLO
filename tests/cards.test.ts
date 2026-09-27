import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestOmaha, cmp, describe, eval5 } from '../src/engine/cards.ts';
import type { Card, Suit } from '../src/engine/types.ts';

// "Ah Kd 7c" -> cards
const cards = (s: string): Card[] => s.split(' ').map(t => {
  const r = t.slice(0, -1), suit = t.slice(-1) as Suit;
  const rank = ({ A: 14, K: 13, Q: 12, J: 11, T: 10 } as Record<string, number>)[r] ?? Number(r);
  return { r: rank, s: suit };
});

test('ranks the categories in order', () => {
  const order = [
    '2c 7d 9h Js Kc',       // high card
    '2c 2d 9h Js Kc',       // pair
    '2c 2d 9h 9s Kc',       // two pair
    '2c 2d 2h 9s Kc',       // trips
    '5c 6d 7h 8s 9c',       // straight
    '2h 7h 9h Jh Kh',       // flush
    '2c 2d 2h 9s 9c',       // full house
    '2c 2d 2h 2s 9c',       // quads
    '5h 6h 7h 8h 9h',       // straight flush
  ].map(h => eval5(cards(h)));
  for (let i = 1; i < order.length; i++) assert.ok(cmp(order[i], order[i - 1]) > 0, `category ${i} beats ${i - 1}`);
});

test('the wheel is a five-high straight', () => {
  assert.deepEqual(eval5(cards('Ac 2d 3h 4s 5c')), [4, 5]);
  assert.equal(describe(eval5(cards('Ac 2d 3h 4s 5c'))), 'a straight, five high');
});

test('Omaha: four hearts on board and one in hand is not a flush', () => {
  const best = bestOmaha(cards('Ah Kc Qd 2s'), cards('3h 7h 9h Jh 4c'));
  assert.notEqual(best.score[0], 5);
});

test('Omaha: must play exactly two hole cards', () => {
  // Board has a straight by itself; hand holds nothing that connects.
  const best = bestOmaha(cards('2c 2d Kc Kd'), cards('5h 6s 7d 8c 9h'));
  assert.notEqual(best.score[0], 4, 'board straight does not play');
  assert.equal(best.hole.length, 2);
  assert.equal(best.board.length, 3);
});

test('kickers break ties', () => {
  assert.ok(cmp(eval5(cards('Ac Ad Kh 5s 2c')), eval5(cards('As Ah Qh 5d 2d'))) > 0);
  assert.equal(cmp(eval5(cards('Ac Ad Kh 5s 2c')), eval5(cards('As Ah Kd 5d 2d'))), 0);
});
