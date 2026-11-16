// Browser test: the instructor view (/teach/), with the stand-in school from e2e/stub/supabase.js.
// Signed out, signed in with no school, and an owner working through a class: the code, the
// students, sorting, a new code, closing, renaming, removing a student, and adding a class.
// Also the link to it from a game page's account box.
//
//   node e2e/teach.mjs http://localhost:4174/ --shots      (a stub build; see e2e/stub/build.sh)
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
  // Record what "Copy join link" copies.
  await page.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.__copied.push(t); } }, configurable: true });
  });
  return page;
};
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${OUT}teach-${name}.png`, fullPage: true }); };
const fitsPhone = async (page, where) => {
  const w = await page.evaluate(() => document.scrollingElement.scrollWidth);
  check(w <= 390, `${where}: wider than the phone`, w);
};
const text = (page, sel) => page.innerText(sel);

// Signed out: the sign-in box.
let page = await fresh();
await page.goto(at('/teach/'));
await page.waitForSelector('#tEmailForm');
check(!(await page.$('#tSignOut')), 'no sign-out button when signed out');
await page.fill('#tEmail', 'not-an-email');
await page.click('#tEmailForm button[type=submit]');
check((await text(page, '.teach-signin')).includes('Enter the email address'), 'bad email message');
await page.fill('#tEmail', 'teacher@example.com');
await page.click('#tEmailForm button[type=submit]');
await page.waitForSelector('#tCodeForm');
check((await text(page, '.teach-signin')).includes('teacher@example.com'), 'code step names the email');
await shot(page, 'signin');
await page.close();

// Signed in, but not at any school.
page = await fresh();
await page.goto(at('/teach/?stub=member&teach=none'));
await page.waitForSelector('.teach-empty');
check((await text(page, '.teach-empty')).includes('dealer@example.com'), 'no-school page names the account');
await shot(page, 'none');
await page.close();

// An owner: the school and its classes.
page = await fresh();
await page.goto(at('/teach/?stub=member'));
await page.waitForSelector('.org');
check((await text(page, '.org h2')) === 'Texas Gaming Institute', 'school name');
check((await text(page, '.org-sub')).includes('3 of 20 seats used'), 'seats used', await text(page, '.org-sub'));
const cards = await page.$$eval('.cls', as => as.map(a => a.innerText.replace(/\s+/g, ' ').trim()));
check(cards.length === 2 && cards[0].includes('December PLO') && cards[0].includes('K7Q2-PMXA') && cards[0].includes('3 students'), 'first class card', cards[0]);
check(cards[1]?.includes('Closed'), 'closed class is marked', cards[1]);
await fitsPhone(page, 'classes');
await shot(page, 'classes');

// One class.
await page.click('.cls[href="#class=class-1"]');
await page.waitForSelector('.code-box');
check((await text(page, '#joinCode')) === 'K7Q2-PMXA', 'join code shown with a dash');
check((await text(page, '#joinLink')).endsWith('/join/K7Q2PMXA'), 'join link shown', await text(page, '#joinLink'));
const tiles = await page.$$eval('.tile', ts => ts.map(t => t.innerText.replace(/\s+/g, ' ').trim()));
check(JSON.stringify(tiles) === JSON.stringify(['Students 3', 'Active this week 2', 'Answers this week 50', 'Right since joining 79%']), 'class tiles', tiles);
let names = await page.$$eval('.stu-name', ns => ns.map(n => n.textContent));
check(JSON.stringify(names) === JSON.stringify(['Lee <Dealer>', 'Pat Nguyen', 'Sam Ortiz']), 'students by name, name shown as text', names);
check(!(await page.$('.stu-name dealer')), 'a name is never read as markup');
check((await page.$eval('.stu-row[data-stu="u-pat"] .stu-acc', e => e.className)).includes('weak'), 'a struggling student shows in red');
check((await text(page, '.stu-row[data-stu="u-lee"] .stu-acc')) === 'No answers yet', 'a new student has no answers yet');
check((await text(page, '.left-list summary')).includes('Left the class (1)'), 'students who left are listed apart');
await page.click('[data-sort="accuracy"]');
names = await page.$$eval('.stu-name', ns => ns.map(n => n.textContent));
check(JSON.stringify(names) === JSON.stringify(['Pat Nguyen', 'Sam Ortiz', 'Lee <Dealer>']), 'lowest first, no answers last', names);
await page.click('.stu-row[data-stu="u-sam"]');
await page.waitForSelector('.stu.open .stu-more');
const more = await text(page, '.stu.open .stu-more');
check(more.includes('Pot limit Omaha') && more.includes('Double board bomb pots'), 'drills are grouped by game', more);
check(more.includes('Left out dead money') && more.includes('Gave the odd chip to the bottom board'), 'mistakes use the dealer labels', more);
check(more.includes('55/60') && more.includes('6.2s'), 'per-drill counts and times', more);
await fitsPhone(page, 'class');
await shot(page, 'class');

// Copy the join link.
await page.click('#copyLink');
await page.waitForSelector('.teach-flash');
const copied = await page.evaluate(() => window.__copied);
check(copied.length === 1 && copied[0] === at('/join/K7Q2PMXA'), 'copied the join link', copied);

// A new code, after confirming.
await page.click('#askCode');
await page.waitForSelector('.code-box .confirm');
await shot(page, 'new-code');
await page.click('#newCode');
await page.waitForFunction(() => document.querySelector('#joinCode')?.textContent === 'P3ND-T8WX');
check(!(await page.$('.code-box .confirm')), 'confirm goes away after the new code');

// Close and reopen.
await page.click('#toggleOpen');
await page.waitForFunction(() => document.querySelector('#toggleOpen')?.textContent === 'Reopen');
check((await text(page, '.cls-open')).includes('Closed'), 'closed class says so');
await page.click('#toggleOpen');
await page.waitForFunction(() => document.querySelector('#toggleOpen')?.textContent === 'Close class');

// Rename.
await page.click('#renameOpen');
await page.fill('#renameInput', 'December PLO, nights');
await page.click('#renameForm button[type=submit]');
await page.waitForFunction(() => document.querySelector('.cls-title h2')?.textContent === 'December PLO, nights');

// Remove a student, after confirming.
await page.click('.stu-row[data-stu="u-pat"]');
await page.click('[data-ask-remove="u-pat"]');
await page.waitForSelector('.stu .confirm');
check((await text(page, '.stu .confirm')).includes('Remove Pat Nguyen'), 'remove asks first');
await page.click('[data-remove="u-pat"]');
await page.waitForFunction(() => document.querySelector('.left-list summary')?.textContent.includes('(2)'));
names = await page.$$eval('.stu-name', ns => ns.map(n => n.textContent));
check(!names.includes('Pat Nguyen'), 'removed student is out of the list', names);
check((await text(page, '.tile b')) === '2', 'two students left');
check((await text(page, '.crumb')).includes('2 of 20 seats used'), 'the seat frees up', await text(page, '.crumb'));

// Reload keeps the class open.
await page.reload();
await page.waitForSelector('.code-box');
check((await text(page, '.cls-title h2')) === 'December PLO, nights', 'reload stays on the class');

// Back to the classes, then add one.
await page.click('.crumb a');
await page.waitForSelector('.org');
check((await text(page, '.cls[href="#class=class-1"]')).includes('2 students'), 'class card updated');
await page.fill('.new-class input', 'January bomb pots');
await page.click('.new-class button[type=submit]');
await page.waitForFunction(() => document.querySelector('.cls-title h2')?.textContent === 'January bomb pots');
check((await text(page, '#joinCode')) === 'R2MV-Q7KC', 'new class has its code');
check((await text(page, '.teach')).includes('No students yet'), 'new class has no students');
await page.close();

// A class that isn't the school's.
page = await fresh();
await page.goto(at('/teach/?stub=member#class=class-99'));
await page.waitForSelector('.teach .acct-msg.err');
check((await text(page, '.teach .acct-msg.err')).includes('isn’t one of your school’s'), 'unknown class message');
await page.close();

// The link from a game page's account box: only for instructors.
page = await fresh();
await page.goto(at('/plo/?stub=member'));
await page.click('#gear');
await page.waitForSelector('.acct-teach a');
check((await page.getAttribute('.acct-teach a', 'href')) === '/teach/', 'account box links to the instructor view');
await page.close();
page = await fresh();
await page.goto(at('/plo/?stub=member&teach=none'));
await page.click('#gear');
await page.waitForSelector('#signout');
await page.waitForTimeout(400);
check(!(await page.$('.acct-teach')), 'no instructor link for everyone else');
await page.close();

await browser.close();
if (bad.length || errors.length) {
  console.error('FAILED', JSON.stringify({ bad, errors: errors.slice(0, 5) }, null, 2));
  process.exit(1);
}
console.log('instructor view ok');
