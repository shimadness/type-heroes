// ============================================================
// 対話式チュートリアル
//
// 【方針】説明文を読ませない。1ステップ＝1つの操作を実際にやって覚える。
//   ヒントは短い1行＋視覚（光るカード・矢印）で伝える。
//
// 【重要・改修時の注意】
//   画面に出す数値（弱点倍率・会心倍率・防御軽減率など）は必ず
//   TUNING / ENEMY_KINDS など「本編と同じ定数」から算出すること。
//   ベタ書きするとバランス調整のたびにチュートリアルだけ嘘になる。
//   ステップの流れ自体を変える改修をしたら STEPS の並びも見直す。
// ============================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { ENEMY_KINDS, TUNING, roleDef } from "../game/data";
import { TypingWord } from "../typing/romaji";
import { GENRES, type GenreId } from "../typing/words";
import { alienFor, enAsset } from "../assets";
import { sfx } from "../sfx";
import { TouchKeyboard, isTouchDevice } from "../ui/TouchKeyboard";

const TOUCH = isTouchDevice();

interface Props {
  onExit: () => void;
}

type StepId =
  | "attack"
  | "weakness"
  | "defense"
  | "heal"
  | "revive"
  | "unison"
  | "done";

const STEPS: { id: StepId; label: string }[] = [
  { id: "attack", label: "こうげき" },
  { id: "weakness", label: "弱点" },
  { id: "defense", label: "ぼうぎょ" },
  { id: "heal", label: "かいふく" },
  { id: "revive", label: "そせい" },
  { id: "unison", label: "ユニゾン" },
];

const MAX_HP = 100;

interface Card {
  id: string;
  genre?: GenreId;
  kind: "genre" | "defense" | "revive" | "unison";
  word: TypingWord;
}

let seq = 0;
const cid = () => `t${seq++}`;

const genreOf = (id: GenreId) => GENRES.find((g) => g.id === id)!;

