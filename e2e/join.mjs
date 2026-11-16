// Browser test: joining a class (/join/ and /join/<code>) with the stand-in school from
// e2e/stub/supabase.js, then seeing and leaving the class from a game page's account box.
//
//   node e2e/join.mjs http://localhost:4174/ --shots      (a stub build; see e2e/stub/build.sh)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const base = new URL(args.find(a => a.startsWith('http')) || 'http://localhost:4174/');
const SHOTS = args.includes('--shots');
const OUT = new URL('./out/', import.meta.url).pathname;
if (SHOTS) mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const bad = [], errors = [];
const at = path => new URL(path, base).href;
const check = (ok, what, got) => { if (!ok) bad.push(got === undefined ? [what] : [what, got]); };
const fresh = async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => errors.push(String(e)));
  return page;
};
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${OUT}join-${name}.png`, fullPage: true }); };
const fitsPhone = async (page, where) => {
  const w = await page.evaluate(() => document.scrollingElement.scrollWidth);
  check(w <= 390, `${where}: wider than the phone`, w);
};
const text = (page, sel) => page.innerText(sel);
/** Wait for an element; if it never shows, say what the page showed instead. */
async function wait(page, sel) {
  try { await page.waitForSelector(sel, { timeout: 15000 }); }
  catch (e) { throw new Error(`${sel} never showed at ${page.url()}. The page said: ${(await page.innerText('body').catch(() => '?')).replace(/\s+/g, ' ').slice(0, 400)}`); }
}
const path = page => new URL(page.url()).pathname;

// The home page links to it.
let page = await fresh();
await page.goto(at('/'));
check((await page.getAttribute('.home-join a', 'href')) === '/join/', 'home page links to the join page');
await page.close();

// No code yet, signed out: type one in, then sign in.
page = await fresh();
await page.goto(at('/join/'));
await wait(page, '#codeForm');
await page.fill('#codeInput', 'abc');
await page.click('#codeForm button[type=submit]');
check(path(page) === '/join/', 'a short code is refused', path(page));
await page.fill('#codeInput', 'k7q2-pmxa');
await page.click('#codeForm button[type=submit]');
await wait(page, '#siEmailForm');
check(path(page) === '/join/K7Q2PMXA', 'the code goes into the address', path(page));
check((await text(page, '.join')).includes('K7Q2-PMXA'), 'signed out, the page shows the code');
await fitsPhone(page, 'sign in');
await shot(page, 'signin');
await page.close();

// Signed in with a good code: what the school sees, a name, join.
page = await fresh();
await page.goto(at('/join/K7Q2PMXA?stub=member'));
await wait(page, '#joinForm');
check((await text(page, '.join h2')) === 'Join December PLO', 'class name', await text(page, '.join h2'));
check((await text(page, '.join-org')).includes('Texas Gaming Institute'), 'school name');
const share = await text(page, '.join-share');
check(share.includes('Your email address') && share.includes('before you joined') && share.includes('leave anytime'), 'says what the school sees and doesn’t', share);
await fitsPhone(page, 'consent');
await shot(page, 'consent');
await page.click('#joinForm button[type=submit]');
await wait(page, '#joinForm .acct-msg.err');
check((await text(page, '#joinForm .acct-msg.err')).includes('name'), 'a name is required');
await page.fill('#joinName', 'Dana <Lee>');
await page.click('#joinForm button[type=submit]');
await wait(page, '.join-done');
check((await text(page, '.join-done b')) === 'You’re in.', 'joined');
const games = await page.$$eval('.join-games a', as => as.map(a => [a.getAttribute('href'), a.textContent]));
check(JSON.stringify(games) === JSON.stringify([['/plo/', 'Deal pot limit Omaha'], ['/bombpot/', 'Deal bomb pots']]), 'links to the games', games);
check(await page.evaluate(() => window.__joined) === 1, 'joined once');
await shot(page, 'done');
await page.reload();
await wait(page, '.join-done');
check((await text(page, '.join-done b')).includes('already in'), 'coming back says they’re already in');

// The game page's account box lists the class, and leaving asks first.
await page.goto(at('/plo/?stub=member'));
await page.click('#gear');
await wait(page, '.acct-classes');
const cls = await text(page, '.acct-classes');
check(cls.includes('December PLO') && cls.includes('Texas Gaming Institute') && cls.includes('Dana <Lee>'), 'account box lists the class', cls);
await page.click('[data-leave]');
await wait(page, '.acct-classes .confirm');
await shot(page, 'leave');
await page.click('[data-leave-yes]');
await wait(page, '.acct-msg');
check((await text(page, '.acct-msg')).includes('You left December PLO'), 'left the class');
check(!(await page.$('.acct-classes')), 'no classes listed after leaving');
await page.close();

// A closed class.
page = await fresh();
await page.goto(at('/join/HC4RW9TB?stub=member'));
await wait(page, '.join-err');
check((await text(page, '.join h2')) === 'Weekend bootcamp' && (await text(page, '.join-err')).includes('isn’t taking new students'), 'closed class message');
check(!(await page.$('#joinForm')), 'no join form for a closed class');
await page.close();

// A wrong code, then the right one; and too many wrong ones.
page = await fresh();
await page.goto(at('/join/ZZZZZZZZ?stub=member'));
await wait(page, '.join-err');
check((await text(page, '.join-err')).includes('doesn’t match a class'), 'wrong code message');
await shot(page, 'wrong');
await page.fill('#codeInput', 'K7Q2PMXA');
await page.click('#codeForm button[type=submit]');
await wait(page, '#joinForm');
check(path(page) === '/join/K7Q2PMXA', 'the new code goes into the address');
for (let i = 0; i < 10; i++) {
  await page.goto(at(`/join/WRONG${String(i).padStart(3, '0')}?stub=member`));
  await wait(page, '.join-err');
}
check((await text(page, '.join-err')).includes('Wait an hour'), 'too many wrong codes', await text(page, '.join-err'));
check(!(await page.$('#codeForm')), 'no code box while locked out');
await page.close();

// A full school.
page = await fresh();
await page.goto(at('/join/K7Q2PMXA?stub=member&seats=3'));
await wait(page, '#joinForm');
await page.fill('#joinName', 'Dana');
await page.click('#joinForm button[type=submit]');
await wait(page, '#joinForm .acct-msg.err');
check((await text(page, '#joinForm .acct-msg.err')).includes('no open seats'), 'full school message');
await page.close();

await browser.close();
if (bad.length || errors.length) {
  console.error('FAILED', JSON.stringify({ bad, errors: errors.slice(0, 5) }, null, 2));
  process.exit(1);
}
console.log('join ok');
