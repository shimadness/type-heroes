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
import type { RoleId } from "./types";

export const ROOT = "typing";

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
    defended: 0, revived: 0, words: 0, startAt: 0,
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
    teamDiff: Difficulty
  ): Promise<Room> {
    const myId = newPlayerId();
    const room = new Room(store, code, myId);
    const meta: RoomMeta = {
      createdAt: Date.now(),
      hostId: myId,
      diff: teamDiff,
      status: "lobby",
      stageIdx: 0,
      wave: 0,
      startedAt: 0,
      clearedAt: 0,
      rage: 0,
      gauge: 0,
    };
    await store.write(room.base, { meta });
    await room.writeSelf(profile);
    return room;
  }

  static async join(
    store: Store,
    code: string,
    profile: JoinProfile
  ): Promise<Room> {
    const meta = (await store.read(`${ROOT}/rooms/${code}/meta`)) as RoomMeta | null;
    if (!meta) throw new Error("そのあいことばの部屋が見つからないよ");
    if (meta.status !== "lobby") throw new Error("この部屋はもう出発してしまった…（観戦は可能）");
    const room = new Room(store, code, newPlayerId());
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
    await this.store.write(this.myPath, p);
    this.store.onDisconnectRemove(this.myPath);
    this.hbTimer = setInterval(() => {
      this.store.update(this.myPath, { lastSeen: Date.now() }).catch(() => {});
    }, 5000);
  }

  subscribe(cb: (state: RoomState | null) => void): Unsubscribe {
    return this.store.subscribe(this.base, (v) => {
      cb((v as RoomState) ?? null);
    });
  }

  async leave() {
    if (this.hbTimer) clearInterval(this.hbTimer);
    if (!this.spectator) await this.store.remove(this.myPath).catch?.(() => {});
  }

  dispose() {
    if (this.hbTimer) clearInterval(this.hbTimer);
  }

  // ---------- lobby ----------

  setProfile(partial: Partial<Pick<PlayerState, "role" | "diff" | "ready" | "name">>) {
    return this.store.update(this.myPath, partial as Record<string, unknown>);
  }

  setTeamDiff(diff: Difficulty) {
    return this.store.update(`${this.base}/meta`, { diff });
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

  /** 与ダメージ倍率（ロール・装備・バフ・チェイン込み） */
  static damageMult(
    me: PlayerState,
    state: RoomState | null,
    chainCount: number,
    weakness: boolean,
    crit: boolean
  ): number {
    const r = roleDef(me.role);
    let m = r.dmgMult;
    if (me.equip === "sword") m *= 1.15;
    const buff = state?.buff;
    if (buff && buff.until > Date.now()) m *= buff.mult;
    m *= 1 + Math.min(TUNING.chainBonusMax, Math.max(0, chainCount - 1) * TUNING.chainBonusPer);
    if (weakness) m *= TUNING.weaknessMult;
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

/** 生きているプレイヤー一覧（観戦者除く） */
export function alivePlayers(state: RoomState): [string, PlayerState][] {
  return Object.entries(state.players ?? {}).filter(
    ([, p]) => p.alive && !p.spectator
  );
}

export function allPlayers(state: RoomState): [string, PlayerState][] {
  return Object.entries(state.players ?? {}).filter(([, p]) => !p.spectator);
}

export function aliveEnemies(state: RoomState): [string, EnemyState][] {
  return Object.entries(state.enemies ?? {}).filter(([, e]) => e.alive);
}
