// Engineer Navigator 由来のドット絵アセット（public/en/）のパスヘルパー
export const enAsset = (name: string): string =>
  `${import.meta.env.BASE_URL}en/${name}.png`;

/** プレイヤーアバター（エイリアン20種を参加順で割り当て） */
export const alienFor = (index: number, smile: boolean): string =>
  enAsset(
    `alien-${String((((index % 20) + 20) % 20) + 1).padStart(2, "0")}-${smile ? "smile" : "normal"}`
  );
