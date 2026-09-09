import { useEffect, useMemo, useState } from "react";
import type { Session } from "../App";
import type { RoomState } from "../game/types";
import { DIFF_TUNING, ROLES, SURVIVAL, TEAM_DIFFS, roleDef } from "../game/data";
import { DIFFS, DIFF_LABEL } from "../typing/words";
import { HostBrain } from "../game/host";
import { allPlayers, isSurvival } from "../game/room";
import { alienFor } from "../assets";
import { fireAndForget } from "../net/store";
import type { CSSProperties } from "react";

interface Props {
  session: Session;
  state: RoomState;
  onLeave: () => void;
}

const diffStyle = (color: string) => ({ "--diff-color": color } as CSSProperties);

export function Lobby({ session, state, onLeave }: Props) {
  const { room } = session;
  const me = state.players?.[room.myId];
  const isHost = state.meta.hostId === room.myId;
  const survival = isSurvival(state);
  const teamTuning = DIFF_TUNING[state.meta.diff] ?? DIFF_TUNING.normal;
  const players = allPlayers(state).sort(
    (a, b) => a[1].joinedAt - b[1].joinedAt
  );
  const everyoneReady =
    players.length > 0 && players.every(([pid, p]) => p.ready || pid === state.meta.hostId);

  const brain = useMemo(() => new HostBrain(room), [room]);

  // なまえは打鍵ごとにRTDBへ送らず、入力欄を離れたときにまとめて確定する
  const [nameDraft, setNameDraft] = useState(me?.name ?? "");
  useEffect(() => {
    if (me) setNameDraft(me.name);
  }, [me?.name]);
  const commitName = () => {
    const name = nameDraft.trim() || "ゆうしゃ";
    setNameDraft(name);
    try {
      localStorage.setItem("th_name", name);
    } catch {}
    if (me && name !== me.name) fireAndForget("なまえ変更", room.setProfile({ name }));
  };

  return (
    <div className="screen lobby-screen">
      <div className="lobby-head">
        <h2>🏕️ じゅんびのやかた</h2>
        {survival && (
          <div className="mode-banner" title={`${SURVIVAL.bossEvery}ウェーブごとにボス。全滅したら終了`}>
            ☠️ うぉーろーど（サバイバル）— たおした数をきそう
          </div>
        )}
        {!session.isLocal && (
          <div className="pw-banner">
            あいことば: <b>{room.code}</b>
            <span className="pw-hint">（なかまに教えてあげよう）</span>
          </div>
        )}
      </div>

      <div className="lobby-body">
        <div className="member-list">
          <h3>パーティーメンバー（{players.length}人）</h3>
          {players.map(([pid, p], idx) => (
            <div key={pid} className={`member-row ${pid === room.myId ? "me" : ""}`}>
              <img className="avatar" src={alienFor(idx, true)} alt="" draggable={false} />
              <span className="member-role">{roleDef(p.role).icon}</span>
              <span className="member-name">
                {p.name}
                {pid === state.meta.hostId && <span className="host-badge">👑部屋主</span>}
                {pid === room.myId && <span className="me-badge">じぶん</span>}
              </span>
              <span className="member-diff" style={diffStyle(DIFF_TUNING[p.diff].color)}>
                {DIFF_LABEL[p.diff]}
              </span>
              <span className={`member-ready ${p.ready ? "on" : ""}`}>
                {pid === state.meta.hostId ? "─" : p.ready ? "じゅんびOK!" : "じゅんび中…"}
              </span>
            </div>
          ))}
        </div>

        {me && !room.spectator && (
          <div className="my-setup">
            <label className="field">
              <span>なまえ</span>
              <input
                value={nameDraft}
                maxLength={10}
                placeholder="ゆうしゃ"
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </label>

            <div className="field">
              <span>ロール（職業）</span>
              <div className="role-grid">
                {ROLES.map((r) => (
                  <button
                    key={r.id}
                    className={`role-card ${me.role === r.id ? "sel" : ""}`}
                    onClick={() => fireAndForget("ロール変更", room.setProfile({ role: r.id }))}
                    title={r.desc}
                  >
                    <span className="role-icon">{r.icon}</span>
                    <span className="role-name">{r.label}</span>
                  </button>
                ))}
              </div>
              <div className="role-desc">{roleDef(me.role).desc}</div>
            </div>

            <div className="field">
              <span>じぶんの出題難易度（ハンデ）</span>
              <div className="diff-row">
                {DIFFS.map((d) => (
                  <button
                    key={d}
                    className={`diff-btn ${me.diff === d ? "sel" : ""}`}
                    style={diffStyle(DIFF_TUNING[d].color)}
                    onClick={() => fireAndForget("難易度変更", room.setProfile({ diff: d }))}
                  >
                    {DIFF_LABEL[d]}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <span>てきの強さ（チーム難易度）</span>
              {isHost ? (
                <div className="diff-row">
                  {TEAM_DIFFS.map((d) => (
                    <button
                      key={d}
                      className={`diff-btn ${state.meta.diff === d ? "sel" : ""}`}
                      style={diffStyle(DIFF_TUNING[d].color)}
                      onClick={() => fireAndForget("チーム難易度変更", room.setTeamDiff(d))}
                    >
                      {DIFF_TUNING[d].label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="diff-row">
                  <span className="diff-btn sel" style={diffStyle(teamTuning.color)}>
                    {teamTuning.label}
                  </span>
                  <span className="field-note">（部屋主が決める）</span>
                </div>
              )}
              {teamTuning.missSelfDamage > 0 && (
                <div className="miss-note">
                  💥 ミスタイプすると 自分のHPが -{teamTuning.missSelfDamage}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="lobby-actions">
        <button className="btn ghost" onClick={onLeave}>
          ぬける
        </button>
        {!isHost && me && (
          <button
            className={`btn big ${me.ready ? "" : "primary"}`}
            onClick={() => fireAndForget("じゅんびOK", room.setProfile({ ready: !me.ready }))}
          >
            {me.ready ? "じゅんびOKをとりけす" : "じゅんびOK！"}
          </button>
        )}
        {isHost && (
          <button
            className="btn big primary"
            disabled={!everyoneReady}
            onClick={() => fireAndForget("ゲーム開始", brain.startGame(state))}
          >
            {survival ? "☠️ うぉーろーど 開始！" : "⚔️ ぼうけんに出発！"}
            {!everyoneReady && <span className="btn-note">（全員のじゅんびOK待ち）</span>}
          </button>
        )}
      </div>
    </div>
  );
}
