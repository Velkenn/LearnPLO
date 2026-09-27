// Link previews for shared daily-challenge scores. A shared link looks like
//   https://feltready.com/share?score=18-20&time=342&day=2026-09-27&rank=3-12
// (right-total, seconds, day, rank-players). Plain names on purpose: link cleaners strip short
// parameters that look like tracking (a "t" never made it through). Link previews (iMessage, Reddit, Facebook) don't run
// scripts, so the Worker puts the score into the page's preview tags before sending it.
// Anyone can edit the numbers in a link; it's a brag card, not a record. Real scores are on
// the leaderboard.

export interface Preview { title: string; description: string; image: string; url: string }

const SITE = 'https://feltready.com';
const GENERIC: Preview = {
  title: 'FeltReady daily challenge: the same five PLO hands for every dealer',
  description: 'Call the pots, cut the side pots, read the showdowns. Free, and ranked on today’s leaderboard.',
  image: `${SITE}/og-daily.png`,
  url: `${SITE}/?daily`,
};

const pair = (v: string | null, max: number): [number, number] | null => {
  const m = v && /^(\d{1,4})-(\d{1,4})$/.exec(v);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  return a <= b && b >= 1 && b <= max ? [a, b] : null;
};
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Preview text for a shared score. Anything malformed falls back to the generic challenge card. */
export function sharePreview(q: URLSearchParams): Preview {
  const score = pair(q.get('score'), 60);
  if (!score) return GENERIC;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(q.get('day') || '') ? q.get('day')! : null;
  const secs = /^\d{1,5}$/.test(q.get('time') || '') ? Number(q.get('time')) : null;
  const rank = pair(q.get('rank'), 100000);
  const date = day ? new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null;
  const bits = [secs != null && secs < 36000 ? `in ${clock(secs)}` : '', rank ? `#${rank[0]} of ${rank[1]}` : ''].filter(Boolean).join(' · ');
  return {
    title: `${score[0]}/${score[1]} on the FeltReady daily challenge${date ? `, ${date}` : ''}`,
    description: `${bits ? `${bits}. ` : ''}Same five pot limit Omaha hands for every dealer. Can you beat it?`,
    image: GENERIC.image,
    url: GENERIC.url,
  };
}

const attr = (t: string): string => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Swap the page's title and preview tags for these. */
export function withPreview(html: string, p: Preview): string {
  const meta = (key: string, value: string) => {
    const re = new RegExp(`<meta (property|name)="${key}" content="[^"]*">`);
    html = re.test(html) ? html.replace(re, `<meta $1="${key}" content="${attr(value)}">`) : html.replace('</head>', `<meta property="${key}" content="${attr(value)}">\n</head>`);
  };
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${attr(p.title)}</title>`);
  meta('description', p.description);
  meta('og:title', p.title);
  meta('og:description', p.description);
  meta('og:image', p.image);
  meta('og:url', p.url);
  return html;
}
