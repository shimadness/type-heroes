// BGM: 効果音と同じく WebAudio の合成だけで鳴らすチップチューン（アセット不要）。
// 16分音符刻みのステップシーケンサーで、少し先の音を AudioContext の時計に予約していく。
import { audio } from "./sfx";

const _ = null;
type Step = number | null; // MIDI ノート番号 / 休符

interface Track {
  bpm: number;
  /** 小節ごとのベースの根音（MIDI） */
  roots: number[];
  /** 小節ごとのメロディ（16ステップ） */
  lead: Step[][];
  /** ベースの刻み（根音からの半音。16ステップ） */
  bass: Step[];
  kick: number[];
  snare: number[];
  hat: number[];
  leadType: OscillatorType;
}

// ---- ふつうのバトル: Aマイナー。Am-F-C-G / Am-F-G-E の8小節 ----
const BATTLE: Track = {
  bpm: 152,
  roots: [45, 41, 48, 43, 45, 41, 43, 40],
  lead: [
    [69, _, 72, _, 76, _, 72, _, 69, _, 72, 76, _, 74, 72, _],
    [69, _, 72, _, 77, _, 72, _, 69, _, 72, 77, _, 76, 72, _],
    [67, _, 72, _, 76, _, 72, _, 67, _, 72, 76, _, 79, 76, _],
    [67, _, 71, _, 74, _, 71, _, 74, _, 76, 74, _, 71, 67, _],
    [76, _, _, 74, 72, _, 74, _, 76, _, _, 79, 76, _, 74, _],
    [77, _, _, 76, 72, _, 69, _, 72, _, _, 77, 76, _, 72, _],
    [74, _, _, 71, 67, _, 71, _, 74, _, _, 79, 74, _, 71, _],
    [71, _, _, 68, 64, _, 68, _, 71, _, 76, _, 80, _, 83, _],
  ],
  bass: [0, _, 12, _, 0, _, 12, _, 0, _, 12, _, 7, _, 12, _],
  kick: [0, 8, 10],
  snare: [4, 12],
  hat: [2, 6, 10, 14],
  leadType: "square",
};

// ---- ボス戦: Eマイナー。速くて低音が16分で刻む。Em-Em-C-D / Em-Em-C-B ----
const BOSS: Track = {
  bpm: 176,
  roots: [40, 40, 36, 38, 40, 40, 36, 35],
  lead: [
    [76, _, 76, 79, _, 76, _, 74, 76, _, 76, 79, _, 83, _, 81],
    [79, _, 76, _, 74, _, 76, _, 71, _, _, 74, 76, _, _, _],
    [72, _, 72, 76, _, 72, _, 71, 72, _, 72, 76, _, 79, _, 76],
    [74, _, 74, 78, _, 74, _, 72, 74, _, 74, 78, _, 81, _, 78],
    [76, _, 76, 79, _, 76, _, 74, 76, _, 76, 79, _, 83, _, 86],
    [88, _, 86, _, 83, _, 79, _, 76, _, _, 79, 83, _, _, _],
    [84, _, 79, 76, _, 72, _, 76, 79, _, 84, _, 83, _, 79, _],
    [83, _, 78, 75, _, 71, _, 75, 78, _, 83, _, 87, _, 90, _],
  ],
  bass: [0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 7, 12, 7],
  kick: [0, 4, 8, 12],
  snare: [4, 12, 15],
  hat: [2, 6, 10, 14],
  leadType: "sawtooth",
};

const TRACKS = { battle: BATTLE, boss: BOSS };
export type BgmName = keyof typeof TRACKS;

const BGM_LEVEL = 0.5; // 効果音より控えめに
const LOOKAHEAD = 0.14; // この秒数ぶん先まで予約しておく
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

let gain: GainNode | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let current: BgmName | null = null;
let step = 0;
let nextTime = 0;
let noiseBuf: AudioBuffer | null = null;

function voice(ctx: AudioContext, freq: number, t: number, dur: number, type: OscillatorType, vol: number, slideTo = 0) {
  if (!gain) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.setValueAtTime(vol, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(gain);
  osc.start(t);
  osc.stop(t + dur + 0.01);
}

function hiss(ctx: AudioContext, t: number, dur: number, vol: number, freq: number) {
  if (!gain) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(gain);
  src.start(t);
  src.stop(t + dur);
}

function playStep(ctx: AudioContext, tr: Track, s: number, t: number) {
  const sixteenth = 60 / tr.bpm / 4;
  const bar = Math.floor(s / 16) % tr.roots.length;
  const i = s % 16;
  const lead = tr.lead[bar][i];
  if (lead !== null) voice(ctx, hz(lead), t, sixteenth * 1.7, tr.leadType, tr.leadType === "sawtooth" ? 0.03 : 0.035);
  const bass = tr.bass[i];
  if (bass !== null) voice(ctx, hz(tr.roots[bar] + bass), t, sixteenth * 1.5, "triangle", 0.09);
  if (tr.kick.includes(i)) voice(ctx, 150, t, 0.11, "sine", 0.16, 45);
  if (tr.snare.includes(i)) hiss(ctx, t, 0.09, 0.06, 1800);
  if (tr.hat.includes(i)) hiss(ctx, t, 0.03, 0.025, 7000);
}

function pump() {
  const a = audio();
  if (!a || !current) return;
  const tr = TRACKS[current];
  // タブが裏に回るなどして予約が遅れたら、たまった分を一気に鳴らさず今から仕切り直す
  if (nextTime < a.ctx.currentTime) nextTime = a.ctx.currentTime + 0.05;
  while (nextTime < a.ctx.currentTime + LOOKAHEAD) {
    playStep(a.ctx, tr, step, nextTime);
    nextTime += 60 / tr.bpm / 4;
    step = (step + 1) % (tr.roots.length * 16);
  }
}

export const bgm = {
  /** 曲を流す。同じ曲なら何もしない（再描画のたびに頭出ししない） */
  play(name: BgmName) {
    if (current === name) return;
    const a = audio();
    if (!a) return;
    if (!gain) {
      gain = a.ctx.createGain();
      gain.connect(a.master);
    }
    gain.gain.cancelScheduledValues(a.ctx.currentTime);
    gain.gain.setValueAtTime(BGM_LEVEL, a.ctx.currentTime);
    current = name;
    step = 0;
    nextTime = a.ctx.currentTime + 0.08;
    if (!timer) timer = setInterval(pump, 25);
  },
  stop() {
    if (!current) return;
    current = null;
    if (timer) clearInterval(timer);
    timer = null;
    const a = audio();
    // 予約済みの音がぶつ切りにならないよう、短くフェードアウトさせる
    if (a && gain) gain.gain.setTargetAtTime(0, a.ctx.currentTime, 0.08);
  },
  /** いま流れている曲（確認用） */
  playing: () => current,
};
