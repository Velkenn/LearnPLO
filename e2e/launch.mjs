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
async function open(url, storage = null) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: args.includes('--dark') ? 'dark' : 'light' });
  await ctx.route('**/auth/v1/settings**', r => r.fulfill({ json: { passkeys_enabled: false } }));
  if (storage) await ctx.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, storage);
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
  // The first deal asks how the room counts the pot, then deals.
  await page.waitForSelector('#styleAsk.open');
  const ask = await page.innerText('#styleBox');
  check(ask.includes('True pot') && ask.includes('Rounded pot') && ask.includes('$17') && ask.includes('$20') && ask.includes('$15') && ask.includes('sign in free and change it in settings'), 'pot style question explains both, and that switching later takes an account', ask);
  const fits = await page.$eval('#styleBox', el => el.getBoundingClientRect().top >= 0);
  check(fits, 'pot style question fits on the phone screen');
  await shoot(page, 'pot-style');
  await page.click('#styleBox [data-style="rounded"]');
  await page.waitForFunction(() => !document.querySelector('#styleAsk').classList.contains('open'));
  await page.waitForFunction(() => !!document.querySelector('#welcome').hidden);
  check(await page.$eval('#table', el => !!el.querySelector('.seat, [class*=seat]')), 'a hand is being dealt');
  check((await page.$eval('#log', el => el.textContent)).includes('Rounded pot'), 'the hand is dealt rounded pot');
  await page.reload();
  await page.waitForTimeout(500);
  check(!await page.isVisible('#welcome'), 'welcome stays gone after a reload');
  // The pick is remembered (a guest's on this device) and shown in settings, locked: switching takes an account.
  await page.click('#gear');
  check(await page.$eval('#potStyleSeg [data-v="rounded"]', b => b.classList.contains('on')), 'settings show rounded pot');
  check(await page.$eval('#potStyleSet', f => f.disabled), 'guests can’t switch the pot style');
  await page.click('#potStyleSeg [data-v="true"]', { force: true });
  check(await page.$eval('#potStyleSeg [data-v="rounded"]', b => b.classList.contains('on')), 'a locked switch stays on rounded pot');
  check((await page.innerText('#potStyleHint')).includes('Sign in free to switch'), 'the hint says to sign in to switch');
  await shoot(page, 'pot-style-locked');
  await page.click('#potStyleSignin');
  await page.waitForTimeout(100);
  check(await page.evaluate(() => document.activeElement?.id === 'acctEmail'), 'the sign-in link goes to the email box');
  await page.click('#gear');
  await page.click('[data-deal]');
  await page.waitForTimeout(300);
  check(!await page.isVisible('#styleAsk.open'), 'it asks only once');
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
  // Members can switch the pot style in settings.
  await page.click('#gear');
  check(!await page.$eval('#potStyleSet', f => f.disabled), 'members can switch the pot style');
  await page.click('#potStyleSeg [data-v="rounded"]');
  check(await page.$eval('#potStyleSeg [data-v="rounded"]', b => b.classList.contains('on')), 'a member switches to rounded pot');
  check(!(await page.innerText('#potStyleHint')).includes('Sign in'), 'no sign-in prompt for members');
  await ctx.close();
}
{
  // Picked rounded pot while signed out, then made an account: the account keeps the pick, no second ask.
  const { ctx, page } = await open(base.href);
  await page.evaluate(() => localStorage.setItem('plo-dd-comfort', JSON.stringify({ potStyle: 'rounded' })));
  await page.goto(memberUrl);
  await page.waitForFunction(() => document.querySelector('#acct')?.textContent?.includes('Signed in as'));
  await page.click('[data-deal]');
  await page.waitForTimeout(300);
  check(!await page.isVisible('#styleAsk.open'), 'a signed-out pick carries into the new account');
  check((await page.$eval('#log', el => el.textContent)).includes('Rounded pot'), 'the new account deals rounded pot');
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
  const id = await page.evaluate(() => localStorage.getItem('fr-feedback'));
  check(/^[0-9a-f-]{36}$/.test(id || '') && sent[0].sender === id, 'the message carries this browser’s id, so a reply can find its way back');
  check(!await page.isVisible('#fbNote'), 'no reply note before there’s a reply');
  await ctx.close();
}

