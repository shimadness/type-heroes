import { useEffect, useState } from "react";
import { DIFF_TUNING, TEAM_DIFFS, type TeamDifficulty } from "../game/data";
import type { CSSProperties } from "react";
import { PixelIcon, Px } from "../ui/PixelIcon";

interface Props {
  onBack: () => void;
}

type Board = "story" | "survival";

interface StoryEntry {
  names: string[];
  timeMs: number;
  at: number;
}

interface SurvivalEntry {
  names: string[];
  kills: number;
  waves: number;
  timeMs: number;
  at: number;
}

type Entry = StoryEntry | SurvivalEntry;

const BOARDS: { id: Board; label: string; path: string }[] = [
  { id: "story", label: "🏆 ストーリー（クリアタイム）", path: "ranking" },
  { id: "survival", label: "☠️ うぉーろーど（撃破数）", path: "survival" },
];

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const isSurvivalEntry = (e: Entry): e is SurvivalEntry =>
  typeof (e as SurvivalEntry).kills === "number";

export function Ranking({ onBack }: Props) {
  const [board, setBoard] = useState<Board>("story");
  const [diff, setDiff] = useState<TeamDifficulty>("normal");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError("");
    (async () => {
      try {
        const { FirebaseStore } = await import("../net/store");
        const store = new FirebaseStore();
        const path = BOARDS.find((b) => b.id === board)!.path;
        const raw = (await store.read(`typing/${path}/${diff}`)) as Record<string, Entry> | null;
        if (cancelled) return;
        const all = Object.values(raw ?? {}).filter((e) => e && typeof e.timeMs === "number");
        const list =
          board === "survival"
            ? (all.filter(isSurvivalEntry) as SurvivalEntry[]).sort(
                (a, b) => b.kills - a.kills || b.waves - a.waves || a.at - b.at
              )
            : all.sort((a, b) => a.timeMs - b.timeMs);
        setEntries(list.slice(0, 10));
      } catch (e) {
        if (!cancelled) setError("ランキングをよみこめなかった…（通信かルール設定を確認）");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [board, diff]);

  return (
    <div className="screen ranking-screen center">
      <h1><PixelIcon name="trophy" /> でんせつのきろく</h1>
      <div className="diff-row board-row">
        {BOARDS.map((b) => (
          <button
            key={b.id}
            className={`diff-btn ${board === b.id ? "sel" : ""}`}
            style={{ "--diff-color": "var(--gold)" } as CSSProperties}
            onClick={() => setBoard(b.id)}
          >
            <Px>{b.label}</Px>
          </button>
        ))}
      </div>
      <div className="diff-row">
        {TEAM_DIFFS.map((d) => (
          <button
            key={d}
            className={`diff-btn ${diff === d ? "sel" : ""}`}
            style={{ "--diff-color": DIFF_TUNING[d].color } as CSSProperties}
            onClick={() => setDiff(d)}
          >
            {DIFF_TUNING[d].label}
          </button>
        ))}
      </div>

      <div className="ranking-list">
        {entries === null && !error && <div className="wait-note">よみこみ中…</div>}
        {error && <div className="error-box">{error}</div>}
        {entries && entries.length === 0 && (
          <div className="wait-note">まだ記録がないよ。いちばんのりを目指そう！</div>
        )}
        {entries?.map((e, i) => (
          <div key={i} className={`ranking-row rank-${i + 1}`}>
            <span className="rank-no">
              <Px>{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}位`}</Px>
            </span>
            <span className="rank-names">{e.names?.join("・")}</span>
            <span className="rank-time">
              {isSurvivalEntry(e) ? (
                <>
                  {e.kills}体 <small>WAVE {e.waves}</small>
                </>
              ) : (
                fmtTime(e.timeMs)
              )}
            </span>
          </div>
        ))}
      </div>

      <button className="btn" onClick={onBack}>
        もどる
      </button>
    </div>
  );
}
