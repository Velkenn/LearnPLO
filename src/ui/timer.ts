// Countdown per question. Pauses while the tab is hidden.
import { app } from '../app.ts';
import { TIMERS } from '../config.ts';

type Kind = 'pot' | 'build' | 'read' | 'split';
interface Running { kind: Kind; limit: number; start: number; paused: number; hiddenAt: number | null; onExpire: () => void; raf: number }
let T: Running | null = null;

const elapsed = (): number => T ? (T.hiddenAt ?? performance.now()) - T.start - T.paused : 0;

export function timerStart(kind: Kind, onExpire: () => void): void {
  timerStop();
  const cfg = TIMERS[app.settings.timer];
  T = { kind, limit: cfg ? cfg[kind] * 1000 : 0, start: performance.now(), paused: 0, hiddenAt: null, onExpire, raf: 0 };
  T.raf = requestAnimationFrame(tick);
}

/** Stop the clock and return how long the answer took (ms), or null if none was running. */
export function timerStop(): number | null {
  if (!T) return null;
  const e = elapsed(); cancelAnimationFrame(T.raf); T = null; return e;
}

function tick(): void {
  if (!T) return;
  if (T.limit) {
    const left = Math.max(0, T.limit - elapsed());
    document.querySelectorAll<HTMLElement>('.tbar').forEach(b => {
      (b.querySelector('.tfill') as HTMLElement).style.width = `${left / T!.limit * 100}%`;
      (b.querySelector('.tsec') as HTMLElement).textContent = `${Math.ceil(left / 1000)}s`;
      b.classList.toggle('low', left < 3000);
    });
    if (left <= 0) { const f = T.onExpire; timerStop(); f(); return; }
  }
  T.raf = requestAnimationFrame(tick);
}

export function initTimer(): void {
  document.addEventListener('visibilitychange', () => {
    if (!T) return;
    if (document.hidden) T.hiddenAt = performance.now();
    else if (T.hiddenAt != null) { T.paused += performance.now() - T.hiddenAt; T.hiddenAt = null; }
  });
}

export function timerHTML(kind: Kind): string {
  const cfg = TIMERS[app.settings.timer]; if (!cfg) return '';
  const w = T && T.limit ? Math.max(0, T.limit - elapsed()) / T.limit * 100 : 100;
  const sec = T && T.limit ? Math.ceil(Math.max(0, T.limit - elapsed()) / 1000) : cfg[kind];
  return `<div class="tbar" role="timer" aria-label="Time left"><div class="ttrack"><div class="tfill" style="width:${w}%"></div></div><span class="tsec">${sec}s</span></div>`;
}

export function timeLine(kind: 'p' | 'b' | 'r' | 'h', ms: number | null | undefined): string {
  if (ms == null) return '';
  const n = app.stats[kind + 'n'] || 0, t = app.stats[kind + 'time'] || 0;
  return `<p class="tline">Answered in ${(ms / 1000).toFixed(1)}s${n > 1 ? `. Your average: ${(t / n / 1000).toFixed(1)}s` : ''}.</p>`;
}
