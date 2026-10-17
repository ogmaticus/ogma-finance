"""Синтез фоновой музыки и звуков под ролик: пэд, мягкий бит 112 BPM, вжухи на сменах сцен, щелчок кнопки.
python3 music.py out.wav"""
import sys, wave
import numpy as np

SR = 48000
DUR = 28.5
CUTS = [4.2, 7, 11, 16.5, 20.5, 24.8]
PRESS = 7.55
n = int(SR * DUR)
t = np.arange(n) / SR
rng = np.random.default_rng(7)
mix = np.zeros((n, 2))

def note(f):
    return 440 * 2 ** ((f - 69) / 12)

def add(sig, start, gain=1.0, pan=0.0):
    i = int(start * SR)
    j = min(n, i + len(sig))
    if j <= i:
        return
    l, r = np.sqrt((1 - pan) / 2), np.sqrt((1 + pan) / 2)
    mix[i:j, 0] += sig[: j - i] * gain * l
    mix[i:j, 1] += sig[: j - i] * gain * r

# Пэд: Am9 → Fmaj7 → C → G (по 4 такта при 112 BPM ≈ 2.14 с на такт)
bar = 60 / 112 * 4
chords = [[57, 60, 64, 67, 71], [53, 57, 60, 64, 69], [48, 55, 60, 64, 67], [55, 59, 62, 67, 71]]
k = 0
s = 0.0
while s < DUR:
    ch = chords[k % 4]
    L = bar * 2
    tt = np.arange(int(L * SR)) / SR
    env = np.minimum(1, tt / 0.6) * np.minimum(1, (L - tt) / 0.8)
    sig = np.zeros_like(tt)
    for m in ch:
        f = note(m)
        sig += np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * f * 2.003 * tt) + 0.15 * np.sin(2 * np.pi * f * 0.998 * tt)
    add(sig * env / len(ch), s, 0.09, -0.2)
    add(sig * env / len(ch), s + 0.012, 0.09, 0.2)
    s += L
    k += 1

# Бит начинается с бренда (7 с), до этого — только пэд и тики
beat = 60 / 112
def kick():
    tt = np.arange(int(0.35 * SR)) / SR
    f = 50 + 90 * np.exp(-tt * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 9)
def hat():
    tt = np.arange(int(0.06 * SR)) / SR
    x = rng.standard_normal(len(tt))
    x = np.diff(x, prepend=0)
    return x * np.exp(-tt * 70)
def tick():
    tt = np.arange(int(0.05 * SR)) / SR
    return np.sin(2 * np.pi * 1800 * tt) * np.exp(-tt * 90)

b = 0
while b * beat < DUR - 1.2:
    st = b * beat
    if st >= 7.0:
        if b % 2 == 0:
            add(kick(), st, 0.55)
        add(hat(), st + beat / 2, 0.06, 0.3)
    elif st >= 0.2:
        add(tick(), st, 0.05, -0.3 if b % 2 else 0.3)
    b += 1

# Вжухи на сменах сцен
def whoosh(L=0.7):
    m = int(L * SR)
    x = rng.standard_normal(m)
    tt = np.arange(m) / SR
    env = np.sin(np.pi * tt / L) ** 2
    # простой фильтр: скользящее среднее с меняющимся окном
    y = np.convolve(x, np.ones(18) / 18, mode="same")
    return y * env
for c in CUTS:
    add(whoosh(), c - 0.35, 0.22, rng.uniform(-0.5, 0.5))

# Нажатие кнопки + «бум»
tt = np.arange(int(0.9 * SR)) / SR
click = np.sin(2 * np.pi * 900 * tt) * np.exp(-tt * 60)
boom = np.sin(2 * np.pi * (45 + 60 * np.exp(-tt * 12)) * tt) * np.exp(-tt * 3.5)
add(click * 0.5 + boom * 0.9, PRESS, 0.6)
add(boom, 20.6, 0.35)

# Финальный аккорд-колокол
tt = np.arange(int(3.5 * SR)) / SR
bell = sum(np.sin(2 * np.pi * note(m) * tt) * np.exp(-tt * 1.6) for m in [72, 76, 79, 84])
add(bell / 4, 25.9, 0.25)

# Общий выход: затухание в конце, нормализация
fade = np.minimum(1, (DUR - t) / 1.5)[:, None] * np.minimum(1, t / 0.4)[:, None]
mix *= fade
mix = np.tanh(mix * 1.4)
mix /= np.max(np.abs(mix)) / 0.89
pcm = (mix * 32767).astype(np.int16)
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("ok", DUR)
