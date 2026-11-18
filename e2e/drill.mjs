// Browser test: plays hands in a real browser and checks every drill grades correctly.
// Works on either game's page: /plo/ or /bombpot/ (splits and two-board reads).
//
//   npm run build
//   npx vite preview --port 4173 &
//   npm run e2e -- http://localhost:4173/plo/
//
// Options: --hands 40  --seats 9  --shots (save screenshots to e2e/out)  --dark
//          --rounded (answer the first deal's question with rounded pot)  --stakes 1/3
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const url = new URL(args.find(a => a.startsWith('http')) || 'http://localhost:4173/plo/');
const BOMB = url.pathname.includes('bombpot');
url.searchParams.set('e2e', '');
const HANDS = +(args[args.indexOf('--hands') + 1] || 0) || 40;
const SEATS = +(args[args.indexOf('--seats') + 1] || 0) || 6;
const SHOTS = args.includes('--shots');
const ROUNDED = args.includes('--rounded');
const STAKES = args.includes('--stakes') ? args[args.indexOf('--stakes') + 1] : null;
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
  await page.click(`#seatsSeg button[data-v="${SEATS}"]`);
  if (BOMB) await page.click(`#anteSeg button[data-v="${SEATS === 9 ? 25 : 10}"]`);
  if (STAKES) await page.selectOption('#stakes', STAKES);
}
await page.click('#gear');

const tally = { pot: 0, cut: 0, read: 0, chop: 0, missedChop: 0, split: 0, bottom: 0 };
let handsDone = 0;
const bad = [];
const shot = async name => { if (SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true }); } };
const shots = new Set();
const once = async name => { if (!shots.has(name)) { shots.add(name); await shot(`${BOMB ? 'bomb-' : ''}${name}${SEATS === 6 ? '' : `-${SEATS}`}${ROUNDED ? '-rounded' : ''}`); } };
const locked = await page.$eval('#training', f => f.disabled);

// A question pins the page where it was, so the phone keyboard can't scroll it, and closing the
// question puts it back: no scrolling back up to the table. Checked on the first of each kind.
let pinnedAt = 0; // where the page was when the question came up
let pinBack = 0; // times the page was seen back in its spot after a question
const pinChecked = new Set();
async function checkPinned(kind) {
  if (pinChecked.has(kind)) return false;
  const st = await page.evaluate(() => {
    const before = window.scrollY;
    window.scrollTo(0, before + 300); // what the keyboard does on a phone
    return { position: document.body.style.position, top: document.body.style.top, moved: window.scrollY - before };
  });
  pinnedAt = -parseInt(st.top || '0', 10);
  if (st.position !== 'fixed' || st.moved !== 0) { bad.push(['pinned', kind, st]); return false; }
  // At test speed the question can come up before the page was scrolled: check the next one.
  if (!(pinnedAt > 50 && pinnedAt <= 150)) return false;
  return true;
}
async function checkUnpinned(kind) {
  pinChecked.add(kind);
  const st = await page.evaluate(() => ({ y: window.scrollY, position: document.body.style.position, top: document.body.style.top }));
  // Back where it was; or, at test speed, the next question is already up, holding the same spot.
  const back = st.position === '' && st.y === pinnedAt;
  const heldAgain = st.position === 'fixed' && st.top === `-${pinnedAt}px`;
  if (!back && !heldAgain) bad.push(['unpinned', kind, pinnedAt, st]);
  if (back) pinBack++;
}

