import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Session } from "../App";
import type {
  GimmickEvent,
  RoomState,
  TelegraphEvent,
} from "../game/types";
import {
  DIFF_TUNING,
  ENEMY_KINDS,
  STAGES,
  TUNING,
  equipDef,
  roleDef,
} from "../game/data";
import { HostBrain } from "../game/host";
import { Room, aliveEnemies, allPlayers } from "../game/room";
import { TypingWord, hiraToKata } from "../typing/romaji";
import {
  GENRES,
  pickDefense,
  pickRevive,
  pickUnison,
  pickWord,
  type GenreId,
} from "../typing/words";
import { sfx } from "../sfx";

interface Props {
  session: Session;
  state: RoomState;
  onLeave: () => void;
}

// ---- ローカルカード型 ----
interface GenreCard {
  kind: "genre";
  id: string;
  genre: GenreId;
  word: TypingWord;
}
interface DefenseCard {
  kind: "defense";
  id: string; // event id
  word: TypingWord;
  resolveAt: number;
  defended: boolean;
}
interface ReviveCard {
  kind: "revive";
  id: string; // "revive_" + pid
  pid: string;
  word: TypingWord;
}
type Card = GenreCard | DefenseCard | ReviveCard;

interface FloatFx {
  id: number;
  text: string;
  cls: string;
  area: "enemy" | "self";
}

