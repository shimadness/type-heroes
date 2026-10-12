// 軽量SE: WebAudio の合成だけで鳴らす（アセット不要）
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

// ---- 音量（大 / 小 / 消音 の3段階。ボタン1つで順に切り替える）----
const VOL_KEY = "th_vol";
export const VOLUME_STEPS = [1, 0.4, 0] as const;
let volume: number = (() => {
  try {
    const v = Number(localStorage.getItem(VOL_KEY) ?? "1");
    return VOLUME_STEPS.includes(v as (typeof VOLUME_STEPS)[number]) ? v : 1;
  } catch {
    return 1;
  }
})();
const volumeListeners = new Set<() => void>();

export const getVolume = () => volume;
export function subscribeVolume(cb: () => void): () => void {
  volumeListeners.add(cb);
  return () => volumeListeners.delete(cb);
}
export function cycleVolume(): void {
  volume = VOLUME_STEPS[(VOLUME_STEPS.indexOf(volume as (typeof VOLUME_STEPS)[number]) + 1) % VOLUME_STEPS.length];
  try {
    localStorage.setItem(VOL_KEY, String(volume));
  } catch {}
  if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
  volumeListeners.forEach((cb) => cb());
  if (volume > 0) sfx.wordDone(); // いまの大きさを耳で確かめられるように
}

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** BGM 用に同じ AudioContext と音量つまみを貸す（音量ボタン1つで効果音もBGMも変わる） */
export function audio(): { ctx: AudioContext; master: GainNode } | null {
  const a = ac();
  return a && master ? { ctx: a, master } : null;
}

/** オシレーター1発。delay（秒）で少し先に予約できる（setTimeout より拍がぶれない） */
function tone(
  freq: number,
  dur: number,
  type: OscillatorType = "square",
  vol = 0.04,
  slide = 0,
  delay = 0
) {
  const a = ac();
  if (!a || !master || volume === 0) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur);
}

/** ノイズ1発（打撃・斬撃・爆発の「ザッ」）。from→to へフィルタを動かすと風切り音になる */
function noise(
  dur: number,
  vol: number,
  from: number,
  to = from,
  filter: BiquadFilterType = "bandpass",
  delay = 0
) {
  const a = ac();
  if (!a || !master || volume === 0) return;
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = a.currentTime + delay;
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(from, t0);
  if (to !== from) f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
  const gain = a.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(gain).connect(master);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + dur);
}

// コンボが伸びるほど打鍵音が音階を上がっていく（ペンタトニックなので連打しても濁らない）
const PENTA = [0, 2, 4, 7, 9];
const COMBO_PER_STEP = 5;
const MAX_STEP = 14;

