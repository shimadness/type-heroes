import { DIFF_LABEL, type Difficulty, type GenreId } from "../typing/words";
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
// 敵（Engineer Navigator のダンジョンモンスターを流用）
// スプライト: public/en/<sprite>.png（ドット絵・192x192）
// ============================================================
export interface EnemyKind {
  id: string;
  name: string;
  sprite: string; // public/en/<sprite>.png
  boss?: boolean;
  baseHp: number; // 1人あたり基準HP（人数・難易度で補正）
  atk: number; // 攻撃力
  atkInterval: number; // 攻撃間隔ms
  gimmicks?: ("ink" | "shuffle" | "katakana")[];
  tint?: string; // 色違い（変異種）用の CSS filter。専用ドット絵ができたら sprite を差し替えて外す
  enc: string; // 出現時の一文
  win: string; // 撃破時の一文（ボスで表示）
}

export const ENEMY_KINDS: Record<string, EnemyKind> = {
  minibug: {
    id: "minibug", name: "ミニバグ", sprite: "mon-minibug",
    baseHp: 45, atk: 6, atkInterval: 8000,
    enc: "小さなバグが飛び出してきた！", win: "ワンライナーで退治した！",
  },
  typo: {
    id: "typo", name: "タイポの小人", sprite: "mon-typo",
    baseHp: 50, atk: 7, atkInterval: 9000,
    enc: "タイポの小人が足元にセミコロンを撒いた！", win: "リンターの光で追い払った！",
  },
  offbyone: {
    id: "offbyone", name: "オフバイワン鳥", sprite: "mon-offbyone",
    baseHp: 55, atk: 8, atkInterval: 8500,
    enc: "オフバイワン鳥が1歩ずれて飛んでいる！", win: "境界値を見切って捕まえた！",
  },
  mojibake: {
    id: "mojibake", name: "文字化けオバケ", sprite: "mon-mojibake",
    baseHp: 60, atk: 9, atkInterval: 9500,
    enc: "「縺ゅ→縺ｧ」と鳴く影が現れた！", win: "UTF-8の御札で祓った！",
  },
  infloop: {
    id: "infloop", name: "無限ループヘビ", sprite: "mon-infloop",
    baseHp: 65, atk: 10, atkInterval: 8000,
    enc: "自分の尻尾を追うヘビが道を塞いでいる！", win: "break文を投げて断ち切った！",
  },
  memleak: {
    id: "memleak", name: "メモリリークスライム", sprite: "mon-memleak",
    baseHp: 80, atk: 9, atkInterval: 10000,
    enc: "スライムがじわじわ膨らみ続けている！", win: "解放の呪文でしぼませた！",
  },
  nullpo: {
    id: "nullpo", name: "ヌルポ", sprite: "mon-nullpo",
    baseHp: 70, atk: 11, atkInterval: 8500,
    enc: "実体のない何かがそこに「無い」！", win: "Optionalの網で捕獲した！",
  },
  deadlock: {
    id: "deadlock", name: "デッドロックガニ", sprite: "mon-deadlock",
    baseHp: 85, atk: 10, atkInterval: 9500,
    enc: "2匹のカニが互いを挟んで動けない！", win: "片方に先を譲らせて突破！",
  },
  cacheghost: {
    id: "cacheghost", name: "キャッシュゴースト", sprite: "mon-cacheghost",
    baseHp: 80, atk: 12, atkInterval: 8000,
    enc: "倒したはずの敵の残像が立ちはだかる！", win: "スーパーリロードで消し飛ばした！",
  },
  flaky: {
    id: "flaky", name: "フレーキーコウモリ", sprite: "mon-flaky",
    baseHp: 70, atk: 11, atkInterval: 7000,
    enc: "たまにしか当たらない攻撃をするコウモリだ！", win: "3回リトライして見事命中！",
  },
  specchange: {
    id: "specchange", name: "仕様変更カメレオン", sprite: "mon-specchange",
    baseHp: 90, atk: 13, atkInterval: 9000,
    enc: "戦っている最中に姿が変わっていく！", win: "要件を書面で固定して撃破！",
  },
  debtgolem: {
    id: "debtgolem", name: "技術的負債ゴーレム", sprite: "mon-debtgolem", boss: true,
    baseHp: 230, atk: 13, atkInterval: 8000, gimmicks: ["shuffle"],
    enc: "放置された年月のぶんだけ硬いゴーレムが現れた！",
    win: "小さなリファクタを積み重ねて崩した！",
  },
  legacydragon: {
    id: "legacydragon", name: "レガシーコードドラゴン", sprite: "mon-legacydragon", boss: true,
    baseHp: 330, atk: 17, atkInterval: 7500, gimmicks: ["ink", "shuffle"],
    enc: "誰も全容を知らない巨竜が目を覚ました！",
    win: "テストで外堀を埋め、ついに打ち倒した！",
  },
  prodhydra: {
    id: "prodhydra", name: "本番障害ヒュドラ", sprite: "mon-prodhydra", boss: true,
    baseHp: 460, atk: 20, atkInterval: 7000, gimmicks: ["ink", "shuffle", "katakana"],
    enc: "首を1本直すと2本生える怪物が咆哮した！",
    win: "根本原因の心臓を貫いた！！",
  },

  // ---- 変異種（うぉーろーど専用。STAGES に載せていないのでストーリーには出ない）----
  zombieproc: {
    id: "zombieproc", name: "ゾンビプロセス", sprite: "mon-nullpo",
    tint: "hue-rotate(90deg) saturate(1.3)",
    baseHp: 85, atk: 13, atkInterval: 8000,
    enc: "殺しても消えないプロセスがうろついている！", win: "親に wait させて成仏させた！",
  },
  racecond: {
    id: "racecond", name: "レースコンディション鳥", sprite: "mon-offbyone",
    tint: "hue-rotate(200deg)",
    baseHp: 75, atk: 12, atkInterval: 6500,
    enc: "2羽が同時に同じ実を狙って突っ込んでくる！", win: "ロックをかけて順番に捕まえた！",
  },
  oomkiller: {
    id: "oomkiller", name: "OOMキラー", sprite: "mon-memleak",
    tint: "hue-rotate(-60deg) saturate(1.6)",
    baseHp: 120, atk: 15, atkInterval: 10000,
    enc: "メモリを食い尽くした巨大スライムが迫る！", win: "スワップを増やしてしのぎ切った！",
  },
  segfault: {
    id: "segfault", name: "セグフォ", sprite: "mon-mojibake",
    tint: "hue-rotate(300deg) contrast(1.3)",
    baseHp: 90, atk: 14, atkInterval: 8500,
    enc: "触ってはいけない番地から何かが這い出した！", win: "境界チェックで封印した！",
  },
  stackdragon: {
    id: "stackdragon", name: "スタックオーバーフロー竜", sprite: "mon-legacydragon", boss: true,
    tint: "hue-rotate(160deg)",
    baseHp: 520, atk: 22, atkInterval: 6800, gimmicks: ["ink", "shuffle", "katakana"],
    enc: "再帰の底から無限に積み上がる竜が現れた！",
    win: "終了条件を書き足して積み上がりを止めた！！",
  },
};

