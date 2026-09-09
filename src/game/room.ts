// ============================================================
// ルーム操作（プレイヤー共通アクション）
// パスワード = ルームキー。RTDB の typing/rooms/{password} 配下に全状態を置く
// ============================================================
import type { Store, Unsubscribe } from "../net/store";
import type {
  BattleEvent,
  EnemyState,
  PlayerState,
  PlayerStats,
  RoomState,
  RoomMeta,
} from "./types";
import type { Difficulty, GenreId } from "../typing/words";
import { PLAYER_MAX_HP, TUNING, roleDef } from "./data";
import type { TeamDifficulty } from "./data";
import type { EquipId, GameMode, RoleId } from "./types";

export const ROOT = "typing";

/** 心拍（lastSeen 更新）の間隔 */
export const HEARTBEAT_MS = 5000;
/** 部屋の使用中判定: 最後の心拍からこれ以上経っていたら「もういない」とみなす */
export const LIVE_WINDOW_MS = 60000;

/**
 * ちゃんと中身のあるプレイヤーか。
 * 通信断で onDisconnect がノードを消したあと、心拍だけが `{lastSeen}` を書き戻して
 * 名前もHPもない「ゾンビ」が残ることがある。そういうのは居ないものとして扱う。
 */
export function isLivePlayer(p: unknown): p is PlayerState {
  const q = p as Partial<PlayerState> | null | undefined;
  return !!q && typeof q.hp === "number" && typeof q.name === "string";
}

/** いまも遊んでいそうなプレイヤー（ゾンビ・心拍が途絶えた人・観戦者を除く） */
export function livePlayersOf(
  players: Record<string, unknown> | null | undefined,
  now = Date.now()
): [string, PlayerState][] {
  return Object.entries(players ?? {}).filter((e): e is [string, PlayerState] => {
    const p = e[1];
    if (!isLivePlayer(p) || p.spectator) return false;
    return now - (p.lastSeen ?? 0) < LIVE_WINDOW_MS;
  });
}

