// The Cloudflare Worker for feltready.com. Almost everything is a static file from dist/,
// served before this code runs. Only paths with no file reach here: /share, which returns the
// app page with a shared score in its link preview (see share.ts), and real 404s.
import { sharePreview, withPreview } from './share.ts';

interface Env { ASSETS: { fetch(input: Request | URL | string): Promise<Response> } }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/share') {
      const page = await env.ASSETS.fetch(new URL('/', url));
      if (!page.ok) return page;
      const html = withPreview(await page.text(), sharePreview(url.searchParams));
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
    }
    return env.ASSETS.fetch(request);
  },
};
