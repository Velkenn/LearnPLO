// Which browser the page is running in, where it matters for staying signed in.

/**
 * Apps like the Google app, Facebook, and Instagram open links in a browser of their own. It keeps
 * its storage apart from Safari or Chrome and often drops it, so a sign-in there doesn't last.
 * Returns the app's name, or null in a regular browser. (Some apps, like Reddit on iPhone, use a
 * view that can't be told apart from Safari; signing in with the emailed code covers those.)
 */
export function inAppBrowser(ua: string): string | null {
  if (/\bGSA\/\d/.test(ua)) return 'the Google app';
  if (/FBAN|FBAV|FB_IAB|FBIOS/.test(ua)) return 'Facebook';
  if (/Instagram/.test(ua)) return 'Instagram';
  if (/Snapchat/.test(ua)) return 'Snapchat';
  if (/LinkedInApp/.test(ua)) return 'LinkedIn';
  if (/musical_ly|BytedanceWebview|TikTok/i.test(ua)) return 'TikTok';
  if (/\bLine\/\d/.test(ua)) return 'LINE';
  if (/\bTwitter/.test(ua)) return 'X';
  return null;
}

/** "Safari" on iPhone and iPad, "Chrome" elsewhere: what to open the page in instead. */
export const regularBrowser = (ua: string): string => /iPhone|iPad|iPod/.test(ua) ? 'Safari' : 'Chrome';
