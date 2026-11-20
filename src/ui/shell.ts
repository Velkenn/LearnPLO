// The markup every game page shares: header, scores, sheets, table, panel. Each game's page
// (plo/index.html, bombpot/index.html) has only its own head and <body data-game>; main.ts
// puts this in before anything else runs.
import type { GameId } from '../config.ts';
import { GAMES } from '../config.ts';
import { dtFootHTML } from './downtracker.ts';

const LOGO = `<svg class="logo" viewBox="3 3 94 94" aria-hidden="true"><g transform="rotate(-8 50 50)"><rect x="20" y="7" width="60" height="86" rx="10" fill="#1E6045"/><path d="M36 25h30v11H47v9h12v10H47v20H36z" fill="#F2E8D0"/><path d="M12 2.5S3.5 9 3.5 14.2c0 2.8 2.1 4.6 4.4 4.6 1.4 0 2.6-.6 3.3-1.6-.2 1.7-.9 3.2-2.4 4.3h6.4c-1.5-1.1-2.2-2.6-2.4-4.3.7 1 1.9 1.6 3.3 1.6 2.3 0 4.4-1.8 4.4-4.6C20.5 9 12 2.5 12 2.5z" fill="#C99B2F" transform="translate(58 62) scale(.62)"/></g></svg>`;
// The wordmark is lowercase Inter ExtraBold turned into outlines, so it needs no web font.
const WORDMARK = `<svg class="wm" role="img" aria-label="FeltReady" width="102.0" height="24" viewBox="6 -766 4158 978"><path d="M380 -546H271V-577C271 -609 285 -628 325 -628C342 -628 362 -625 375 -622L402 -746C382 -752 335 -762 287 -762C178 -762 102 -700 102 -575V-546H10V-419H102V0H271V-419H380Z M657 10C789 10 879 -50 906 -145L754 -169C741 -133 706 -113 660 -113C596 -113 552 -152 549 -231H914V-274C914 -455 804 -553 651 -553C487 -553 382 -439 382 -271C382 -96 486 10 657 10ZM550 -331C557 -391 592 -429 652 -429C712 -429 746 -393 752 -331Z M1129 -728H958V0H1129Z M1506 -546H1407V-676H1237V-546H1165V-419H1237V-152C1237 -48 1298 8 1414 8C1446 8 1482 4 1520 -6L1498 -130C1489 -128 1463 -125 1451 -125C1420 -125 1407 -138 1407 -167V-419H1506Z"/><path class="r" d="M1548 0H1718V-298C1718 -363 1765 -407 1828 -407C1848 -407 1879 -404 1895 -398V-547C1881 -550 1863 -553 1847 -553C1787 -553 1739 -518 1719 -446H1714V-546H1548Z M2150 10C2282 10 2371 -50 2399 -145L2247 -169C2233 -133 2198 -113 2152 -113C2088 -113 2045 -152 2042 -231H2406V-274C2406 -455 2296 -553 2143 -553C1979 -553 1874 -439 1874 -271C1874 -96 1978 10 2150 10ZM2043 -331C2049 -391 2085 -429 2145 -429C2204 -429 2238 -393 2245 -331Z M2613 10C2689 10 2742 -21 2772 -77H2776V0H2936V-371C2936 -488 2829 -553 2693 -553C2557 -553 2471 -489 2449 -396L2604 -375C2613 -410 2645 -432 2692 -432C2738 -432 2766 -410 2766 -373V-371C2766 -337 2729 -330 2637 -322C2526 -313 2434 -272 2434 -151C2434 -43 2508 10 2613 10ZM2665 -103C2624 -103 2595 -123 2595 -159C2595 -195 2623 -217 2673 -224C2705 -229 2748 -236 2768 -247V-194C2768 -141 2722 -103 2665 -103Z M3202 8C3285 8 3333 -39 3355 -88H3361V0H3529V-728H3359V-452H3355C3334 -501 3288 -553 3200 -553C3085 -553 2983 -464 2983 -272C2983 -87 3080 8 3202 8ZM3260 -125C3194 -125 3158 -184 3158 -272C3158 -361 3194 -419 3260 -419C3325 -419 3363 -363 3363 -272C3363 -183 3324 -125 3260 -125Z M3607 191C3633 201 3674 208 3716 208C3838 208 3898 146 3931 58L4160 -546H3982L3895 -279C3880 -232 3868 -186 3857 -137C3848 -186 3839 -232 3825 -279L3743 -546H3563L3767 1L3767 24C3770 68 3728 89 3667 73L3645 67Z"/></svg>`;
export const brandHTML = `${LOGO}${WORDMARK}`;

/** For schools, Privacy, Terms: the last line of every page. The plain pages (home, schools,
 *  privacy, terms) have the same links written into their HTML. */
export const siteLinksHTML = `<nav class="site-links" aria-label="About FeltReady"><a href="/schools/">For schools</a><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a></nav>`;

/** Settings that depend on the game: blinds for pot limit Omaha, the ante for bomb pots. */
function stakesRows(game: GameId): { top: string; bottom: string } {
  if (game === 'bomb') return {
    top: `<div class="row"><span>Ante</span>
      <div class="seg" id="anteSeg"><button data-v="5">$5</button><button data-v="10">$10</button><button data-v="25">$25</button></div></div>`,
    bottom: '',
  };
  return {
    top: `<div class="row"><label for="stakes">Blinds</label>
      <select id="stakes"><option>1/2</option><option>1/3</option><option>2/5</option><option>5/10</option><option>25/50</option></select></div>`,
    bottom: '',
  };
}

