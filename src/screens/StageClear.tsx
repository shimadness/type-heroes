import { useMemo } from "react";
import type { Session } from "../App";
import type { RoomState } from "../game/types";
import { ENEMY_KINDS, EQUIPS, STAGES, equipDef, recommendEquip, roleDef } from "../game/data";
import { enAsset } from "../assets";
import { fireAndForget } from "../net/store";
import { HostBrain } from "../game/host";
import { allPlayers } from "../game/room";
import { PixelIcon, Px } from "../ui/PixelIcon";

interface Props {
  session: Session;
  state: RoomState;
  onLeave: () => void;
}

export function StageClear({ session, state }: Props) {
  const { room } = session;
  const me = state.players?.[room.myId];
  const isHost = state.meta.hostId === room.myId;
  const stage = STAGES[state.meta.stageIdx];
  const nextStage = STAGES[state.meta.stageIdx + 1];
  const players = allPlayers(state).sort((a, b) => a[1].joinedAt - b[1].joinedAt);
  const brain = useMemo(() => new HostBrain(room), [room]);
  // おすすめ（実績から導いた得意な行動）。ホストが初期値として配っているので、放置しても同じ結果になる
  const rec = useMemo(
    () => (me ? recommendEquip(me, players.map(([, p]) => p)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room.myId, state.meta.stageIdx]
  );
  const canPick = !!me && !room.spectator;

  return (
    <div className="screen center stageclear-screen" style={{ background: stage.bg }}>
      <h1 className="clear-title"><PixelIcon name="party" /> STAGE CLEAR!</h1>
      <div className="clear-stage-name">
        <Px>{stage.icon}</Px> {stage.name} をクリアした！
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
        <h3><Px>{canPick ? "🎁 そうびを えらぼう" : "🎁 そうびを手に入れた！"}</Px></h3>
        {canPick && me && (
          <div className="equip-grid">
            {EQUIPS.map((eq) => {
              const sel = me.equip === eq.id;
              const isRec = rec?.equip === eq.id;
              return (
                <button
                  key={eq.id}
                  className={`equip-card ${sel ? "sel" : ""} ${isRec ? "rec" : ""}`}
                  onClick={() => fireAndForget("装備えらび", room.setEquip(eq.id))}
                >
                  {isRec && (
                    <span className="equip-rec"><PixelIcon name="star" />おすすめ（{rec!.reason}）</span>
                  )}
                  <span className="equip-icon"><Px>{eq.icon}</Px></span>
                  <span className="equip-name">{eq.label}</span>
                  <span className="equip-desc">{eq.desc}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="drop-list">
          {players.map(([pid, p]) => {
            const eq = equipDef(p.equip);
            return (
              <div key={pid} className={`drop-row ${pid === room.myId ? "me" : ""}`}>
                <span>
                  <Px>{roleDef(p.role).icon}</Px> {p.name}
                </span>
                <span className="drop-item">
                  <Px>{eq ? `${eq.icon} ${eq.label}（${eq.desc}）` : "─"}</Px>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {nextStage && (
        <div className="next-stage-note">
          つぎは <Px>{nextStage.icon}</Px> <b>{nextStage.name}</b> …
        </div>
      )}

      {isHost ? (
        <button className="btn big primary" onClick={() => fireAndForget("次ステージへ", brain.nextStage(state))}>
          つぎのステージへ すすむ！
        </button>
      ) : (
        <div className="wait-note">そうびをえらんだら、部屋主が すすめるのを待とう…</div>
      )}
    </div>
  );
}