/** パスワードを RTDB キーとして安全な形に整える */
export function sanitizeRoomCode(pw: string): string {
  return pw.trim().replace(/[.#$\[\]\/\s]/g, "").slice(0, 12);
}

export function newPlayerId(): string {
  return `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function emptyStats(): PlayerStats {
  return {
    damage: 0, heal: 0, typed: 0, miss: 0, maxCombo: 0,
    defended: 0, revived: 0, words: 0, kills: 0, startAt: 0,
  };
}

export interface JoinProfile {
  name: string;
  role: RoleId;
  diff: Difficulty;
}

export class Room {
  readonly store: Store;
  readonly code: string;
  readonly myId: string;
  readonly spectator: boolean;
  private hbTimer: ReturnType<typeof setInterval> | null = null;
  /** 自分の最新状態（ノードが消されたときの復元用） */
  private self: PlayerState | null = null;
  private left = false;
  private lastRestoreAt = 0;
  /** 参加した部屋の createdAt。別の人が同じあいことばで作り直した部屋には復元しない */
  private roomCreatedAt = 0;

  constructor(store: Store, code: string, myId: string, spectator = false) {
    this.store = store;
    this.code = code;
    this.myId = myId;
    this.spectator = spectator;
  }

  get base() {
    return `${ROOT}/rooms/${this.code}`;
  }
  get myPath() {
    return `${this.base}/players/${this.myId}`;
  }

  // ---------- lifecycle ----------

  static async create(
    store: Store,
    code: string,
    profile: JoinProfile,
    teamDiff: TeamDifficulty,
    mode: GameMode = "story"
  ): Promise<Room> {
    const myId = newPlayerId();
    const room = new Room(store, code, myId);
    const meta: RoomMeta = {
      createdAt: Date.now(),
      hostId: myId,
      diff: teamDiff,
      mode,
      kills: 0,
      status: "lobby",
      stageIdx: 0,
      wave: 0,
      startedAt: 0,
      clearedAt: 0,
      rage: 0,
      gauge: 0,
    };
    // write は配下ごと置き換えるので、放置された古い部屋（players/enemies/events）は消える
    await store.write(room.base, { meta });
    room.roomCreatedAt = meta.createdAt;
    await room.writeSelf(profile);
    return room;
  }

  /** 部屋に「いまも遊んでいる人」がいるか（あいことばの使用中判定） */
  static async hasLivePlayers(store: Store, code: string): Promise<boolean> {
    const players = (await store.read(`${ROOT}/rooms/${code}/players`)) as
      | Record<string, unknown>
      | null;
    return livePlayersOf(players).length > 0;
  }

  static async join(
    store: Store,
    code: string,
    profile: JoinProfile
  ): Promise<Room> {
    const data = (await store.read(`${ROOT}/rooms/${code}`)) as RoomState | null;
    const meta = data?.meta;
    if (!meta) throw new Error("そのあいことばの部屋が見つからないよ");
    if (meta.status !== "lobby") {
      // 全滅・クリア後に全員タイトルへ戻った部屋は「出発済み」のまま残る。
      // 誰も残っていなければ同じあいことばで作り直す（難易度・モードは引き継ぐ）
      if (livePlayersOf(data?.players).length === 0) {
        return Room.create(store, code, profile, meta.diff, meta.mode ?? "story");
      }
      throw new Error("この部屋はもう出発してしまった…（観戦は可能）");
    }
    const room = new Room(store, code, newPlayerId());
    room.roomCreatedAt = meta.createdAt;
    await room.writeSelf(profile);
    return room;
  }

  static async spectate(store: Store, code: string): Promise<Room> {
    const meta = (await store.read(`${ROOT}/rooms/${code}/meta`)) as RoomMeta | null;
    if (!meta) throw new Error("そのあいことばの部屋が見つからないよ");
    return new Room(store, code, newPlayerId(), true);
  }

  private async writeSelf(profile: JoinProfile) {
    const p: PlayerState = {
      name: profile.name.slice(0, 10) || "ゆうしゃ",
      role: profile.role,
      diff: profile.diff,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      alive: true,
      ready: false,
      joinedAt: Date.now(),
      lastSeen: Date.now(),
      equip: "none",
      stats: emptyStats(),
    };
    this.self = p;
    await this.store.write(this.myPath, p);
    this.store.onDisconnectRemove(this.myPath);
    this.hbTimer = setInterval(() => {
      this.store.update(this.myPath, { lastSeen: Date.now() }).catch(() => {});
    }, HEARTBEAT_MS);
  }

  subscribe(cb: (state: RoomState | null) => void): Unsubscribe {
    return this.store.subscribe(this.base, (v) => {
      const state = (v as RoomState) ?? null;
      this.keepSelfAlive(state);
      cb(state);
    });
  }

  /**
   * 通信断からの復帰対策。
   * 切断中に onDisconnect が自分のノードを消し、復帰後は心拍が `{lastSeen}` だけを
   * 書き戻すので、名前もHPもないゾンビになってしまう（次ステージへ進めない等の原因）。
   * 自分の最新状態を覚えておき、消えていたら書き戻す。
   */
  private keepSelfAlive(state: RoomState | null) {
    if (this.spectator || this.left || !state?.meta) return;
    const cur = state.players?.[this.myId];
    if (isLivePlayer(cur)) {
      this.self = cur;
      return;
    }
    if (!this.self) return;
    // 別の人が同じあいことばで作り直した部屋なら、そこには入り込まない
    if (this.roomCreatedAt && state.meta.createdAt !== this.roomCreatedAt) return;
    const now = Date.now();
    if (now - this.lastRestoreAt < 3000) return;
    this.lastRestoreAt = now;
    const restored: PlayerState = { ...this.self, lastSeen: now };
    this.store.write(this.myPath, restored).catch((e) => {
      console.warn("[TYPE HEROES] 自分の状態の復元に失敗", e);
    });
    // onDisconnect は発火すると消えるので張り直す
    this.store.onDisconnectRemove(this.myPath);
  }

  async leave() {
    this.left = true;
    if (this.hbTimer) clearInterval(this.hbTimer);
    if (!this.spectator) await this.store.remove(this.myPath).catch(() => {});
  }

  dispose() {
    this.left = true;
    if (this.hbTimer) clearInterval(this.hbTimer);
  }

  // ---------- lobby ----------

  setProfile(partial: Partial<Pick<PlayerState, "role" | "diff" | "ready" | "name">>) {
    return this.store.update(this.myPath, partial as Record<string, unknown>);
  }

  setTeamDiff(diff: TeamDifficulty) {
    return this.store.update(`${this.base}/meta`, { diff });
  }

  /** ステージクリア画面での装備えらび */
  setEquip(equip: EquipId) {
    return this.store.update(this.myPath, { equip });
  }

  // ---------- battle: 攻撃・回復 ----------

  /** 打鍵ダメージのフラッシュ（まとめて適用）。敵が倒れたら true */
  async damageEnemy(enemyIdx: number, amount: number): Promise<boolean> {
    let killed = false;
    await this.store.transaction(
      `${this.base}/enemies/${enemyIdx}`,
      (cur) => {
        const e = cur as EnemyState | null;
        if (!e || !e.alive) return cur;
        const hp = Math.max(0, e.hp - amount);
        killed = hp <= 0;
        return { ...e, hp, alive: hp > 0 };
      }
    );
    return killed;
  }

  /** 回復: 対象プレイヤーのHPを増やす */
  healPlayer(pid: string, amount: number) {
    return this.store.transaction(
      `${this.base}/players/${pid}`,
      (cur) => {
        const p = cur as PlayerState | null;
        if (!p || !p.alive) return cur;
        return { ...p, hp: Math.min(p.maxHp, Math.round(p.hp + amount)) };
      }
    );
  }

  /** 自分への被ダメージ適用（気絶判定込み） */
  damageSelf(amount: number) {
    return this.store.transaction(this.myPath, (cur) => {
      const p = cur as PlayerState | null;
      if (!p || !p.alive) return cur;
      const hp = Math.max(0, Math.round(p.hp - amount));
      return { ...p, hp, alive: hp > 0 };
    });
  }

  /** 仲間を蘇生 */
  async revive(pid: string) {
    await this.store.transaction(`${this.base}/players/${pid}`, (cur) => {
      const p = cur as PlayerState | null;
      if (!p || p.alive) return cur;
      return {
        ...p,
        alive: true,
        hp: Math.round(p.maxHp * TUNING.reviveHpRatio),
      };
    });
  }

  /** ワード完了時のチェイン更新。新しいチェイン数を返す */
  async registerChain(): Promise<number> {
    let count = 1;
    await this.store.transaction(`${this.base}/chain`, (cur) => {
      const c = cur as { at: number; count: number; by: string } | null;
      const now = Date.now();
      if (c && now - c.at <= TUNING.chainWindow && c.by !== this.myId) {
        count = c.count + 1;
      } else if (c && now - c.at <= TUNING.chainWindow && c.by === this.myId) {
        count = c.count; // 自分連続はチェイン延長せず維持
      } else {
        count = 1;
      }
      return { at: now, count, by: this.myId };
    });
    return count;
  }

  /** ユニゾンゲージを加算 */
  addGauge(amount: number) {
    return this.store.transaction(`${this.base}/meta/gauge`, (cur) => {
      const g = typeof cur === "number" ? cur : 0;
      return Math.min(100, g + amount);
    });
  }

  /** バッファーの応援バフ */
  applyBuff() {
    return this.store.write(`${this.base}/buff`, {
      until: Date.now() + TUNING.buffDuration,
      mult: TUNING.buffMult,
      by: this.myId,
    });
  }

  /** 自分の累積スタッツをマージ加算 */
  flushStats(delta: Partial<PlayerStats>) {
    return this.store.transaction(`${this.myPath}/stats`, (cur) => {
      const s = (cur as PlayerStats | null) ?? emptyStats();
      return {
        ...s,
        damage: s.damage + (delta.damage ?? 0),
        heal: s.heal + (delta.heal ?? 0),
        typed: s.typed + (delta.typed ?? 0),
        miss: s.miss + (delta.miss ?? 0),
        words: s.words + (delta.words ?? 0),
        defended: s.defended + (delta.defended ?? 0),
        revived: s.revived + (delta.revived ?? 0),
        kills: (s.kills ?? 0) + (delta.kills ?? 0),
        maxCombo: Math.max(s.maxCombo, delta.maxCombo ?? 0),
        startAt: s.startAt || delta.startAt || 0,
      };
    });
  }

  // ---------- ユニゾンアタック ----------

  async triggerUnison(wordD: string, wordK: string) {
    await this.store.update(`${this.base}`, {
      unison: {
        active: true,
        wordD,
        wordK,
        deadline: Date.now() + TUNING.unisonTime,
        done: {},
      },
      "meta/gauge": 0,
    });
  }

  unisonDone() {
    return this.store.write(
      `${this.base}/unison/done/${this.myId}`,
      true
    );
  }

  // ---------- events ----------

  pushEvent(ev: Omit<BattleEvent, "id">) {
    return this.store.push(`${this.base}/events`, ev);
  }

  // ---------- helpers ----------

  /** 与ダメージ倍率（ロール・装備・バフ・チェイン込み）。weaknessMult は 1（不一致）〜 boss弱点倍率 */
  static damageMult(
    me: PlayerState,
    state: RoomState | null,
    chainCount: number,
    weaknessMult: number,
    crit: boolean
  ): number {
    const r = roleDef(me.role);
    let m = r.dmgMult;
    if (me.equip === "sword") m *= 1.15;
    const buff = state?.buff;
    if (buff && buff.until > Date.now()) m *= buff.mult;
    m *= 1 + Math.min(TUNING.chainBonusMax, Math.max(0, chainCount - 1) * TUNING.chainBonusPer);
    m *= weaknessMult;
    if (crit) m *= TUNING.critMult;
    return m;
  }

  static healMult(me: PlayerState): number {
    const r = roleDef(me.role);
    let m = r.healMult;
    if (me.equip === "staff") m *= 1.25;
    return m;
  }

  static takenMult(me: PlayerState): number {
    const r = roleDef(me.role);
    let m = r.takenMult;
    if (me.equip === "shield") m *= 0.8;
    return m;
  }
}

/** 生きているプレイヤー一覧（観戦者・ゾンビ除く） */
export function alivePlayers(state: RoomState): [string, PlayerState][] {
  return allPlayers(state).filter(([, p]) => p.alive);
}

/** パーティー全員（観戦者・ゾンビ除く）。ゾンビを混ぜると hp/maxHp が NaN になって書き込みが失敗する */
export function allPlayers(state: RoomState): [string, PlayerState][] {
  return Object.entries(state.players ?? {}).filter(
    (e): e is [string, PlayerState] => isLivePlayer(e[1]) && !e[1].spectator
  );
}

export function aliveEnemies(state: RoomState): [string, EnemyState][] {
  return Object.entries(state.enemies ?? {}).filter(([, e]) => e.alive);
}

/** うぉーろーど（サバイバル）部屋か */
export function isSurvival(state: RoomState): boolean {
  return state.meta?.mode === "survival";
}
