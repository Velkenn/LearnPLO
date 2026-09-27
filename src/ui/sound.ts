// Chip clicks (synthesized, no audio files) and a short vibration on Android.
import { app } from '../app.ts';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (app.settings.sound === false) return null;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = ctx || new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

export function chipClick(n: number): void {
  const a = audio(); if (!a || a.state !== 'running') return;
  const t0 = a.currentTime + .01;
  for (let k = 0; k < n; k++) {
    const t = t0 + k * .05 + Math.random() * .02, len = .04;
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 7);
    const src = a.createBufferSource(); src.buffer = buf;
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600 + Math.random() * 1900; bp.Q.value = 7;
    const g = a.createGain(); g.gain.value = .28;
    src.connect(bp).connect(g).connect(a.destination); src.start(t);
  }
}

export function buzz(ok: boolean): void {
  if (app.settings.sound === false) return;
  try { navigator.vibrate?.(ok ? 12 : [28, 60, 28]); } catch { /* not supported */ }
}