// ---- replies: a signed-out sender sees the owner's answer and writes back ----
{
  const sender = '7a1c2e4b-0000-4000-8000-000000000123';
  const url = new URL(base.href); url.searchParams.set('replies', '1');
  const { ctx, page } = await open(url.href, { 'fr-feedback': sender });
  await page.waitForSelector('#fbNote:not([hidden])');
  check((await page.innerText('#fbNote')).includes('You have a reply'), 'a note says there’s a reply');
  await shoot(page, 'reply-note');
  await page.click('#fbNoteOpen');
  await page.waitForSelector('#feedback.open .fb-thread.new');
  const sheet = await page.innerText('#feedback');
  check(sheet.includes('Which phone were you on?') && sheet.includes('took my answer twice'), 'the sheet shows the reply under their message');
  check(!await page.isVisible('#fbNote'), 'the note goes away once it’s open');
  check(await page.waitForFunction(() => window.__seen >= 1, null, { timeout: 3000 }).then(() => true, () => false), 'opening it marks the reply read');
  await page.click('#feedback [data-back]');
  await page.click('.fb-back button[type=submit]');
  check((await page.innerText('#feedback')).includes('Type a message first'), 'an empty write-back is stopped');
  await page.fill('#fbBack', 'iPhone 15, in Safari.');
  await page.click('.fb-back button[type=submit]');
  await page.waitForFunction(() => !document.querySelector('#fbBack'));
  const t = await page.evaluate(() => window.__threads.find(x => x.id === 3));
  check(t.replies.length === 2 && t.replies[1].body === 'iPhone 15, in Safari.' && !t.replies[1].owner && t.done_at === null, `the write-back is saved and reopens it for the owner (${JSON.stringify(t)})`);
  check((await page.innerText('#feedback')).includes('iPhone 15, in Safari.'), 'the write-back shows in the thread');
  check(await page.isVisible('#fbMessage'), 'they can still send something new below');
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  check(wide <= 390, `no sideways scrolling on a phone (${wide}px)`);
  await shoot(page, 'reply-thread');
  await ctx.close();
}

// ---- member feedback, then the admin's stats dashboard shows it ----
{
  const { ctx, page } = await open(memberUrl);
  // Members reach it from the settings sheet (guests used the footer link above).
  await page.click('#gear');
  await page.waitForSelector('#sheet.open #feedbackSettings');
  await page.locator('#feedbackRow').scrollIntoViewIfNeeded();
  await shoot(page, 'feedback-settings');
  await page.click('#feedbackSettings');
  await page.waitForSelector('#feedback.open #fbMessage');
  check(!await page.isVisible('#sheet.open'), 'the feedback form replaces the settings sheet');
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
  // Answering feedback: waiting first, reply in the app, mark done by hand.
  check(text.includes('2 waiting') && await page.$eval('#fbFilter [data-v="waiting"]', b => b.classList.contains('on')), 'feedback opens on what’s waiting');
  check(text.includes('there’s no way to reply') && !text.includes('small blind counts'), 'messages that can’t be answered say so, and answered ones are under All');
  const item = page.locator('#stats .fb-item', { hasText: 'Side pot 2 wording' });
  await item.locator('[data-reply]').click();
  await page.click('#stats .fb-back button[type=submit]');
  check((await page.innerText('#stats')).includes('Type a reply first'), 'an empty reply is stopped');
  await page.fill('#fbReply', 'Good catch. I reworded it.');
  await shoot(page, 'stats-reply');
  await page.click('#stats .fb-back button[type=submit]');
  await page.waitForFunction(() => !document.querySelector('#fbReply'));
  const answered = await page.evaluate(() => window.__threads.find(t => t.message === 'Side pot 2 wording confused me.'));
  check(answered.replies[0]?.body === 'Good catch. I reworded it.' && answered.replies[0].owner && !!answered.done_at, `the reply is saved and marks it done (${JSON.stringify(answered)})`);
  check(!(await page.innerText('#stats')).includes('Side pot 2 wording'), 'an answered message leaves the waiting list');
  await page.click('#stats .fb-item [data-done]');
  await page.waitForFunction(() => document.querySelector('#stats')?.textContent?.includes('all answered'));
  await page.click('#fbFilter [data-v="all"]');
  const all = await page.innerText('#stats');
  check(all.includes('Good catch. I reworded it.') && all.includes('They’ve read your reply.') && all.includes('Reopen'), 'All shows the threads, whether they’ve read the reply, and Reopen');
  check(await page.$$eval('#stats table.days tbody tr', rows => rows.length) === 14, 'fourteen days of activity');
  check(text.includes('1,890'), 'the answers tile counts members and signed-out visitors');
  const today = await page.$$eval('#stats table.days tbody tr.today td', tds => tds.map(td => td.textContent));
  check(text.includes('Hands') && text.includes('520'), 'the hands tile shows');
  check(today[2] === '9' && today[3] === '40' && today[4] === '300', `today's row counts everyone who answered (${today.join(' | ')})`);
  check(text.includes('Visitors') && text.includes('Asked for a code') && text.includes('reddit.com'), 'the visitors section shows the steps and sources');
  check(text.includes('The 120 who didn’t sign up') && text.includes('Left without answering'), 'how far the visitors who left got');
  check(await page.$$eval('#stats .funnel li', li => li.length) === 5, 'five steps from visit to sign-up');
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  check(wide <= 390, `no sideways scrolling on a phone (${wide}px)`);
  await shoot(page, 'stats');
  await ctx.close();
}

