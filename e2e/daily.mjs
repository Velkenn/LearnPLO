// Browser test for the daily challenge: sign in (stub), pick a name, deal all five hands with a
// couple of answers wrong on purpose, and check the server's grade and the leaderboard.
// Needs a build with accounts on and a daily server; e2e/stub/build.sh makes one (see there).
//
//   node e2e/daily.mjs "http://localhost:4174/?stub=member" [--shots] [--dark]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const base = args.find(a => a.startsWith('http')) || 'http://localhost:4174/?stub=member';
const url = new URL(base); url.searchParams.set('e2e', '');
const guestUrl = new URL(base); guestUrl.searchParams.delete('stub'); guestUrl.searchParams.set('e2e', '');
const SHOTS = args.includes('--shots');
const OUT = new URL('./out/', import.meta.url).pathname;
if (SHOTS) mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: args.includes('--dark') ? 'dark' : 'light' });
const errors = [], bad = [];
const check = (ok, what) => { if (!ok) bad.push(what); };
const shoot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true }); } };

// ---- guest: can see the leaderboard, can't play ----
{
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(guestUrl.href);
  await page.waitForSelector('#dailyStrip:not([hidden]) #dailyOpen');
  await page.click('#dailyOpen');
  await page.waitForSelector('#daily.open .lboard li');
  check(await page.isVisible('#dailySignin'), 'guest sees a sign-in button');
  check(!await page.isVisible('#dailyStart'), 'guest has no start button');
  await shoot(page, 'daily-guest');
  await page.close();
}

// ---- member: play the whole challenge ----
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(String(e)));
await page.goto(url.href);
await page.evaluate(() => { const orig = window.setTimeout; window.setTimeout = (f, ms) => orig(f, Math.min(ms || 0, 4)); });
await page.waitForSelector('#dailyStrip:not([hidden]) #dailyOpen');
await page.click('#dailyOpen');
await page.waitForSelector('#daily.open #dailyStart');
await shoot(page, 'daily-start');
await page.click('#dailyStart');
await page.waitForSelector('#dailyName');
await page.fill('#dailyName', 'x');
await page.click('#dailyNameForm button');
await page.waitForSelector('#daily .acct-msg.err');
check((await page.innerText('#daily .acct-msg.err')).includes('2 to 24'), 'a one-letter name is refused');
await page.fill('#dailyName', 'Test Dealer');
await page.click('#dailyNameForm button');
await page.waitForFunction(() => window.__app.challenge && window.__app.S);
check(!await page.isVisible('#daily'), 'the sheet closes when the challenge starts');

