import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { Session } from "../App";
import type {
  GimmickEvent,
  PlayerState,
  RoomState,
  TelegraphEvent,
} from "../game/types";
import {
  BERSERK,
  DIFF_TUNING,
  ENEMY_KINDS,
  STAGES,
  TUNING,
  equipDef,
  furyMult,
  roleDef,
} from "../game/data";
import { HostBrain } from "../game/host";
import { Room, aliveEnemies, allPlayers, isSurvival } from "../game/room";
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
import { fireAndForget } from "../net/store";
import { alienFor, enAsset } from "../assets";
import { TouchKeyboard, isTouchDevice } from "../ui/TouchKeyboard";
import { WordReel, nextReelId, type ReelItem } from "../ui/WordReel";
import { PixelIcon, Px } from "../ui/PixelIcon";

const TOUCH = isTouchDevice();

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
  const [modeState, setMode] = useState<"attack" | "heal">("attack");
  // かいふくの無いロール（ばーさーかー）は常にこうげき
  const myRole = roleDef(me?.role ?? "attacker");
  const mode: "attack" | "heal" = myRole.noHeal ? "attack" : modeState;
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
    defended: 0, revived: 0, kills: 0, maxCombo: 0,
  });
  const localSessionStats = useRef({ typed: 0, miss: 0, startAt: Date.now() });
  const inkUntil = useRef(0);
  const kataUntil = useRef(0);
  // 攻撃予告の「自分の時計での」解決時刻。ホストの時計とズレていても
  // 予告が消えない／早く消えることがないよう、受信時刻＋猶予で持つ
  const teleLocalRef = useRef<Record<string, number>>({});
  const enemyHitAt = useRef<Record<string, number>>({});
  const comboRef = useRef(0);
  // ばーさーかーのいかりスタック。計算はこのローカル値、RTDB は仲間に見せるためのミラー
  const furyRef = useRef(0);
  const [fury, setFuryState] = useState(0);
  const setFury = useCallback(
    (n: number) => {
      if (n === furyRef.current) return;
      furyRef.current = n;
      setFuryState(n);
      fireAndForget("いかり同期", room.setFury(n));
    },
    [room]
  );
  // ステージをまたいだら 0 から（コンボと同じ）。前ステージの値が RTDB に残らないよう明示的に書く
  useEffect(() => {
    if (!isSpectator && myRole.fury) fireAndForget("いかり初期化", room.setFury(0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const activeCardRef = useRef<Card | null>(null);
  const cardsRef = useRef<Card[]>([]);

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
        const resolveAt = Date.now() + Math.max(0, t.resolveAt - t.at);
        teleLocalRef.current[id] = resolveAt;
        // 全体攻撃は targets:[] で送られるが、RTDB は空配列を削除するので undefined で届く
        const targets = t.targets ?? [];
        const targetsMe =
          !isSpectator && (targets.length === 0 || targets.includes(room.myId));
        if (targetsMe && me?.alive) {
          const w = pickDefense();
          defenseCardsRef.current = [
            ...defenseCardsRef.current,
            {
              kind: "defense",
              id,
              word: new TypingWord(w.d, w.k),
              resolveAt,
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
        const ev = (s.events ?? {})[card.id] as TelegraphEvent | undefined;
        const attacker = ev ? (s.enemies ?? {})[String(ev.enemyIdx)] : undefined;
        // 予告した敵が倒れた／ウェーブが進んで予告が消えた → 攻撃は来ない。カードも下げる
        if (!ev || !attacker?.alive) {
          defenseCardsRef.current = defenseCardsRef.current.filter((c) => c.id !== card.id);
          changed = true;
          continue;
        }
        if (now < card.resolveAt) continue;
        defenseCardsRef.current = defenseCardsRef.current.filter((c) => c.id !== card.id);
        changed = true;
        if (!myself?.alive) continue;
        const baseDmg = ev?.dmg ?? 10;
        const mult = Room.takenMult(myself) * (card.defended ? 0.5 : 1);
        const dmg = Math.max(1, Math.round(baseDmg * mult));
        fireAndForget("被ダメージ適用", room.damageSelf(dmg));
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
  cardsRef.current = cards;
  useEffect(() => {
    if (activeCard && activeCard.id !== activeCardId) setActiveCardId(activeCard.id);
  }, [activeCard, activeCardId]);

  /** ジャンルワード完了の効果（ダメージ／回復／ゲージ／バフ）。カード差し替え後に呼ばれる */
  const applyGenreWord = useCallback(
    async (card: GenreCard, myself: PlayerState, s: RoomState) => {
      const kanaLen = card.word.kana.length;
      const crit = card.word.missCount === 0;
      const chainCount = await room.registerChain();
      statsDelta.current.words++;

      if (mode === "attack") {
        const enemy = (s.enemies ?? {})[targetKey];
        if (enemy?.alive) {
          const kind = ENEMY_KINDS[enemy.kind];
          const weakness = card.genre === enemy.weakness;
          const wMult = weakness
            ? kind?.boss
              ? TUNING.bossWeaknessMult
              : TUNING.weaknessMult
            : 1;
          const mult = Room.damageMult(myself, s, chainCount, wMult, crit, furyRef.current);
          const dmg = Math.round(kanaLen * TUNING.wordBonusPerKana * mult + pendingDmg.current);
          pendingDmg.current = 0;
          statsDelta.current.damage += dmg;
          const killed = await room.damageEnemy(Number(targetKey), dmg);
          if (killed) statsDelta.current.kills++;
          enemyHitAt.current[targetKey] = Date.now();
          addFloat(
            `${weakness ? `弱点×${wMult}!` : ""}${crit ? "会心!" : ""} ${dmg}`,
            crit || weakness ? "float-crit" : "float-dmg",
            "enemy"
          );
          if (killed && kind?.boss) {
            fireAndForget(
              "ボス撃破メッセージ",
              room.pushEvent({ type: "info", text: `🎉 ${kind.win}`, at: Date.now() } as never)
            );
          }
          if (killed) sfx.kill();
          else if (crit) sfx.crit();
          else sfx.wordDone();
          // ばーさーかー: ノーミスで打ち切るたびにいかりが1段上がる（次のワードから効く）
          if (crit && roleDef(myself.role).fury && furyRef.current < BERSERK.maxStacks) {
            const next = furyRef.current + 1;
            setFury(next);
            addFloat(
              `🔥いかり ×${furyMult(next)}${next >= BERSERK.maxStacks ? " MAX!" : ""}`,
              "float-fury",
              "self"
            );
          }
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
      fireAndForget("ユニゾンゲージ加算", room.addGauge(gaugeGain));
      if (roleDef(myself.role).buffOnWord) fireAndForget("応援バフ", room.applyBuff());
      forceUpdate();
    },
    [room, mode, targetKey, addFloat, setFury]
  );

  // ---------- ワード完了処理 ----------
  // カードの差し替えは通信を待たずに同期で行う。
  // （通信待ちの間に敵が倒れる／シャッフルが来る／書き込みが失敗すると、
  //   打ち終わったカードが差し替わらずに残り続けていた）
  const completeWord = useCallback(
    (card: Card) => {
      const s = stateRef.current;
      const myself = s.players?.[room.myId];
      if (!myself) return;

      if (card.kind === "defense") {
        card.defended = true;
        statsDelta.current.defended++;
        addFloat("ガードじゅんびOK!", "float-guard", "self");
        sfx.wordDone();
        // ガード済みカードは攻撃が解決するまで残るので、リールを次のワードへ進めて手を止めさせない
        setActiveCardId(nextReelId(cardsRef.current, card.id));
        forceUpdate();
        return;
      }
      if (card.kind === "revive") {
        // 仲間が alive になるまでは完了済みカードを見せておき、state 更新で自然に消える。
        // 失敗したら打ち直せるよう新しいワードに差し替える
        sfx.revive();
        addFloat("⛑️ふっかつ！", "float-heal", "self");
        forceUpdate();
        room
          .revive(card.pid)
          .then(() => {
            statsDelta.current.revived++;
          })
          .catch((e) => {
            console.warn("[TYPE HEROES] 蘇生の書き込みに失敗", e);
            const w = pickRevive();
            reviveWordsRef.current.set(card.pid, new TypingWord(w.d, w.k));
            forceUpdate();
          });
        return;
      }

      // genre カード: 先に次のワードへ差し替えてから、ダメージ等を非同期で反映
      genreCardsRef.current = genreCardsRef.current.map((c) =>
        c.id === card.id
          ? makeGenreCard(genreCardsRef.current.filter((x) => x.id !== c.id).map((x) => x.genre))
          : c
      );
      forceUpdate();
      fireAndForget("ワード完了の反映", applyGenreWord(card, myself, s));
    },
    [room, addFloat, makeGenreCard, forceUpdate, applyGenreWord]
  );

  // ---------- 1打鍵の処理（物理キーボードとタッチキーボード共通） ----------
  const handleChar = useCallback(
    (key: string) => {
      const s = stateRef.current;
      const myself = s.players?.[room.myId];
      if (!myself?.alive) return;

      // ユニゾン最優先
      const word = unisonTyping
        ? unisonWordRef.current!.word
        : activeCard?.word;
      if (!word || word.finished) return;

      const ok = word.input(key);
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
            const m = Room.damageMult(myself, s, 1, 1, false, furyRef.current);
            pendingDmg.current += TUNING.keyDamage * m;
            enemyHitAt.current[targetKey] = Date.now();
          } else {
            pendingHeal.current += TUNING.keyHeal * Room.healMult(myself);
          }
        }
        if (word.finished) {
          if (unisonTyping) {
            fireAndForget("ユニゾン入力完了", room.unisonDone());
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
        // ばーさーかーはミスでいかりが消える
        if (roleDef(myself.role).fury && furyRef.current > 0) {
          setFury(0);
          addFloat("💨いかりが さめた…", "float-hurt", "self");
        }
        // 上位ティアはミスが自傷になる（ロール・装備は効かないフラット値）
        const selfDmg = DIFF_TUNING[s.meta.diff].missSelfDamage;
        if (selfDmg > 0) {
          fireAndForget("ミス自傷", room.damageSelf(selfDmg));
          addFloat(`💥-${selfDmg}`, "float-hurt", "self");
        }
      }
      forceUpdate();
    },
    [room, activeCard, mode, targetKey, unisonTyping, completeWord, forceUpdate, addFloat, setFury]
  );

  // ---------- キー入力（物理キーボード） ----------
  useEffect(() => {
    if (isSpectator) return;
    const onKey = (e: KeyboardEvent) => {
      const myself = stateRef.current.players?.[room.myId];
      if (!myself?.alive) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "Tab") {
        e.preventDefault();
        if (cards.length > 1 && activeCard) {
          setActiveCardId(nextReelId(cards, activeCard.id, e.shiftKey ? -1 : 1));
        }
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        if (!roleDef(myself.role).noHeal) setMode((m) => (m === "attack" ? "heal" : "attack"));
        return;
      }
      // 数字キーでターゲット変更（敵カードの番号バッジと対応。ワードに数字は出ない）
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const key = String(Number(e.key) - 1);
        if (stateRef.current.enemies?.[key]?.alive) setTargetKey(key);
        return;
      }
      if (!/^[a-z0-9\-,.!?/]$/i.test(e.key)) return;
      e.preventDefault();
      handleChar(e.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSpectator, room, activeCard, cards, handleChar]);

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
        if (enemy?.alive)
          fireAndForget(
            "打鍵ダメージ",
            room.damageEnemy(Number(targetKey), dmg).then((killed) => {
              if (killed) statsDelta.current.kills++;
            })
          );
      }
      if (pendingHeal.current >= 1) {
        const amount = Math.round(pendingHeal.current);
        pendingHeal.current = 0;
        statsDelta.current.heal += amount;
        const targets = allPlayers(s).filter(([, p]) => p.alive);
        targets.sort((a, b) => a[1].hp / a[1].maxHp - b[1].hp / b[1].maxHp);
        if (targets[0]) fireAndForget("打鍵回復", room.healPlayer(targets[0][0], amount));
      }
    }, 700);
    const statsIv = setInterval(() => {
      const d = statsDelta.current;
      if (d.damage || d.heal || d.typed || d.miss || d.words || d.defended || d.revived || d.kills || d.maxCombo) {
        fireAndForget("スタッツ送信", room.flushStats({ ...d }));
        statsDelta.current = {
          damage: 0, heal: 0, typed: 0, miss: 0, words: 0,
          defended: 0, revived: 0, kills: 0, maxCombo: 0,
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
      fireAndForget("ホスト進行", brain.tick(stateRef.current));
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
  const survival = isSurvival(state);

  // 敵の攻撃予告（画面表示用）。倒れた敵の予告は出さない
  const telegraphs = Object.entries(state.events ?? {}).filter(([id, ev]) => {
    if (ev.type !== "telegraph") return false;
    const t = ev as TelegraphEvent;
    const localAt = teleLocalRef.current[id] ?? t.resolveAt;
    return localAt > now && !!(state.enemies ?? {})[String(t.enemyIdx)]?.alive;
  }) as [string, TelegraphEvent][];

  const infoEvents = Object.entries(state.events ?? {})
    .filter(([, ev]) => ev.type === "info" && now - ev.at < 4000)
    .map(([, ev]) => ev as { text: string; at: number })
    .sort((a, b) => b.at - a.at)
    .slice(0, 2);

  const wpmElapsed = Math.max(0.2, (now - localSessionStats.current.startAt) / 60000);
  const kpm = Math.round(localSessionStats.current.typed / wpmElapsed);
  const totalKeys = localSessionStats.current.typed + localSessionStats.current.miss;
  const acc = totalKeys > 0 ? Math.round((localSessionStats.current.typed / totalKeys) * 100) : 100;

  // タッチキーボードが打鍵を渡す先（＝いま入力を受けているワード）
  const touchWord = !me?.alive
    ? null
    : unisonTyping
      ? unisonWordRef.current?.word ?? null
      : unison?.active && unison.done?.[room.myId]
        ? null
        : activeCard?.word ?? null;

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
          {survival ? (
            <>
              <PixelIcon name="skull" /> WAVE {state.meta.wave + 1}{" "}
              <span className="wave-label kills-label">撃破 {state.meta.kills ?? 0}</span>{" "}
              <span className="wave-label"><Px>{stage.icon}</Px> {stage.name}</span>
            </>
          ) : (
            <>
              <Px>{stage.icon}</Px> {stage.name}{" "}
              <span className="wave-label">
                WAVE {state.meta.wave + 1}/{stage.waves.length}
              </span>
            </>
          )}
        </div>
        {boss && (
          <div className="rage-wrap" title="ボスのいかりゲージ。満タンで全体攻撃！">
            <span className="rage-icon"><PixelIcon name="anger" /></span>
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
              fireAndForget("ユニゾン発動", room.triggerUnison(w.d, w.k));
            }}
          >
            <PixelIcon name="sparkle" />ユニゾン
          </button>
        </div>
        {!isSpectator && (
          <button
            className="btn ghost giveup-btn"
            title={isHost ? "パーティー全員のバトルを終わらせる" : "パーティーをぬけてタイトルへ"}
            onClick={() => {
              if (isHost) {
                if (window.confirm("あきらめる？（全員のバトルが終わり、ぜんめつ扱いになります）")) {
                  fireAndForget("あきらめる", brain.giveUp(stateRef.current));
                }
              } else if (window.confirm("パーティーをぬけてタイトルにもどる？")) {
                onLeave();
              }
            }}
          >
            <PixelIcon name="flag" /> あきらめる
          </button>
        )}
      </div>

      {/* ---- バナー ---- */}
      <div className="banner-feed">
        {chainActive && (
          <div className="banner chain-banner">
            <PixelIcon name="chain" /> {chain!.count} CHAIN! 火力+
            {Math.round(Math.min(TUNING.chainBonusMax, (chain!.count - 1) * TUNING.chainBonusPer) * 100)}%
          </div>
        )}
        {buffActive && (
          <div className="banner buff-banner"><PixelIcon name="trumpet" /> おうえん中！ チーム火力+20%</div>
        )}
        {infoEvents.map((ev, i) => (
          <div key={ev.at + i} className="banner info-banner">
            <Px>{ev.text}</Px>
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
          const teleAt = tele ? teleLocalRef.current[tele[0]] ?? tele[1].resolveAt : 0;
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
              {e.alive && Number(key) < 9 && (
                <span className="enemy-num" title={`${Number(key) + 1} キーでねらう`}>
                  {Number(key) + 1}
                </span>
              )}
              <img
                className={`enemy-sprite ${e.alive ? "" : "ko"}`}
                src={enAsset(kind.sprite)}
                alt={kind.name}
                draggable={false}
                style={kind.tint ? ({ "--tint": kind.tint } as CSSProperties) : undefined}
              />
              <div className="enemy-name">
                {kind.boss && <PixelIcon name="crown" />}
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
                  弱点:<Px>{genre.icon}</Px>
                  {genre.label} ×{kind.boss ? TUNING.bossWeaknessMult : TUNING.weaknessMult}
                </div>
              )}
              {tele && (
                <div className="telegraph-warn">
                  <PixelIcon name="warning" />こうげき! {Math.max(0, Math.ceil((teleAt - now) / 1000))}
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
                <Px>{f.text}</Px>
              </div>
            ))}
        </div>
      </div>

      {/* ---- 床の装飾（EN ガジェット） ---- */}
      <div className="deco-strip">
        {stage.deco.map((d, i) => (
          <img key={i} src={enAsset(d)} alt="" draggable={false} />
        ))}
      </div>

      {/* ---- パーティー ---- */}
      <div className="party-area">
        {players.map(([pid, pl], playerIdx) => {
          const rd = roleDef(pl.role);
          const eq = equipDef(pl.equip);
          const targeted = telegraphs.some(
            ([, t]) => (t.targets ?? []).length === 0 || (t.targets ?? []).includes(pid)
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
                <img
                  className="avatar"
                  src={alienFor(playerIdx, pl.alive && pl.hp / pl.maxHp >= 0.6)}
                  alt=""
                  draggable={false}
                />
                <span className="player-role"><Px>{rd.icon}</Px></span>
                <span className="player-name">{pl.name}</span>
                {eq && <span className="player-equip" title={eq.desc}><Px>{eq.icon}</Px></span>}
                {rd.fury && (pid === room.myId ? fury : pl.fury ?? 0) > 0 && (
                  <span className="player-fury" title="いかり（ノーミス連続）">
                    <PixelIcon name="fire" />×{furyMult(pid === room.myId ? fury : pl.fury ?? 0)}
                  </span>
                )}
                {unison?.active && unison.done?.[pid] && <span title="ユニゾン入力完了"><PixelIcon name="check" /></span>}
              </div>
              <div className="bar player-hp-bar">
                <div
                  className={`bar-fill hp-fill ${pl.hp / pl.maxHp < 0.3 ? "low" : ""}`}
                  style={{ width: `${(pl.hp / pl.maxHp) * 100}%` }}
                />
              </div>
              <div className="player-hp-num">
                <Px>{pl.alive ? `${pl.hp}/${pl.maxHp}` : "😵 きぜつ中"}</Px>
              </div>
            </div>
          );
        })}
        <div className="float-layer self-floats">
          {floatsRef.current
            .filter((f) => f.area === "self")
            .map((f) => (
              <div key={f.id} className={`float ${f.cls}`}>
                <Px>{f.text}</Px>
              </div>
            ))}
        </div>
      </div>

      {/* ---- タイピングパネル ---- */}
      {!isSpectator && me && (
        <div className={`typing-panel ${missFlash ? "miss-flash" : ""}`}>
          {!me.alive ? (
            <div className="downed-overlay">
              <div className="downed-msg"><PixelIcon name="dizzy" /> きぜつしてしまった…</div>
              <div className="downed-sub">なかまの「そせいワード」を待とう！</div>
            </div>
          ) : unisonTyping && unisonWordRef.current ? (
            <div className="unison-panel">
              <div className="unison-title">
                <PixelIcon name="sparkle" /> ユニゾンアタック！ 全員で打ちきれ！（のこり
                {Math.max(0, Math.ceil((unison!.deadline - now) / 1000))}秒）
              </div>
              <div className="active-card unison-card">
                {dispWord(unisonWordRef.current.word, false)}
              </div>
            </div>
          ) : unison?.active && unison.done?.[room.myId] ? (
            <div className="unison-panel">
              <div className="unison-title"><PixelIcon name="check" /> 入力かんりょう！なかまを待て…</div>
            </div>
          ) : (
            <>
              <div className="mode-row">
                <button
                  className={`mode-btn attack ${mode === "attack" ? "sel" : ""}`}
                  onClick={() => setMode("attack")}
                >
                  <PixelIcon name="swords" /> こうげき
                </button>
                {myRole.noHeal ? (
                  <div
                    className={`fury-meter ${fury >= BERSERK.maxStacks ? "max" : ""}`}
                    title={`ノーミスで打ち切るごとに +${Math.round(BERSERK.perStack * 100)}%。ミスで 0 に戻る`}
                  >
                    {Array.from({ length: BERSERK.maxStacks }, (_, i) => (
                      <span key={i} className={`fury-pip ${i < fury ? "on" : ""}`}>
                        <PixelIcon name="fire" />
                      </span>
                    ))}
                    <span className="fury-mult">×{furyMult(fury)}</span>
                  </div>
                ) : (
                  <button
                    className={`mode-btn heal ${mode === "heal" ? "sel" : ""}`}
                    onClick={() => setMode("heal")}
                  >
                    <PixelIcon name="heart" /> かいふく
                  </button>
                )}
                <span className="mode-hint">
                  {myRole.noHeal ? "" : "Space: 切替 ／ "}Tab: つぎのワード ／ 1〜9: ねらう敵
                </span>
              </div>
              <WordReel
                activeId={activeCard?.id ?? ""}
                onSelect={setActiveCardId}
                items={cards.map((c): ReelItem => {
                  const targetEnemy = (state.enemies ?? {})[targetKey];
                  if (c.kind === "defense") {
                    const left = Math.max(0, Math.ceil((c.resolveAt - now) / 1000));
                    return {
                      id: c.id,
                      kind: "defense",
                      chip: "🛡️",
                      word: c.word,
                      label: c.defended
                        ? `🛡️ガードOK! あと${left}秒`
                        : `🛡️ぼうぎょ! のこり${left}秒`,
                    };
                  }
                  if (c.kind === "revive") {
                    return {
                      id: c.id,
                      kind: "revive",
                      chip: "⛑️",
                      word: c.word,
                      label: `⛑️そせい: ${state.players?.[c.pid]?.name ?? ""}`,
                    };
                  }
                  const genre = GENRES.find((g) => g.id === c.genre);
                  const weakHit =
                    mode === "attack" && !!targetEnemy?.alive && targetEnemy.weakness === c.genre;
                  const weakMult = weakHit
                    ? ENEMY_KINDS[targetEnemy!.kind]?.boss
                      ? TUNING.bossWeaknessMult
                      : TUNING.weaknessMult
                    : 1;
                  return {
                    id: c.id,
                    kind: "genre",
                    chip: genre?.icon ?? "❔",
                    word: c.word,
                    weak: weakHit,
                    kata: katakanaMode,
                    label: `${genre?.icon}${genre?.label}${weakHit ? ` ⚡弱点×${weakMult}` : ""}`,
                  };
                })}
              />
              <div className="stat-row">
                <span className={`combo ${combo >= 10 ? "hot" : ""}`}>
                  <PixelIcon name="fire" />コンボ {combo}
                </span>
                <span><PixelIcon name="keyboard" /> {kpm} 打/分</span>
                <span><PixelIcon name="target" /> せいかく {acc}%</span>
                <span className="diff-note" style={{ color: tuning.color }}>
                  てき: {tuning.label}
                </span>
                {tuning.missSelfDamage > 0 && (
                  <span className="miss-note" title="ミスタイプすると自分のHPが減る">
                    <PixelIcon name="burst" />ミス -{tuning.missSelfDamage}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ---- タッチキーボード（スマホ・タブレット） ---- */}
      {TOUCH && !isSpectator && touchWord && (
        <TouchKeyboard
          onKey={handleChar}
          nextKey={touchWord.romajiParts()[1][0]}
        />
      )}

      {isSpectator && (
        <div className="spectate-bar">
          <PixelIcon name="eye" /> 観戦中 — {room.code}
          <button className="btn ghost" onClick={onLeave}>
            観戦をやめる
          </button>
        </div>
      )}

      {/* ---- インクギミック ---- */}
      {inkMode && (
        <div className="ink-overlay">
          <div className="ink-blob b1"><PixelIcon name="heartBlack" /></div>
          <div className="ink-blob b2"><PixelIcon name="heartBlack" /></div>
          <div className="ink-blob b3"><PixelIcon name="heartBlack" /></div>
        </div>
      )}
    </div>
  );
}
