// ============================================================
// ホスト（部屋主）だけが動かす進行役ロジック
//   敵の攻撃スケジュール / ボスギミック / 怒りゲージ / ウェーブ進行 /
//   ユニゾン判定 / ステージクリア・ゲームオーバー判定 / ランキング登録
// ホストが落ちたら joinedAt が最古のプレイヤーが引き継ぐ（useRoom 側）
// ============================================================
import type { Store } from "../net/store";
import type { EnemyState, PlayerState, RoomState } from "./types";
import {
  DIFF_TUNING,
  ENEMY_KINDS,
  EQUIPS,
  STAGES,
  TUNING,
} from "./data";
import { Room, ROOT, aliveEnemies, allPlayers, alivePlayers } from "./room";
import { roleDef } from "./data";

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export class HostBrain {
  private room: Room;
  private store: Store;
  private nextAtkAt: Record<string, number> = {};
  private nextGimmickAt = 0;
  private lastRageTick = 0;
  private transitioning = false;
  private unisonResolving = false;

  constructor(room: Room) {
    this.room = room;
    this.store = room.store;
  }

  private get base() {
    return this.room.base;
  }

  // ---------- 開始・ウェーブ生成 ----------

  async startGame(state: RoomState) {
    const players = allPlayers(state);
    // 全員のHP・スタッツをリセット
    const updates: Record<string, unknown> = {
      "meta/status": "battle",
      "meta/stageIdx": 0,
      "meta/wave": 0,
      "meta/startedAt": Date.now(),
      "meta/clearedAt": 0,
      "meta/rage": 0,
      "meta/gauge": 0,
      chain: null,
      buff: null,
      unison: null,
      events: null,
    };
    for (const [pid, p] of players) {
      updates[`players/${pid}/hp`] = p.maxHp;
      updates[`players/${pid}/alive`] = true;
      updates[`players/${pid}/equip`] = "none";
      updates[`players/${pid}/stats`] = {
        damage: 0, heal: 0, typed: 0, miss: 0, maxCombo: 0,
        defended: 0, revived: 0, words: 0, startAt: Date.now(),
      };
    }
    updates["enemies"] = this.buildWave(state, 0, 0, players.length);
    await this.store.update(this.base, updates);
    this.resetSchedules();
  }

  private buildWave(
    state: RoomState,
    stageIdx: number,
    wave: number,
    playerCount: number
  ): Record<string, EnemyState> {
    const stage = STAGES[stageIdx];
    const tuning = DIFF_TUNING[state.meta.diff];
    const kinds = stage.waves[wave];
    const out: Record<string, EnemyState> = {};
    kinds.forEach((kindId, i) => {
      const kind = ENEMY_KINDS[kindId];
      const hp = Math.round(
        kind.baseHp * tuning.enemyHpMult * (0.5 + 0.5 * Math.max(1, playerCount))
      );
      out[String(i)] = {
        kind: kindId,
        hp,
        maxHp: hp,
        alive: true,
        weakness: pick(stage.weaknessPool),
      };
    });
    return out;
  }

  private resetSchedules() {
    this.nextAtkAt = {};
    this.nextGimmickAt = Date.now() + rand(10000, 16000);
    this.lastRageTick = Date.now();
    this.transitioning = false;
  }

  // ---------- メインループ（500msごとに Battle 画面から呼ばれる） ----------

  async tick(state: RoomState) {
    if (state.meta.status !== "battle") return;
    const now = Date.now();
    const tuning = DIFF_TUNING[state.meta.diff];

    // --- 敗北判定 ---
    const alive = alivePlayers(state);
    if (alive.length === 0 && allPlayers(state).length > 0) {
      if (!this.transitioning) {
        this.transitioning = true;
        await this.store.update(`${this.base}/meta`, { status: "gameover" });
      }
      return;
    }

    // --- ウェーブクリア判定 ---
    const enemies = aliveEnemies(state);
    if (enemies.length === 0 && Object.keys(state.enemies ?? {}).length > 0) {
      if (!this.transitioning) {
        this.transitioning = true;
        await this.advanceWave(state);
      }
      return;
    }

    // --- 敵の攻撃スケジュール ---
    // 少人数パーティーは集中攻撃がきつすぎるので攻撃間隔を伸ばす
    const count = alive.length;
    const teamScale = count <= 1 ? 1.7 : count === 2 ? 1.3 : 1;
    for (const [key, e] of enemies) {
      const kind = ENEMY_KINDS[e.kind];
      const interval = kind.atkInterval * tuning.atkIntervalMult * teamScale;
      if (!this.nextAtkAt[key]) {
        this.nextAtkAt[key] = now + interval * rand(0.6, 1.3);
      }
      if (now >= this.nextAtkAt[key]) {
        this.nextAtkAt[key] = now + interval * rand(0.8, 1.2);
        await this.enemyAttack(state, key, e, false);
      }
    }

    // --- ボス怒りゲージ ---
    const boss = enemies.find(([, e]) => ENEMY_KINDS[e.kind].boss);
    if (boss) {
      const dt = (now - this.lastRageTick) / 1000;
      this.lastRageTick = now;
      const rage = Math.min(100, (state.meta.rage ?? 0) + tuning.ragePerSec * dt);
      if (rage >= 100) {
        await this.store.update(`${this.base}/meta`, { rage: 0 });
        await this.enemyAttack(state, boss[0], boss[1], true); // 怒り爆発=全体攻撃
        await this.room.pushEvent({
          type: "info",
          text: `${ENEMY_KINDS[boss[1].kind].name}の いかりが ばくはつした！`,
          at: now,
        } as never);
      } else {
        await this.store.update(`${this.base}/meta`, { rage });
      }

      // --- ボスギミック ---
      const gimmicks = ENEMY_KINDS[boss[1].kind].gimmicks ?? [];
      if (gimmicks.length > 0 && now >= this.nextGimmickAt) {
        this.nextGimmickAt = now + rand(13000, 20000);
        const g = pick(gimmicks);
        await this.room.pushEvent({
          type: "gimmick",
          gimmick: g,
          duration: g === "katakana" ? 10000 : g === "ink" ? 4000 : 0,
          at: now,
        } as never);
      }
    } else {
      this.lastRageTick = now;
    }

    // --- ユニゾン判定 ---
    await this.resolveUnison(state);

    // --- 古いイベントの掃除 ---
    for (const [id, ev] of Object.entries(state.events ?? {})) {
      if (now - ev.at > 30000) {
        await this.store.remove(`${this.base}/events/${id}`);
      }
    }
  }

  private async enemyAttack(
    state: RoomState,
    enemyKey: string,
    e: EnemyState,
    allTarget: boolean
  ) {
    const now = Date.now();
    const tuning = DIFF_TUNING[state.meta.diff];
    const kind = ENEMY_KINDS[e.kind];
    const alive = alivePlayers(state);
    if (alive.length === 0) return;

    let targets: string[] = [];
    if (!allTarget) {
      // aggro 重み付きランダム（タンクが狙われやすい）
      const weighted: string[] = [];
      for (const [pid, p] of alive) {
        const w = roleDef(p.role).aggro;
        for (let i = 0; i < w; i++) weighted.push(pid);
      }
      targets = [pick(weighted)];
    }
    const dmg = Math.round(
      kind.atk *
        tuning.enemyAtkMult *
        (allTarget ? TUNING.rageAtkMult : 1) *
        rand(0.85, 1.15)
    );
    await this.room.pushEvent({
      type: "telegraph",
      enemyIdx: Number(enemyKey),
      targets,
      dmg,
      resolveAt: now + tuning.defenseTime,
      at: now,
    } as never);
  }

  private async resolveUnison(state: RoomState) {
    const u = state.unison;
    if (!u || !u.active || u.result || this.unisonResolving) return;
    const now = Date.now();
    const alive = alivePlayers(state);
    const doneCount = alive.filter(([pid]) => u.done?.[pid]).length;
    const allDone = doneCount >= alive.length && alive.length > 0;
    if (!allDone && now < u.deadline) return;

    this.unisonResolving = true;
    try {
      if (allDone) {
        const dmg = TUNING.unisonDmgPerPlayer * alive.length;
        for (const [key] of aliveEnemies(state)) {
          await this.room.damageEnemy(Number(key), dmg);
        }
        await this.store.update(`${this.base}/unison`, {
          active: false,
          result: "success",
        });
        await this.room.pushEvent({
          type: "info",
          text: `✨ユニゾンアタック成功！！ 全体に${dmg}ダメージ！`,
          at: now,
        } as never);
      } else {
        await this.store.update(`${this.base}/unison`, {
          active: false,
          result: "fail",
        });
        await this.room.pushEvent({
          type: "info",
          text: "ユニゾンアタックは ふはつに おわった…",
          at: now,
        } as never);
      }
      // 3秒後に unison ノードを消す
      setTimeout(() => {
        this.store.remove(`${this.base}/unison`).catch(() => {});
      }, 3000);
    } finally {
      this.unisonResolving = false;
    }
  }

  // ---------- ウェーブ / ステージ進行 ----------

  private async advanceWave(state: RoomState) {
    const { stageIdx, wave } = state.meta;
    const stage = STAGES[stageIdx];
    const playerCount = allPlayers(state).length;

    if (wave + 1 < stage.waves.length) {
      // 次ウェーブ
      const isBossWave = wave + 1 === stage.waves.length - 1;
      await this.store.update(this.base, {
        enemies: this.buildWave(state, stageIdx, wave + 1, playerCount),
        "meta/wave": wave + 1,
        "meta/rage": 0,
      });
      await this.room.pushEvent({
        type: "info",
        text: isBossWave ? "⚠️ ボスが あらわれた！！" : "つぎの てきが あらわれた！",
        at: Date.now(),
      } as never);
      this.resetSchedules();
    } else if (stageIdx + 1 < STAGES.length) {
      // ステージクリア → 装備ドロップ
      await this.dropEquips(state);
      await this.store.update(`${this.base}/meta`, { status: "stageclear" });
    } else {
      // 全ステージクリア！
      const clearedAt = Date.now();
      await this.store.update(`${this.base}/meta`, {
        status: "clear",
        clearedAt,
      });
      await this.writeRanking(state, clearedAt);
    }
  }

  private async dropEquips(state: RoomState) {
    for (const [pid, p] of allPlayers(state)) {
      // ロールに合いやすい装備が出やすい抽選
      const weights: Record<string, number> = {
        sword: p.role === "attacker" ? 3 : 1,
        staff: p.role === "healer" ? 3 : 1,
        shield: p.role === "tank" ? 3 : 1,
        boots: p.role === "buffer" ? 3 : 1,
      };
      const pool: string[] = [];
      for (const eq of EQUIPS) {
        for (let i = 0; i < (weights[eq.id] ?? 1); i++) pool.push(eq.id);
      }
      await this.store.update(`${this.base}/players/${pid}`, {
        equip: pick(pool),
      });
    }
  }

  /** ステージクリア画面から次ステージへ（ホスト操作） */
  async nextStage(state: RoomState) {
    const stageIdx = state.meta.stageIdx + 1;
    const playerCount = allPlayers(state).length;
    const updates: Record<string, unknown> = {
      enemies: this.buildWave(state, stageIdx, 0, playerCount),
      "meta/stageIdx": stageIdx,
      "meta/wave": 0,
      "meta/status": "battle",
      "meta/rage": 0,
      chain: null,
      unison: null,
      events: null,
    };
    // 気絶者は40%で復活・全員30%回復してから次ステージへ
    for (const [pid, p] of allPlayers(state)) {
      const hp = p.alive
        ? Math.min(p.maxHp, Math.round(p.hp + p.maxHp * 0.3))
        : Math.round(p.maxHp * TUNING.reviveHpRatio);
      updates[`players/${pid}/hp`] = hp;
      updates[`players/${pid}/alive`] = true;
    }
    await this.store.update(this.base, updates);
    this.resetSchedules();
  }

  /** リザルトからロビーに戻る（ホスト操作） */
  async backToLobby(state: RoomState) {
    const updates: Record<string, unknown> = {
      "meta/status": "lobby",
      "meta/stageIdx": 0,
      "meta/wave": 0,
      "meta/rage": 0,
      "meta/gauge": 0,
      enemies: null,
      events: null,
      chain: null,
      buff: null,
      unison: null,
    };
    for (const [pid, p] of allPlayers(state)) {
      updates[`players/${pid}/hp`] = p.maxHp;
      updates[`players/${pid}/alive`] = true;
      updates[`players/${pid}/ready`] = false;
    }
    await this.store.update(this.base, updates);
  }

  private async writeRanking(state: RoomState, clearedAt: number) {
    const timeMs = clearedAt - state.meta.startedAt;
    const names = allPlayers(state).map(([, p]) => p.name);
    await this.store.push(`${ROOT}/ranking/${state.meta.diff}`, {
      names,
      timeMs,
      at: clearedAt,
    });
  }
}
