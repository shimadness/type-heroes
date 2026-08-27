import { useMemo } from "react";
import type { Session } from "../App";
import type { RoomState } from "../game/types";
import { ROLES, roleDef } from "../game/data";
import { DIFF_LABEL, type Difficulty } from "../typing/words";
import { HostBrain } from "../game/host";
import { allPlayers } from "../game/room";
import { alienFor } from "../assets";

interface Props {
  session: Session;
  state: RoomState;
  onLeave: () => void;
}

const DIFFS: Difficulty[] = ["easy", "normal", "hard", "oni"];

export function Lobby({ session, state, onLeave }: Props) {
  const { room } = session;
  const me = state.players?.[room.myId];
  const isHost = state.meta.hostId === room.myId;
  const players = allPlayers(state).sort(
    (a, b) => a[1].joinedAt - b[1].joinedAt
  );
  const everyoneReady =
    players.length > 0 && players.every(([pid, p]) => p.ready || pid === state.meta.hostId);

  const brain = useMemo(() => new HostBrain(room), [room]);

  return (
    <div className="screen lobby-screen">
      <div className="lobby-head">
        <h2>🏕️ じゅんびのやかた</h2>
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
              <span className={`member-diff diff-${p.diff}`}>{DIFF_LABEL[p.diff]}</span>
              <span className={`member-ready ${p.ready ? "on" : ""}`}>
                {pid === state.meta.hostId ? "─" : p.ready ? "じゅんびOK!" : "じゅんび中…"}
              </span>
            </div>
          ))}
        </div>

        {me && !room.spectator && (
          <div className="my-setup">
            <div className="field">
              <span>ロールへんこう</span>
              <div className="role-grid">
                {ROLES.map((r) => (
                  <button
                    key={r.id}
                    className={`role-card ${me.role === r.id ? "sel" : ""}`}
                    onClick={() => room.setProfile({ role: r.id })}
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
                    className={`diff-btn diff-${d} ${me.diff === d ? "sel" : ""}`}
                    onClick={() => room.setProfile({ diff: d })}
                  >
                    {DIFF_LABEL[d]}
                  </button>
                ))}
              </div>
            </div>

            {isHost && (
              <div className="field">
                <span>てきの強さ（チーム難易度）</span>
                <div className="diff-row">
                  {DIFFS.map((d) => (
                    <button
                      key={d}
                      className={`diff-btn diff-${d} ${state.meta.diff === d ? "sel" : ""}`}
                      onClick={() => room.setTeamDiff(d)}
                    >
                      {DIFF_LABEL[d]}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
            onClick={() => room.setProfile({ ready: !me.ready })}
          >
            {me.ready ? "じゅんびOKをとりけす" : "じゅんびOK！"}
          </button>
        )}
        {isHost && (
          <button
            className="btn big primary"
            disabled={!everyoneReady}
            onClick={() => brain.startGame(state)}
          >
            ⚔️ ぼうけんに出発！
            {!everyoneReady && <span className="btn-note">（全員のじゅんびOK待ち）</span>}
          </button>
        )}
      </div>
    </div>
  );
}
