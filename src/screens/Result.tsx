import { useMemo } from "react";
import type { Session } from "../App";
import type { PlayerState, RoomState } from "../game/types";
import { ENEMY_KINDS, STAGES, roleDef } from "../game/data";
import { HostBrain } from "../game/host";
import { allPlayers, isSurvival } from "../game/room";
import { alienFor, enAsset } from "../assets";
import { fireAndForget } from "../net/store";
import { PixelIcon, Px } from "../ui/PixelIcon";

interface Props {
  session: Session;
  state: RoomState;
  onLeave: () => void;
}

interface TitleAward {
  icon: string;
  label: string;
}

/** 全員に必ず1つは称号がつくように割り当てる */
function awardTitles(players: [string, PlayerState][]): Record<string, TitleAward[]> {
  const out: Record<string, TitleAward[]> = {};
  for (const [pid] of players) out[pid] = [];

  const give = (
    title: TitleAward,
    score: (p: PlayerState) => number,
    min = 1
  ) => {
    let best: string | null = null;
    let bestScore = -1;
    for (const [pid, p] of players) {
      const s = score(p);
      if (s >= min && s > bestScore) {
        bestScore = s;
        best = pid;
      }
    }
    if (best) out[best].push(title);
  };

  give({ icon: "👑", label: "MVP（さいだいダメージ）" }, (p) => p.stats?.damage ?? 0);
  give({ icon: "💚", label: "守護神（さいだい回復）" }, (p) => p.stats?.heal ?? 0);
  give(
    { icon: "🎯", label: "正確王（せいかくりつNo.1）" },
    (p) => {
      const t = p.stats?.typed ?? 0;
      const m = p.stats?.miss ?? 0;
      return t >= 20 ? (t / (t + m)) * 100 : 0;
    },
    1
  );
  give({ icon: "🔥", label: "コンボ王" }, (p) => p.stats?.maxCombo ?? 0, 5);
  give({ icon: "🛡️", label: "鉄壁（ぼうぎょ成功）" }, (p) => p.stats?.defended ?? 0);
  give({ icon: "⛑️", label: "救世主（そせい回数）" }, (p) => p.stats?.revived ?? 0);
  give({ icon: "⚔️", label: "討伐王（さいだい撃破）" }, (p) => p.stats?.kills ?? 0);

  for (const [pid] of players) {
    if (out[pid].length === 0) out[pid].push({ icon: "🌟", label: "ムードメーカー" });
  }
  return out;
}

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, "0")}秒`;
}

export function Result({ session, state, onLeave }: Props) {
  const { room } = session;
  const isHost = state.meta.hostId === room.myId;
  const cleared = state.meta.status === "clear";
  const survival = isSurvival(state);
  const kills = state.meta.kills ?? 0;
  const players = allPlayers(state).sort(
    (a, b) => (b[1].stats?.damage ?? 0) - (a[1].stats?.damage ?? 0)
  );
  // アバターは参加順で固定なので join 順のインデックスを引けるようにしておく
  const joinIdx = new Map(
    allPlayers(state)
      .sort((a, b) => a[1].joinedAt - b[1].joinedAt)
      .map(([pid], i) => [pid, i])
  );
  const titles = useMemo(() => awardTitles(players), [players]);
  const brain = useMemo(() => new HostBrain(room), [room]);
  const timeMs =
    cleared || survival ? Math.max(0, state.meta.clearedAt - state.meta.startedAt) : 0;
  const lastStage = STAGES[STAGES.length - 1];
  const finalBoss = lastStage.waves[lastStage.waves.length - 1]
    .map((k) => ENEMY_KINDS[k])
    .find((k) => k?.boss);

  return (
    <div
      className={`screen result-screen center ${
        survival ? "survival" : cleared ? "win" : "lose"
      }`}
    >
      <h1 className="result-title">
        <Px>{survival
          ? "☠️ うぉーろーど しゅうりょう"
          : cleared
            ? "🏆 ぜんステージクリア！！"
            : "💀 ぜんめつ…"}</Px>
      </h1>
      {survival && (
        <div className="result-time survival-score">
          <div className="survival-kills">
            撃破 <b>{kills}</b> 体
          </div>
          <div>
            WAVE {state.meta.wave + 1} まで到達 ／ 生存 {fmtTime(timeMs)}
            {!session.isLocal && kills > 0 && (
              <span className="rank-note">（ランキングに登録したよ）</span>
            )}
          </div>
        </div>
      )}
      {!survival && cleared && finalBoss && (
        <>
          <div className="boss-win-line">
            <img
              className="boss-win-sprite"
              src={enAsset(finalBoss.sprite)}
              alt=""
              draggable={false}
            />
            <span>{finalBoss.win}</span>
          </div>
          <div className="result-time">
            クリアタイム: <b>{fmtTime(timeMs)}</b>
            {!session.isLocal && <span className="rank-note">（ランキングに登録したよ）</span>}
          </div>
        </>
      )}
      {!survival && !cleared && (
        <div className="result-time">もういちど ちからを合わせて挑もう！</div>
      )}

      <div className="result-table-wrap">
        <table className="result-table">
          <thead>
            <tr>
              <th>なかま</th>
              <th>称号</th>
              <th>ダメージ</th>
              <th>撃破</th>
              <th>回復</th>
              <th>打鍵</th>
              <th>せいかく</th>
              <th>最大コンボ</th>
            </tr>
          </thead>
          <tbody>
            {players.map(([pid, p]) => {
              const t = p.stats?.typed ?? 0;
              const m = p.stats?.miss ?? 0;
              const acc = t + m > 0 ? Math.round((t / (t + m)) * 100) : 100;
              return (
                <tr key={pid} className={pid === room.myId ? "me" : ""}>
                  <td className="name-cell">
                    <img
                      className="avatar"
                      src={alienFor(joinIdx.get(pid) ?? 0, cleared)}
                      alt=""
                      draggable={false}
                    />
                    <Px>{roleDef(p.role).icon}</Px> {p.name}
                  </td>
                  <td className="title-cell">
                    {titles[pid]?.map((tt, i) => (
                      <div key={i}>
                        <Px>{tt.icon}</Px>
                        {tt.label}
                      </div>
                    ))}
                  </td>
                  <td>{p.stats?.damage ?? 0}</td>
                  <td>{p.stats?.kills ?? 0}</td>
                  <td>{p.stats?.heal ?? 0}</td>
                  <td>{t}</td>
                  <td>{acc}%</td>
                  <td>{p.stats?.maxCombo ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="result-actions">
        <button className="btn ghost" onClick={onLeave}>
          タイトルへ
        </button>
        {isHost && (
          <button className="btn primary" onClick={() => fireAndForget("ロビーに戻る", brain.backToLobby(state))}>
            <PixelIcon name="tent" /> ロビーにもどって もういちど！
          </button>
        )}
        {!isHost && !room.spectator && (
          <div className="wait-note">部屋主がロビーにもどすのを待つか、タイトルへ</div>
        )}
      </div>
    </div>
  );
}
