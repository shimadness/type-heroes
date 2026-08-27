import { useMemo } from "react";
import type { Session } from "../App";
import type { RoomState } from "../game/types";
import { ENEMY_KINDS, STAGES, equipDef, roleDef } from "../game/data";
import { enAsset } from "../assets";
import { fireAndForget } from "../net/store";
import { HostBrain } from "../game/host";
import { allPlayers } from "../game/room";

interface Props {
  session: Session;
  state: RoomState;
  onLeave: () => void;
}

export function StageClear({ session, state }: Props) {
  const { room } = session;
  const isHost = state.meta.hostId === room.myId;
  const stage = STAGES[state.meta.stageIdx];
  const nextStage = STAGES[state.meta.stageIdx + 1];
  const players = allPlayers(state).sort((a, b) => a[1].joinedAt - b[1].joinedAt);
  const brain = useMemo(() => new HostBrain(room), [room]);

  return (
    <div className="screen center stageclear-screen" style={{ background: stage.bg }}>
      <h1 className="clear-title">🎉 STAGE CLEAR!</h1>
      <div className="clear-stage-name">
        {stage.icon} {stage.name} をクリアした！
      </div>
      {(() => {
        const lastWave = stage.waves[stage.waves.length - 1];
        const boss = lastWave.map((k) => ENEMY_KINDS[k]).find((k) => k?.boss);
        return boss ? (
          <div className="boss-win-line">
            <img className="boss-win-sprite" src={enAsset(boss.sprite)} alt="" draggable={false} />
            <span>{boss.win}</span>
          </div>
        ) : null;
      })()}

      <div className="drop-panel">
        <h3>🎁 そうびを手に入れた！</h3>
        {players.map(([pid, p]) => {
          const eq = equipDef(p.equip);
          return (
            <div key={pid} className="drop-row">
              <span>
                {roleDef(p.role).icon} {p.name}
              </span>
              <span className="drop-item">
                {eq ? `${eq.icon} ${eq.label}（${eq.desc}）` : "─"}
              </span>
            </div>
          );
        })}
      </div>

      {nextStage && (
        <div className="next-stage-note">
          つぎは {nextStage.icon} <b>{nextStage.name}</b> …
        </div>
      )}

      {isHost ? (
        <button className="btn big primary" onClick={() => fireAndForget("次ステージへ", brain.nextStage(state))}>
          つぎのステージへ すすむ！
        </button>
      ) : (
        <div className="wait-note">部屋主が すすめるのを待っています…</div>
      )}
    </div>
  );
}