export const sfx = {
  type: (combo = 0) => {
    const step = Math.min(MAX_STEP, Math.floor(combo / COMBO_PER_STEP));
    const semis = 12 * Math.floor(step / PENTA.length) + PENTA[step % PENTA.length];
    tone(587 * 2 ** (semis / 12) * (1 + (Math.random() - 0.5) * 0.01), 0.06, "square", 0.022);
    noise(0.025, 0.012, 4000, 4000, "highpass");
  },
  miss: () => {
    tone(140, 0.16, "sawtooth", 0.05, -60);
    noise(0.1, 0.03, 300, 120, "lowpass");
  },
  wordDone: () => {
    noise(0.09, 0.035, 2400, 700);
    tone(660, 0.08, "square", 0.04);
    tone(880, 0.1, "square", 0.04, 0, 0.07);
  },
  crit: () => {
    noise(0.12, 0.05, 3200, 500);
    tone(660, 0.07, "square", 0.05);
    tone(990, 0.07, "square", 0.05, 0, 0.06);
    tone(1320, 0.14, "square", 0.05, 0, 0.12);
    tone(1976, 0.2, "triangle", 0.03, 0, 0.16);
  },
  /** 弱点ヒット: 電撃っぽい下降音 + 会心より太い打撃 */
  weak: () => {
    noise(0.16, 0.06, 1800, 200, "lowpass");
    tone(1400, 0.14, "sawtooth", 0.045, -1150);
    tone(784, 0.08, "square", 0.05, 0, 0.05);
    tone(1175, 0.08, "square", 0.05, 0, 0.11);
    tone(1568, 0.18, "square", 0.05, 0, 0.17);
  },
  /** コンボの節目（25, 50, …）。tier が上がるほど高く長いファンファーレ */
  comboUp: (tier = 0) => {
    const base = 523 * 2 ** (Math.min(tier, 4) / 6);
    [1, 1.26, 1.5, 2].forEach((m, i) => tone(base * m, 0.1, "square", 0.04, 0, i * 0.055));
  },
  heal: () => {
    tone(520, 0.1, "sine", 0.05);
    tone(780, 0.15, "sine", 0.05, 0, 0.09);
  },
  hurt: () => {
    tone(200, 0.2, "sawtooth", 0.06, -120);
    noise(0.18, 0.05, 500, 120, "lowpass");
  },
  warn: () => {
    tone(440, 0.1, "triangle", 0.05);
    tone(440, 0.1, "triangle", 0.05, 0, 0.15);
  },
  /** 敵が力をためる（自分が狙われたとき）。警告のピピッ + せり上がる唸り */
  charge: () => {
    tone(440, 0.1, "triangle", 0.05);
    tone(440, 0.1, "triangle", 0.05, 0, 0.15);
    tone(90, 0.7, "sawtooth", 0.035, 260, 0.1);
  },
  /** 敵が飛びかかる風切り音 */
  enemyAttack: () => noise(0.16, 0.05, 400, 2600),
  /** ぼうぎょワードを打ち切った: 盾を構える金属音 */
  guardReady: () => {
    tone(1568, 0.05, "square", 0.04);
    tone(2093, 0.14, "triangle", 0.045, 0, 0.04);
  },
  /** ガードで受け止めた: 硬いものに当たって弾く音 */
  guard: () => {
    noise(0.07, 0.06, 5000, 2500, "highpass");
    tone(1245, 0.05, "square", 0.05);
    tone(1865, 0.22, "triangle", 0.05, -300, 0.03);
  },
  kill: () => {
    noise(0.28, 0.07, 900, 80, "lowpass");
    tone(300, 0.08, "square", 0.05);
    tone(200, 0.08, "square", 0.05, 0, 0.06);
    tone(120, 0.18, "square", 0.05, 0, 0.12);
  },
  /** ボス登場: 低い警報が2回うなる */
  bossIntro: () => {
    [0, 0.42].forEach((d) => {
      tone(110, 0.36, "sawtooth", 0.07, 110, d);
      tone(55, 0.36, "square", 0.06, 0, d);
    });
    noise(0.9, 0.04, 200, 1200, "bandpass");
  },
  /** ボス撃破: 連鎖爆発（このあとすぐクリアのジングルが鳴るので、メロディは付けない） */
  bossDown: () => {
    [0, 0.14, 0.3, 0.48, 0.7].forEach((d, i) => noise(0.3, 0.08, 1200 - i * 150, 60, "lowpass", d));
    tone(220, 0.9, "sawtooth", 0.05, -180);
  },
  /** いかりゲージ満タンの全体攻撃予告 */
  rage: () => {
    tone(80, 0.6, "sawtooth", 0.07, 400);
    noise(0.6, 0.05, 150, 1500, "lowpass");
    [0.1, 0.25, 0.4].forEach((d) => tone(880, 0.08, "square", 0.05, 0, d));
  },
  // クリア系のジングルは、ボス撃破の爆発音が鳴り終わるころに始める
  stageClear: () => {
    [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone(f, i === 6 ? 0.4 : 0.11, "square", 0.05, 0, 0.7 + i * 0.1));
    [262, 330, 392].forEach((f) => tone(f, 0.5, "triangle", 0.05, 0, 1.3));
  },
  victory: () => {
    [523, 523, 523, 659, 784, 659, 784, 1046].forEach((f, i) => tone(f, i === 7 ? 0.7 : 0.13, "square", 0.05, 0, 0.7 + i * 0.13));
    [262, 330, 392, 523].forEach((f) => tone(f, 0.9, "triangle", 0.05, 0, 1.61));
  },
  /** 成績ランクのハンコ。S/A は高い和音つき */
  stamp: (good: boolean) => {
    noise(0.12, 0.08, 600, 100, "lowpass");
    tone(160, 0.14, "square", 0.06, -80);
    if (good) [1046, 1318, 1568].forEach((f, i) => tone(f, 0.25, "triangle", 0.04, 0, 0.08 + i * 0.06));
  },
  gameover: () => {
    [392, 370, 349, 330, 262].forEach((f, i) => tone(f, i === 4 ? 0.8 : 0.22, "triangle", 0.06, 0, i * 0.22));
    tone(65, 1.2, "sawtooth", 0.04, -20, 0.88);
  },
  /** ユニゾン: なかまが1人打ち終わるたびに鳴る。n 人目ほど高い（全員そろうと和音が完成する） */
  unisonTick: (n: number) => {
    const f = [523, 659, 784, 1046][Math.min(3, Math.max(0, n - 1))];
    tone(f, 0.22, "square", 0.05);
    tone(f * 2, 0.3, "triangle", 0.03, 0, 0.03);
  },
  /** ユニゾン成功: 全員の一斉攻撃 */
  unisonHit: () => {
    noise(0.5, 0.09, 2500, 80, "lowpass");
    [523, 659, 784, 1046].forEach((f) => tone(f, 0.5, "square", 0.04));
    tone(110, 0.5, "sawtooth", 0.06, -70);
    [1318, 1568, 2093].forEach((f, i) => tone(f, 0.18, "triangle", 0.04, 0, 0.12 + i * 0.07));
  },
  unisonFail: () => {
    tone(330, 0.2, "sawtooth", 0.05, -120);
    tone(220, 0.4, "sawtooth", 0.05, -120, 0.18);
  },
  /** チェインがつながった。数が増えるほど高い */
  chain: (count: number) => {
    const f = 660 * 2 ** (Math.min(12, count - 2) / 12);
    tone(f, 0.06, "triangle", 0.05);
    tone(f * 1.5, 0.12, "triangle", 0.05, 0, 0.05);
  },
  /** なかまが気絶した */
  down: () => {
    tone(392, 0.14, "square", 0.05, -150);
    tone(196, 0.4, "square", 0.05, -110, 0.13);
  },
  unison: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.15, "square", 0.05, 0, i * 0.08));
  },
  revive: () => {
    [392, 523, 659, 784].forEach((f, i) => tone(f, 0.12, "sine", 0.05, 0, i * 0.07));
  },
};
