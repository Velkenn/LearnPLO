// Builds the promo page and renders it frame by frame with Playwright (1080×1920, 30 fps).
//
//   node render.mjs                     every frame → out/frames/00000.png…, plus out/frames/events.json
//   node render.mjs 3.2,17.5,30         just those moments → out/keys/t03.20.png… (for a quick look)
//   FROM=480 TO=745 node render.mjs     only re-render frames 480–745 (after changing one scene)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname, ROOT = join(HERE, '../..');
const OUT = join(HERE, 'out'), PAGE = join(OUT, 'page');
mkdirSync(PAGE, { recursive: true });

// esbuild comes with vite; where vite isn't installed, use the copy that tsx bundles.
const req = createRequire(join(ROOT, 'package.json'));
let esbuild;
try { esbuild = req('esbuild'); } catch { esbuild = createRequire(req.resolve('tsx'))('esbuild'); }
await esbuild.build({ entryPoints: [join(HERE, 'main.ts')], bundle: true, format: 'esm', outfile: join(PAGE, 'main.js'), logLevel: 'warning' });
await esbuild.build({ entryPoints: [join(ROOT, 'src/styles/main.css')], bundle: true, outfile: join(PAGE, 'app.css'), logLevel: 'warning' });
cpSync(join(HERE, 'index.html'), join(PAGE, 'index.html'));
cpSync(join(HERE, 'app-pot.jpg'), join(PAGE, 'app-pot.jpg'));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg' };
const server = await new Promise(resolve => {
  const s = createServer((q, res) => {
    const p = join(PAGE, new URL(q.url, 'http://x').pathname);
    if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
  }).listen(0, '127.0.0.1', () => resolve(s));
});

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
await page.waitForFunction(() => window.seek && document.fonts.status === 'loaded');
await page.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
const V = await page.evaluate(() => window.VIDEO);

const picked = process.argv[2] ? process.argv[2].split(',').map(Number) : null;
const dir = join(OUT, picked ? 'keys' : 'frames'); mkdirSync(dir, { recursive: true });
const times = picked || Array.from({ length: Math.round(V.DURATION * V.FPS) }, (_, k) => k / V.FPS);
const FROM = +(process.env.FROM || 0), TO = +(process.env.TO || 1e9);
let done = 0;
for (const [k, t] of times.entries()) {
  if (!picked && (k < FROM || k > TO)) continue;
  await page.evaluate(t => window.seek(t), t);
  await page.screenshot({ path: join(dir, picked ? `t${t.toFixed(2).padStart(5, '0')}.png` : `${String(k).padStart(5, '0')}.png`) });
  if (++done % 100 === 0) console.log(`${done} frames`);
}
if (!picked) writeFileSync(join(dir, 'events.json'), JSON.stringify(V));
await b.close(); server.close();
if (errs.length) { console.error(errs); process.exit(1); }
console.log(`rendered ${done} frame${done === 1 ? '' : 's'} into ${dir}`);
