import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanCode, codeFromUrl, formatCode, joinLink } from '../src/data/joinCodes.ts';
import { isJoinLink } from '../worker/join.ts';

test('codes can be typed with dashes, spaces, or in lower case', () => {
  assert.equal(cleanCode('k7q2-pmxa'), 'K7Q2PMXA');
  assert.equal(cleanCode(' K7Q2 PMXA '), 'K7Q2PMXA');
  assert.equal(cleanCode(''), '');
});

test('codes show with a dash in the middle, and links use the plain code', () => {
  assert.equal(formatCode('K7Q2PMXA'), 'K7Q2-PMXA');
  assert.equal(formatCode('ABC'), 'ABC');
  assert.equal(joinLink('K7Q2PMXA', 'https://feltready.com'), 'https://feltready.com/join/K7Q2PMXA');
});

test('the join page reads the code from its address', () => {
  assert.equal(codeFromUrl('/join/K7Q2PMXA', ''), 'K7Q2PMXA');
  assert.equal(codeFromUrl('/join/k7q2-pmxa/', ''), 'K7Q2PMXA');
  assert.equal(codeFromUrl('/join/', '?code=k7q2pmxa'), 'K7Q2PMXA');
  assert.equal(codeFromUrl('/join/', ''), '');
  assert.equal(codeFromUrl('/join/a/b', ''), '');
});

test('the Worker answers join links with the join page, and nothing else', () => {
  for (const p of ['/join/K7Q2PMXA', '/join/k7q2-pmxa', '/join/K7Q2PMXA/']) assert.ok(isJoinLink(p), p);
  for (const p of ['/join/', '/join', '/join/a/b', '/join/../plo/', '/joinK7Q2PMXA', '/plo/', '/join/' + 'A'.repeat(21)]) assert.ok(!isJoinLink(p), p);
});
