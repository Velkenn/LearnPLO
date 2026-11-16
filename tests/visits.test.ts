// Where a signed-out visitor came from, for the owner's stats dashboard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from '../src/data/visits.ts';

test('a tagged link wins over the referrer', () => {
  assert.equal(sourceOf('?utm_source=Reddit&utm_medium=post', 'https://www.google.com/', 'feltready.com'), 'reddit');
  assert.equal(sourceOf('?ref=dealerschool', '', 'feltready.com'), 'dealerschool');
});

test('the referring site, tidied', () => {
  assert.equal(sourceOf('', 'https://old.reddit.com/r/poker/comments/x', 'feltready.com'), 'reddit.com');
  assert.equal(sourceOf('', 'https://out.reddit.com/t3_abc', 'feltready.com'), 'reddit.com');
  assert.equal(sourceOf('', 'https://l.facebook.com/l.php?u=x', 'feltready.com'), 'facebook.com');
  assert.equal(sourceOf('', 'https://t.co/abc', 'feltready.com'), 'x.com');
  assert.equal(sourceOf('', 'https://www.google.co.uk/', 'feltready.com'), 'google');
});

test('no referrer, or our own pages, is direct', () => {
  assert.equal(sourceOf('', '', 'feltready.com'), null);
  assert.equal(sourceOf('', 'https://feltready.com/', 'feltready.com'), null);
  assert.equal(sourceOf('', 'https://www.feltready.com/plo/', 'feltready.com'), null);
  assert.equal(sourceOf('', 'not a url', 'feltready.com'), null);
});
