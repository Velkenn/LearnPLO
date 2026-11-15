import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downtrackerHref, isIOS } from '../src/ui/downtracker.ts';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

test('iPhones and iPads count as iOS; Macs without touch and Android do not', () => {
  assert.equal(isIOS(IPHONE, 5), true);
  assert.equal(isIOS(IPAD, 5), true);   // iPadOS Safari says it's a Mac
  assert.equal(isIOS(IPAD, 0), false);  // a real Mac
  assert.equal(isIOS(ANDROID, 5), false);
});

test('iOS gets the App Store with a campaign token, everyone else the site with UTM tags', () => {
  assert.equal(downtrackerHref('daily', true), 'https://apps.apple.com/us/app/down-tracker/id6770693806?ct=feltready-daily&mt=8');
  assert.equal(downtrackerHref('footer', false), 'https://nevermissadown.com/?utm_source=feltready&utm_medium=referral&utm_campaign=footer');
});
