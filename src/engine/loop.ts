// Plays one hand from blinds to showdown. The UI (or a test) supplies the hooks.
import type { Hand, Player, Pot, PotQ } from './types.ts';
import { active, collect, dealBoard, decide, makePotRaise, potCallDue, roundDone, seatName, startStreet } from './hand.ts';
import { commitCuts, newCutLevels, prepareCuts } from './pots.ts';
import { fmt } from '../util.ts';

export interface Hooks {
  render(): void;
  sleep(ms: number): Promise<void>;
  /** False once a newer hand has started, so this one should stop. */
  current(): boolean;
  actionDelay(): number;
  /** A player says "Pot". Resolve when the dealer has announced it. */
  askPot(p: Player, q: PotQ): Promise<void>;
  /** Pots to cut before the next card. Resolve when the dealer has cut them. */
  askCuts(pots: Pot[]): Promise<void>;
  /** Everyone else folded. */
  uncontested(winner: Player, amount: number): void;
  /** Two or more hands reach showdown. */
  showdown(): void;
}

export async function playHand(S: Hand, h: Hooks): Promise<void> {
  h.render();
  await h.sleep(500);

  async function act(p: Player): Promise<void> {
    S.acting = p.i; h.render();
    await h.sleep(h.actionDelay());
    if (!h.current()) return;
    const q = potCallDue(S, p);
    if (q) {
      await h.askPot(p, q);
      if (!h.current()) return;
      makePotRaise(S, p, q); h.render(); return;
    }
    decide(S, p); h.render();
  }

  async function bettingRound(): Promise<void> {
    startStreet(S);
    let i = S.street === 0 ? (S.btn + 3) % 6 : (S.btn + 1) % 6;
    for (let guard = 0; guard < 400; guard++) {
      if (!h.current()) return;
      if (active(S).length <= 1 || roundDone(S)) return;
      const p = S.players[i];
      if (!p.folded && !p.allin && (!p.acted || p.committed < S.currentBet)) await act(p);
      i = (i + 1) % 6;
    }
  }

  /** Bring bets in and cut any side pots. Returns false if the hand was abandoned. */
  async function endRound(): Promise<boolean> {
    collect(S); S.acting = null;
    if (S.sweep && S.sweep.length) { h.render(); await h.sleep(420); if (!h.current()) return false; }
    if (active(S).length > 1) {
      const lv = newCutLevels(S);
      if (lv.length) {
        const pots = prepareCuts(S, lv);
        await h.askCuts(pots);
        if (!h.current()) return false;
        commitCuts(S, pots);
      }
    }
    return true;
  }

  for (let st = 0; st < 4; st++) {
    if (!h.current()) return;
    if (st > 0) {
      if (!await endRound()) return;
      S.street = st; dealBoard(S, st); h.render();
      await h.sleep(h.actionDelay() * 1.2);
      if (!h.current()) return;
    }
    if (S.players.filter(p => !p.folded && !p.allin).length >= 2) await bettingRound();
    if (!h.current()) return;
    if (S.quizLeft > 0 && S.quizStreet === st) S.quizStreet = st + 1;
    if (active(S).length <= 1) break;
  }
  if (!await endRound()) return;
  if (active(S).length <= 1) {
    const w = active(S)[0], amount = S.pot;
    w.stack += amount; S.caption = `${seatName(w)} takes ${fmt(amount)}`; S.mode = 'done'; S.sd = null;
    h.uncontested(w, amount);
    return;
  }
  h.showdown();
}
