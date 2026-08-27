// 軽量SE: WebAudio のオシレーターだけで鳴らす（アセット不要）
let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType = "square",
  vol = 0.04,
  slide = 0
) {
  const a = ac();
  if (!a) return;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, a.currentTime);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), a.currentTime + dur);
  gain.gain.setValueAtTime(vol, a.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  osc.connect(gain).connect(a.destination);
  osc.start();
  osc.stop(a.currentTime + dur);
}

export const sfx = {
  type: () => tone(880 + Math.random() * 200, 0.05, "square", 0.025),
  miss: () => tone(140, 0.15, "sawtooth", 0.05, -60),
  wordDone: () => {
    tone(660, 0.08, "square", 0.04);
    setTimeout(() => tone(880, 0.1, "square", 0.04), 70);
  },
  crit: () => {
    tone(660, 0.07, "square", 0.05);
    setTimeout(() => tone(990, 0.07, "square", 0.05), 60);
    setTimeout(() => tone(1320, 0.12, "square", 0.05), 120);
  },
  heal: () => {
    tone(520, 0.1, "sine", 0.05);
    setTimeout(() => tone(780, 0.15, "sine", 0.05), 90);
  },
  hurt: () => tone(200, 0.2, "sawtooth", 0.06, -120),
  warn: () => {
    tone(440, 0.1, "triangle", 0.05);
    setTimeout(() => tone(440, 0.1, "triangle", 0.05), 150);
  },
  kill: () => {
    tone(300, 0.08, "square", 0.05);
    setTimeout(() => tone(200, 0.08, "square", 0.05), 60);
    setTimeout(() => tone(120, 0.15, "square", 0.05), 120);
  },
  unison: () => {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => tone(f, 0.15, "square", 0.05), i * 80)
    );
  },
  revive: () => {
    [392, 523, 659, 784].forEach((f, i) =>
      setTimeout(() => tone(f, 0.12, "sine", 0.05), i * 70)
    );
  },
};
