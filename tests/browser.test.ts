import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inAppBrowser, regularBrowser } from '../src/data/browser.ts';

// The Google app on iPhone: every sign-in on the live site so far came from this.
const GSA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/439.4.980558000 Mobile/15E148 Safari/604.1';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1';
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const FB = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.40.108;FBBV/712345678]';
const IG_ANDROID = 'Mozilla/5.0 (Linux; Android 15; SM-S921U; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.40.100 Android';

test('in-app browsers are recognized; regular browsers are not', () => {
  assert.equal(inAppBrowser(GSA), 'the Google app');
  assert.equal(inAppBrowser(FB), 'Facebook');
  assert.equal(inAppBrowser(IG_ANDROID), 'Instagram');
  for (const ua of [SAFARI, CHROME_IOS, CHROME_ANDROID]) assert.equal(inAppBrowser(ua), null, ua);
});

test('points iPhone users to Safari and everyone else to Chrome', () => {
  assert.equal(regularBrowser(GSA), 'Safari');
  assert.equal(regularBrowser(CHROME_ANDROID), 'Chrome');
});
