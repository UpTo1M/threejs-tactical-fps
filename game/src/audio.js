// Synthesised sound: every effect is built with WebAudio oscillators and
// filtered noise, so the game ships no audio files and makes no requests.
// All calls are safe before the first user gesture (context resumes lazily).
export function createAudio() {
  let ctx = null;
  let master = null;
  let enabled = true;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function noiseBuffer(duration) {
    const c = ensure();
    if (!c) return null;
    const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * duration), c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ duration = 0.12, type = 'lowpass', freq = 1800, gain = 0.9, decay = 0.09, when = 0 }) {
    const c = ensure();
    if (!c || !enabled) return;
    const t = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(duration + 0.05);
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  function tone({ freq = 440, freqEnd = null, duration = 0.1, type = 'sine', gain = 0.3, when = 0 }) {
    const c = ensure();
    if (!c || !enabled) return;
    const t = c.currentTime + when;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + duration);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  // distance in metres softens and dulls a shot; volume 0..1.
  function shot(kind, distance = 0) {
    const atten = Math.max(0.12, 1 - distance / 55);
    const dull = Math.max(300, 3200 - distance * 45);
    if (kind === 'rifle') {
      burst({ duration: 0.14, freq: dull, gain: 0.85 * atten, decay: 0.11 });
      tone({ freq: 160, freqEnd: 55, duration: 0.12, type: 'triangle', gain: 0.5 * atten });
    } else if (kind === 'smg') {
      burst({ duration: 0.09, freq: Math.min(dull, 2400), gain: 0.6 * atten, decay: 0.07 });
      tone({ freq: 190, freqEnd: 70, duration: 0.08, type: 'triangle', gain: 0.35 * atten });
    } else if (kind === 'sniper') {
      burst({ duration: 0.25, freq: dull, gain: 1.0 * atten, decay: 0.2 });
      tone({ freq: 120, freqEnd: 38, duration: 0.28, type: 'triangle', gain: 0.7 * atten });
    } else {
      burst({ duration: 0.1, freq: 2000, gain: 0.55 * atten, decay: 0.08 });
      tone({ freq: 220, freqEnd: 90, duration: 0.09, type: 'triangle', gain: 0.3 * atten });
    }
  }

  return {
    unlock() {
      ensure();
    },
    setEnabled(value) {
      enabled = value;
    },
    shot,
    dryFire() {
      tone({ freq: 1400, duration: 0.03, type: 'square', gain: 0.12 });
    },
    reload() {
      tone({ freq: 900, duration: 0.03, type: 'square', gain: 0.14 });
      tone({ freq: 600, duration: 0.03, type: 'square', gain: 0.14, when: 0.18 });
      tone({ freq: 1100, duration: 0.04, type: 'square', gain: 0.16, when: 0.55 });
    },
    hit(kill) {
      tone({ freq: kill ? 1320 : 990, duration: 0.06, type: 'sine', gain: 0.22 });
      if (kill) tone({ freq: 1760, duration: 0.09, type: 'sine', gain: 0.2, when: 0.06 });
    },
    hurt() {
      tone({ freq: 110, freqEnd: 60, duration: 0.18, type: 'sawtooth', gain: 0.25 });
    },
    step() {
      burst({ duration: 0.05, freq: 500, gain: 0.06, decay: 0.04 });
    },
    grenadeThrow() {
      burst({ duration: 0.08, freq: 900, gain: 0.2, decay: 0.06 });
    },
    explosion(distance = 0) {
      const atten = Math.max(0.2, 1 - distance / 70);
      burst({ duration: 0.9, freq: 900, gain: 1.0 * atten, decay: 0.8 });
      tone({ freq: 90, freqEnd: 28, duration: 0.9, type: 'sine', gain: 0.9 * atten });
    },
    beep(final = false) {
      tone({ freq: final ? 1560 : 1180, duration: final ? 0.12 : 0.07, type: 'square', gain: 0.16 });
    },
    plant() {
      tone({ freq: 880, duration: 0.08, type: 'square', gain: 0.15 });
      tone({ freq: 880, duration: 0.08, type: 'square', gain: 0.15, when: 0.14 });
    },
    roundWin() {
      [523, 659, 784].forEach((f, i) => tone({ freq: f, duration: 0.16, type: 'triangle', gain: 0.22, when: i * 0.11 }));
    },
    roundLose() {
      [392, 330, 262].forEach((f, i) => tone({ freq: f, duration: 0.18, type: 'triangle', gain: 0.2, when: i * 0.12 }));
    },
    buy() {
      tone({ freq: 740, duration: 0.05, type: 'square', gain: 0.14 });
      tone({ freq: 1108, duration: 0.07, type: 'square', gain: 0.14, when: 0.05 });
    },
    denied() {
      tone({ freq: 220, duration: 0.12, type: 'square', gain: 0.16 });
    },
  };
}
