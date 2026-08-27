import type { Difficulty, GenreId } from "../typing/words";
import type { EquipId, RoleId } from "./types";

// ============================================================
// ロール（職業）
// ============================================================
export interface RoleDef {
  id: RoleId;
  label: string;
  icon: string;
  desc: string;
  dmgMult: number; // 与ダメージ倍率
  healMult: number; // 回復量倍率
  takenMult: number; // 被ダメージ倍率
  aggro: number; // 敵に狙われやすさ（重み）
  buffOnWord: boolean; // ワード完了で味方全体バフ
}

export const ROLES: RoleDef[] = [
  {
    id: "attacker", label: "アタッカー", icon: "⚔️",
    desc: "ダメージ1.25倍。とにかく敵を打ち倒す前衛。",
    dmgMult: 1.25, healMult: 0.8, takenMult: 1.0, aggro: 1, buffOnWord: false,
  },
  {
    id: "healer", label: "ヒーラー", icon: "💚",
    desc: "回復量1.6倍。仲間のライフを守る生命線。",
    dmgMult: 0.8, healMult: 1.6, takenMult: 1.0, aggro: 1, buffOnWord: false,
  },
  {
    id: "tank", label: "タンク", icon: "🛡️",
    desc: "敵に狙われやすいが被ダメージ35%カット。",
    dmgMult: 0.9, healMult: 1.0, takenMult: 0.65, aggro: 3, buffOnWord: false,
  },
  {
    id: "buffer", label: "バッファー", icon: "🎺",
    desc: "ワード完了で8秒間チーム火力+20%（全員に効果）。",
    dmgMult: 0.95, healMult: 1.0, takenMult: 1.0, aggro: 1, buffOnWord: true,
  },
];

export const roleDef = (id: RoleId): RoleDef =>
  ROLES.find((r) => r.id === id) ?? ROLES[0];

// ============================================================
// 装備（ステージクリア時ドロップ・1枠）
// ============================================================
export interface EquipDef {
  id: EquipId;
  label: string;
  icon: string;
  desc: string;
}

export const EQUIPS: EquipDef[] = [
  { id: "sword", label: "連打の剣", icon: "🗡️", desc: "与ダメージ +15%" },
  { id: "staff", label: "回復の杖", icon: "🪄", desc: "回復量 +25%" },
  { id: "shield", label: "守りの盾", icon: "🛡️", desc: "被ダメージ -20%" },
  { id: "boots", label: "疾風のブーツ", icon: "👢", desc: "ユニゾンゲージ +30%" },
];

export const equipDef = (id: EquipId): EquipDef | undefined =>
  EQUIPS.find((e) => e.id === id);

// ============================================================
// 敵
// ============================================================
export interface EnemyKind {
  id: string;
  name: string;
  icon: string;
  boss?: boolean;
  baseHp: number; // 1人あたり基準HP（人数・難易度で補正）
  atk: number; // 攻撃力
  atkInterval: number; // 攻撃間隔ms
  gimmicks?: ("ink" | "shuffle" | "katakana")[];
}

export const ENEMY_KINDS: Record<string, EnemyKind> = {
  slime: { id: "slime", name: "スライム", icon: "🟢", baseHp: 60, atk: 8, atkInterval: 9000 },
  bat: { id: "bat", name: "コウモリ", icon: "🦇", baseHp: 45, atk: 6, atkInterval: 7000 },
  mushroom: { id: "mushroom", name: "どくキノコ", icon: "🍄", baseHp: 55, atk: 9, atkInterval: 10000 },
  kingslime: {
    id: "kingslime", name: "キングスライム", icon: "👑", boss: true,
    baseHp: 220, atk: 13, atkInterval: 8000, gimmicks: ["shuffle"],
  },
  goblin: { id: "goblin", name: "ゴブリン", icon: "👺", baseHp: 70, atk: 10, atkInterval: 8000 },
  skeleton: { id: "skeleton", name: "ガイコツ", icon: "💀", baseHp: 65, atk: 11, atkInterval: 9000 },
  spider: { id: "spider", name: "おおグモ", icon: "🕷️", baseHp: 60, atk: 9, atkInterval: 7500 },
  dragon: {
    id: "dragon", name: "ドラゴン", icon: "🐉", boss: true,
    baseHp: 320, atk: 17, atkInterval: 7500, gimmicks: ["ink"],
  },
  ghost: { id: "ghost", name: "ゴースト", icon: "👻", baseHp: 75, atk: 11, atkInterval: 8000 },
  demon: { id: "demon", name: "デーモン", icon: "😈", baseHp: 85, atk: 13, atkInterval: 8500 },
  golem: { id: "golem", name: "ゴーレム", icon: "🗿", baseHp: 110, atk: 12, atkInterval: 11000 },
  maou: {
    id: "maou", name: "まおう", icon: "🐲", boss: true,
    baseHp: 450, atk: 20, atkInterval: 7000, gimmicks: ["ink", "shuffle", "katakana"],
  },
};

