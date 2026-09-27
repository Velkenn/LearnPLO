import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sharePreview, withPreview } from '../worker/share.ts';

const q = (s: string) => new URLSearchParams(s);

test('a shared score becomes the preview title and description', () => {
  const p = sharePreview(q('d=2026-09-27&s=18-20&t=342&r=3-12'));
  assert.equal(p.title, '18/20 on the FeltReady daily challenge, Sep 27');
  assert.equal(p.description, 'in 5:42 · #3 of 12. Same five pot limit Omaha hands for every dealer. Can you beat it?');
  assert.equal(p.image, 'https://feltready.com/og-daily.png');
});

test('odd or missing numbers fall back to the generic card or are left out', () => {
  for (const bad of ['', 's=21-20', 's=abc', 's=5-0', 's=1-99999', 's=<script>']) {
    assert.match(sharePreview(q(bad)).title, /^FeltReady daily challenge/, bad);
  }
  assert.equal(sharePreview(q('s=7-9&t=nope&r=0-x&d=someday')).description, 'Same five pot limit Omaha hands for every dealer. Can you beat it?');
});

test('the real page gets its title and preview tags replaced, and nothing else changes', () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const out = withPreview(page, { title: 'A & "B" <c>', description: 'd', image: 'https://feltready.com/og-daily.png', url: 'https://feltready.com/?daily' });
  assert.match(out, /<title>A &amp; &quot;B&quot; &lt;c&gt;<\/title>/);
  assert.match(out, /<meta property="og:title" content="A &amp; &quot;B&quot; &lt;c&gt;">/);
  assert.match(out, /<meta name="description" content="d">/);
  assert.match(out, /<meta property="og:image" content="https:\/\/feltready.com\/og-daily.png">/);
  assert.match(out, /<meta property="og:url" content="https:\/\/feltready.com\/\?daily">/);
  assert.equal(out.match(/og:title/g)!.length, 1);
  assert.equal(out.replace(/<title>[^<]*<\/title>|<meta [^>]*>/g, ''), page.replace(/<title>[^<]*<\/title>|<meta [^>]*>/g, ''), 'only title and meta tags differ');
});

test('the Worker serves /share with the preview, and passes everything else to the files', async () => {
  const { default: worker } = await import('../worker/index.ts');
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const asked: string[] = [];
  const env = { ASSETS: { fetch: async (input: Request | URL | string) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    asked.push(path);
    return path === '/' ? new Response(page, { headers: { 'content-type': 'text/html' } }) : new Response('Not found', { status: 404 });
  } } };
  const res = await worker.fetch(new Request('https://feltready.com/share?d=2026-09-27&s=18-20&t=342&r=3-12'), env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type')!, /text\/html/);
  const html = await res.text();
  assert.match(html, /<meta property="og:title" content="18\/20 on the FeltReady daily challenge, Sep 27">/);
  assert.match(html, /history\.replaceState\(null, '', '\/\?daily'\)/, 'the page sends visitors on to the challenge');
  const miss = await worker.fetch(new Request('https://feltready.com/nope.png'), env);
  assert.equal(miss.status, 404);
  assert.deepEqual(asked, ['/', '/nope.png']);
});