/**
 * Pot limit Omaha: true pot or rounded pot. Members (and local mode) can switch it; guests pick
 * once before their first hand and sign in to switch. The daily challenge is always true pot.
 * The hint sits outside the fieldset so its sign-in link still works while the row is locked.
 */
const potStyleRow = (game: GameId): string => game === 'bomb' ? '' : `<fieldset class="training" id="potStyleSet">
    <legend class="sr">How the pot is counted</legend>
    <div class="row"><span>Pot</span>
      <div class="seg" id="potStyleSeg"><button data-v="true">True pot</button><button data-v="rounded">Rounded pot</button></div></div>
    </fieldset>
    <p class="thint muted" id="potStyleHint"></p>`;

export function shellHTML(game: GameId): string {
  const rows = stakesRows(game);
  return `<header class="top">
    <h1 class="brand${GAMES[game].tag.length > 4 ? ' long' : ''}"><a class="home" href="/" aria-label="FeltReady: all games">${brandHTML}</a><span class="game">${GAMES[game].tag}</span></h1>
    <button class="linkbtn" id="signin" hidden>Sign in</button>
    <button class="iconbtn" id="spotsBtn" aria-label="Your weak spots" aria-expanded="false" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 20v-7M12 20V5M19 20v-10M3 20h18"/></svg></button>
    <button class="iconbtn" id="gear" aria-label="Settings" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg></button>
  </header>
  <div class="scores${game === 'bomb' ? ' five' : ''}" id="scores"></div>
  <div class="daily-strip" id="dailyStrip" hidden></div>
  <div class="fb-note" id="fbNote" role="status" hidden></div>

  <section class="sheet" id="sheet" aria-label="Settings">
    <div class="acct" id="acct" hidden></div>
    ${potStyleRow(game)}
    <fieldset class="training" id="training">
    <legend class="sr">Training settings</legend>
    <p class="lockmsg" id="lockmsg" hidden>Sign in to change these.</p>
    ${rows.top}
    <div class="row"><span>Players</span>
      <div class="seg" id="seatsSeg"><button data-v="6">6-handed</button><button data-v="9">9-handed</button></div></div>
    <div class="row"><span>Action speed</span>
      <div class="seg" id="speed"><button data-v="slow">Slow</button><button data-v="normal">Normal</button><button data-v="fast">Fast</button></div></div>
    <div class="row trow"><span>Timer</span>
      <div class="seg" id="timerSeg"><button data-v="off">Off</button><button data-v="relaxed">Relaxed</button><button data-v="standard">Standard</button><button data-v="fast">Fast</button></div></div>
    <p class="thint muted" id="thint"></p>
    <div class="row"><span>Pot calls per hand</span>
      <div class="seg" id="potCount"><button data-v="1">1</button><button data-v="2">2</button><button data-v="3">3</button></div></div>
    <p class="thint muted">Up to this many per hand. With 2 or 3, some come as re-pots on the same street.</p>
    <div class="row"><span>Side pot hands</span>
      <div class="seg" id="sideFreq"><button data-v="off">Off</button><button data-v="some">Some</button><button data-v="often">Often</button></div></div>
    <div class="row"><label for="showPot">Show the pot total on the table</label><input type="checkbox" id="showPot"></div>
    ${rows.bottom}
    <div class="row"><label for="chipAmt">Label chip amounts (turn off to count chips yourself)</label><input type="checkbox" id="chipAmt"></div>
    </fieldset>
    <div class="row"><label for="sound">Chip sounds and vibration</label><input type="checkbox" id="sound"></div>
    <div class="row"><label for="four">Four-color deck</label><input type="checkbox" id="four"></div>
    <div class="row"><span class="muted" id="scoreNote">Scores are saved on this device.</span><button class="btn ghost" id="reset">Reset scores</button></div>
    <div class="row" id="feedbackRow" hidden><span>Found a bug or have an idea?</span><button class="btn ghost" id="feedbackSettings">Send feedback</button></div>
  </section>

  <section class="sheet spots" id="spots" aria-label="Your weak spots"></section>
  <section class="sheet spots daily" id="daily" aria-label="Daily challenge"></section>
  <section class="sheet spots" id="feedback" aria-label="Send feedback"></section>
  <section class="sheet spots" id="stats" aria-label="Stats"></section>
  <section class="welcome" id="welcome" hidden></section>

  <div class="table" id="table"></div>
  <div class="ticker"><span class="street" id="street">Ready</span><strong id="caption">Waiting on a deal</strong></div>
  <section class="panel" id="panel"></section>
  <div class="modal" id="modal" role="dialog" aria-modal="true" aria-labelledby="qtitle"><div class="box" id="modalBox"></div></div>
  <div class="modal" id="styleAsk" role="dialog" aria-modal="true" aria-labelledby="styleTitle"><div class="box" id="styleBox"></div></div>
  <details class="log" id="logwrap"><summary>Hand history</summary><ol id="log"></ol></details>
  <footer class="foot"><a class="linkbtn" href="/">All games</a><button class="linkbtn" id="feedbackOpen" hidden>Send feedback</button></footer>
  ${dtFootHTML('footer')}
  ${siteLinksHTML}`;
}
