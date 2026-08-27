import type { Difficulty, GenreId } from "../typing/words";

export type RoleId = "attacker" | "healer" | "tank" | "buffer";
export type EquipId =
  | "none"
  | "sword" // 連打の剣: ダメージ+15%
  | "staff" // 回復の杖: 回復+25%
  | "shield" // 守りの盾: 被ダメ-20%
  | "boots"; // 疾風のブーツ: ゲージ+30%

export type RoomStatus =
  | "lobby"
  | "battle"
  | "stageclear"
  | "clear"
  | "gameover";

export interface PlayerState {
  name: string;
  role: RoleId;
  diff: Difficulty; // 個人ハンデ（出題難易度）
  hp: number;
  maxHp: number;
  alive: boolean; // false = 気絶（蘇生待ち）
  ready: boolean;
  joinedAt: number;
  lastSeen: number;
  equip: EquipId;
  spectator?: boolean;
  stats: PlayerStats;
}

export interface PlayerStats {
  damage: number;
  heal: number;
  typed: number;
  miss: number;
  maxCombo: number;
  defended: number; // 防御成功回数
  revived: number; // 蘇生した回数
  words: number; // 完了ワード数
  startAt: number; // WPM計測用
}

export interface EnemyState {
  kind: string; // EnemyKind id
  hp: number;
  maxHp: number;
  alive: boolean;
  weakness: GenreId;
}

export interface TelegraphEvent {
  type: "telegraph";
  id: string;
  enemyIdx: number;
  targets: string[]; // player ids ([] = 全体攻撃)
  dmg: number;
  resolveAt: number;
  at: number;
}

export interface GimmickEvent {
  type: "gimmick";
  id: string;
  gimmick: "ink" | "shuffle" | "katakana";
  duration: number;
  at: number;
}

export interface InfoEvent {
  type: "info";
  id: string;
  text: string;
  at: number;
}

export type BattleEvent = TelegraphEvent | GimmickEvent | InfoEvent;

export interface UnisonState {
  active: boolean;
  wordD: string;
  wordK: string;
  deadline: number;
  done: Record<string, boolean>;
  result?: "success" | "fail";
}

export interface ChainState {
  at: number;
  count: number;
  by: string;
}

export interface BuffState {
  until: number;
  mult: number;
  by: string;
}

export interface RoomMeta {
  createdAt: number;
  hostId: string;
  diff: Difficulty; // チーム基準難易度（敵の強さ）
  status: RoomStatus;
  stageIdx: number;
  wave: number;
  startedAt: number; // クリアタイム計測
  clearedAt: number;
  rage: number; // ボス怒りゲージ 0-100
  gauge: number; // ユニゾンゲージ 0-100
}

export interface RoomState {
  meta: RoomMeta;
  players: Record<string, PlayerState>;
  enemies: Record<string, EnemyState>;
  events: Record<string, BattleEvent>;
  unison: UnisonState | null;
  chain: ChainState | null;
  buff: BuffState | null;
}
