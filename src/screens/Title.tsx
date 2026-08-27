import { useState } from "react";
import type { JoinProfile } from "../game/room";
import type { Difficulty } from "../typing/words";
import { DIFF_LABEL } from "../typing/words";
import { ROLES } from "../game/data";
import type { RoleId } from "../game/types";
import { alienFor, enAsset } from "../assets";

interface Props {
  error: string;
  onSolo: (profile: JoinProfile, teamDiff: Difficulty) => void;
  onCreate: (pw: string, profile: JoinProfile, teamDiff: Difficulty) => void;
  onJoin: (pw: string, profile: JoinProfile) => void;
  onSpectate: (pw: string) => void;
  onRanking: () => void;
}

type Mode = "menu" | "solo" | "create" | "join" | "spectate";

const DIFFS: Difficulty[] = ["easy", "normal", "hard", "oni"];

export function Title(p: Props) {
  const [mode, setMode] = useState<Mode>("menu");
  const [name, setName] = useState(
    () => localStorage.getItem("th_name") ?? ""
  );
  const [pw, setPw] = useState("");
  const [role, setRole] = useState<RoleId>("attacker");
  const [diff, setDiff] = useState<Difficulty>("normal");
  const [busy, setBusy] = useState(false);

  const profile = (): JoinProfile => {
    try {
      localStorage.setItem("th_name", name);
    } catch {}
    return { name: name || "ゆうしゃ", role, diff };
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
        <div className="title-sub">みんなでタイピングクエスト</div>
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
          <button className="btn big" onClick={() => setMode("create")}>
            🏰 へやをつくる
          </button>
          <button className="btn big" onClick={() => setMode("join")}>
            🤝 あいことばで参加
          </button>
          <button className="btn big" onClick={() => setMode("solo")}>
            🗡️ ひとりで特訓
          </button>
          <button className="btn" onClick={() => setMode("spectate")}>
            📺 観戦する
          </button>
          <button className="btn" onClick={p.onRanking}>
            🏆 ランキング
          </button>
        </div>
      )}

      {mode !== "menu" && (
        <div className="setup-panel">
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

              <div className="field">
                <span>ロール（職業）</span>
                <div className="role-grid">
                  {ROLES.map((r) => (
                    <button
                      key={r.id}
                      className={`role-card ${role === r.id ? "sel" : ""}`}
                      onClick={() => setRole(r.id)}
                      title={r.desc}
                    >
                      <span className="role-icon">{r.icon}</span>
                      <span className="role-name">{r.label}</span>
                    </button>
                  ))}
                </div>
                <div className="role-desc">
                  {ROLES.find((r) => r.id === role)?.desc}
                </div>
              </div>

              <div className="field">
                <span>
                  {mode === "join" ? "じぶんの出題難易度" : "難易度"}
                </span>
                <div className="diff-row">
                  {DIFFS.map((d) => (
                    <button
                      key={d}
                      className={`diff-btn diff-${d} ${diff === d ? "sel" : ""}`}
                      onClick={() => setDiff(d)}
                    >
                      {DIFF_LABEL[d]}
                    </button>
                  ))}
                </div>
                {mode === "join" && (
                  <div className="role-desc">
                    ※敵の強さは部屋主の難易度。これは自分に出る問題のむずかしさ（ハンデ）だよ
                  </div>
                )}
              </div>
            </>
          )}

          {mode !== "solo" && (
            <label className="field">
              <span>あいことば（パスワード）</span>
              <input
                value={pw}
                maxLength={12}
                placeholder="例: きょうのぼうけん"
                onChange={(e) => setPw(e.target.value)}
              />
            </label>
          )}

          {p.error && <div className="error-box">{p.error}</div>}

          <div className="setup-actions">
            <button className="btn ghost" onClick={() => setMode("menu")}>
              もどる
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() =>
                go(() => {
                  if (mode === "solo") p.onSolo(profile(), diff);
                  else if (mode === "create") p.onCreate(pw, profile(), diff);
                  else if (mode === "join") p.onJoin(pw, profile());
                  else p.onSpectate(pw);
                })
              }
            >
              {mode === "solo" && "特訓スタート！"}
              {mode === "create" && "へやをつくる！"}
              {mode === "join" && "参加する！"}
              {mode === "spectate" && "観戦する"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
