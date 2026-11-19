// Browser test for signing in: Google and Apple, email and password, the emailed code, the
// in-app browser notice, and passkeys.
// Needs a build with accounts on; e2e/stub/build.sh makes one (see there). The passkey
// ceremony itself is faked by the stub; this checks when the buttons show and what happens next.
//
//   node e2e/account.mjs http://localhost:4174/plo/ [--shots] [--dark]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const base = new URL(args.find(a => a.startsWith('http')) || 'http://localhost:4174/plo/');
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

/** A fresh browser where the project's auth settings say passkeys (and Google and Apple) are on or off. */
async function open(url, { passkeys, oauth, userAgent } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: args.includes('--dark') ? 'dark' : 'light', ...(userAgent && { userAgent }) });
  await ctx.route('**/auth/v1/settings**', r => r.fulfill({ json: { passkeys_enabled: !!passkeys, external: { email: true, google: !!oauth, apple: !!oauth } } }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  return { ctx, page };
}
const openSheet = async page => { await page.click('#gear'); await page.waitForSelector('#sheet.open #acct:not([hidden])'); await page.waitForTimeout(200); };

const accountText = page => page.innerText('#acct');
const signedIn = page => page.waitForFunction(() => document.querySelector('#acct').innerText.includes('Signed in as'));

// ---- the emailed code: the code box comes up right away, so the sign-in lands in this browser ----
{
  const { ctx, page } = await open(guestUrl, { passkeys: false });
  await openSheet(page);
  check(!await page.isVisible('#acctPasskey'), 'no passkey button while passkeys are off');
  check(!await page.isVisible('.oauth'), 'no Google or Apple buttons while they are off');
  check(!await page.isVisible('.acct-warn'), 'no in-app browser notice in a regular browser');
  check((await page.innerText('#acctEmailForm button')).includes('Create account'), 'a new browser starts on making an account');
  await page.fill('#acctEmail', 'dealer@example.com');
  await page.click('#acctToCode');
  await page.waitForSelector('#acctCode');
  check((await page.innerText('#acct')).includes('sign-in code'), 'asks for the emailed code');
  await shoot(page, 'signin-code');
  await ctx.close();
}

// ---- Google and Apple: both buttons, and each one heads off to its provider and back to this page ----
{
  const { ctx, page } = await open(guestUrl, { passkeys: true, oauth: true });
  await openSheet(page);
  await page.waitForSelector('#acctOauth-google');
  check(await page.isVisible('#acctOauth-apple'), 'Apple button shows');
  check((await accountText(page)).includes('Continue with Google'), 'Google button says Continue with Google');
  await shoot(page, 'signin-options');
  await page.click('#acctOauth-google');
  await page.waitForFunction(() => window.__oauth);
  const go = await page.evaluate(() => window.__oauth);
  check(go.provider === 'google' && go.redirectTo === new URL(guestUrl).origin + new URL(guestUrl).pathname + new URL(guestUrl).search, `Google comes back to this page (${JSON.stringify(go)})`);
  await ctx.close();
}

// ---- back from Google without signing in: a failure says so, a cancel says nothing ----
{
  const { ctx, page } = await open(guestUrl, { oauth: true });
  const comeBack = async hash => {
    await page.evaluate(h => { sessionStorage.setItem('fr-oauth', 'google'); location.hash = h; }, hash);
    await page.reload();
    await openSheet(page);
  };
  await comeBack('error=server_error&error_description=Something+broke');
  const msg = await page.innerText('#acct .acct-msg.err').catch(() => '');
  check(msg.includes('Google') && msg.includes('didn’t finish'), `failed return is explained (got "${msg}")`);
  check(!page.url().includes('error='), 'the error is cleared from the address');
  await comeBack('error=access_denied&error_description=The+user+denied+access');
  check(!await page.isVisible('#acct .acct-msg.err'), 'a cancel shows no error');
  await ctx.close();
}

// ---- email and password: a too-short password, then a new account; sign out, a wrong password, the right one ----
{
  const { ctx, page } = await open(guestUrl);
  await openSheet(page);
  await page.fill('#acctEmail', 'new@example.com');
  await page.fill('#acctPassword', 'short');
  await page.click('#acctEmailForm button');
  check((await accountText(page)).includes('at least 8'), 'short password is refused');
  await page.fill('#acctPassword', 'river-card-9');
  await shoot(page, 'signin-create');
  await page.click('#acctEmailForm button');
  await signedIn(page);
  check((await accountText(page)).includes('Set or change your password'), 'a member can set a password');

  await page.click('#signout');
  await page.waitForSelector('#acctPassword');
  check((await page.innerText('#acctEmailForm button')).includes('Sign in'), 'after an account, the box starts on signing in');
  await page.fill('#acctEmail', 'new@example.com');
  await page.fill('#acctPassword', 'wrong-one');
  await page.click('#acctEmailForm button');
  await page.waitForSelector('#acct .acct-msg.err');
  check((await page.innerText('#acct .acct-msg.err')).includes('code'), 'wrong password points to the emailed code');
  await page.fill('#acctPassword', 'river-card-9');
  await page.click('#acctEmailForm button');
  await signedIn(page);
  await ctx.close();
}

// ---- an email that already has an account; and "Confirm email" on: the code from the confirmation email ----
{
  const { ctx, page } = await open(guestUrl);
  await openSheet(page);
  await page.fill('#acctEmail', 'taken@example.com');
  await page.fill('#acctPassword', 'river-card-9');
  await page.click('#acctEmailForm button');
  await page.waitForSelector('#acct .acct-msg.err');
  check((await page.innerText('#acct .acct-msg.err')).includes('already has an account'), 'taken email says so');
  await page.goto(`${guestUrl}${guestUrl.includes('?') ? '&' : '?'}confirm=1`);
  await openSheet(page);
  await page.fill('#acctEmail', 'new@example.com');
  await page.fill('#acctPassword', 'river-card-9');
  await page.click('#acctEmailForm button');
  await page.waitForSelector('#acctCode');
  check((await accountText(page)).includes('confirm'), 'asks for the confirmation code');
  await page.fill('#acctCode', '123456');
  await page.click('#acctCodeForm button');
  await signedIn(page);
  await ctx.close();
}

// ---- a member sets a password ----
{
  const { ctx, page } = await open(memberUrl);
  await openSheet(page);
  await page.waitForSelector('#acctSetPw');
  await page.click('#acctSetPw');
  await page.fill('#acctNewPw', 'abc');
  await page.click('#acctPwForm button');
  check((await accountText(page)).includes('at least 8'), 'short new password is refused');
  await page.fill('#acctNewPw', 'flop-turn-river');
  await page.click('#acctPwForm button');
  await page.waitForFunction(() => document.querySelector('#acct').innerText.includes('Password saved'));
  await shoot(page, 'password-saved');
  await ctx.close();
}

// ---- the Google app's built-in browser: warn, and don't offer passkeys or Google/Apple (they don't work there) ----
{
  const { ctx, page } = await open(guestUrl, { passkeys: true, oauth: true, userAgent: GSA });
  await openSheet(page);
  const warn = await page.innerText('.acct-warn').catch(() => '');
  check(warn.includes('Google app') && warn.includes('Safari'), `Google app notice points to Safari (got "${warn}")`);
  check(!await page.isVisible('#acctPasskey'), 'no passkey button in an in-app browser');
  await page.waitForTimeout(200);
  check(!await page.isVisible('.oauth'), 'no Google or Apple buttons in an in-app browser');
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
