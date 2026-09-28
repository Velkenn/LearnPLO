// Browser test: the home page, links between the pages, and old links that used to land on the
// root (the daily challenge, sign-in links) going on to pot limit Omaha.
//
//   node e2e/pages.mjs http://localhost:4174/ --shots      (a stub build; see e2e/stub/build.sh)
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
const fresh = async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => errors.push(String(e)));
  return page;
};

// Home: both games listed, each links to its page.
let page = await fresh();
await page.goto(at('/'));
const games = await page.$$eval('.gamelink', as => as.map(a => a.getAttribute('href')));
if (JSON.stringify(games) !== JSON.stringify(['/plo/', '/bombpot/'])) bad.push(['home links', games]);
if (SHOTS) await page.screenshot({ path: `${OUT}home.png`, fullPage: true });
await page.click('.gamelink[href="/bombpot/"]');
await page.waitForSelector('#table .seat');
if (!new URL(page.url()).pathname.startsWith('/bombpot')) bad.push(['bomb link', page.url()]);
const tag = await page.innerText('.brand .game');
if (tag !== 'Bomb pots') bad.push(['bomb tag', tag]);
if (await page.$$eval('.board', b => b.length) !== 2) bad.push(['two boards before the deal']);
if (await page.isVisible('#dailyStrip')) bad.push(['daily strip on the bomb pot page']);
if (SHOTS) await page.screenshot({ path: `${OUT}bomb-intro.png`, fullPage: true });
await page.click('.brand a.home');
await page.waitForSelector('.gamecard');
await page.close();

// A member on the bomb pot page: no daily challenge (it's pot limit Omaha), splits in the scores.
page = await fresh();
await page.goto(at('/bombpot/?stub=member'));
await page.waitForSelector('#spotsBtn:not([hidden])');
if (await page.isVisible('#dailyStrip')) bad.push(['daily strip for a member on the bomb pot page']);
if (!(await page.innerText('#scores')).includes('Splits')) bad.push(['splits score missing']);
await page.click('#gear');
if (!await page.isVisible('#anteSeg') || await page.$('#stakes') || await page.$('#sbFull')) bad.push(['bomb settings rows']);
await page.close();

// Old links: the daily challenge and sign-in links that come back to the root.
page = await fresh();
await page.goto(at('/?daily&stub=member'));
await page.waitForURL(/\/plo\/\?daily/);
await page.waitForSelector('#daily.open');
await page.close();
page = await fresh();
await page.goto(at('/#access_token=x&type=magiclink'));
await page.waitForURL(u => u.pathname === '/plo/');
if (!new URL(page.url()).hash.includes('access_token')) bad.push(['sign-in link lost its token', page.url()]);
await page.close();

// The pot limit Omaha page: its tag, one board, the daily strip for accounts.
page = await fresh();
await page.goto(at('/plo/'));
await page.waitForSelector('#table .seat');
if (await page.innerText('.brand .game') !== 'PLO') bad.push(['plo tag']);
if (await page.$$eval('.board', b => b.length) !== 1) bad.push(['one board on PLO']);
if (!await page.isVisible('#dailyStrip')) bad.push(['daily strip missing on PLO']);
await page.close();

await browser.close();
if (bad.length || errors.length) {
  console.error('FAILED', JSON.stringify({ bad, errors: errors.slice(0, 5) }, null, 2));
  process.exit(1);
}
console.log('pages ok');
