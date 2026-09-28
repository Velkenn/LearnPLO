// The markup every game page shares: header, scores, sheets, table, panel. Each game's page
// (plo/index.html, bombpot/index.html) has only its own head and <body data-game>; main.ts
// puts this in before anything else runs.
import type { GameId } from '../config.ts';
import { GAMES } from '../config.ts';

const LOGO = `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="31" fill="#1E6045"/><circle cx="32" cy="32" r="26" fill="none" stroke="#F2E8D0" stroke-width="6.5" stroke-dasharray="10.21 10.21"/><circle cx="32" cy="32" r="19" fill="#1E6045" stroke="#C99B2F" stroke-width="1.6"/><path d="M25.5 20h14v4.8h-8.6v5h7.6v4.8h-7.6V44h-5.4z" fill="#F2E8D0"/></svg>`;
export const brandHTML = `${LOGO}<span class="wm">Felt<span>Ready</span></span>`;

/** Settings that depend on the game: blinds for pot limit Omaha, the ante for bomb pots. */
function stakesRows(game: GameId): { top: string; bottom: string } {
  if (game === 'bomb') return {
    top: `<div class="row"><span>Ante</span>
      <div class="seg" id="anteSeg"><button data-v="5">$5</button><button data-v="10">$10</button><button data-v="25">$25</button></div></div>`,
    bottom: '',
  };
  return {
    top: `<div class="row"><label for="stakes">Blinds</label>
      <select id="stakes"><option>1/2</option><option>2/5</option><option>5/10</option><option>25/50</option></select></div>`,
    bottom: `<div class="row"><label for="sbFull">Count the small blind as a full blind in the preflop pot</label><input type="checkbox" id="sbFull"></div>`,
  };
}

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

  <section class="sheet" id="sheet" aria-label="Settings">
    <div class="acct" id="acct" hidden></div>
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
  <details class="log" id="logwrap"><summary>Hand history</summary><ol id="log"></ol></details>
  <footer class="foot"><a class="linkbtn" href="/">All games</a><button class="linkbtn" id="feedbackOpen" hidden>Send feedback</button></footer>`;
}
