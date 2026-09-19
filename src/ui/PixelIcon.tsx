// 自作8bitアイコン。絵文字だとOSごとに絵柄が変わってドット絵の世界観から浮くので、
// 文字マップ（pixelIconData.ts）から SVG の矩形に起こして描く。
import { Children, Fragment, type ReactNode } from "react";
import { EMOJI_ICON, ICONS, PALETTE, type PixelIconName } from "./pixelIconData";

export type { PixelIconName };

/** size 省略時はまわりの文字サイズに合わせる（1.25em） */
export function PixelIcon({ name, size }: { name: PixelIconName; size?: number }) {
  // 同じ色が横に続くところは1つの矩形にまとめる
  const rects: { x: number; y: number; w: number; fill: string }[] = [];
  ICONS[name].forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const ch = row[x];
      let w = 1;
      while (row[x + w] === ch) w++;
      if (ch !== ".") rects.push({ x, y, w, fill: PALETTE[ch] });
      x += w;
    }
  });
  return (
    <svg
      className="pixel-icon"
      width={size ?? "1.25em"}
      height={size ?? "1.25em"}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {rects.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  );
}

// 絵文字の後ろに付く異体字セレクタ（U+FE0F）ごと1つのアイコンに置き換える
const EMOJI_RE = new RegExp(`(${Object.keys(EMOJI_ICON).join("|")})\\uFE0F?`, "gu");

function pixelize(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(EMOJI_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<PixelIcon key={m.index} name={EMOJI_ICON[m[1]]} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * 子の文字列に混ざった絵文字を PixelIcon に置き換えて描く。
 * data.ts の icon やイベントログなど、文字列で流れてくるものはこれで包む。
 */
export function Px({ children }: { children: ReactNode }) {
  return (
    <>
      {Children.map(children, (c) =>
        typeof c === "string" ? <Fragment>{pixelize(c)}</Fragment> : c
      )}
    </>
  );
}
