// 結果画面の個人成績（ランク S〜C）と自己ベストの記録。
// 自己ベストはこの端末の localStorage にだけ持つ（ランキングとは別。ひとりでも伸びが見えるように）
import { GRADE } from "./data";
import type { PlayerStats } from "./types";

export interface Report {
  kpm: number; // 打鍵/分
  acc: number; // 正確率 %
  combo: number; // 最大コンボ
  score: number; // 0〜100
  rank: (typeof GRADE.ranks)[number];
  /** 1つ上のランクと、そこまでの残り点数（S なら null） */
  next: { id: string; need: number } | null;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function makeReport(stats: PlayerStats | undefined, endedAt: number): Report {
  const typed = stats?.typed ?? 0;
  const miss = stats?.miss ?? 0;
  const combo = stats?.maxCombo ?? 0;
  const minutes = Math.max(0.25, (endedAt - (stats?.startAt || endedAt)) / 60000);
  const kpm = Math.round(typed / minutes);
  const acc = typed + miss > 0 ? Math.round((typed / (typed + miss)) * 100) : 0;
  const score = Math.round(
    GRADE.speedPts * clamp01(kpm / GRADE.speedFullKpm) +
      GRADE.accPts * clamp01((acc - GRADE.accFloor) / (100 - GRADE.accFloor)) +
      GRADE.comboPts * clamp01(combo / GRADE.comboFull)
  );
  const idx = GRADE.ranks.findIndex((r) => score >= r.min);
  const rank = GRADE.ranks[idx];
  const upper = idx > 0 ? GRADE.ranks[idx - 1] : null;
  return { kpm, acc, combo, score, rank, next: upper ? { id: upper.id, need: upper.min - score } : null };
}

// ---- 自己ベスト ----
const BEST_KEY = "th_best";
export interface Best {
  score: number;
  kpm: number;
  acc: number;
  combo: number;
}
export type BestKey = keyof Best;

export function loadBest(): Best | null {
  try {
    const b = JSON.parse(localStorage.getItem(BEST_KEY) ?? "null") as Partial<Best> | null;
    if (!b || typeof b.score !== "number") return null;
    return { score: b.score, kpm: b.kpm ?? 0, acc: b.acc ?? 0, combo: b.combo ?? 0 };
  } catch {
    return null;
  }
}

/** 今回の成績で自己ベストを更新し、更新できた項目を返す（初回は「更新」とは呼ばない） */
export function updateBest(r: Report): { prev: Best | null; beaten: BestKey[] } {
  const prev = loadBest();
  const keys: BestKey[] = ["score", "kpm", "acc", "combo"];
  const beaten = prev ? keys.filter((k) => r[k] > prev[k]) : [];
  const next: Best = {
    score: Math.max(r.score, prev?.score ?? 0),
    kpm: Math.max(r.kpm, prev?.kpm ?? 0),
    acc: Math.max(r.acc, prev?.acc ?? 0),
    combo: Math.max(r.combo, prev?.combo ?? 0),
  };
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(next));
  } catch {}
  return { prev, beaten };
}