// ============================================================
// ステージ
// ============================================================
export interface StageDef {
  name: string;
  bg: string; // CSS グラデーション
  icon: string;
  waves: string[][]; // wave ごとの敵 kind 一覧（最後の wave にボス）
  weaknessPool: GenreId[]; // このステージの敵の弱点候補
}

export const STAGES: StageDef[] = [
  {
    name: "はじまりの森",
    icon: "🌲",
    bg: "linear-gradient(180deg,#0c2418 0%,#14381f 60%,#0a1f12 100%)",
    waves: [["slime", "bat", "mushroom"], ["kingslime", "slime"]],
    weaknessPool: ["food", "animal", "nature"],
  },
  {
    name: "こだまの洞窟",
    icon: "⛰️",
    bg: "linear-gradient(180deg,#1a1430 0%,#2a1e45 60%,#120e22 100%)",
    waves: [["goblin", "skeleton", "spider"], ["golem", "skeleton"], ["dragon"]],
    weaknessPool: ["vehicle", "it", "nature"],
  },
  {
    name: "まおうの城",
    icon: "🏰",
    bg: "linear-gradient(180deg,#2b0a14 0%,#3d0f1f 60%,#1a060c 100%)",
    waves: [["demon", "ghost", "ghost"], ["golem", "demon"], ["maou"]],
    weaknessPool: ["magic", "it", "food"],
  },
];

// ============================================================
// 難易度（チーム基準 = 敵の強さ補正）
// ============================================================
export interface DiffTuning {
  enemyHpMult: number;
  enemyAtkMult: number;
  atkIntervalMult: number; // 小さいほど敵の攻撃が速い
  defenseTime: number; // 防御ワードの猶予ms
  ragePerSec: number; // ボス怒りゲージ上昇/秒
}

export const DIFF_TUNING: Record<Difficulty, DiffTuning> = {
  easy: { enemyHpMult: 0.7, enemyAtkMult: 0.7, atkIntervalMult: 1.4, defenseTime: 6000, ragePerSec: 1.2 },
  normal: { enemyHpMult: 1.0, enemyAtkMult: 1.0, atkIntervalMult: 1.0, defenseTime: 5000, ragePerSec: 1.8 },
  hard: { enemyHpMult: 1.4, enemyAtkMult: 1.3, atkIntervalMult: 0.8, defenseTime: 4200, ragePerSec: 2.4 },
  oni: { enemyHpMult: 1.9, enemyAtkMult: 1.6, atkIntervalMult: 0.65, defenseTime: 3500, ragePerSec: 3.0 },
};

export const PLAYER_MAX_HP = 100;

// ---- ダメージ計算パラメータ ----
export const TUNING = {
  keyDamage: 1, // 1打鍵ごとの基礎ダメージ
  wordBonusPerKana: 2.2, // ワード完了ボーナス = かな数 × これ
  critMult: 1.5, // ノーミス完了クリティカル
  weaknessMult: 2.0, // 弱点ジャンル一致
  healPerKana: 3.0, // 回復量 = かな数 × これ
  keyHeal: 0.35, // 1打鍵ごとの微回復（回復モード時）
  chainWindow: 3000, // コンボチェイン受付ms
  chainBonusPer: 0.1, // チェイン1つごとの火力ボーナス
  chainBonusMax: 0.5,
  gaugePerWord: 9, // ワード完了ごとのユニゾンゲージ
  unisonDmgPerPlayer: 120, // ユニゾン成功時 全員×これ を全敵に
  unisonTime: 12000,
  reviveHpRatio: 0.4,
  rageAtkMult: 2.2, // 怒り爆発時の全体攻撃倍率
  missSelfDamage: 0, // ミスタイプの自傷（0=なし、コンボが切れるだけ）
  buffMult: 1.2,
  buffDuration: 8000,
};