// ============================================================
// ステージ（エンジニアダンジョン）
// ============================================================
export interface StageDef {
  name: string;
  bg: string; // CSS グラデーション
  icon: string;
  waves: string[][]; // wave ごとの敵 kind 一覧（最後の wave にボス）
  weaknessPool: GenreId[]; // このステージの敵の弱点候補
  deco: string[]; // 床に並べる装飾スプライト（public/en/<name>.png）
}

export const STAGES: StageDef[] = [
  {
    name: "開発フロア",
    icon: "💻",
    bg: "linear-gradient(180deg,#0d1b2a 0%,#16324a 55%,#0a1522 100%)",
    waves: [["minibug", "typo", "offbyone"], ["debtgolem", "mojibake"]],
    weaknessPool: ["it", "food", "animal"],
    deco: ["gad-crt", "gad-succulent", "gad-elec-desk", "gad-tate-monitor", "gad-retro-pc"],
  },
  {
    name: "サーバールーム",
    icon: "🗄️",
    bg: "linear-gradient(180deg,#0a0f2e 0%,#151d4d 55%,#080c20 100%)",
    waves: [["infloop", "memleak", "nullpo"], ["deadlock", "memleak"], ["legacydragon"]],
    weaknessPool: ["it", "vehicle", "nature"],
    deco: ["gad-rack-server", "gad-rack42u", "gad-raspi-cluster", "gad-ups", "gad-rack-server"],
  },
  {
    name: "本番環境",
    icon: "🚨",
    bg: "linear-gradient(180deg,#2b0a0f 0%,#471219 55%,#1a0508 100%)",
    waves: [["cacheghost", "flaky", "specchange"], ["specchange", "cacheghost"], ["prodhydra"]],
    weaknessPool: ["it", "magic", "food"],
    deco: ["icon-trap", "gad-rack42u", "gad-ups", "icon-trap", "gad-printer3d"],
  },
];