for (let hand = 0; hand < HANDS; hand++) {
  await page.click('[data-deal]'); // the button on the felt
  // The first pot limit Omaha deal asks how the room counts the pot; bomb pots never ask.
  if (hand === 0 && !BOMB) {
    await page.waitForSelector('#styleAsk.open', { timeout: 5000 }).catch(() => bad.push(['pot style', 'first deal didn’t ask']));
    await page.click(`#styleBox [data-style="${ROUNDED ? 'rounded' : 'true'}"]`);
  }
  if (hand === 0 && BOMB && await page.isVisible('#styleAsk.open')) bad.push(['pot style', 'bomb pots asked']);
  if (hand === 1 && await page.isVisible('#styleAsk.open')) bad.push(['pot style', 'asked twice']);
  await page.evaluate(() => window.scrollTo(0, 150)); // as if they'd scrolled down a little
  const n = await page.evaluate(() => window.__app.S.players.length);
  if (n !== (locked ? 6 : SEATS)) bad.push(['seats', n]);
  let done = false;
  for (let tick = 0; tick < 8000 && !done; tick++) {
    await page.waitForTimeout(8);
    if (await page.isVisible('#ans')) {
      const q = await page.evaluate(() => window.__app.S.quiz.q.raiseTo);
      const wrong = hand % 5 === 1;
      if (ROUNDED && q % 5) bad.push(['rounded', 'pot not a $5 amount', q]);
      const pin = await checkPinned('pot');
      await once('pot-question');
      await page.fill('#ans', String(q + (wrong ? 7 : 0))); await page.press('#ans', 'Enter');
      const v = await page.innerText('#modalBox .verdict');
      if (wrong === v.startsWith('Good')) bad.push(['pot', wrong, v]);
      const steps = await page.innerText('#modalBox .steps');
      const box = await page.innerText('#modalBox');
      if (/\$-/.test(box)) bad.push(['pot', 'negative amount in the explanation', box]);
      if (ROUNDED !== steps.includes('Rounded pot')) bad.push(['rounded', 'explanation', ROUNDED, steps]);
      if (wrong) await once('pot-wrong');
      tally.pot++; await page.click('#cont');
      if (pin) await checkUnpinned('pot');
      continue;
    }
    if (await page.isVisible('#bp')) {
      const amt = await page.evaluate(() => { const cq = window.__app.S.cq; return cq.pots[cq.j].round; });
      const wrong = hand % 4 === 1;
      const pin = await checkPinned('cut');
      await once('cut-question');
      await page.fill('#bp', String(amt + (wrong ? 5 : 0))); await page.press('#bp', 'Enter');
      const v = await page.innerText('#modalBox .verdict');
      if (wrong === v.startsWith('Right')) bad.push(['cut', wrong, v]);
      await once('cut-answer');
      tally.cut++;
      if (await page.$('#cont2')) await page.click('#cont2');
      else { await page.click('#cutDone'); if (pin) await checkUnpinned('cut'); }
      continue;
    }
    if (await page.isVisible('#sp')) {
      // Bomb pots: split the pot between the boards. The top board gets the odd chip.
      const amt = await page.evaluate(() => { const sd = window.__app.S.sd; return sd.pots[sd.order[sd.step]].amount; });
      const top = Math.ceil(amt / 2), wrong = hand % 4 === 2;
      await once('split-question');
      await page.fill('#sp', String(wrong ? (amt % 2 ? Math.floor(amt / 2) : top + 5) : top)); await page.press('#sp', 'Enter');
      const v = await page.innerText('#panel .verdict');
      if (wrong === v.startsWith('Right')) bad.push(['split', wrong, amt, v]);
      await once(wrong ? 'split-wrong' : 'split-answer');
      tally.split++; await page.click('#nextPart'); continue;
    }
    if (await page.$('#gradeBtn')) {
      const info = await page.evaluate(() => {
        const S = window.__app.S, sd = S.sd, pt = sd.pots[sd.order[sd.step]];
        // Double board: read the current board's half, with each hand's best on that board.
        const b = S.bottom ? sd.part : null, half = b == null ? pt : pt.halves[b];
        const best = r => b === 1 ? r.best2 : r.best;
        const cutsOk = S.cuts.every((c, k) => sd.pots[k] && sd.pots[k].amount === c.amount);
        const shown = [...new Set([...document.querySelectorAll('button[data-k=hole]')].map(b => +b.dataset.s))].sort();
        const live = pt.elig.filter(i => !(b == null ? sd.mucked : sd.gone[b]).has(i)).sort();
        return {
          b, w: half.winners.map(w => ({ seat: w, hole: best(sd.rows.find(r => r.i === w)).hole })),
          board: best(sd.rows.find(r => r.i === half.winners[0])).board,
          cutsOk, sum: sd.pots.reduce((a, p) => a + p.amount, 0), pot: S.pot, shownOk: JSON.stringify(shown) === JSON.stringify(live),
          halvesOk: !S.bottom || sd.pots.every(p => p.halves[0].amount + p.halves[1].amount === p.amount && p.halves[0].amount - p.halves[1].amount === p.amount % 2),
        };
      });
      if (!info.halvesOk) bad.push(['halves', info]);
      if (info.b === 1) tally.bottom++;
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
      await once(chop ? 'read-chop' : info.b === 1 ? 'read-bottom' : 'read-result');
      if (await page.$('#nextPot')) { await page.click('#nextPot'); continue; }
      if (await page.$('#nextPart')) { await page.click('#nextPart'); continue; }
      done = true; continue;
    }
    if (await page.$('[data-deal]') && await page.evaluate(() => window.__app.S.mode === 'done')) done = true;
  }
  if (done) { handsDone++; await once('hand-done'); }
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

// Members' hands are counted for the stats dashboard, once each, under the page's game.
if (url.searchParams.get('stub') === 'member') {
  await page.waitForTimeout(300);
  const counted = await page.evaluate(() => window.__hands ?? {});
  const g = BOMB ? 'bomb' : 'plo';
  if (counted[g] !== handsDone || Object.keys(counted).length !== 1) bad.push(['hands counted', { handsDone, counted }]);
}

if (BOMB && HANDS >= 6 && (!tally.split || !tally.bottom)) bad.push(['bomb', 'no splits or bottom-board reads', tally]);
if (tally.pot && !pinChecked.has('pot')) bad.push(['pinned', 'never checked a pot question']);
if (pinChecked.size && !pinBack) bad.push(['pinned', 'never saw the page go back after a question']);

await browser.close();
console.log(JSON.stringify({ hands: HANDS, ...tally }));
if (bad.length || errors.length) {
  console.error('FAILED', JSON.stringify({ bad: bad.slice(0, 5), errors: errors.slice(0, 5) }, null, 2));
  process.exit(1);
}
console.log('e2e ok');
