// ============================================================
// タイプワードのリールUI
//   複数のワードを横に並べず、いま打つ1枚だけを大きく見せる。
//   Tab（or つぎボタン／カードタップ）でスロットのリールが回るように次のワードへ。
//   下の小さなチップ列が「リールに何が乗っているか」（防御・そせい・弱点）を示す。
//   本編（Battle）とチュートリアルで共用。
// ============================================================
import type { CSSProperties } from "react";
import { hiraToKata, type TypingWord } from "../typing/romaji";

export interface ReelItem {
  id: string;
  kind: "genre" | "defense" | "revive" | "unison";
  label: string; // カード上部のラベル
  chip: string; // リール一覧に出す短い記号（ジャンルアイコンなど）
  word: TypingWord;
  weak?: boolean; // 弱点一致（金色）
  want?: boolean; // チュートリアルで「これを選んでほしい」ときに光らせる
  kata?: boolean; // ボスのカタカナ化ギミック
}

interface Props {
  items: ReelItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

/** リール上で次のワードの id（末尾なら先頭へ） */
export function nextReelId(items: { id: string }[], activeId: string, dir = 1): string {
  if (items.length === 0) return "";
  const i = Math.max(0, items.findIndex((it) => it.id === activeId));
  return items[(i + dir + items.length) % items.length].id;
}

export function WordReel({ items, activeId, onSelect }: Props) {
  const idx = Math.max(0, items.findIndex((it) => it.id === activeId));
  const active = items[idx];
  if (!active) return null;
  const many = items.length > 1;
  const next = () => {
    if (many) onSelect(nextReelId(items, active.id));
  };
  const [typed, rest] = active.word.romajiParts();
  const wantElsewhere = items.some((it) => it.want && it.id !== active.id);

  return (
    <div className="reel">
      <div className="reel-row">
        <div className="reel-window">
          {/* key=id でカードを作り直す → 切り替えのたびに reel-in アニメが走る */}
          <button
            key={active.id}
            className={[
              "word-card",
              "reel-card",
              active.kind,
              active.weak ? "weak-match" : "",
            ].join(" ")}
            onClick={next}
            title={many ? "タップ / Tab でつぎのワード" : undefined}
          >
            <div className={`card-label ${active.kind}`}>{active.label}</div>
            <div className="card-jp">
              {active.kata ? hiraToKata(active.word.display) : active.word.display}
            </div>
            <div className="card-romaji">
              <span className="typed">{typed}</span>
              <span className="rest">{rest}</span>
            </div>
            <div className="bar word-progress">
              <div
                className="bar-fill word-progress-fill"
                style={{ width: `${active.word.progress() * 100}%` } as CSSProperties}
              />
            </div>
          </button>
        </div>
        {many && (
          <button
            type="button"
            className={`reel-next ${wantElsewhere ? "want" : ""}`}
            onClick={next}
            title="Tab でつぎのワード"
          >
            <span className="reel-next-icon">⇥</span>
            <span className="reel-next-label">つぎ</span>
          </button>
        )}
      </div>
      {many && (
        <div className="reel-strip" aria-label="リールに乗っているワード">
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              className={[
                "reel-chip",
                it.kind,
                i === idx ? "cur" : "",
                it.weak ? "weak" : "",
                it.want && i !== idx ? "want" : "",
              ].join(" ")}
              onClick={() => onSelect(it.id)}
              title={it.label}
            >
              {it.chip}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
