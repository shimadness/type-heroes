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
  STAGES,
  SURVIVAL,
  TUNING,
  recommendEquip,
} from "./data";
import { GENRES, type GenreId } from "../typing/words";
import { Room, ROOT, aliveEnemies, allPlayers, alivePlayers, isSurvival } from "./room";
import { PLAYER_MAX_HP, roleDef } from "./data";

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
      "meta/kills": 0,
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
        defended: 0, revived: 0, words: 0, kills: 0, startAt: Date.now(),
      };
    }
    const enemies = this.waveFor(state, 0, 0, players.length);
    updates["enemies"] = enemies;
    await this.store.update(this.base, updates);
    await this.pushEncounter(enemies);
    this.resetSchedules();
  }

  /** ウェーブ先頭の敵（ボス優先）の遭遇セリフを流す */
  private async pushEncounter(enemies: Record<string, EnemyState>) {
    const kinds = Object.values(enemies).map((e) => ENEMY_KINDS[e.kind]);
    const lead = kinds.find((k) => k.boss) ?? kinds[0];
    if (!lead) return;
    await this.room.pushEvent({
      type: "info",
      text: `${lead.boss ? "⚠️ " : ""}${lead.enc}`,
      at: Date.now(),
    } as never);
  }

  /** モードに応じたウェーブ生成 */
  private waveFor(
    state: RoomState,
    stageIdx: number,
    wave: number,
    playerCount: number
  ): Record<string, EnemyState> {
    return isSurvival(state)
      ? this.buildSurvivalWave(state, wave, playerCount)
      : this.buildWave(state, stageIdx, wave, playerCount);
  }

  private makeEnemies(
    kinds: string[],
    hpMult: number,
    weaknessPool: GenreId[],
    playerCount: number,
    atkMult = 1
  ): Record<string, EnemyState> {
    const out: Record<string, EnemyState> = {};
    kinds.forEach((kindId, i) => {
      const kind = ENEMY_KINDS[kindId];
      const hp = Math.round(
        kind.baseHp * hpMult * (0.5 + 0.5 * Math.max(1, playerCount))
      );
      const e: EnemyState = {
        kind: kindId,
        hp,
        maxHp: hp,
        alive: true,
        weakness: pick(weaknessPool),
      };
      // RTDB は undefined を拒否するので、成長があるときだけキーを持たせる
      if (atkMult !== 1) e.atkMult = Math.round(atkMult * 100) / 100;
      out[String(i)] = e;
    });
    return out;
  }

  /** ストーリー: STAGES の定義どおり */
  private buildWave(
    state: RoomState,
    stageIdx: number,
    wave: number,
    playerCount: number
  ): Record<string, EnemyState> {
    const stage = STAGES[stageIdx];
    const tuning = DIFF_TUNING[state.meta.diff];
    return this.makeEnemies(
      stage.waves[wave],
      tuning.enemyHpMult,
      stage.weaknessPool,
      playerCount
    );
  }

  /** うぉーろーど: wave 番号（0始まり）から無限に生成。bossEvery ごとにボス */
  private buildSurvivalWave(
    state: RoomState,
    wave: number,
    playerCount: number
  ): Record<string, EnemyState> {
    const tuning = DIFF_TUNING[state.meta.diff];
    const all = Object.values(ENEMY_KINDS);
    const bosses = all.filter((k) => k.boss);
    const mobs = all.filter((k) => !k.boss);
    const kinds: string[] = [];
    if (HostBrain.isSurvivalBossWave(wave)) {
      const b = (wave + 1) / SURVIVAL.bossEvery - 1;
      const boss = b < bosses.length ? bosses[b] : pick(bosses);
      kinds.push(boss.id);
      if (b >= 2) kinds.push(pick(mobs).id); // 3体目以降のボスは雑魚を1体連れてくる
    } else {
      const n = Math.min(
        SURVIVAL.maxEnemies,
        SURVIVAL.baseEnemies + Math.floor(wave / SURVIVAL.enemiesGrowEvery)
      );
      for (let i = 0; i < n; i++) kinds.push(pick(mobs).id);
    }
    const hpMult = tuning.enemyHpMult * (1 + SURVIVAL.hpGrowthPerWave * wave);
    const atkMult = Math.min(
      SURVIVAL.atkGrowthMax,
      1 + SURVIVAL.atkGrowthPerWave * wave
    );
    return this.makeEnemies(
      kinds,
      hpMult,
      GENRES.map((g) => g.id),
      playerCount,
      atkMult
    );
  }

  static isSurvivalBossWave(wave: number): boolean {
    return (wave + 1) % SURVIVAL.bossEvery === 0;
  }

  /** サバイバルの背景はボスを倒すごとに STAGES を循環 */
  static survivalStageIdx(wave: number): number {
    return Math.floor(wave / SURVIVAL.bossEvery) % STAGES.length;
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
        await this.endGame(state, now);
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

  /** ゲームオーバーへ（全滅／あきらめる で共用）。サバイバルは撃破数を確定してランキング登録 */
  private async endGame(state: RoomState, now: number) {
    if (isSurvival(state)) {
      // 倒しかけのウェーブの分も撃破数に含める
      const kills =
        (state.meta.kills ?? 0) +
        Object.values(state.enemies ?? {}).filter((e) => !e.alive).length;
      // ランキング書き込みが失敗（ルール未適用など）しても進行が止まらないよう、status を先に確定する
      await this.store.update(`${this.base}/meta`, {
        status: "gameover",
        clearedAt: now,
        kills,
      });
      await this.writeSurvivalRanking(state, kills, now);
    } else {
      await this.store.update(`${this.base}/meta`, { status: "gameover" });
    }
  }

  /** バトル中の「あきらめる」（ホスト操作）。全滅と同じ扱いで終了する */
  async giveUp(state: RoomState) {
    if (state.meta.status !== "battle" || this.transitioning) return;
    this.transitioning = true;
    await this.endGame(state, Date.now());
  }

  /** 生き残っている攻撃予告を消すための update パッチ（敵が入れ替わったら予告は無効） */
  private telegraphClears(state: RoomState): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [id, ev] of Object.entries(state.events ?? {})) {
      if (ev.type === "telegraph") out[`events/${id}`] = null;
    }
    return out;
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
        (e.atkMult ?? 1) *
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
        // 成功のごほうび: 生存者全員が回復（ユニゾン中は攻撃をもらいっぱなしなので、その埋め合わせ）
        const updates: Record<string, unknown> = {
          "unison/active": false,
          "unison/result": "success",
        };
        for (const [pid, p] of alive) {
          updates[`players/${pid}/hp`] = Math.min(
            p.maxHp,
            Math.round(p.hp + p.maxHp * TUNING.unisonHealRatio)
          );
        }
        await this.store.update(this.base, updates);
        await this.room.pushEvent({
          type: "info",
          text: `✨ユニゾンアタック成功！！ 全体に${dmg}ダメージ！ みんなのHPが回復した！`,
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
    if (isSurvival(state)) return this.advanceSurvivalWave(state);
    const { stageIdx, wave } = state.meta;
    const stage = STAGES[stageIdx];
    const playerCount = allPlayers(state).length;

    if (wave + 1 < stage.waves.length) {
      // 次ウェーブ（前ウェーブの敵が残した攻撃予告は同時に消す。残すと新しい敵の番号に化けて当たる）
      const enemies = this.buildWave(state, stageIdx, wave + 1, playerCount);
      await this.store.update(this.base, {
        ...this.telegraphClears(state),
        enemies,
        "meta/wave": wave + 1,
        "meta/rage": 0,
      });
      await this.pushEncounter(enemies);
      this.resetSchedules();
    } else if (stageIdx + 1 < STAGES.length) {
      // ステージクリア → 装備えらび（おすすめを初期値として入れておき、画面で選び直せる）
      await this.dropEquips(state);
      await this.store.update(this.base, {
        ...this.telegraphClears(state),
        "meta/status": "stageclear",
      });
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

  /** うぉーろーど: 撃破数を積んで次ウェーブへ。ボス撃破直後は休憩（回復＋装備） */
  private async advanceSurvivalWave(state: RoomState) {
    const { wave } = state.meta;
    const next = wave + 1;
    const playerCount = allPlayers(state).length;
    const kills =
      (state.meta.kills ?? 0) + Object.keys(state.enemies ?? {}).length;
    const afterBoss = HostBrain.isSurvivalBossWave(wave);
    if (afterBoss) await this.dropEquips(state);

    const enemies = this.buildSurvivalWave(state, next, playerCount);
    const updates: Record<string, unknown> = {
      ...this.telegraphClears(state),
      enemies,
      "meta/wave": next,
      "meta/kills": kills,
      "meta/rage": 0,
      "meta/stageIdx": HostBrain.survivalStageIdx(next),
    };
    if (afterBoss) this.restUpdates(state, updates);
    await this.store.update(this.base, updates);
    if (afterBoss) {
      await this.room.pushEvent({
        type: "info",
        text: "🎁 そうびを手に入れた！ HPがかいふくした！",
        at: Date.now(),
      } as never);
    }
    await this.pushEncounter(enemies);
    this.resetSchedules();
  }

  /** 休憩: 気絶者は復活・生存者は回復（ステージクリア後／サバイバルのボス撃破後で共用） */
  private restUpdates(state: RoomState, updates: Record<string, unknown>) {
    for (const [pid, p] of allPlayers(state)) {
      // maxHp が欠けた不完全なノードが混ざっても NaN を書かない（NaN は RTDB が update ごと拒否する）
      const maxHp = p.maxHp || PLAYER_MAX_HP;
      const hp = p.alive
        ? Math.min(maxHp, Math.round((p.hp || 0) + maxHp * TUNING.stageHealRatio))
        : Math.round(maxHp * TUNING.reviveHpRatio);
      updates[`players/${pid}/hp`] = hp;
      updates[`players/${pid}/alive`] = true;
    }
  }

  /**
   * 装備ドロップ。実績（得意な行動）から導いたおすすめを全員に配る。
   * ストーリーではこれが選択画面の初期値になり、放置しても不利にならない。
   * サバイバルにはえらぶ画面が無いので、おすすめがそのまま装備になる。
   */
  private async dropEquips(state: RoomState) {
    const players = allPlayers(state);
    const team = players.map(([, p]) => p);
    const updates: Record<string, unknown> = {};
    for (const [pid, p] of players) {
      updates[`players/${pid}/equip`] = recommendEquip(p, team).equip;
    }
    if (Object.keys(updates).length > 0) await this.store.update(this.base, updates);
  }

  /** ステージクリア画面から次ステージへ（ホスト操作） */
  async nextStage(state: RoomState) {
    const stageIdx = state.meta.stageIdx + 1;
    const playerCount = allPlayers(state).length;
    const enemies = this.buildWave(state, stageIdx, 0, playerCount);
    const updates: Record<string, unknown> = {
      enemies,
      "meta/stageIdx": stageIdx,
      "meta/wave": 0,
      "meta/status": "battle",
      "meta/rage": 0,
      chain: null,
      unison: null,
      events: null,
    };
    // 気絶者は復活・全員回復してから次ステージへ
    this.restUpdates(state, updates);
    await this.store.update(this.base, updates);
    await this.pushEncounter(enemies);
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
      "meta/kills": 0,
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

  /** うぉーろーど: 撃破数ランキング（typing/survival/{diff}）。1体も倒せなかった回は記録しない */
  private async writeSurvivalRanking(
    state: RoomState,
    kills: number,
    endedAt: number
  ) {
    if (kills <= 0) return;
    const names = allPlayers(state).map(([, p]) => p.name);
    await this.store.push(`${ROOT}/survival/${state.meta.diff}`, {
      names,
      kills,
      waves: state.meta.wave + 1,
      timeMs: Math.max(1, endedAt - state.meta.startedAt),
      at: endedAt,
    });
  }
}
