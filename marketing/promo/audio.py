# Synthesize the soundtrack from the timeline's events: chip clicks (same recipe as the app),
# card flicks, timer ticks, whooshes, a chime, and a light music bed. Writes a 48 kHz stereo WAV.
import json, sys
import numpy as np
from scipy.signal import butter, sosfilt
from scipy.io import wavfile

SR = 48000
ev = json.load(open(sys.argv[1]))
DUR = ev['DURATION']
N = int(SR * (DUR + .2))
rng = np.random.default_rng(7)
sfx = np.zeros(N)
music = np.zeros((N, 2))

def bp(x, f, q):
    lo, hi = f / (1 + 1 / (2 * q)), f * (1 + 1 / (2 * q))
    return sosfilt(butter(2, [lo, min(hi, SR / 2 - 100)], btype='band', fs=SR, output='sos'), x)

def lp(x, f):
    return sosfilt(butter(2, f, btype='low', fs=SR, output='sos'), x)

def add(buf, t, x, g=1.0):
    i = int(t * SR)
    if i >= len(buf): return
    x = x[: len(buf) - i]
    buf[i:i + len(x)] += g * x

def click():
    n = int(SR * .04)
    x = rng.uniform(-1, 1, n) * (1 - np.arange(n) / n) ** 7
    return bp(x, 2600 + rng.random() * 1900, 7) * 2.2

def chips(t, n):
    for k in range(n):
        add(sfx, t + k * .05 + rng.random() * .02, click(), .55)

def card(t):
    n = int(SR * .09)
    x = rng.uniform(-1, 1, n) * (1 - np.arange(n) / n) ** 4
    add(sfx, t, bp(x, 1700, 1.1) * 1.1, .6)
    n2 = int(SR * .05)
    add(sfx, t + .005, np.sin(2 * np.pi * 140 * np.arange(n2) / SR) * np.exp(-np.arange(n2) / (SR * .012)), .25)

def tick(t):
    n = int(SR * .03)
    tt = np.arange(n) / SR
    add(sfx, t, np.sin(2 * np.pi * 1900 * tt) * np.exp(-tt / .006), .22)

def whoosh(t):
    n = int(SR * .45)
    x = rng.uniform(-1, 1, n)
    env = np.sin(np.pi * np.arange(n) / n) ** 2
    # sweep: blend a low and a high band across the length
    a = bp(x, 700, .8); b = bp(x, 2600, .8)
    m = np.linspace(0, 1, n)
    add(sfx, t - .12, (a * (1 - m) + b * m) * env * .9, .35)

def ding(t):
    n = int(SR * 1.2)
    tt = np.arange(n) / SR
    x = np.zeros(n)
    for f, g, d in [(1318.5, 1, .55), (1975.5, .55, .4), (2637, .25, .25), (659.3, .35, .8)]:
        x += g * np.sin(2 * np.pi * f * tt) * np.exp(-tt / d)
    x *= np.minimum(1, tt / .004)
    add(sfx, t, x * .2)
    add(sfx, t + .09, np.concatenate([np.zeros(0), x]) * .08)

def buzz(t):
    n = int(SR * .22)
    tt = np.arange(n) / SR
    x = (np.sin(2 * np.pi * 196 * tt) + .4 * np.sin(2 * np.pi * 147 * tt)) * np.exp(-tt / .07) * np.minimum(1, tt / .005)
    add(sfx, t, x, .28)

for t, kind, n in ev['EVENTS']:
    {'chips': lambda: chips(t, n), 'card': lambda: card(t), 'tick': lambda: tick(t), 'whoosh': lambda: whoosh(t),
     'ding': lambda: ding(t), 'buzz': lambda: buzz(t)}[kind]()

# ---- music bed: 96 BPM, warm pad + soft kick + light shaker ----
BPM = 96; beat = 60 / BPM; bar = 4 * beat
def midi(m): return 440 * 2 ** ((m - 69) / 12)
CHORDS = [[45, 57, 60, 64, 67, 71], [41, 57, 60, 64, 65, 69], [48, 55, 60, 64, 67, 71], [43, 55, 59, 62, 67, 69]]  # Am9, Fmaj7, Cmaj7, G6
tt = np.arange(N) / SR
pad = np.zeros((N, 2))
nbars = int(np.ceil(DUR / bar)) + 1
for b in range(nbars):
    t0 = b * bar
    ch = CHORDS[b % 4]
    i0, i1 = int(t0 * SR), min(N, int((t0 + bar + .6) * SR))
    if i0 >= N: break
    seg = tt[i0:i1] - t0
    env = np.minimum(1, seg / .5) * np.minimum(1, np.maximum(0, (bar + .6 - seg) / .6))
    for j, m in enumerate(ch):
        f = midi(m)
        for side, det in ((0, -.12), (1, .12)):
            ph = 2 * np.pi * (f * (1 + det / 100)) * seg
            v = np.sin(ph) + .3 * np.sin(2 * ph) + .12 * np.sin(3 * ph)
            pad[i0:i1, side] += v * env * (.5 if j == 0 else .22)
pad = np.stack([lp(pad[:, 0], 1500), lp(pad[:, 1], 1500)], 1)
# slow tremolo for movement
pad *= (1 + .08 * np.sin(2 * np.pi * .25 * tt))[:, None]
music += pad * .045

kick = np.zeros(N)
nk = int(SR * .35); kt = np.arange(nk) / SR
kx = np.sin(2 * np.pi * (48 + 90 * np.exp(-kt / .03)) * kt) * np.exp(-kt / .12)
shaker = np.zeros(N)
ns = int(SR * .05)
for k in range(int(DUR / beat) + 1):
    t = k * beat
    if k % 2 == 0: add(kick, t, kx)
    s = rng.uniform(-1, 1, ns) * (1 - np.arange(ns) / ns) ** 3 * np.minimum(1, np.arange(ns) / (SR * .004))
    add(shaker, t + beat / 2, s, 1.0)
    add(shaker, t, s, .45)
shaker = sosfilt(butter(2, 7000, btype='high', fs=SR, output='sos'), shaker)
music += (kick * .12)[:, None] + (shaker * .028)[:, None]

# music ducks a little under the big moments, fades in and out
fade = np.minimum(1, tt / .6) * np.clip((DUR - tt) / 1.8, 0, 1)
music *= fade[:, None]

out = music + np.stack([sfx, sfx], 1)
peak = np.abs(out).max()
out = out / peak * .89  # about -1 dBFS
wavfile.write(sys.argv[2], SR, (out * 32767).astype(np.int16))
# report levels
rms = lambda x: 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
pk = lambda x: 20 * np.log10(np.abs(x).max() + 1e-12)
print('rms dB pad', round(rms(pad * .045), 1), 'kick', round(rms(kick * .12), 1), 'shaker', round(rms(shaker * .028), 1), 'sfx', round(rms(sfx), 1), 'sfx peak', round(pk(sfx), 1))
print('peak before norm', round(float(peak), 3), 'music rms dB', round(rms(music / peak * .89), 1), 'total rms dB', round(rms(out), 1))
