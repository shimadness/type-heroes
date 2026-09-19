# xclip — X 拡散用 10 秒クリップ生成

ゲームをビルド → headless Chromium で「ひとりで特訓 / うぉーろーど」を自動プレイしながら録画 →
撃破・ウェーブ突破が終盤に来る 10 秒を切り抜いて `out/` に mp4（1280x720 / H.264 / 30fps / 無音）を出す。
ゲーム本体の依存には触れない（この folder だけの package.json）。

```bash
cd tools/xclip && npm install      # 初回のみ（Playwright の Chromium も落ちる）
node clip.mjs                      # 日替わりランダム設定で 1 本生成
node clip.mjs --no-build --mode survival --role berserker --team oni --diff hard --play 60 --seconds 10
```

- 標準出力: 生成結果の JSON（`file` / `bytes` / `post`=X 投稿文案 / `stats` / `highlight`）
- stderr: 進行ログ（撃破・ウェーブなどのイベントと切り抜き位置）
- 毎朝 9 時の scheduled task `daily-type-heroes-xclip` がこれを回して Slack の自分宛 DM に投稿する

## しくみ / 直し方

- 打鍵は画面の `.card-romaji .rest`（残りローマ字）の先頭 1 文字を `window` に keydown する。
  リール UI のクラス名を変えたら `readState()` のセレクタを追従させること。
- 画面遷移の検出: `.battle-screen` / `.stageclear-screen` / `.downed-overlay`、
  ロビーの `.role-card` `.diff-row` `.lobby-actions .btn.primary`、
  ステージクリアの `.equip-card` と「つぎのステージ」ボタン。
- 切り抜き位置は stageclear > wave > kill > chain/unison の重み付きで、イベントの 1.8 秒後が窓の終端になるように選ぶ。