export function Tutorial({ onExit }: Props) {
  const [step, setStep] = useState<StepId>("attack");
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  // --- 演出・進行用のミニ状態（本編と同じ見た目のまま、進行だけ台本化する）---
  const cardsRef = useRef<Card[]>([]);
  const activeIdRef = useRef("");
  const enemyHpRef = useRef(100);
  const enemyMaxRef = useRef(100);
  const myHpRef = useRef(MAX_HP);
  const allyHpRef = useRef(MAX_HP);
  const allyAliveRef = useRef(true);
  const modeRef = useRef<"attack" | "heal">("attack");
  const gaugeRef = useRef(0);
  const telegraphRef = useRef<{ until: number; dmg: number } | null>(null);
  const defendedRef = useRef(false);
  const flashRef = useRef<{ text: string; cls: string } | null>(null);
  const okRef = useRef(false); // ステップ達成後の小休止フラグ
  const hitRef = useRef(0);

  const enemyKind =
    step === "unison" ? ENEMY_KINDS.debtgolem : ENEMY_KINDS.minibug;
  const weakGenre: GenreId = "it";

  const float = useCallback(
    (text: string, cls: string) => {
      flashRef.current = { text, cls };
      rerender();
      setTimeout(() => {
        flashRef.current = null;
        rerender();
      }, 1200);
    },
    [rerender]
  );

  // ---------- 各ステップのお膳立て ----------
  const setup = useCallback(
    (s: StepId) => {
      okRef.current = false;
      telegraphRef.current = null;
      defendedRef.current = false;
      modeRef.current = "attack";
      cardsRef.current = [];

      if (s === "attack") {
        enemyMaxRef.current = 28; // 2語くらいで倒せる量（最初の1歩を軽くする）
        enemyHpRef.current = 28;
        myHpRef.current = MAX_HP;
        allyHpRef.current = MAX_HP;
        allyAliveRef.current = true;
        cardsRef.current = [
          { id: cid(), kind: "genre", genre: "food", word: new TypingWord("りんご", "りんご") },
        ];
      } else if (s === "weakness") {
        enemyMaxRef.current = 120;
        enemyHpRef.current = 120;
        cardsRef.current = [
          { id: cid(), kind: "genre", genre: "animal", word: new TypingWord("ねこ", "ねこ") },
          { id: cid(), kind: "genre", genre: "it", word: new TypingWord("バグ", "ばぐ") },
        ];
      } else if (s === "defense") {
        enemyMaxRef.current = 120;
        enemyHpRef.current = 90;
        telegraphRef.current = { until: Date.now() + 7000, dmg: 24 };
        cardsRef.current = [
          { id: cid(), kind: "defense", word: new TypingWord("ガード", "がーど") },
        ];
        sfx.warn();
      } else if (s === "heal") {
        myHpRef.current = 38;
        cardsRef.current = [
          { id: cid(), kind: "genre", genre: "nature", word: new TypingWord("ひかり", "ひかり") },
        ];
      } else if (s === "revive") {
        myHpRef.current = 70;
        allyAliveRef.current = false;
        allyHpRef.current = 0;
        cardsRef.current = [
          { id: cid(), kind: "revive", word: new TypingWord("なかまよたちあがれ", "なかまよたちあがれ") },
        ];
      } else if (s === "unison") {
        enemyMaxRef.current = 240;
        enemyHpRef.current = 240;
        allyAliveRef.current = true;
        allyHpRef.current = 64;
        gaugeRef.current = 100;
        cardsRef.current = [];
      }
      activeIdRef.current = cardsRef.current[0]?.id ?? "";
      rerender();
    },
    [rerender]
  );

  useEffect(() => {
    setup(step);
  }, [step, setup]);

  const advance = useCallback(
    (delay = 1100) => {
      if (okRef.current) return;
      okRef.current = true;
      rerender();
      setTimeout(() => {
        const i = STEPS.findIndex((s) => s.id === step);
        setStep(i >= 0 && i + 1 < STEPS.length ? STEPS[i + 1].id : "done");
      }, delay);
    },
    [step, rerender]
  );

  // ---------- 防御の時間切れ ----------
  useEffect(() => {
    if (step !== "defense") return;
    const iv = setInterval(() => {
      const t = telegraphRef.current;
      if (!t) return;
      if (Date.now() >= t.until) {
        telegraphRef.current = null;
        const dmg = defendedRef.current ? Math.round(t.dmg / 2) : t.dmg;
        myHpRef.current = Math.max(1, myHpRef.current - dmg);
        sfx.hurt();
        float(
          defendedRef.current ? `🛡️-${dmg} はんげん！` : `-${dmg}`,
          defendedRef.current ? "float-guard" : "float-hurt"
        );
        // 失敗しても先へ進む（もう一度やり直すより流れを止めない方がよい）
        advance(1500);
      }
      rerender();
    }, 200);
    return () => clearInterval(iv);
  }, [step, advance, float, rerender]);

  // ---------- ワード完了時の処理 ----------
  const onWordDone = useCallback(
    (card: Card) => {
      const kana = card.word.kana.length;
      const crit = card.word.missCount === 0;

      if (card.kind === "defense") {
        defendedRef.current = true;
        sfx.wordDone();
        float("ガードOK!", "float-guard");
        rerender();
        return;
      }
      if (card.kind === "revive") {
        allyAliveRef.current = true;
        allyHpRef.current = Math.round(MAX_HP * TUNING.reviveHpRatio);
        sfx.revive();
        float("⛑️ふっかつ！", "float-heal");
        advance(1300);
        return;
      }
      if (card.kind === "unison") {
        const dmg = TUNING.unisonDmgPerPlayer * 2;
        enemyHpRef.current = Math.max(0, enemyHpRef.current - dmg);
        hitRef.current = Date.now();
        gaugeRef.current = 0;
        sfx.unison();
        float(`✨ユニゾン ${dmg}!`, "float-crit");
        advance(1600);
        return;
      }

      // 通常ワード
      if (modeRef.current === "heal") {
        const amount = Math.round(kana * TUNING.healPerKana * (crit ? 1.2 : 1));
        myHpRef.current = Math.min(MAX_HP, myHpRef.current + amount);
        sfx.heal();
        float(`+${amount}`, "float-heal");
        advance();
        return;
      }
      if (step === "heal") {
        // 攻撃モードのまま打ち切った → 回復にならないことを見せて、もう1語出す
        float("こうげきになっちゃった！", "float-dmg");
        cardsRef.current = [
          { id: cid(), kind: "genre", genre: "nature", word: new TypingWord("にじ", "にじ") },
        ];
        activeIdRef.current = cardsRef.current[0].id;
        rerender();
        return;
      }

      const weak = card.genre === weakGenre && step === "weakness";
      const mult = (weak ? TUNING.weaknessMult : 1) * (crit ? TUNING.critMult : 1);
      const dmg = Math.round(kana * TUNING.wordBonusPerKana * mult * 1.25);
      enemyHpRef.current = Math.max(0, enemyHpRef.current - dmg);
      hitRef.current = Date.now();
      sfx.wordDone();
      float(
        `${weak ? `弱点×${TUNING.weaknessMult}! ` : ""}${crit ? "会心! " : ""}${dmg}`,
        weak || crit ? "float-crit" : "float-dmg"
      );

      if (step === "attack") {
        if (enemyHpRef.current <= 0) {
          sfx.kill();
          advance(1300);
        } else {
          // 倒しきれなければ同じ敵にもう1語
          cardsRef.current = [
            { id: cid(), kind: "genre", genre: "food", word: new TypingWord("たまご", "たまご") },
          ];
          activeIdRef.current = cardsRef.current[0].id;
        }
      } else if (step === "weakness") {
        if (weak) {
          advance(1400);
        } else {
          // 弱点でない方を打った → 威力の差を体感させて、弱点カードだけ残す
          float("弱点じゃないと ひかえめ…", "float-dmg");
          cardsRef.current = [
            { id: cid(), kind: "genre", genre: "it", word: new TypingWord("サーバー", "さーばー") },
          ];
          activeIdRef.current = cardsRef.current[0].id;
        }
      }
      rerender();
    },
    [step, advance, float, rerender]
  );

  // ---------- 1打鍵の処理（物理キーボードとタッチキーボード共通） ----------
  const handleChar = useCallback(
    (ch: string) => {
      if (step === "done") return;
      const card = cardsRef.current.find((c) => c.id === activeIdRef.current);
      if (!card || card.word.finished) return;
      // 回復ステップでは攻撃モードのままだと進まない（切り替えに気づいてもらう）
      if (card.word.input(ch)) {
        sfx.type();
        if (card.word.finished) onWordDone(card);
      } else {
        sfx.miss();
      }
      rerender();
    },
    [step, onWordDone, rerender]
  );

  // ---------- キー入力（物理キーボード） ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (step === "done") return;

      if (e.key === "Tab") {
        e.preventDefault();
        const cards = cardsRef.current;
        if (cards.length > 1) {
          const i = cards.findIndex((c) => c.id === activeIdRef.current);
          activeIdRef.current = cards[(i + 1) % cards.length].id;
          rerender();
        }
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        modeRef.current = modeRef.current === "attack" ? "heal" : "attack";
        rerender();
        return;
      }
      if (!/^[a-z0-9\-,.!?/]$/i.test(e.key)) return;
      e.preventDefault();
      handleChar(e.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, handleChar, rerender]);

  // ---------- ユニゾン発動 ----------
  const fireUnison = () => {
    cardsRef.current = [
      {
        id: cid(),
        kind: "unison",
        word: new TypingWord("みんなのこころをひとつに", "みんなのこころをひとつに"),
      },
    ];
    activeIdRef.current = cardsRef.current[0].id;
    sfx.unison();
    rerender();
  };

  // ---------- 表示 ----------
  const now = Date.now();
  const activeCard = cardsRef.current.find((c) => c.id === activeIdRef.current);
  const stepIdx = STEPS.findIndex((s) => s.id === step);
  const healMode = modeRef.current === "heal";
  const tele = telegraphRef.current;
  const unisonReady = step === "unison" && cardsRef.current.length === 0;

  // ヒントは1行だけ。数値は本編の定数から出す（ベタ書き禁止）
  const HINTS: Record<StepId, { main: string; sub?: string }> = {
    attack: {
      main: "ローマ字で打つと ダメージ！",
      sub: "1打鍵ごとに敵がのけぞる。ミスなく打ち切ると会心（×" + TUNING.critMult + "）",
    },
    weakness: {
      main: TOUCH
        ? "⚡弱点 のカードをタップしてから打とう"
        : "Tab で ⚡弱点 のカードにきりかえて打とう",
      sub: `弱点ジャンルは ×${TUNING.weaknessMult}（ボスは ×${TUNING.bossWeaknessMult}）`,
    },
    defense: {
      main: "⚠️こうげきが来る！ 赤いカードを打ち切れ",
      sub: "間に合えば ダメージはんげん",
    },
    heal: {
      main: TOUCH
        ? "ライフがピンチ！ 💚かいふく をタップしてから打とう"
        : "ライフがピンチ！ Space で 💚かいふく に切りかえて打とう",
      sub: "同じタイピングでも 攻撃か回復かが変わる",
    },
    revive: {
      main: "なかまが きぜつした！ そせいワードで助けよう",
      sub: "全員たおれなければ 負けにならない",
    },
    unison: {
      main: "ゲージ満タン！ ✨ユニゾン を押して全員で打ち切れ",
      sub: "チームの必殺技。仲間との合わせ技で大ダメージ",
    },
    done: { main: "", sub: "" },
  };

  if (step === "done") {
    return (
      <div className="screen center tutorial-done-screen">
        <h1 className="clear-title">🎓 チュートリアル しゅうりょう！</h1>
        <div className="tutorial-summary">
          <div className="tut-sum-row">
            <span>⚡</span>
            <span>
              弱点カードは ×{TUNING.weaknessMult}、ボスなら ×{TUNING.bossWeaknessMult}。
              速く打つより <b>選んで打つ</b> ほうが強い
            </span>
          </div>
          <div className="tut-sum-row">
            <span>🔗</span>
            <span>
              仲間の完了から{Math.round(TUNING.chainWindow / 1000)}秒以内に完了すると
              チェイン（最大+{Math.round(TUNING.chainBonusMax * 100)}%）
            </span>
          </div>
          <div className="tut-sum-row">
            <span>{roleDef("healer").icon}</span>
            <span>ヒーラーが1人いると安定。ロールは部屋で変えられる</span>
          </div>
          <div className="tut-sum-row">
            <span>🏕️</span>
            <span>
              難易度は部屋（じゅんびのやかた）で決める。
              <b>自分の出題だけ「かんたん」</b>にもできるので、
              打つのが苦手な人も同じ部屋で遊べる
            </span>
          </div>
        </div>
        <div className="result-actions">
          <button className="btn primary big" onClick={onExit}>
            タイトルへ もどる
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="screen battle-screen tutorial-screen"
      style={{ background: "linear-gradient(180deg,#0d1b2a 0%,#16324a 55%,#0a1522 100%)" }}
    >
      {/* 進行度 */}
      <div className="tutorial-top">
        <div className="tutorial-steps">
          {STEPS.map((s, i) => (
            <span
              key={s.id}
              className={`tut-step ${i === stepIdx ? "cur" : ""} ${i < stepIdx ? "done" : ""}`}
            >
              {s.label}
            </span>
          ))}
        </div>
        <button className="btn ghost tut-skip" onClick={onExit}>
          やめる
        </button>
      </div>

      {/* ヒント（1行＋補足1行だけ） */}
      <div className="tutorial-hint">
        <div className="tut-hint-main">{HINTS[step].main}</div>
        {HINTS[step].sub && <div className="tut-hint-sub">{HINTS[step].sub}</div>}
      </div>

      {/* 敵 */}
      <div className="enemy-area">
        {step !== "heal" && step !== "revive" && (
          <div
            className={`enemy-card ${enemyKind.boss ? "boss" : ""} targeted ${
              now - hitRef.current < 200 ? "hit" : ""
            } ${enemyHpRef.current <= 0 ? "dead" : ""}`}
          >
            <img
              className={`enemy-sprite ${enemyHpRef.current <= 0 ? "ko" : ""}`}
              src={enAsset(enemyKind.sprite)}
              alt=""
              draggable={false}
            />
            <div className="enemy-name">
              {enemyKind.boss && "👑"}
              {enemyKind.name}
            </div>
            <div className="bar enemy-hp-bar">
              <div
                className="bar-fill hp-fill"
                style={{ width: `${(enemyHpRef.current / enemyMaxRef.current) * 100}%` }}
              />
            </div>
            {step === "weakness" && (
              <div className="weakness-chip">
                弱点:{genreOf(weakGenre).icon}
                {genreOf(weakGenre).label} ×{TUNING.weaknessMult}
              </div>
            )}
            {tele && (
              <div className="telegraph-warn">
                ⚠️こうげき! {Math.max(0, Math.ceil((tele.until - now) / 1000))}
              </div>
            )}
          </div>
        )}
        <div className="float-layer enemy-floats">
          {flashRef.current && (
            <div className={`float ${flashRef.current.cls}`}>{flashRef.current.text}</div>
          )}
        </div>
      </div>

      {/* 味方 */}
      <div className="party-area">
        <div className="player-card me">
          <div className="player-head">
            <img className="avatar" src={alienFor(0, myHpRef.current >= 60)} alt="" />
            <span className="player-role">{roleDef("attacker").icon}</span>
            <span className="player-name">きみ</span>
          </div>
          <div className="bar player-hp-bar">
            <div
              className={`bar-fill hp-fill ${myHpRef.current / MAX_HP < 0.3 ? "low" : ""}`}
              style={{ width: `${(myHpRef.current / MAX_HP) * 100}%` }}
            />
          </div>
          <div className="player-hp-num">
            {myHpRef.current}/{MAX_HP}
          </div>
        </div>
        <div className={`player-card ${allyAliveRef.current ? "" : "downed"}`}>
          <div className="player-head">
            <img className="avatar" src={alienFor(1, allyAliveRef.current)} alt="" />
            <span className="player-role">{roleDef("healer").icon}</span>
            <span className="player-name">なかま</span>
          </div>
          <div className="bar player-hp-bar">
            <div
              className="bar-fill hp-fill"
              style={{ width: `${(allyHpRef.current / MAX_HP) * 100}%` }}
            />
          </div>
          <div className="player-hp-num">
            {allyAliveRef.current ? `${allyHpRef.current}/${MAX_HP}` : "😵 きぜつ中"}
          </div>
        </div>
      </div>

      {/* 入力パネル */}
      <div className="typing-panel">
        <div className="mode-row">
          <button
            className={`mode-btn attack ${!healMode ? "sel" : ""}`}
            onClick={() => {
              modeRef.current = "attack";
              rerender();
            }}
          >
            ⚔️ こうげき
          </button>
          <button
            className={`mode-btn heal ${healMode ? "sel" : ""} ${
              step === "heal" && !healMode ? "want" : ""
            }`}
            onClick={() => {
              modeRef.current = "heal";
              rerender();
            }}
          >
            💚 かいふく
          </button>
          {step === "unison" && (
            <button
              className={`btn unison-btn ${unisonReady ? "ready" : ""}`}
              disabled={!unisonReady}
              onClick={fireUnison}
            >
              ✨ユニゾン
            </button>
          )}
        </div>

        <div className="card-row">
          {cardsRef.current.map((c) => {
            const isActive = c.id === activeIdRef.current;
            const weakHit = c.kind === "genre" && c.genre === weakGenre && step === "weakness";
            const [typed, rest] = c.word.romajiParts();
            const label =
              c.kind === "defense"
                ? "🛡️ぼうぎょ!"
                : c.kind === "revive"
                  ? "⛑️そせい: なかま"
                  : c.kind === "unison"
                    ? "✨ユニゾンアタック"
                    : `${genreOf(c.genre!).icon}${genreOf(c.genre!).label}${
                        weakHit ? ` ⚡弱点×${TUNING.weaknessMult}` : ""
                      }`;
            return (
              <button
                key={c.id}
                className={[
                  "word-card",
                  c.kind,
                  isActive ? "active" : "",
                  weakHit ? "weak-match" : "",
                  step === "weakness" && weakHit && !isActive ? "tut-want" : "",
                ].join(" ")}
                onClick={() => {
                  activeIdRef.current = c.id;
                  rerender();
                }}
              >
                <div className={`card-label ${c.kind}`}>{label}</div>
                <div className="card-jp">{c.word.display}</div>
                <div className="card-romaji">
                  <span className="typed">{typed}</span>
                  <span className="rest">{rest}</span>
                </div>
                <div className="bar word-progress">
                  <div
                    className="bar-fill word-progress-fill"
                    style={{ width: `${c.word.progress() * 100}%` }}
                  />
                </div>
              </button>
            );
          })}
          {unisonReady && (
            <div className="tut-waiting">↑ ✨ユニゾン を押してみよう</div>
          )}
        </div>

        {okRef.current && <div className="tut-ok">✓ できた！</div>}
        {activeCard && step === "heal" && !healMode && (
          <div className="tut-nudge">
            {TOUCH
              ? "💚かいふく をタップしてから打とう"
              : "Space をおして 💚かいふく にしてから打とう"}
          </div>
        )}
      </div>

      {/* タッチキーボード（スマホ・タブレット） */}
      {TOUCH && activeCard && !activeCard.word.finished && (
        <TouchKeyboard
          onKey={handleChar}
          nextKey={activeCard.word.romajiParts()[1][0]}
        />
      )}
    </div>
  );
}