// ============================================================
// 難易度（チーム基準 = 敵の強さ補正）
//
// ★新ティアを足すときは DIFF_TUNING にエントリを1つ追加するだけ。
//   型（TeamDifficulty）・一覧（TEAM_DIFFS）・ロビー/ランキングのボタン・
//   バトル画面のラベル・チュートリアル完了画面の説明はすべてここから導出される。
//   出題ワードは words.ts の Difficulty（easy〜oni）までしか無いので、
//   上位ティアは「敵の強さ」だけを持ち、個人ハンデ側には出ない。
// ============================================================
export interface DiffTuning {
  label: string; // 表示名
  color: string; // ボタン・バッジの色（CSS）
  enemyHpMult: number;
  enemyAtkMult: number;
  atkIntervalMult: number; // 小さいほど敵の攻撃が速い
  defenseTime: number; // 防御ワードの猶予ms
  ragePerSec: number; // ボス怒りゲージ上昇/秒
  missSelfDamage: number; // ミスタイプ1回の自傷ダメージ（0=なし、コンボが切れるだけ）
}

export const DIFF_TUNING = {
  easy: {
    label: DIFF_LABEL.easy, color: "#4ade80",
    enemyHpMult: 0.7, enemyAtkMult: 0.7, atkIntervalMult: 1.4, defenseTime: 6000, ragePerSec: 1.2,
    missSelfDamage: 0,
  },
  normal: {
    label: DIFF_LABEL.normal, color: "#60a5fa",
    enemyHpMult: 1.0, enemyAtkMult: 1.0, atkIntervalMult: 1.0, defenseTime: 5000, ragePerSec: 1.8,
    missSelfDamage: 0,
  },
  hard: {
    label: DIFF_LABEL.hard, color: "#fb923c",
    enemyHpMult: 1.4, enemyAtkMult: 1.3, atkIntervalMult: 0.8, defenseTime: 4200, ragePerSec: 2.4,
    missSelfDamage: 0,
  },
  oni: {
    label: DIFF_LABEL.oni, color: "#f43f5e",
    enemyHpMult: 1.9, enemyAtkMult: 1.6, atkIntervalMult: 0.65, defenseTime: 3500, ragePerSec: 3.0,
    missSelfDamage: 0,
  },
  // ここから上位ティア（ワードは「おに」を流用）。ミス自傷で差別化する
  nightmare: {
    label: "ないとめあ", color: "#c084fc",
    enemyHpMult: 2.4, enemyAtkMult: 1.9, atkIntervalMult: 0.55, defenseTime: 3000, ragePerSec: 3.6,
    missSelfDamage: 2,
  },
} satisfies Record<string, DiffTuning>;

/** チーム難易度（敵の強さ）の id。DIFF_TUNING のキーから導出 */
export type TeamDifficulty = keyof typeof DIFF_TUNING;
/** チーム難易度の一覧（定義順＝表示順） */
export const TEAM_DIFFS = Object.keys(DIFF_TUNING) as TeamDifficulty[];
export const teamDiffDef = (d: TeamDifficulty): DiffTuning => DIFF_TUNING[d];
// 個人ハンデ（Difficulty）は必ずチーム難易度にも存在すること（Title の初期値 "normal" 等の保証）
const _assertWordDiffsAreTeamDiffs: Record<Difficulty, DiffTuning> = DIFF_TUNING;
void _assertWordDiffsAreTeamDiffs;

export const PLAYER_MAX_HP = 100;

// ---- ダメージ計算パラメータ ----
export const TUNING = {
  keyDamage: 1, // 1打鍵ごとの基礎ダメージ
  wordBonusPerKana: 2.2, // ワード完了ボーナス = かな数 × これ
  critMult: 1.5, // ノーミス完了クリティカル
  weaknessMult: 2.5, // 弱点ジャンル一致（雑魚）
  bossWeaknessMult: 3.5, // 弱点ジャンル一致（ボス）— 早打ちゴリ押しよりカード選びが強い
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
  stageHealRatio: 0.3, // ステージクリア／サバイバルのボス撃破後の回復（maxHp比）
  buffMult: 1.2,
  buffDuration: 8000,
};

// ============================================================
// うぉーろーど（サバイバル）: 無限ウェーブの成長パラメータ
// ============================================================
export const SURVIVAL = {
  bossEvery: 5, // n ウェーブごとにボス（撃破後に回復＋装備ドロップ）
  baseEnemies: 2, // 最初の雑魚ウェーブの体数
  maxEnemies: 4,
  enemiesGrowEvery: 3, // n ウェーブごとに雑魚が1体増える
  hpGrowthPerWave: 0.12, // 敵HP = 基準 × (1 + これ × wave)
  atkGrowthPerWave: 0.05, // 敵攻撃 = 基準 × min(atkGrowthMax, 1 + これ × wave)
  atkGrowthMax: 2.0,
};