let asked = 0, wrong = 0, lockedChecked = false;
for (let hand = 0; hand < 5; hand++) {
  if (hand > 0) {
    const label = await page.innerText('[data-deal]');
    check(label.includes(`${hand + 1} of 5`), `deal button says hand ${hand + 1} of 5 (got "${label}")`);
    await page.click('[data-deal]');
  }
  check((await page.innerText('#dailyStrip')).includes(`Hand ${hand + 1} of 5`), `strip shows hand ${hand + 1}`);
  let done = false;
  for (let tick = 0; tick < 8000 && !done; tick++) {
    await page.waitForTimeout(8);
    if (await page.isVisible('#ans')) {
      const q = await page.evaluate(() => window.__app.S.quiz.q.raiseTo);
      const miss = asked === 0; // the first pot call is wrong on purpose
      if (!lockedChecked) {
        lockedChecked = true;
        await page.click('#peek'); await page.click('#gear');
        check(await page.$eval('#training', f => f.disabled), 'training settings are locked during the challenge');
        check((await page.innerText('#lockmsg')).includes('same settings'), 'lock message explains why');
        await shoot(page, 'daily-playing');
        await page.click('#gear'); await page.click('#fab');
      }
      await page.fill('#ans', String(q + (miss ? 5 : 0))); await page.press('#ans', 'Enter');
      asked++; if (miss) wrong++;
      await page.click('#cont'); continue;
    }
    if (await page.isVisible('#bp')) {
      const amt = await page.evaluate(() => { const cq = window.__app.S.cq; return cq.pots[cq.j].amount; });
      await page.fill('#bp', String(amt)); await page.press('#bp', 'Enter');
      asked++;
      if (await page.$('#cont2')) await page.click('#cont2'); else await page.click('#cutDone');
      continue;
    }
    if (await page.$('#gradeBtn')) {
      const info = await page.evaluate(() => {
        const S = window.__app.S, sd = S.sd, pt = sd.pots[sd.order[sd.step]];
        return { w: pt.winners.map(w => ({ seat: w, hole: sd.rows.find(r => r.i === w).best.hole })), board: sd.rows.find(r => r.i === pt.winners[0]).best.board };
      });
      // The last read of the challenge is wrong on purpose: pick someone else if there is one.
      const lastHand = hand === 4;
      const others = lastHand ? await page.evaluate(() => { const S = window.__app.S, sd = S.sd, pt = sd.pots[sd.order[sd.step]]; return pt.elig.filter(i => !sd.mucked.has(i) && !pt.winners.includes(i)); }) : [];
      const pickWrong = lastHand && others.length > 0 && !(await page.$('#nextPot'));
      for (const b of info.board) await page.click(`button[data-k=board][data-i="${b}"]`);
      if (pickWrong) for (const h of [0, 1]) await page.click(`button[data-k=hole][data-s="${others[0]}"][data-i="${h}"]`);
      else for (const w of info.w) for (const h of w.hole) await page.click(`button[data-k=hole][data-s="${w.seat}"][data-i="${h}"]`);
      await page.click('#gradeBtn');
      asked++;
      const v = await page.innerText('#panel .verdict');
      const ok = v.startsWith('Ship') || v.startsWith('Chop it.');
      if (!ok) wrong++;
      if (await page.$('#nextPot')) { await page.click('#nextPot'); continue; }
      done = true; continue;
    }
    if (await page.evaluate(() => window.__app.S.mode === 'done')) done = true;
  }
  check(done, `hand ${hand + 1} finished`);
  if (!done) break;
}

// After the fifth hand the answers go to the server; the button then opens the results.
await page.waitForFunction(() => window.__app.challenge?.submitted, null, { timeout: 10000 });
check((await page.innerText('[data-deal]')).includes('See your results'), 'last deal button opens the results');
check((await page.innerText('#dailyStrip')).includes('Today'), 'strip shows today’s result');
await page.click('[data-deal]');
await page.waitForSelector('#daily.open .dresult');
const result = await page.innerText('#daily .dresult b');
const graded = await page.evaluate(() => window.__graded);
check(result === `${asked - wrong} of ${asked} right`, `result "${result}" should be ${asked - wrong} of ${asked}`);
check(graded.right === asked - wrong && graded.total === asked, `server graded ${graded.right}/${graded.total}, table ${asked - wrong}/${asked}`);
check(await page.isVisible('#daily .lboard li.me'), 'your row is on the leaderboard');
check(!await page.evaluate(() => window.__app.challenge), 'challenge over');
check(!await page.$eval('#training', f => f.disabled), 'your settings are back');
const logged = await page.evaluate(() => window.__inserted.filter(r => r.detail?.daily).length);
check(logged === asked, `every challenge answer logged with the day (${logged} of ${asked})`);
await page.click('#dailyShare');
const shared = await page.evaluate(() => window.__shared || '');
check(/^https:\/\/feltready\.com\/share\?score=\d+-\d+&time=\d+&day=\d{4}-\d{2}-\d{2}&rank=\d+-\d+$/.test(shared), `share link carries the score (${shared})`);
await shoot(page, 'daily-results');

// A reload keeps the result; starting again doesn't replay.
await page.reload();
await page.waitForSelector('#dailyStrip:not([hidden]) #dailyOpen');
await page.waitForFunction(() => document.querySelector('#dailyStrip').innerText.includes('Today'));
await page.click('#dailyOpen');
await page.waitForSelector('#daily.open .dresult');
check(!await page.isVisible('#dailyStart'), 'no second run today');

await browser.close();
console.log(JSON.stringify({ asked, wrong, graded: graded && `${graded.right}/${graded.total}` }));
if (bad.length || errors.length) { console.error('FAILED', JSON.stringify({ bad, errors }, null, 2)); process.exit(1); }
console.log('daily e2e ok');
