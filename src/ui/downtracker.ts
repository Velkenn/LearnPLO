// Links to DownTracker (nevermissadown.com), the shift and pay tracker for working dealers.
// iPhone and iPad visitors go straight to the App Store; everyone else goes to the website.
// Each spot on the page tags its link so DownTracker's analytics can tell which one brings
// people in: utm_campaign on the website, the campaign token (ct) in App Store Connect.

export const DOWNTRACKER_SITE = 'https://nevermissadown.com/';
export const DOWNTRACKER_APP = 'https://apps.apple.com/us/app/down-tracker/id6770693806';

/** Where on FeltReady the link sits. */
export type DtSpot = 'home' | 'footer' | 'daily' | 'spots';

/** iPhone, iPod, or iPad. iPadOS Safari says it's a Mac, so a Mac with a touch screen counts too. */
export function isIOS(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints ?? 0): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
}

/** The link for one spot, for this device. */
export function downtrackerHref(spot: DtSpot, ios = isIOS()): string {
  if (ios) return `${DOWNTRACKER_APP}?ct=feltready-${spot}&mt=8`;
  const q = new URLSearchParams({ utm_source: 'feltready', utm_medium: 'referral', utm_campaign: spot });
  return `${DOWNTRACKER_SITE}?${q}`;
}

const attrs = (spot: DtSpot): string => `href="${downtrackerHref(spot).replace(/&/g, '&amp;')}" target="_blank" rel="noopener" data-dt="${spot}"`;

/** One line under the footer of every page. */
export function dtFootHTML(spot: DtSpot): string {
  return `<p class="dt-foot muted">Dealing live? Track your downs and true hourly with <a ${attrs(spot)}>DownTracker</a>.</p>`;
}

/**
 * A small card for screens where a dealer has just finished something (results, weak spots):
 * one line of pitch, then DownTracker as it looks in the App Store (icon, name, subtitle, Get).
 * The name and subtitle match the App Store listing; keep them in step if the listing changes.
 */
export function dtCardHTML(spot: DtSpot): string {
  return `<div class="dt-card"><p><b>Dealing for real?</b> DownTracker logs your shifts, downs, and tokes and shows your true hourly. Same maker as FeltReady.</p>
    <a class="dt-app" ${attrs(spot)}><img src="/downtracker-icon.webp" alt="" width="60" height="60"><span class="dt-app-txt"><b>Down Tracker</b><span>Shift Tracker for Dealers</span><small>Free · App Store</small></span><span class="dt-get">${isIOS() ? 'Get' : 'View'}</span></a></div>`;
}

/** Point every static DownTracker link on the page (a[data-dt]) at the right place for this device. */
export function linkDowntracker(root: ParentNode = document): void {
  root.querySelectorAll<HTMLAnchorElement>('a[data-dt]').forEach(a => { a.href = downtrackerHref(a.dataset.dt as DtSpot); });
}
