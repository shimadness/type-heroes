import { useSyncExternalStore } from "react";
import { cycleVolume, getVolume, subscribeVolume } from "../sfx";
import { PixelIcon } from "./PixelIcon";

/** 音量ボタン。押すたびに 大 → 小 → 消音 と回る（アイコンの波の数で今の大きさが分かる） */
export function SoundToggle() {
  const vol = useSyncExternalStore(subscribeVolume, getVolume);
  const label = vol === 0 ? "おと: なし" : vol < 1 ? "おと: 小" : "おと: 大";
  return (
    <button
      type="button"
      className={`btn ghost sound-toggle ${vol === 0 ? "off" : ""}`}
      title={`${label}（おすと切りかえ）`}
      aria-label={label}
      onClick={(e) => {
        cycleVolume();
        e.currentTarget.blur(); // フォーカスが残ると Space（こうげき⇄かいふく切替）でこのボタンが押されてしまう
      }}
    >
      <PixelIcon name={vol === 0 ? "soundOff" : vol < 1 ? "soundLow" : "sound"} />
    </button>
  );
}