// ---- visitor counting: a signed-out browser reports its visit, answers, and sign-in steps ----
{
  // Headless Chrome says so in its user agent, and bots aren't counted; look like a phone instead.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  await ctx.route('**/auth/v1/settings**', r => r.fulfill({ json: { passkeys_enabled: false } }));
  const calls = [];
  await ctx.route('**/rest/v1/rpc/**', r => { calls.push({ fn: r.request().url().split('/rpc/')[1], body: r.request().postDataJSON() }); return r.fulfill({ status: 204, body: '' }); });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  const guestUrl = new URL(base.href); guestUrl.searchParams.set('utm_source', 'Reddit'); guestUrl.searchParams.set('e2e', '');
  await page.goto(guestUrl.href);
  await page.waitForTimeout(300);
  const visit = calls.find(c => c.fn === 'track_visit');
  const id = await page.evaluate(() => localStorage.getItem('fr-visitor'));
  check(!!visit && visit.body.v === id && visit.body.source === 'reddit' && visit.body.landing === new URL(base.href).pathname, `the visit is counted with its source (${JSON.stringify(visit)})`);
  // Answer one question as a guest.
  await page.evaluate(() => { const orig = window.setTimeout; window.setTimeout = (f, ms) => orig(f, Math.min(ms || 0, 4)); });
  await page.click('#welcomeDeal');
  await page.click('#styleBox [data-style="true"]');
  await page.waitForSelector('#ans', { state: 'visible', timeout: 20000 });
  await page.fill('#ans', '1'); await page.press('#ans', 'Enter');
  await page.waitForTimeout(200);
  // The answer's explanation is still up; the header's sign-in link sits behind it.
  await page.evaluate(() => document.querySelector('#signin').click());
  await page.waitForTimeout(200);
  const guest = calls.filter(c => c.fn === 'track_guest');
  check(guest.reduce((t, c) => t + c.body.answers, 0) >= 1 && guest.every(c => c.body.v === id), `guest answers are counted (${JSON.stringify(guest)})`);
  check(guest.some(c => c.body.step === 'signin'), 'opening sign-in is counted');
  await page.evaluate(() => { document.querySelector('#modal')?.classList.remove('open'); });
  await page.fill('#acctEmail', 'new@example.com');
  await page.click('#acctToCode'); // "Email me a code instead" sends it right away
  await page.waitForSelector('#acctCode');
  check(calls.some(c => c.fn === 'track_guest' && c.body.step === 'code'), 'asking for a code is counted');
  // Signing in ties the visits to the account, and the browser isn't counted as a visitor again.
  await page.goto(memberUrl);
  await page.waitForFunction(() => document.querySelector('#acct')?.textContent?.includes('Signed in as'));
  await page.waitForFunction(() => window.__linked !== undefined);
  check(await page.evaluate(() => window.__linked) === id, 'signing in links the visitor to the account');
  await page.click('#gear'); await page.click('#signout');
  await page.waitForFunction(() => document.querySelector('#acct')?.textContent?.includes('Signed out'));
  const before = calls.length;
  await page.goto(base.href);
  await page.waitForTimeout(300);
  check(calls.length === before, 'a browser that has signed in isn’t counted again');
  await ctx.close();
}

await browser.close();
if (bad.length || errors.length) { console.error('FAILED', JSON.stringify({ bad, errors }, null, 2)); process.exit(1); }
console.log('launch e2e ok');
