import { useState } from "react";
import type { JoinProfile } from "../game/room";
import { SURVIVAL, type TeamDifficulty } from "../game/data";
import type { GameMode } from "../game/types";
import { alienFor, enAsset } from "../assets";
import { PixelIcon } from "../ui/PixelIcon";

interface Props {
  error: string;
  onSolo: (profile: JoinProfile, teamDiff: TeamDifficulty, gameMode: GameMode) => void;
  onCreate: (pw: string, profile: JoinProfile, teamDiff: TeamDifficulty, gameMode: GameMode) => void;
  onJoin: (pw: string, profile: JoinProfile) => void;
  onSpectate: (pw: string) => void;
  onRanking: () => void;
  onTutorial: () => void;
  onLegal: () => void;
}

// 画面内のセットアップ段階（warlord = うぉーろーどのサブメニュー）。
// ソロはパネルを出さず、ボタンを押したら即ロビーへ行く（設定は全部ロビーで決める）
type Mode = "menu" | "warlord" | "create" | "join" | "spectate";

export function Title(p: Props) {
  const [mode, setMode] = useState<Mode>("menu");
  // ゲームモードはここでだけ決める（ロビーでは表示のみ）
  const [gameMode, setGameMode] = useState<GameMode>("story");
  const [name, setName] = useState(
    () => localStorage.getItem("th_name") ?? ""
  );
  const [pw, setPw] = useState("");
  // ロールと難易度はロビーで決める（ここで選ばせるとロビーの設定と二重になる）。
  // これらはその初期値でしかない。
  const diff: TeamDifficulty = "normal";
  const [busy, setBusy] = useState(false);

  const profile = (): JoinProfile => {
    try {
      localStorage.setItem("th_name", name);
    } catch {}
    return { name: name || "ゆうしゃ", role: "attacker", diff };
  };

  const go = async (fn: () => void) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen title-screen center">
      <div className="title-logo">
        <h1 className="title-main">
          TYPE <span className="title-accent">HEROES</span>
        </h1>
        <div className="title-parade">
          {[0, 1, 2, 3].map((i) => (
            <img key={i} src={alienFor(i, true)} alt="" draggable={false} />
          ))}
          <span className="parade-vs">VS</span>
          <img src={enAsset("mon-minibug")} alt="" draggable={false} />
          <img src={enAsset("mon-legacydragon")} alt="" draggable={false} className="parade-boss" />
        </div>
      </div>

      {mode === "menu" && (
        <div className="menu-buttons">
          <button className="btn big tutorial-btn" onClick={p.onTutorial}>
            <PixelIcon name="book" size={32} /> あそびかた
          </button>
          <button className="btn big" onClick={() => setMode("create")}>
            <PixelIcon name="castle" size={32} /> ぼうけんをはじめる
          </button>
          <button className="btn big" onClick={() => setMode("join")}>
            <PixelIcon name="key" size={32} /> あいことばでくわわる
          </button>
          <button
            className="btn big"
            disabled={busy}
            onClick={() => go(() => p.onSolo(profile(), diff, "story"))}
          >
            <PixelIcon name="sword" size={32} /> ひとりでしゅぎょう
          </button>
          <button className="btn big warlord-btn" onClick={() => setMode("warlord")}>
            <PixelIcon name="skull" size={32} /> うぉーろーど
          </button>
          <button className="btn" onClick={() => setMode("spectate")}>
            <PixelIcon name="eye" size={24} /> たたかいをみる
          </button>
          <button className="btn" onClick={p.onRanking}>
            <PixelIcon name="trophy" size={24} /> でんせつのきろく
          </button>
        </div>
      )}

      {mode === "warlord" && (
        <div className="menu-buttons">
          <div className="mode-desc">
            <PixelIcon name="skull" /> 終わりなき戦い。たおした数をきそう。
            <br />
            {SURVIVAL.bossEvery}ウェーブごとにボス。全滅したら終了。
          </div>
          <button
            className="btn big"
            onClick={() => {
              setGameMode("survival");
              setMode("create");
            }}
          >
            <PixelIcon name="castle" size={32} /> みんなでいどむ
          </button>
          <button
            className="btn big"
            disabled={busy}
            onClick={() => go(() => p.onSolo(profile(), diff, "survival"))}
          >
            <PixelIcon name="sword" size={32} /> ひとりでいどむ
          </button>
          <button className="btn ghost" onClick={() => setMode("menu")}>
            もどる
          </button>
        </div>
      )}

      {mode !== "menu" && mode !== "warlord" && (
        <div className="setup-panel">
          {gameMode === "survival" && (
            <div className="mode-banner"><PixelIcon name="skull" /> うぉーろーど（サバイバル）</div>
          )}
          {mode !== "spectate" && (
            <>
              <label className="field">
                <span>なまえ</span>
                <input
                  value={name}
                  maxLength={10}
                  placeholder="ゆうしゃ"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            </>
          )}

          <label className="field">
            <span>あいことば（パスワード）</span>
            <input
              value={pw}
              maxLength={12}
              placeholder="例: きょうのぼうけん"
              onChange={(e) => setPw(e.target.value)}
            />
          </label>

          {p.error && <div className="error-box">{p.error}</div>}

          <div className="setup-actions">
            <button
              className="btn ghost"
              onClick={() => {
                setMode(gameMode === "survival" ? "warlord" : "menu");
                setGameMode("story");
              }}
            >
              もどる
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() =>
                go(() => {
                  if (mode === "create") p.onCreate(pw, profile(), diff, gameMode);
                  else if (mode === "join") p.onJoin(pw, profile());
                  else p.onSpectate(pw);
                })
              }
            >
              {mode === "create" && "ぼうけんをはじめる！"}
              {mode === "join" && "くわわる！"}
              {mode === "spectate" && "たたかいをみる"}
            </button>
          </div>
        </div>
      )}

      <div className="title-footer">
        <button className="link-btn" onClick={p.onLegal}>
          利用規約・プライバシーポリシー
        </button>
      </div>
    </div>
  );
}
