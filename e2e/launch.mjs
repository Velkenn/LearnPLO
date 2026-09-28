// Browser test for the launch pieces: the first-visit welcome, sending feedback, and the
// owner's stats dashboard. Needs a build with accounts on; e2e/stub/build.sh makes one.
//
//   node e2e/launch.mjs http://localhost:4174/plo/ [--shots] [--dark]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const base = new URL(args.find(a => a.startsWith('http')) || 'http://localhost:4174/plo/');
base.searchParams.delete('stub');
const memberUrl = (() => { const u = new URL(base.href); u.searchParams.set('stub', 'member'); return u.href; })();
const SHOTS = args.includes('--shots');
const OUT = new URL('./out/', import.meta.url).pathname;
if (SHOTS) mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const errors = [], bad = [];
const check = (ok, what) => { if (!ok) bad.push(what); };
const shoot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true }); } };
async function open(url) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: args.includes('--dark') ? 'dark' : 'light' });
  await ctx.route('**/auth/v1/settings**', r => r.fulfill({ json: { passkeys_enabled: false } }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  // A member's account loads a moment after the page; wait for it.
  if (url.includes('stub=member')) await page.waitForFunction(() => document.querySelector('#acct')?.textContent?.includes('Signed in as'));
  return { ctx, page };
}

// ---- first visit: welcome shows, dealing hides it for good ----
{
  const { ctx, page } = await open(base.href);
  await page.waitForSelector('#welcome:not([hidden]) h2');
  check((await page.innerText('#welcome')).includes('Call the pot'), 'welcome explains the drills');
  const box = await page.$eval('#welcome', el => el.getBoundingClientRect().bottom);
  check(box < 844, `welcome fits on the first phone screen (bottom at ${Math.round(box)}px)`);
  await shoot(page, 'welcome');
  await page.click('#welcomeDeal');
  await page.waitForFunction(() => !!document.querySelector('#welcome').hidden);
  check(await page.$eval('#table', el => !!el.querySelector('.seat, [class*=seat]')), 'a hand is being dealt');
  await page.reload();
  await page.waitForTimeout(500);
  check(!await page.isVisible('#welcome'), 'welcome stays gone after a reload');
  await ctx.close();
}
{
  const { ctx, page } = await open(base.href);
  await page.waitForSelector('#welcomeDaily');
  await page.click('#welcomeDaily');
  await page.waitForSelector('#daily.open');
  check(!await page.isVisible('#welcome'), 'opening the challenge from the welcome hides it');
  await ctx.close();
}
{
  const { ctx, page } = await open(memberUrl);
  await page.waitForTimeout(800);
  check(!await page.isVisible('#welcome'), 'members never see the welcome');
  await ctx.close();
}

// ---- feedback: a guest sends one with an optional email ----
{
  const { ctx, page } = await open(base.href);
  await page.click('#feedbackOpen');
  await page.waitForSelector('#feedback.open #fbMessage');
  check(await page.isVisible('#fbEmail'), 'guests can leave an email');
  await page.click('#feedbackForm button');
  check((await page.innerText('#feedback')).includes('Type a message first'), 'empty feedback is stopped');
  await page.fill('#fbMessage', 'The re-pot explanation helped. Could you add Big O?');
  await page.fill('#fbEmail', 'dealer@example.com');
  await shoot(page, 'feedback-form');
  await page.click('#feedbackForm button');
  await page.waitForSelector('.fb-sent');
  const sent = await page.evaluate(() => window.__feedback);
  check(sent.length === 1 && sent[0].email === 'dealer@example.com' && sent[0].context?.mode === 'guest', `feedback row sent with context (${JSON.stringify(sent)})`);
  await ctx.close();
}

// ---- member feedback, then the admin's stats dashboard shows it ----
{
  const { ctx, page } = await open(memberUrl);
  await page.click('#feedbackOpen');
  await page.waitForSelector('#feedback.open #fbMessage');
  check(!await page.isVisible('#fbEmail'), 'members are not asked for an email');
  await page.fill('#fbMessage', 'Side pot 2 wording confused me.');
  await page.click('#feedbackForm button');
  await page.waitForSelector('.fb-sent');
  const sent = await page.evaluate(() => window.__feedback);
  check(sent.length === 1 && sent[0].email == null && sent[0].context?.mode === 'member', 'member feedback sent without an email field');
  await page.click('#gear');
  await page.waitForSelector('#acctStats');
  await page.click('#acctStats');
  await page.waitForSelector('#stats.open table.stats tbody tr');
  const text = await page.innerText('#stats');
  check(text.includes('Members') && text.includes('14'), 'stats tiles show members');
  check(text.includes('Side pot 2 wording confused me.'), 'the new feedback shows on the dashboard');
  check(await page.$$eval('#stats tbody tr', rows => rows.length) === 14, 'fourteen days of activity');
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  check(wide <= 390, `no sideways scrolling on a phone (${wide}px)`);
  await shoot(page, 'stats');
  await ctx.close();
}

await browser.close();
if (bad.length || errors.length) { console.error('FAILED', JSON.stringify({ bad, errors }, null, 2)); process.exit(1); }
console.log('launch e2e ok');