let uidSeq = 0;
const uid = () => `c${uidSeq++}`;
const pickRand = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export function Battle({ session, state, onLeave }: Props) {
  const { room } = session;
  const me = state.players?.[room.myId];
  const isHost = state.meta.hostId === room.myId;
  const isSpectator = room.spectator || !me;
  const stage = STAGES[state.meta.stageIdx] ?? STAGES[0];

  const stateRef = useRef(state);
  stateRef.current = state;

  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((t) => t + 1), []);
  const [mode, setMode] = useState<"attack" | "heal">("attack");
  const [targetKey, setTargetKey] = useState("0");
  const [activeCardId, setActiveCardId] = useState<string>("");
  const [shake, setShake] = useState(false);
  const [combo, setCombo] = useState(0);
  const [missFlash, setMissFlash] = useState(false);

  const genreCardsRef = useRef<GenreCard[]>([]);
  const defenseCardsRef = useRef<DefenseCard[]>([]);
  const reviveWordsRef = useRef<Map<string, TypingWord>>(new Map());
  const unisonWordRef = useRef<{ deadline: number; word: TypingWord } | null>(null);
  const floatsRef = useRef<FloatFx[]>([]);
  const processedEvents = useRef<Set<string>>(new Set());
  const pendingDmg = useRef(0);
  const pendingHeal = useRef(0);
  const statsDelta = useRef({
    damage: 0, heal: 0, typed: 0, miss: 0, words: 0,
    defended: 0, revived: 0, maxCombo: 0,
  });
  const localSessionStats = useRef({ typed: 0, miss: 0, startAt: Date.now() });
  const inkUntil = useRef(0);
  const kataUntil = useRef(0);
  const enemyHitAt = useRef<Record<string, number>>({});
  const comboRef = useRef(0);
  const activeCardRef = useRef<Card | null>(null);

  const brain = useMemo(() => new HostBrain(room), [room]);

  // ---------- カード生成 ----------
  const makeGenreCard = useCallback(
    (excludeGenres: GenreId[]): GenreCard => {
      const diff = stateRef.current.players?.[room.myId]?.diff ?? "normal";
      const candidates = GENRES.filter((g) => !excludeGenres.includes(g.id));
      const g = pickRand(candidates.length > 0 ? candidates : GENRES);
      const w = pickWord(g.id, diff);
      return { kind: "genre", id: uid(), genre: g.id, word: new TypingWord(w.d, w.k) };
    },
    [room.myId]
  );

  const regenAllCards = useCallback(() => {
    const cards: GenreCard[] = [];
    for (let i = 0; i < 3; i++) {
      cards.push(makeGenreCard(cards.map((c) => c.genre)));
    }
    genreCardsRef.current = cards;
    forceUpdate();
  }, [makeGenreCard, forceUpdate]);

  useEffect(() => {
    if (!isSpectator) regenAllCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- エフェクト ----------
  const addFloat = useCallback(
    (text: string, cls: string, area: "enemy" | "self") => {
      const id = uidSeq++;
      floatsRef.current = [...floatsRef.current.slice(-14), { id, text, cls, area }];
      forceUpdate();
      setTimeout(() => {
        floatsRef.current = floatsRef.current.filter((f) => f.id !== id);
        forceUpdate();
      }, 1100);
    },
    [forceUpdate]
  );

  const doShake = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 400);
  }, []);

  // ---------- ターゲット自動補正 ----------
  useEffect(() => {
    const enemies = state.enemies ?? {};
    const t = enemies[targetKey];
    if (!t || !t.alive) {
      const first = aliveEnemies(state)[0];
      if (first) setTargetKey(first[0]);
    }
  }, [state, targetKey]);

  // ---------- イベント処理（telegraph / gimmick / info）----------
  useEffect(() => {
    const events = state.events ?? {};
    for (const [id, ev] of Object.entries(events)) {
      if (processedEvents.current.has(id)) continue;
      processedEvents.current.add(id);
      if (ev.type === "telegraph") {
        const t = ev as TelegraphEvent;
        const targetsMe =
          !isSpectator && (t.targets.length === 0 || t.targets.includes(room.myId));
        if (targetsMe && me?.alive) {
          const w = pickDefense();
          defenseCardsRef.current = [
            ...defenseCardsRef.current,
            {
              kind: "defense",
              id,
              word: new TypingWord(w.d, w.k),
              resolveAt: t.resolveAt,
              defended: false,
            },
          ];
          sfx.warn();
          // 入力途中のワードがなければ防御カードに自動フォーカス
          // （打ちかけを中断させるとミス連発になるため、途中ならフォーカスは奪わない）
          const ac = activeCardRef.current;
          if (!ac || ac.word.typedCount === 0 || ac.word.finished) {
            setActiveCardId(id);
          }
          forceUpdate();
        }
      } else if (ev.type === "gimmick") {
        const g = ev as GimmickEvent;
        if (g.gimmick === "ink") inkUntil.current = Date.now() + g.duration;
        if (g.gimmick === "katakana") kataUntil.current = Date.now() + g.duration;
        if (g.gimmick === "shuffle" && !isSpectator) regenAllCards();
        forceUpdate();
      }
    }
  }, [state.events, isSpectator, me?.alive, room.myId, regenAllCards, forceUpdate]);

  // ---------- telegraph 解決（被ダメ適用は各自）----------
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      const s = stateRef.current;
      const myself = s.players?.[room.myId];
      let changed = false;
      for (const card of [...defenseCardsRef.current]) {
        if (now < card.resolveAt) continue;
        defenseCardsRef.current = defenseCardsRef.current.filter((c) => c.id !== card.id);
        changed = true;
        const ev = (s.events ?? {})[card.id] as TelegraphEvent | undefined;
        if (!myself?.alive) continue;
        const baseDmg = ev?.dmg ?? 10;
        const mult = Room.takenMult(myself) * (card.defended ? 0.5 : 1);
        const dmg = Math.max(1, Math.round(baseDmg * mult));
        room.damageSelf(dmg);
        sfx.hurt();
        doShake();
        addFloat(
          card.defended ? `🛡️-${dmg}` : `-${dmg}`,
          card.defended ? "float-guard" : "float-hurt",
          "self"
        );
      }
      if (changed) forceUpdate();
    }, 200);
    return () => clearInterval(iv);
  }, [room, addFloat, doShake, forceUpdate]);

  // ---------- 気絶した仲間 → 蘇生カード ----------
  const downedMates = allPlayers(state).filter(
    ([pid, p]) => !p.alive && pid !== room.myId
  );
  for (const [pid] of downedMates) {
    if (!reviveWordsRef.current.has(pid)) {
      const w = pickRevive();
      reviveWordsRef.current.set(pid, new TypingWord(w.d, w.k));
    }
  }
  for (const pid of [...reviveWordsRef.current.keys()]) {
    if (!downedMates.some(([id]) => id === pid)) reviveWordsRef.current.delete(pid);
  }

  // ---------- ユニゾンワード ----------
  const unison = state.unison;
  if (unison?.active && !isSpectator) {
    if (!unisonWordRef.current || unisonWordRef.current.deadline !== unison.deadline) {
      unisonWordRef.current = {
        deadline: unison.deadline,
        word: new TypingWord(unison.wordD, unison.wordK),
      };
      sfx.unison();
    }
  } else if (!unison?.active) {
    unisonWordRef.current = null;
  }

  // ---------- 表示するカード一覧 ----------
  const cards: Card[] = [];
  const unisonTyping =
    unison?.active && !unison.done?.[room.myId] && unisonWordRef.current && me?.alive;
  if (!unisonTyping) {
    cards.push(...defenseCardsRef.current);
    for (const [pid] of downedMates) {
      const w = reviveWordsRef.current.get(pid);
      if (w) cards.push({ kind: "revive", id: `revive_${pid}`, pid, word: w });
    }
    cards.push(...genreCardsRef.current);
  }
  const activeCard =
    cards.find((c) => c.id === activeCardId) ?? cards[0] ?? null;
  activeCardRef.current = activeCard;
  useEffect(() => {
    if (activeCard && activeCard.id !== activeCardId) setActiveCardId(activeCard.id);
  }, [activeCard, activeCardId]);

  // ---------- ワード完了処理 ----------
  const completeWord = useCallback(
    async (card: Card) => {
      const s = stateRef.current;
      const myself = s.players?.[room.myId];
      if (!myself) return;
      const kanaLen = card.word.kana.length;
      const crit = card.word.missCount === 0;

      if (card.kind === "defense") {
        card.defended = true;
        statsDelta.current.defended++;
        addFloat("ガードじゅんびOK!", "float-guard", "self");
        sfx.wordDone();
        forceUpdate();
        return;
      }
      if (card.kind === "revive") {
        await room.revive(card.pid);
        statsDelta.current.revived++;
        reviveWordsRef.current.delete(card.pid);
        addFloat("⛑️ふっかつ！", "float-heal", "self");
        sfx.revive();
        forceUpdate();
        return;
      }

      // genre カード
      const chainCount = await room.registerChain();
      statsDelta.current.words++;

      if (mode === "attack") {
        const enemy = (s.enemies ?? {})[targetKey];
        if (enemy?.alive) {
          const weakness = card.genre === enemy.weakness;
          const mult = Room.damageMult(myself, s, chainCount, weakness, crit);
          const dmg = Math.round(kanaLen * TUNING.wordBonusPerKana * mult + pendingDmg.current);
          pendingDmg.current = 0;
          statsDelta.current.damage += dmg;
          const killed = await room.damageEnemy(Number(targetKey), dmg);
          enemyHitAt.current[targetKey] = Date.now();
          addFloat(
            `${weakness ? "弱点!" : ""}${crit ? "会心!" : ""} ${dmg}`,
            crit || weakness ? "float-crit" : "float-dmg",
            "enemy"
          );
          if (killed) sfx.kill();
          else if (crit) sfx.crit();
          else sfx.wordDone();
        }
      } else {
        // 回復: いちばんHPが減っている仲間（自分含む）へ
        const targets = allPlayers(s).filter(([, p]) => p.alive);
        targets.sort((a, b) => a[1].hp / a[1].maxHp - b[1].hp / b[1].maxHp);
        const target = targets[0];
        if (target) {
          const amount = Math.round(
            kanaLen * TUNING.healPerKana * Room.healMult(myself) * (crit ? 1.2 : 1) +
              pendingHeal.current
          );
          pendingHeal.current = 0;
          statsDelta.current.heal += amount;
          await room.healPlayer(target[0], amount);
          addFloat(`+${amount} ${target[1].name}`, "float-heal", "self");
          sfx.heal();
        }
      }

      // ゲージ・バフ
      const gaugeGain =
        TUNING.gaugePerWord * (myself.equip === "boots" ? 1.3 : 1);
      room.addGauge(gaugeGain);
      if (roleDef(myself.role).buffOnWord) room.applyBuff();

      // カード入れ替え
      genreCardsRef.current = genreCardsRef.current.map((c) =>
        c.id === card.id
          ? makeGenreCard(genreCardsRef.current.filter((x) => x.id !== c.id).map((x) => x.genre))
          : c
      );
      forceUpdate();
    },
    [room, mode, targetKey, addFloat, makeGenreCard, forceUpdate]
  );

  // ---------- キー入力 ----------
  useEffect(() => {
    if (isSpectator) return;
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      const myself = s.players?.[room.myId];
      if (!myself?.alive) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "Tab") {
        e.preventDefault();
        if (cards.length > 1 && activeCard) {
          const idx = cards.findIndex((c) => c.id === activeCard.id);
          setActiveCardId(cards[(idx + 1) % cards.length].id);
        }
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        setMode((m) => (m === "attack" ? "heal" : "attack"));
        return;
      }
      if (!/^[a-z0-9\-,.!?/]$/i.test(e.key)) return;
      e.preventDefault();

      // ユニゾン最優先
      const word = unisonTyping
        ? unisonWordRef.current!.word
        : activeCard?.word;
      if (!word || word.finished) return;

      const ok = word.input(e.key);
      if (ok) {
        sfx.type();
        comboRef.current++;
        setCombo(comboRef.current);
        statsDelta.current.typed++;
        statsDelta.current.maxCombo = Math.max(
          statsDelta.current.maxCombo,
          comboRef.current
        );
        localSessionStats.current.typed++;
        if (!unisonTyping && activeCard?.kind === "genre") {
          if (mode === "attack") {
            const m = Room.damageMult(myself, s, 1, false, false);
            pendingDmg.current += TUNING.keyDamage * m;
            enemyHitAt.current[targetKey] = Date.now();
          } else {
            pendingHeal.current += TUNING.keyHeal * Room.healMult(myself);
          }
        }
        if (word.finished) {
          if (unisonTyping) {
            room.unisonDone();
            sfx.crit();
          } else if (activeCard) {
            completeWord(activeCard);
          }
        }
      } else {
        sfx.miss();
        comboRef.current = 0;
        setCombo(0);
        statsDelta.current.miss++;
        localSessionStats.current.miss++;
        setMissFlash(true);
        setTimeout(() => setMissFlash(false), 180);
      }
      forceUpdate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    isSpectator, room, activeCard, cards, mode, targetKey,
    unisonTyping, completeWord, forceUpdate,
  ]);

  // ---------- 定期フラッシュ（打鍵ダメージ・回復・スタッツ）----------
  useEffect(() => {
    if (isSpectator) return;
    const iv = setInterval(() => {
      const s = stateRef.current;
      if (pendingDmg.current >= 1) {
        const dmg = Math.round(pendingDmg.current);
        pendingDmg.current = 0;
        statsDelta.current.damage += dmg;
        const enemy = (s.enemies ?? {})[targetKey];
        if (enemy?.alive) room.damageEnemy(Number(targetKey), dmg);
      }
      if (pendingHeal.current >= 1) {
        const amount = Math.round(pendingHeal.current);
        pendingHeal.current = 0;
        statsDelta.current.heal += amount;
        const targets = allPlayers(s).filter(([, p]) => p.alive);
        targets.sort((a, b) => a[1].hp / a[1].maxHp - b[1].hp / b[1].maxHp);
        if (targets[0]) room.healPlayer(targets[0][0], amount);
      }
    }, 700);
    const statsIv = setInterval(() => {
      const d = statsDelta.current;
      if (d.damage || d.heal || d.typed || d.miss || d.words || d.defended || d.revived || d.maxCombo) {
        room.flushStats({ ...d });
        statsDelta.current = {
          damage: 0, heal: 0, typed: 0, miss: 0, words: 0,
          defended: 0, revived: 0, maxCombo: 0,
        };
      }
    }, 2000);
    return () => {
      clearInterval(iv);
      clearInterval(statsIv);
    };
  }, [isSpectator, room, targetKey]);

  // ---------- ホストループ ----------
  useEffect(() => {
    if (!isHost) return;
    const iv = setInterval(() => {
      brain.tick(stateRef.current).catch(() => {});
    }, 500);
    return () => clearInterval(iv);
  }, [isHost, brain]);

  // ---------- 表示用の定期再描画（カウントダウン等）----------
  useEffect(() => {
    const iv = setInterval(forceUpdate, 300);
    return () => clearInterval(iv);
  }, [forceUpdate]);

  // ---------- レンダリング ----------
  const now = Date.now();
  const enemies = Object.entries(state.enemies ?? {}).sort(
    (a, b) => Number(a[0]) - Number(b[0])
  );
  const players = allPlayers(state).sort((a, b) => a[1].joinedAt - b[1].joinedAt);
  const boss = enemies.find(([, e]) => ENEMY_KINDS[e.kind]?.boss && e.alive);
  const buffActive = state.buff && state.buff.until > now;
  const chain = state.chain;
  const chainActive = chain && now - chain.at <= TUNING.chainWindow && chain.count >= 2;
  const gauge = state.meta.gauge ?? 0;
  const katakanaMode = now < kataUntil.current;
  const inkMode = now < inkUntil.current;
  const tuning = DIFF_TUNING[state.meta.diff];

  // 敵の攻撃予告（画面表示用）
  const telegraphs = Object.entries(state.events ?? {}).filter(
    ([, ev]) => ev.type === "telegraph" && (ev as TelegraphEvent).resolveAt > now
  ) as [string, TelegraphEvent][];

  const infoEvents = Object.entries(state.events ?? {})
    .filter(([, ev]) => ev.type === "info" && now - ev.at < 4000)
    .map(([, ev]) => ev as { text: string; at: number })
    .sort((a, b) => b.at - a.at)
    .slice(0, 2);

  const wpmElapsed = Math.max(0.2, (now - localSessionStats.current.startAt) / 60000);
  const kpm = Math.round(localSessionStats.current.typed / wpmElapsed);
  const totalKeys = localSessionStats.current.typed + localSessionStats.current.miss;
  const acc = totalKeys > 0 ? Math.round((localSessionStats.current.typed / totalKeys) * 100) : 100;

  const dispWord = (w: TypingWord, kata: boolean) => {
    const [typed, rest] = w.romajiParts();
    return (
      <>
        <div className="card-jp">{kata ? hiraToKata(w.display) : w.display}</div>
        <div className="card-romaji">
          <span className="typed">{typed}</span>
          <span className="rest">{rest}</span>
        </div>
      </>
    );
  };

  return (
    <div
      className={`screen battle-screen ${shake ? "shake" : ""}`}
      style={{ background: stage.bg }}
    >
      {/* ---- トップバー ---- */}
      <div className="battle-top">
        <div className="stage-label">
          {stage.icon} {stage.name}{" "}
          <span className="wave-label">
            WAVE {state.meta.wave + 1}/{STAGES[state.meta.stageIdx].waves.length}
          </span>
        </div>
        {boss && (
          <div className="rage-wrap" title="ボスのいかりゲージ。満タンで全体攻撃！">
            <span className="rage-icon">💢</span>
            <div className="bar rage-bar">
              <div
                className="bar-fill rage-fill"
                style={{ width: `${state.meta.rage ?? 0}%` }}
              />
            </div>
          </div>
        )}
        <div className="unison-wrap">
          <div className="bar gauge-bar" title="みんなでワードを完了するとたまる">
            <div className="bar-fill gauge-fill" style={{ width: `${gauge}%` }} />
          </div>
          <button
            className={`btn unison-btn ${gauge >= 100 ? "ready" : ""}`}
            disabled={gauge < 100 || !!unison?.active || isSpectator}
            onClick={() => {
              const w = pickUnison();
              room.triggerUnison(w.d, w.k);
            }}
          >
            ✨ユニゾン
          </button>
        </div>
      </div>

      {/* ---- バナー ---- */}
      <div className="banner-feed">
        {chainActive && (
          <div className="banner chain-banner">
            🔗 {chain!.count} CHAIN! 火力+
            {Math.round(Math.min(TUNING.chainBonusMax, (chain!.count - 1) * TUNING.chainBonusPer) * 100)}%
          </div>
        )}
        {buffActive && (
          <div className="banner buff-banner">🎺 おうえん中！ チーム火力+20%</div>
        )}
        {infoEvents.map((ev, i) => (
          <div key={ev.at + i} className="banner info-banner">
            {ev.text}
          </div>
        ))}
      </div>

      {/* ---- 敵エリア ---- */}
      <div className="enemy-area">
        {enemies.map(([key, e]) => {
          const kind = ENEMY_KINDS[e.kind];
          if (!kind) return null;
          const genre = GENRES.find((g) => g.id === e.weakness);
          const tele = telegraphs.find(([, t]) => String(t.enemyIdx) === key);
          const hitRecently = now - (enemyHitAt.current[key] ?? 0) < 200;
          return (
            <button
              key={key}
              className={[
                "enemy-card",
                kind.boss ? "boss" : "",
                e.alive ? "" : "dead",
                key === targetKey ? "targeted" : "",
                hitRecently ? "hit" : "",
              ].join(" ")}
              onClick={() => e.alive && setTargetKey(key)}
              disabled={!e.alive}
            >
              {key === targetKey && e.alive && <div className="target-marker">▼ターゲット</div>}
              <div className="enemy-icon">{e.alive ? kind.icon : "💨"}</div>
              <div className="enemy-name">
                {kind.boss && "👑"}
                {kind.name}
              </div>
              <div className="bar enemy-hp-bar">
                <div
                  className={`bar-fill hp-fill ${e.hp / e.maxHp < 0.3 ? "low" : ""}`}
                  style={{ width: `${(e.hp / e.maxHp) * 100}%` }}
                />
              </div>
              {genre && e.alive && (
                <div className="weakness-chip">
                  弱点:{genre.icon}
                  {genre.label}
                </div>
              )}
              {tele && (
                <div className="telegraph-warn">
                  ⚠️こうげき! {Math.max(0, Math.ceil((tele[1].resolveAt - now) / 1000))}
                </div>
              )}
            </button>
          );
        })}
        <div className="float-layer enemy-floats">
          {floatsRef.current
            .filter((f) => f.area === "enemy")
            .map((f) => (
              <div key={f.id} className={`float ${f.cls}`}>
                {f.text}
              </div>
            ))}
        </div>
      </div>

      {/* ---- パーティー ---- */}
      <div className="party-area">
        {players.map(([pid, pl]) => {
          const rd = roleDef(pl.role);
          const eq = equipDef(pl.equip);
          const targeted = telegraphs.some(
            ([, t]) => t.targets.length === 0 || t.targets.includes(pid)
          );
          return (
            <div
              key={pid}
              className={[
                "player-card",
                pid === room.myId ? "me" : "",
                pl.alive ? "" : "downed",
                targeted ? "in-danger" : "",
              ].join(" ")}
            >
              <div className="player-head">
                <span className="player-role">{rd.icon}</span>
                <span className="player-name">{pl.name}</span>
                {eq && <span className="player-equip" title={eq.desc}>{eq.icon}</span>}
                {unison?.active && unison.done?.[pid] && <span title="ユニゾン入力完了">✅</span>}
              </div>
              <div className="bar player-hp-bar">
                <div
                  className={`bar-fill hp-fill ${pl.hp / pl.maxHp < 0.3 ? "low" : ""}`}
                  style={{ width: `${(pl.hp / pl.maxHp) * 100}%` }}
                />
              </div>
              <div className="player-hp-num">
                {pl.alive ? `${pl.hp}/${pl.maxHp}` : "😵 きぜつ中"}
              </div>
            </div>
          );
        })}
        <div className="float-layer self-floats">
          {floatsRef.current
            .filter((f) => f.area === "self")
            .map((f) => (
              <div key={f.id} className={`float ${f.cls}`}>
                {f.text}
              </div>
            ))}
        </div>
      </div>

      {/* ---- タイピングパネル ---- */}
      {!isSpectator && me && (
        <div className={`typing-panel ${missFlash ? "miss-flash" : ""}`}>
          {!me.alive ? (
            <div className="downed-overlay">
              <div className="downed-msg">😵 きぜつしてしまった…</div>
              <div className="downed-sub">なかまの「そせいワード」を待とう！</div>
            </div>
          ) : unisonTyping && unisonWordRef.current ? (
            <div className="unison-panel">
              <div className="unison-title">
                ✨ ユニゾンアタック！ 全員で打ちきれ！（のこり
                {Math.max(0, Math.ceil((unison!.deadline - now) / 1000))}秒）
              </div>
              <div className="active-card unison-card">
                {dispWord(unisonWordRef.current.word, false)}
              </div>
            </div>
          ) : unison?.active && unison.done?.[room.myId] ? (
            <div className="unison-panel">
              <div className="unison-title">✅ 入力かんりょう！なかまを待て…</div>
            </div>
          ) : (
            <>
              <div className="mode-row">
                <button
                  className={`mode-btn attack ${mode === "attack" ? "sel" : ""}`}
                  onClick={() => setMode("attack")}
                >
                  ⚔️ こうげき
                </button>
                <button
                  className={`mode-btn heal ${mode === "heal" ? "sel" : ""}`}
                  onClick={() => setMode("heal")}
                >
                  💚 かいふく
                </button>
                <span className="mode-hint">Spaceで切替 / Tabでカード切替</span>
              </div>
              <div className="card-row">
                {cards.map((c) => {
                  const isActive = activeCard?.id === c.id;
                  const genre = c.kind === "genre" ? GENRES.find((g) => g.id === c.genre) : null;
                  const label =
                    c.kind === "defense"
                      ? `🛡️ぼうぎょ! のこり${Math.max(0, Math.ceil(((c as DefenseCard).resolveAt - now) / 1000))}秒`
                      : c.kind === "revive"
                        ? `⛑️そせい: ${state.players?.[(c as ReviveCard).pid]?.name ?? ""}`
                        : `${genre?.icon}${genre?.label}`;
                  return (
                    <button
                      key={c.id}
                      className={[
                        "word-card",
                        c.kind,
                        isActive ? "active" : "",
                        c.kind === "genre" &&
                        mode === "attack" &&
                        (state.enemies ?? {})[targetKey]?.weakness === (c as GenreCard).genre
                          ? "weak-match"
                          : "",
                      ].join(" ")}
                      onClick={() => setActiveCardId(c.id)}
                    >
                      <div className={`card-label ${c.kind}`}>{label}</div>
                      {dispWord(c.word, katakanaMode && c.kind === "genre")}
                      <div className="bar word-progress">
                        <div
                          className="bar-fill word-progress-fill"
                          style={{ width: `${c.word.progress() * 100}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="stat-row">
                <span className={`combo ${combo >= 10 ? "hot" : ""}`}>
                  🔥コンボ {combo}
                </span>
                <span>⌨️ {kpm} 打/分</span>
                <span>🎯 せいかく {acc}%</span>
                <span className="diff-note">
                  てき: {tuning === DIFF_TUNING.easy ? "" : ""}
                  {state.meta.diff === "easy" ? "かんたん" : state.meta.diff === "normal" ? "ふつう" : state.meta.diff === "hard" ? "むずかしい" : "おに"}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {isSpectator && (
        <div className="spectate-bar">
          📺 観戦中 — {room.code}
          <button className="btn ghost" onClick={onLeave}>
            観戦をやめる
          </button>
        </div>
      )}

      {/* ---- インクギミック ---- */}
      {inkMode && (
        <div className="ink-overlay">
          <div className="ink-blob b1">🖤</div>
          <div className="ink-blob b2">🖤</div>
          <div className="ink-blob b3">🖤</div>
        </div>
      )}
    </div>
  );
}
