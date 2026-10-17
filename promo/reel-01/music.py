"""Синтез трека под неоновый ролик: 128 BPM, интро → нарастание → дроп на 15-й доле.
python3 music.py out.wav"""
import sys, wave
import numpy as np

SR = 48000
BEAT = 60 / 128
DUR = 61 * BEAT
DROP = 15 * BEAT
CUTS = [9, 15, 23, 35, 44, 53]
n = int(SR * DUR)
t = np.arange(n) / SR
rng = np.random.default_rng(3)
L = np.zeros(n); R = np.zeros(n)

def add(sig, start, g=1.0, pan=0.0):
    i = int(start * SR); j = min(n, i + len(sig))
    if i >= n or j <= i: return
    s = sig[: j - i] * g
    L[i:j] += s * np.sqrt((1 - pan) / 2); R[i:j] += s * np.sqrt((1 + pan) / 2)

def f(m): return 440 * 2 ** ((m - 69) / 12)
def env_ar(N, a, r):
    tt = np.arange(N) / SR
    return np.minimum(1, tt / a) * np.exp(-tt / r)
from scipy.signal import lfilter
def lp(x, k):  # однополюсный фильтр
    return lfilter([k], [1, k - 1], x)

def kick():
    N = int(.42 * SR); tt = np.arange(N) / SR
    fr = 48 + 140 * np.exp(-tt * 35)
    return np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-tt * 7) + 0.3 * np.exp(-tt * 200) * rng.standard_normal(N)
def clap():
    N = int(.25 * SR); x = rng.standard_normal(N); tt = np.arange(N) / SR
    e = np.exp(-tt * 18) * (1 + .6 * (np.sin(2 * np.pi * 90 * tt) > .7))
    return np.diff(x, prepend=0) * e * .6
def hat(open_=False):
    N = int((.18 if open_ else .05) * SR); x = np.diff(rng.standard_normal(N), prepend=0); tt = np.arange(N) / SR
    return x * np.exp(-tt * (14 if open_ else 80))
def saw(fr, N):
    tt = np.arange(N) / SR
    return 2 * ((tt * fr) % 1) - 1

# Аккорды: Fm — Db — Ab — Eb, по 2 такта
prog = [[53, 56, 60, 65], [49, 53, 56, 61], [56, 60, 63, 68], [51, 55, 58, 63]]
bass = [41, 37, 44, 39]
bar = 4 * BEAT

# Пэд/стаб-аккорды с суперсо
k = 0; s = 0.0
while s < DUR:
    ch = prog[k % 4]; N = int(2 * bar * SR)
    sig = sum(saw(f(m) * d, N) for m in ch for d in (0.996, 1.004))
    sig = lp(sig / 8, .05 if s >= DROP else .02)
    e = np.minimum(1, np.arange(N) / SR / .3) * np.minimum(1, (2 * bar - np.arange(N) / SR) / .3)
    add(sig * e, s, .22 if s >= DROP else .16, -.25); add(sig * e, s + .01, .22 if s >= DROP else .16, .25)
    s += 2 * bar; k += 1

# Ритм
for b in range(int(DUR / BEAT)):
    B = b * BEAT
    if B >= DROP:
        add(kick(), B, .9)
        if b % 2 == 1: add(clap(), B, .5, .1)
        add(hat(True), B + BEAT / 2, .14, .35)
        add(hat(), B + BEAT / 4, .05, -.3); add(hat(), B + 3 * BEAT / 4, .05, -.3)
        # бас: восьмые с сайдчейном от бочки
        idx = int((B - DROP) // (2 * bar)) % 4
        for half in (0, .5):
            N = int(BEAT / 2 * SR)
            x = lp(saw(f(bass[idx] - 12), N) + .5 * saw(f(bass[idx]), N), .08)
            add(x * env_ar(N, .01, .12), B + half * BEAT, .45)
    else:
        if b % 2 == 0 and B >= BEAT * 3: add(kick(), B, .45)
        add(hat(), B + BEAT / 2, .07, .3)

# Нарастание перед дропом: дробь + шумовой райзер
for i in range(16):
    tt0 = DROP - 2 * BEAT + i * BEAT / 8
    add(clap(), tt0, .12 + .03 * i, (i % 2 - .5) * .4)
N = int(4 * BEAT * SR); x = rng.standard_normal(N); tt = np.arange(N) / SR
ris = lp(x, .02) * (tt / tt[-1]) ** 2 + .15 * np.sin(2 * np.pi * (300 + 900 * (tt / tt[-1]) ** 2) * tt) * (tt / tt[-1])
add(ris, DROP - 4 * BEAT, 1.2)

# Удар на дропе и на «бесплатно»
def impact():
    N = int(1.6 * SR); tt = np.arange(N) / SR
    return np.sin(2 * np.pi * (35 + 80 * np.exp(-tt * 8)) * tt) * np.exp(-tt * 2.2) + lp(rng.standard_normal(N), .1) * np.exp(-tt * 3) * .8
add(impact(), DROP, 1.0)
add(impact(), 49 * BEAT, .6)

# Вжухи на склейках
for c in CUTS:
    N = int(.5 * SR); x = rng.standard_normal(N); tt = np.arange(N) / SR
    add(lp(x, .15) * np.sin(np.pi * tt / .5) ** 2, c * BEAT - .3, .5, rng.uniform(-.6, .6))

# Финал: колокол
N = int(3 * SR); tt = np.arange(N) / SR
add(sum(np.sin(2 * np.pi * f(m) * tt) for m in [77, 80, 84, 89]) / 4 * np.exp(-tt * 1.4), 57 * BEAT, .4)

mix = np.stack([L, R], 1)
fade = (np.minimum(1, (DUR - t) / 1.2) * np.minimum(1, t / .05))[:, None]
mix = np.tanh(mix * fade * 1.6)
mix /= np.max(np.abs(mix)) / .9
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype(np.int16).tobytes())
print("ok", round(DUR, 3))
