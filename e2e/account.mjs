// Browser test for signing in: the emailed code, the in-app browser notice, and passkeys.
// Needs a build with accounts on; e2e/stub/build.sh makes one (see there). The passkey
// ceremony itself is faked by the stub; this checks when the buttons show and what happens next.
//
//   node e2e/account.mjs http://localhost:4174/ [--shots] [--dark]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const base = new URL(args.find(a => a.startsWith('http')) || 'http://localhost:4174/');
base.searchParams.delete('stub');
const guestUrl = base.href;
const memberUrl = (() => { const u = new URL(base.href); u.searchParams.set('stub', 'member'); return u.href; })();
const SHOTS = args.includes('--shots');
const OUT = new URL('./out/', import.meta.url).pathname;
if (SHOTS) mkdirSync(OUT, { recursive: true });
const GSA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/439.4.980558000 Mobile/15E148 Safari/604.1';

const browser = await chromium.launch();
const errors = [], bad = [];
const check = (ok, what) => { if (!ok) bad.push(what); };
const shoot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true }); } };

/** A fresh browser where the project's auth settings say passkeys are on (or off). */
async function open(url, { passkeys, userAgent } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: args.includes('--dark') ? 'dark' : 'light', ...(userAgent && { userAgent }) });
  await ctx.route('**/auth/v1/settings**', r => r.fulfill({ json: { passkeys_enabled: !!passkeys } }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  return { ctx, page };
}
const openSheet = async page => { await page.click('#gear'); await page.waitForSelector('#sheet.open #acct:not([hidden])'); await page.waitForTimeout(200); };

// ---- the emailed code: the code box comes up right away, so the sign-in lands in this browser ----
{
  const { ctx, page } = await open(guestUrl, { passkeys: false });
  await openSheet(page);
  check(!await page.isVisible('#acctPasskey'), 'no passkey button while passkeys are off');
  check(!await page.isVisible('.acct-warn'), 'no in-app browser notice in a regular browser');
  await page.fill('#acctEmail', 'dealer@example.com');
  await page.click('#acctEmailForm button');
  await page.waitForSelector('#acctCode');
  check((await page.innerText('#acct')).includes('6-digit code'), 'asks for the emailed code');
  await shoot(page, 'signin-code');
  await ctx.close();
}

// ---- the Google app's built-in browser: warn, and don't offer passkeys (they don't work there) ----
{
  const { ctx, page } = await open(guestUrl, { passkeys: true, userAgent: GSA });
  await openSheet(page);
  const warn = await page.innerText('.acct-warn').catch(() => '');
  check(warn.includes('Google app') && warn.includes('Safari'), `Google app notice points to Safari (got "${warn}")`);
  check(!await page.isVisible('#acctPasskey'), 'no passkey button in an in-app browser');
  await shoot(page, 'signin-google-app');
  await ctx.close();
}

// ---- passkeys: a member adds one, signs out, and signs back in with it ----
{
  const { ctx, page } = await open(memberUrl, { passkeys: true });
  await openSheet(page);
  await page.waitForSelector('#acctAddPasskey');
  check((await page.innerText('.acct-pk')).includes('Face ID'), 'signed-in member is offered a passkey');
  await shoot(page, 'passkey-offer');
  await page.click('#acctAddPasskey');
  await page.waitForFunction(() => document.querySelector('#acct').innerText.includes('Passkey added'));
  check((await page.innerText('#acct')).includes('iCloud Keychain'), 'the new passkey is listed');
  check(!await page.isVisible('.acct-pk'), 'the offer goes away once there is a passkey');
  await shoot(page, 'passkey-added');

  await page.click('#signout');
  await page.waitForSelector('#acctPasskey');
  check(await page.isVisible('#acctEmail'), 'signed out: the email box is back');
  await shoot(page, 'signin-passkey');
  await page.click('#acctPasskey');
  await page.waitForSelector('#signout');
  check((await page.innerText('#acct')).includes('Signed in as'), 'signed back in with the passkey');
  await ctx.close();
}

// ---- a passkey that isn't on any account gets a clear message ----
{
  const { ctx, page } = await open(guestUrl, { passkeys: true });
  await openSheet(page);
  await page.waitForSelector('#acctPasskey');
  await page.click('#acctPasskey');
  await page.waitForSelector('#acct .acct-msg.err');
  check((await page.innerText('#acct .acct-msg.err')).includes('emailed code'), 'unknown passkey says to use a code');
  await ctx.close();
}

await browser.close();
if (bad.length || errors.length) { console.error('FAILED', JSON.stringify({ bad, errors }, null, 2)); process.exit(1); }
console.log('account e2e ok');
