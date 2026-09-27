// Starts a hand and connects the engine's hooks to the drills and the screen.
import { app } from './app.ts';
import { SPEEDS } from './config.ts';
import { newHand } from './engine/hand.ts';
import { playHand, type Hooks } from './engine/loop.ts';
import { askPot } from './drills/potCall.ts';
import { askCuts } from './drills/cutPot.ts';
import { startShowdown } from './drills/readHands.ts';
import { render } from './ui/render.ts';
import { timerStop } from './ui/timer.ts';

export function startHand(): void {
  const my = ++app.runId;
  timerStop();
  app.lastBtn = (app.lastBtn + 1) % 6;
  const S = newHand(app.settings, app.lastBtn);
  app.S = S;
  const hooks: Hooks = {
    render,
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    current: () => my === app.runId,
    actionDelay: () => SPEEDS[app.settings.speed] || 650,
    askPot,
    askCuts,
    uncontested: (w, amount) => { S.ship = [{ i: w.i, amt: amount }]; render(); },
    showdown: startShowdown,
  };
  void playHand(S, hooks);
}
