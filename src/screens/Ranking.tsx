import { useEffect, useState } from "react";
import { DIFF_LABEL, type Difficulty } from "../typing/words";

interface Props {
  onBack: () => void;
}

interface Entry {
  names: string[];
  timeMs: number;
  at: number;
}

const DIFFS: Difficulty[] = ["easy", "normal", "hard", "oni"];

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Ranking({ onBack }: Props) {
  const [diff, setDiff] = useState<Difficulty>("normal");
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
        const raw = (await store.read(`typing/ranking/${diff}`)) as Record<
          string,
          Entry
        > | null;
        if (cancelled) return;
        const list = Object.values(raw ?? {})
          .filter((e) => e && typeof e.timeMs === "number")
          .sort((a, b) => a.timeMs - b.timeMs)
          .slice(0, 10);
        setEntries(list);
      } catch (e) {
        if (!cancelled) setError("ランキングをよみこめなかった…（通信かルール設定を確認）");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [diff]);

  return (
    <div className="screen ranking-screen center">
      <h1>🏆 チームランキング</h1>
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

      <div className="ranking-list">
        {entries === null && !error && <div className="wait-note">よみこみ中…</div>}
        {error && <div className="error-box">{error}</div>}
        {entries && entries.length === 0 && (
          <div className="wait-note">まだ記録がないよ。いちばんのりを目指そう！</div>
        )}
        {entries?.map((e, i) => (
          <div key={i} className={`ranking-row rank-${i + 1}`}>
            <span className="rank-no">
              {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}位`}
            </span>
            <span className="rank-names">{e.names?.join("・")}</span>
            <span className="rank-time">{fmtTime(e.timeMs)}</span>
          </div>
        ))}
      </div>

      <button className="btn" onClick={onBack}>
        もどる
      </button>
    </div>
  );
}
