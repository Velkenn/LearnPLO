// Browser test: plays hands in a real browser and checks every drill grades correctly.
//
//   npm run build
//   npx vite preview --port 4173 &
//   npm run e2e -- http://localhost:4173/
//
// Options: --hands 40  --shots (save screenshots to e2e/out)  --dark
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const url = new URL(args.find(a => a.startsWith('http')) || 'http://localhost:4173/');
url.searchParams.set('e2e', '');
const HANDS = +(args[args.indexOf('--hands') + 1] || 0) || 40;
const SHOTS = args.includes('--shots');
const OUT = new URL('./out/', import.meta.url).pathname;
if (SHOTS) mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: args.includes('--dark') ? 'dark' : 'light' });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(url.href);
// Speed the table up: cap every delay at a few milliseconds.
await page.evaluate(() => { const orig = window.setTimeout; window.setTimeout = (f, ms) => orig(f, Math.min(ms || 0, 4)); });
// Training settings are locked for guests when accounts are on; use the defaults then.
await page.click('#gear');
if (!await page.$eval('#training', f => f.disabled)) {
  await page.click('#speed button[data-v=fast]');
  await page.click('#sideFreq button[data-v=often]');
  await page.click('#potCount button[data-v="2"]');
}
await page.click('#gear');

const tally = { pot: 0, cut: 0, read: 0, chop: 0, missedChop: 0 };
const bad = [];
const shot = async name => { if (SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true }); } };
const shots = new Set();
const once = async name => { if (!shots.has(name)) { shots.add(name); await shot(name); } };

for (let hand = 0; hand < HANDS; hand++) {
  await page.click('[data-deal]'); // the button on the felt
  let done = false;
  for (let tick = 0; tick < 8000 && !done; tick++) {
    await page.waitForTimeout(8);
    if (await page.isVisible('#ans')) {
      const q = await page.evaluate(() => window.__app.S.quiz.q.raiseTo);
      const wrong = hand % 5 === 1;
      await once('pot-question');
      await page.fill('#ans', String(q + (wrong ? 7 : 0))); await page.press('#ans', 'Enter');
      const v = await page.innerText('#modalBox .verdict');
      if (wrong === v.startsWith('Good')) bad.push(['pot', wrong, v]);
      if (wrong) await once('pot-wrong');
      tally.pot++; await page.click('#cont'); continue;
    }
    if (await page.isVisible('#bp')) {
      const amt = await page.evaluate(() => { const cq = window.__app.S.cq; return cq.pots[cq.j].amount; });
      const wrong = hand % 4 === 1;
      await once('cut-question');
      await page.fill('#bp', String(amt + (wrong ? 5 : 0))); await page.press('#bp', 'Enter');
      const v = await page.innerText('#modalBox .verdict');
      if (wrong === v.startsWith('Right')) bad.push(['cut', wrong, v]);
      await once('cut-answer');
      tally.cut++;
      if (await page.$('#cont2')) await page.click('#cont2'); else await page.click('#cutDone');
      continue;
    }
    if (await page.$('#gradeBtn')) {
      const info = await page.evaluate(() => {
        const S = window.__app.S, sd = S.sd, pt = sd.pots[sd.order[sd.step]];
        const cutsOk = S.cuts.every((c, k) => sd.pots[k] && sd.pots[k].amount === c.amount);
        const shown = [...new Set([...document.querySelectorAll('button[data-k=hole]')].map(b => +b.dataset.s))].sort();
        const live = pt.elig.filter(i => !sd.mucked.has(i)).sort();
        return {
          w: pt.winners.map(w => ({ seat: w, hole: sd.rows.find(r => r.i === w).best.hole })),
          board: sd.rows.find(r => r.i === pt.winners[0]).best.board,
          cutsOk, sum: sd.pots.reduce((a, p) => a + p.amount, 0), pot: S.pot, shownOk: JSON.stringify(shown) === JSON.stringify(live),
        };
      });
      if (!info.cutsOk || info.sum !== info.pot || !info.shownOk) bad.push(['pots', info]);
      const chop = info.w.length > 1;
      const pick = chop && hand % 2 === 0 ? info.w.slice(0, 1) : info.w; // sometimes miss the chop on purpose
      for (const b of info.board) await page.click(`button[data-k=board][data-i="${b}"]`);
      for (const w of pick) for (const h of w.hole) await page.click(`button[data-k=hole][data-s="${w.seat}"][data-i="${h}"]`);
      await once('read-select');
      await page.click('#gradeBtn');
      const v = await page.innerText('#panel .verdict');
      const expectOk = pick.length === info.w.length;
      if (expectOk !== (v.startsWith('Ship') || v.startsWith('Chop it.'))) bad.push(['read', chop, v.slice(0, 80)]);
      tally.read++; if (chop) { tally.chop++; if (!expectOk) tally.missedChop++; }
      await once(chop ? 'read-chop' : 'read-result');
      if (await page.$('#nextPot')) { await page.click('#nextPot'); continue; }
      done = true; continue;
    }
    if (await page.$('[data-deal]') && await page.evaluate(() => window.__app.S.mode === 'done')) done = true;
  }
  if (done) await once('hand-done');
  if (!done) { bad.push(['stuck', hand, await page.evaluate(() => ({ m: window.__app.S.mode, c: window.__app.S.caption }))]); break; }
}

// Weak spots sheet (only when accounts are on). Guests get a sign-in prompt; members get their numbers.
if (await page.isVisible('#spotsBtn')) {
  await page.click('#spotsBtn');
  await page.waitForSelector('#spots.open h2');
  await page.waitForFunction(() => !document.querySelector('#spots').textContent.includes('Loading'), null, { timeout: 10000 });
  if (!await page.isVisible('#spotsSignin') && !await page.isVisible('#spots .drill') && !await page.isVisible('#spots .muted')) bad.push(['spots', await page.innerText('#spots')]);
  await shot('weak-spots');
  await page.click('#gear'); // opening settings closes weak spots
  if (await page.isVisible('#spots')) bad.push(['spots', 'still open after opening settings']);
}

await browser.close();
console.log(JSON.stringify({ hands: HANDS, ...tally }));
if (bad.length || errors.length) {
  console.error('FAILED', JSON.stringify({ bad: bad.slice(0, 5), errors: errors.slice(0, 5) }, null, 2));
  process.exit(1);
}
console.log('e2e ok');
