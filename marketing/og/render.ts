// Builds the link preview images (public/og.png, public/og-daily.png). The fanned hand uses the
// real-deck card images in public/cards/ (public domain art, see README), the same ones the home
// page shows. Needs Chrome and the Barlow fonts installed.
//   npx tsx marketing/og/render.ts            (CHROME=/path/to/chrome to pick the browser)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logoMark, INK } from '../../src/ui/cardArt.ts';
import type { Card } from '../../src/engine/types.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, 'marketing/og/out');
const CHROME = process.env.CHROME || 'google-chrome';

const HAND: Card[] = [{ r: 14, s: 's' }, { r: 13, s: 'h' }, { r: 12, s: 'd' }, { r: 11, s: 'c' }];
const CODE = (c: Card): string => ({ 14: 'A', 13: 'K', 12: 'Q', 11: 'J' } as Record<number, string>)[c.r] + c.s.toUpperCase();
const FAN = [[-12, 0, 26], [-4, 112, 4], [4, 224, 4], [12, 336, 26]]; // [rotate, left, top]

const page = (title: string, sub: string): string => `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:#154A34;font-family:Barlow,sans-serif}
.felt{position:absolute;inset:16px;border-radius:44px;border:11px solid #3A2518;background:radial-gradient(ellipse at 60% 35%,#2B7757 0%,#1E6045 55%,#154A34 100%);overflow:hidden}
.brand{position:absolute;left:55px;top:52px;display:flex;align-items:center;gap:8px}
.wm{font-weight:700;font-size:58px;letter-spacing:-.045em;line-height:1}.wm b{font-weight:700;color:#D9B048}.wm span{color:#F2E8D0}
.pill{margin-left:26px;border:2px solid rgba(242,232,208,.45);border-radius:10px;padding:4px 12px;font:600 21px Barlow;letter-spacing:.06em;color:#F2E8D0}
.fan{position:absolute;left:617px;top:48px;width:500px;height:260px}
.fan div{position:absolute;width:128px;filter:drop-shadow(0 10px 14px rgba(0,0,0,.38));transform-origin:50% 100%}
.fan img{display:block;width:100%;height:auto}
h1{position:absolute;left:55px;top:272px;margin:0;width:800px;font:700 76px/1.02 'Barlow Condensed';color:#fff;letter-spacing:-.005em}
p{position:absolute;left:55px;top:452px;margin:0;width:800px;font:500 27px/1.45 Barlow;color:#E8DCC0}
</style></head><body><div class="felt">
<div class="brand"><svg width="74" height="74" viewBox="0 0 100 100">${logoMark(50, 50, 100, '#F2E8D0', INK.felt, INK.red)}</svg>
<div class="wm"><span>felt</span><b>ready</b></div><div class="pill">PLO</div></div>
<div class="fan">${HAND.map((c, i) => `<div style="left:${FAN[i][1]}px;top:${FAN[i][2]}px;transform:rotate(${FAN[i][0]}deg)"><img src="file://${join(root, 'public/cards', CODE(c) + '.webp')}" alt=""></div>`).join('')}</div>
<h1>${title}</h1><p>${sub}</p></div></body></html>`;

const IMAGES: [string, string, string][] = [
  ['og', 'Deal pot limit Omaha like you’re in the box', 'Call pot raises, build side pots, and read showdowns on a live table. Free dealer training.'],
  ['og-daily', 'Daily challenge: same five hands for every dealer', 'Call the pots, build the side pots, read the showdowns.<br>Can you beat my score?'],
];

mkdirSync(out, { recursive: true });
for (const [name, title, sub] of IMAGES) {
  const html = join(out, `${name}.html`);
  writeFileSync(html, page(title, sub));
  execFileSync(CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=1200,630',
    `--screenshot=${join(root, 'public', name + '.png')}`, `file://${html}`], { stdio: 'ignore' });
  console.log(`public/${name}.png`);
}
