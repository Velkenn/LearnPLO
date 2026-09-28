// The settings sheet: reflect current settings and save changes.
import { app, canCustomize, resetStats, saveSettings, storeMode } from '../app.ts';
import { TIMERS } from '../config.ts';
import type { Ante, Settings, SideFreq, Speed, Stakes, TimerLevel } from '../engine/types.ts';
import { $, $q, sheetOpen, showSheet } from './dom.ts';
import { isBomb } from '../page.ts';
import { chipClick } from './sound.ts';
import { renderModal, renderPanel, renderScores } from './render.ts';
import { renderTable } from './table.ts';

// Some rows are only on one game's page (blinds for PLO, the ante for bomb pots), so look them up with $q.
const checkbox = (id: string): HTMLInputElement => $<HTMLInputElement>('#' + id);
const maybeBox = (id: string): HTMLInputElement | null => $q<HTMLInputElement>('#' + id);
const segOn = (id: string, value: string): void =>
  document.querySelectorAll<HTMLButtonElement>(`#${id} button`).forEach(b => b.classList.toggle('on', b.dataset.v === value));

export function applySettings(): void {
  const s = app.settings;
  document.body.classList.toggle('four', !!s.four);
  const stakes = $q<HTMLSelectElement>('#stakes'); if (stakes) stakes.value = s.stakes;
  checkbox('showPot').checked = !!s.showPot;
  const sbFull = maybeBox('sbFull'); if (sbFull) sbFull.checked = !!s.sbFull;
  segOn('anteSeg', String(s.ante));
  checkbox('chipAmt').checked = s.chipAmt !== false;
  checkbox('sound').checked = s.sound !== false;
  checkbox('four').checked = !!s.four;
  segOn('speed', s.speed);
  segOn('timerSeg', s.timer);
  segOn('potCount', String(+s.potCalls || 1));
  segOn('sideFreq', s.side);
  segOn('seatsSeg', String(s.seats));
  const locked = !canCustomize();
  $<HTMLFieldSetElement>('#training').disabled = locked;
  $('#lockmsg').hidden = !locked;
  $('#lockmsg').textContent = app.challenge ? 'The daily challenge uses the same settings for every dealer.' : 'Sign in to change these.';
  const mode = storeMode();
  $('#scoreNote').textContent = mode === 'member' ? 'Scores are saved to your account.'
    : mode === 'guest' ? 'Scores last for this visit. Sign in to keep them.' : 'Scores are saved on this device.';
  const tc = TIMERS[s.timer];
  $('#thint').textContent = tc
    ? `Pot calls get ${tc.pot}s, side pots ${tc.build}s, ${isBomb ? `splits ${tc.split}s, ` : ''}and hand reads ${tc.read}s. Running out of time counts as a miss.`
    : 'Your answer times are still tracked with the timer off.';
}

function onSeg(id: string, set: (v: string) => void): void {
  $q('#' + id)?.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button'); if (!b || !b.dataset.v) return;
    set(b.dataset.v); saveSettings(); applySettings();
  });
}
function onCheck(id: string, set: (v: boolean) => void, after?: () => void): void {
  maybeBox(id)?.addEventListener('change', e => { set((e.target as HTMLInputElement).checked); saveSettings(); after?.(); });
}

export function initSettings(): void {
  // Always edit app.settings at event time: it's replaced when someone signs in or out.
  const s = (): Settings => app.settings;
  $('#gear').addEventListener('click', () => showSheet(sheetOpen('sheet') ? null : 'sheet'));
  $q<HTMLSelectElement>('#stakes')?.addEventListener('change', e => { s().stakes = (e.target as HTMLSelectElement).value as Stakes; saveSettings(); });
  // Takes effect on the next deal; the intro before the first deal names the ante.
  onSeg('anteSeg', v => { s().ante = +v as Ante; if (!app.S) renderPanel(); });
  onCheck('showPot', v => { s().showPot = v; }, () => { if (app.S) { renderTable(); renderModal(); } });
  onCheck('sbFull', v => { s().sbFull = v; }, () => { if (!app.S) renderPanel(); });
  onCheck('chipAmt', v => { s().chipAmt = v; }, () => { if (app.S) { renderTable(); renderModal(); } });
  onCheck('sound', v => { s().sound = v; }, () => { if (s().sound) chipClick(2); });
  onCheck('four', v => { s().four = v; }, applySettings);
  onSeg('speed', v => { s().speed = v as Speed; });
  onSeg('timerSeg', v => { s().timer = v as TimerLevel; });
  onSeg('potCount', v => { s().potCalls = +v; });
  onSeg('sideFreq', v => { s().side = v as SideFreq; });
  // Takes effect on the next deal; an empty table redraws with the new seats right away.
  onSeg('seatsSeg', v => { s().seats = v === '9' ? 9 : 6; if (!app.S) { renderTable(); renderPanel(); } });
  $('#reset').addEventListener('click', () => {
    if (storeMode() === 'member' && !confirm('Reset the scores on your account? This can’t be undone.')) return;
    resetStats(); renderScores();
  });
  applySettings();
}
