# TYPE HEROES 開発ガイド

チームで協力してステージをクリアするタイピングRPG。
本番: https://shimadness.github.io/type-heroes/ （main への push で自動デプロイ）

## ★チュートリアル同期ルール（最重要）

**ゲーム挙動を変える改修をしたら、必ずチュートリアル（`src/screens/Tutorial.tsx`）への影響を確認し、
影響があれば「チュートリアルの改修提案」をユーザーに提示すること。**
黙って本編だけ直すと、チュートリアルが嘘を教える状態になる。

影響を確認すべき改修の例:

| 改修 | チュートリアルへの影響 |
| --- | --- |
| 倍率・ダメージ・回復量の調整（`TUNING`） | 表示中の数値。**定数から算出していれば自動追従**（下記ルール） |
| 操作方法の変更（キー割り当て・モード切替） | ヒント文とステップの手順 |
| 新メカニクスの追加 | ステップ追加の要否（`STEPS` 配列） |
| メカニクスの削除・統合 | 該当ステップの削除 |
| 画面構成・設定場所の変更 | 完了画面の案内（例: 難易度をロビーに一本化 → 案内追加） |
| ロール性能の変更 | 完了画面の「ヒーラーが1人いると安定」等の推奨 |

提案するときは「本編のこの変更 → チュートリアルのこの箇所がこう食い違う → こう直す」の形で出す。

### 数値のベタ書き禁止

チュートリアルに出す数値は **必ず `TUNING` / `ENEMY_KINDS` など本編と同じ定数から算出する**。
そうしておけばバランス調整だけの改修ではチュートリアルが自動で追従し、同期漏れが起きない。

```tsx
// OK — バランス調整に自動追従
`弱点ジャンルは ×${TUNING.weaknessMult}（ボスは ×${TUNING.bossWeaknessMult}）`
// NG — TUNING を変えた瞬間に嘘になる
"弱点ジャンルは ×2.5（ボスは ×3.5）"
```

配布用ガイド `docs/あそびかた.md` にも同じ数値が載っている。こちらは手書きなので、
バランス調整をしたら**必ず目視で確認**すること（自動追従しない）。

## UX方針

説明文を読まずに「見て・触ってわかる」UIにする（他プロジェクトから引き継いだ方針）。
テキストを足す前に視覚的手段で伝えられないか先に考える。テキストを消すなら代わりの視覚ヒントをセットにする。
チュートリアルも読み物ではなく「実際に打って覚える」対話式にしてある。

## 構成

```
src/typing/romaji.ts   ローマ字判定エンジン（si/shi・っ・ん の複数入力パターンを並列ステートで受理）
src/typing/words.ts    ワードDB（ジャンル×難易度）＋防御/蘇生/ユニゾン用の特殊ワード
src/game/data.ts       ★バランス定数（TUNING / DIFF_TUNING）・敵・ステージ・ロール・装備
src/game/room.ts       ルーム操作（プレイヤー共通アクション）
src/game/host.ts       部屋主だけが動かす進行役（敵AI・ウェーブ進行・ユニゾン判定・ランキング登録）
src/net/store.ts       通信抽象（FirebaseStore / LocalStore）＋ fireAndForget
src/screens/           Title / Lobby / Battle / StageClear / Result / Ranking / Tutorial
public/en/             ドット絵（Engineer Navigator から流用）
database.rules.json    ★RTDB の DB全体ルール（TWINKLE と共用）
```

## 決まりごと

- **結果を待たない RTDB 書き込みは `fireAndForget(ラベル, promise)` で包む**。
  素で投げると通信断が `Uncaught (in promise)` の不明なエラーになり原因が追えない。
- **RTDBルールは `database.rules.json` が唯一の正**。TWINKLE DROP RUSH の
  `drop`/`slot`/`events`/`appmeta` も同じDB（triple-slot-ranking）に同居しているので、
  他アプリのブロックを消さないこと。適用は
  `npx firebase-tools deploy --only database --project triple-slot-ranking`。
  なおルールの**読み取り**はCLIでできないため、差分確認はRESTの読み取りプローブ（各パスのHTTPコード）で行う。
- 難易度の設定場所はロビー1箇所（タイトルでは選ばせない。二重になるため）。
- **push・デプロイはユーザーの明示指示があるまで行わない**（他プロジェクトから引き継いだ運用ルール）。

## 開発コマンド

```bash
npm run dev     # 開発サーバー
npm run build   # 型チェック + ビルド。コード変更後は必ず通すこと
```
