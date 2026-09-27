// Button and keyboard handling for the drill panel and the question popup.
import { app } from '../app.ts';
import { startHand } from '../game.ts';
import { continueQuiz, gradeQuiz } from '../drills/potCall.ts';
import { finishCuts, gradeCut, nextCut } from '../drills/cutPot.ts';
import { gradeHand, nextPot, toggleSel } from '../drills/readHands.ts';
import { $ } from './dom.ts';
import { openAccount } from './account.ts';
import { fitVV, renderModal, renderPanel, unpeek } from './render.ts';

export function initEvents(): void {
  $('#panel').addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest('button'); if (!t) return;
    if (t.id === 'deal') { startHand(); window.scrollTo({ top: 0, behavior: 'auto' }); return; }
    if (t.id === 'unpeek') { unpeek(); return; }
    if (t.id === 'introSignin') { openAccount(); return; }
    if (t.id === 'gradeBtn') { gradeHand(false); return; }
    if (t.id === 'nextPot') { nextPot(); return; }
    const S = app.S;
    if (t.dataset.k && S && S.mode === 'showdown' && S.sd?.phase === 'read') {
      toggleSel(t.dataset.k as 'board' | 'hole', t.dataset.s != null ? +t.dataset.s : null, +(t.dataset.i || 0));
    }
  });

  $('#modal').addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest('button'); if (!t) return;
    if (t.id === 'checkPot') { gradeQuiz(false); return; }
    if (t.id === 'cont') { continueQuiz(); return; }
    if (t.id === 'checkPots') { gradeCut(false); return; }
    if (t.id === 'cont2') { nextCut(); return; }
    if (t.id === 'cutDone') { finishCuts(); return; }
    if (t.id === 'peek' && app.S) { app.S.peek = true; renderModal(); renderPanel(); window.scrollTo({ top: 0, behavior: 'auto' }); }
  });

  $('#modal').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const id = (e.target as HTMLElement).id;
    if (id === 'ans') { e.preventDefault(); gradeQuiz(false); }
    else if (id === 'bp') { e.preventDefault(); gradeCut(false); }
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitVV);
    window.visualViewport.addEventListener('scroll', fitVV);
  }
}
