// ============================================================
// タッチ端末用のゲーム内キーボード
//
// スマホのOSキーボードは日本語フリックがデフォルトで、しかも
// Android では keydown がまともに取れないため、ゲーム側で
// QWERTY を描画してタップを1打鍵として渡す方式にしている。
// 物理キーボードの keydown 処理はそのまま生きているので、
// タブレット＋外付けキーボードでも従来どおり打てる。
// ============================================================

// 段の内容はワードDBに登場しうる文字を網羅する
// （a-z ＋ ー→"-", 、→",", 。→".", ・→"/"）
const ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", "-"],
  ["z", "x", "c", "v", "b", "n", "m", ",", ".", "/"],
];

/** タッチ主体の端末か（＝ゲーム内キーボードを出すか） */
export const isTouchDevice = (): boolean =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(pointer: coarse)").matches;

interface Props {
  onKey: (ch: string) => void;
  /** 次に打つべきキー（推奨パターンの先頭文字）。光らせてガイドする */
  nextKey?: string;
}

export function TouchKeyboard({ onKey, nextKey }: Props) {
  return (
    <div className="touch-keyboard">
      {ROWS.map((row, i) => (
        <div className="tk-row" key={i}>
          {row.map((k) => (
            <button
              key={k}
              type="button"
              className={`tk-key ${k === nextKey ? "next" : ""}`}
              // click だと連打・二本指打ちで取りこぼすため pointerdown で拾う
              onPointerDown={(e) => {
                e.preventDefault();
                onKey(k);
              }}
            >
              {k}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
