// Before the first hand of pot limit Omaha: does the dealer's room count true pot or rounded pot?
// Asked once (the choice is kept with their settings: on the account, or on this device for
// guests), and changeable any time in settings. Bomb pots and the daily challenge don't ask.
import { app, saveSettings } from '../app.ts';
import type { PotStyle } from '../engine/types.ts';
import { isBomb } from '../page.ts';
import { $, $q } from './dom.ts';
import { applySettings } from './settings.ts';
import { renderPanel } from './render.ts';

/** The next deal should ask first. */
export const needsPotStyle = (): boolean => !isBomb && !app.challenge && !app.settings.potStyle;

let after: (() => void) | null = null;

/** Ask, then run `then` (deal the hand) once they've picked. */
export function askPotStyle(then: () => void): void {
  after = then;
  $('#styleBox').innerHTML = `<h2 id="styleTitle">How does your room count the pot?</h2>
    <p>Poker rooms figure a pot-sized raise one of two ways. Pick the one where you deal.</p>
    <button class="style-pick" data-style="true"><b>True pot</b>
      <span>Every chip counts as it is. At $2/$5, first in pots it to $17.</span></button>
    <button class="style-pick" data-style="rounded"><b>Rounded pot</b>
      <span>Bets go in $5s and the pot rounds up to the next $5. At $2/$5 each blind counts as $5, so first in pots it to $20. At $1/$3 the blinds count as $5 together and the bring-in is $5, so it’s $15. When a player is all in, their last $1 to $4 doesn’t play and goes back to them.</span></button>
    <p class="style-note">Not sure? Ask your floor. You can change this anytime in settings. The daily challenge is always true pot, so everyone plays the same hands.</p>`;
  $('#styleAsk').classList.add('open');
  $q<HTMLButtonElement>('#styleBox [data-style="true"]')?.focus({ preventScroll: true });
}

export function initPotStyle(): void {
  $q('#styleAsk')?.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-style]'); if (!b) return;
    app.settings.potStyle = b.dataset.style as PotStyle;
    saveSettings(); applySettings(); renderPanel();
    $('#styleAsk').classList.remove('open'); $('#styleBox').innerHTML = '';
    const go = after; after = null; go?.();
  });
}
