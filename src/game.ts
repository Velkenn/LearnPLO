// Starts a hand and connects the engine's hooks to the drills and the screen.
import { app, challengeComplete, logHand } from './app.ts';
import { SPEEDS } from './config.ts';
import { newHand, tableSize } from './engine/hand.ts';
import { playHand, type Hooks } from './engine/loop.ts';
import { seed } from './engine/rng.ts';
import { dealChallengeHand } from './engine/challenge.ts';
import type { Hand } from './engine/types.ts';
import { askPot } from './drills/potCall.ts';
import { askCuts } from './drills/cutPot.ts';
import { startShowdown } from './drills/readHands.ts';
import { startBombShowdown } from './drills/bombShowdown.ts';
import { newBombHand } from './engine/bomb.ts';
import { isBomb } from './page.ts';
import { render } from './ui/render.ts';
import { timerStop } from './ui/timer.ts';
import { showDailyResults, submitChallenge } from './ui/daily.ts';
import { askPotStyle, needsPotStyle } from './ui/potStyle.ts';

export function startHand(): void {
  const c = app.challenge;
  // After the last challenge hand, the deal button shows the results instead.
  if (challengeComplete()) { showDailyResults(); return; }
  // A challenge hand is never cut short: wait for it to finish before dealing the next one.
  if (c && !c.handDone) return;
  // The first pot limit Omaha deal asks whether the dealer's room counts true pot or rounded pot.
  if (needsPotStyle()) { askPotStyle(startHand); return; }
  const my = ++app.runId;
  timerStop();
  let S: Hand;
  if (c) {
    c.hand++; c.handDone = false;
    S = dealChallengeHand(c.seed, c.hand); // the rest of the hand stays on this seed
  } else {
    seed(null);
    app.lastBtn = (app.lastBtn + 1) % tableSize(app.settings);
    S = (isBomb ? newBombHand : newHand)(app.settings, app.lastBtn);
  }
  app.S = S;
  const hooks: Hooks = {
    render,
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    current: () => my === app.runId,
    actionDelay: () => SPEEDS[app.settings.speed] || 650,
    askPot,
    askCuts,
    uncontested: (w, amount) => { S.ship = [{ i: w.i, amt: amount }]; handOver(); render(); },
    showdown: S.bottom ? startBombShowdown : startShowdown,
  };
  void playHand(S, hooks);
}

/** Hands already counted as played, so a hand that ends twice still counts once. */
const counted = new WeakSet<Hand>();

/** A hand just ended (everyone folded, or the last pot was shipped). */
export function handOver(): void {
  const S = app.S;
  if (S && !counted.has(S)) { counted.add(S); logHand(); }
  const c = app.challenge; if (!c || c.handDone) return;
  c.handDone = true;
  if (challengeComplete()) void submitChallenge();
}
