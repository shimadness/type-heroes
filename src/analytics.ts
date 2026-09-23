// ===== アクセス解析（Google アナリティクス 4）=====================
// 測定IDは公開前提の識別子（秘密ではない）。空のままなら何も読み込まず何も送らない。
// 取得方法: analytics.google.com → 管理 → データストリーム → ウェブ → 測定ID（G-XXXXXXXXXX）
export const GA_MEASUREMENT_ID: string = "G-HMWLJMDDPR";

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** 開発中（npm run dev）や localhost では計測しない＝自分のテストが来訪者数に混ざらない */
const enabled =
  GA_MEASUREMENT_ID !== "" &&
  !import.meta.env.DEV &&
  !["localhost", "127.0.0.1"].includes(location.hostname);

export function initAnalytics(): void {
  if (!enabled) return;
  window.dataLayer = window.dataLayer || [];
  // gtag.js は arguments オブジェクトをそのまま積む実装を要求するので rest 引数にしない
  window.gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  // 画面遷移は自前で送る（SPAで URL が変わらないため）
  window.gtag("config", GA_MEASUREMENT_ID, { send_page_view: false });

  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(s);
}

/** 画面の表示（レポートの「ページとスクリーン」に画面名で出る） */
export function trackScreen(screen: string): void {
  window.gtag?.("event", "screen_view", { screen_name: screen });
}

/** 遊び始め方の計測。mode: solo=ひとりでしゅぎょう / create=部屋を作る / join=参加 / spectate=観戦 */
export function trackPlayStart(mode: "solo" | "create" | "join" | "spectate"): void {
  window.gtag?.("event", "play_start", { mode });
}

/**
 * 1ゲームの決着。結果画面に入った瞬間に各プレイヤーの端末から1回ずつ送る（観戦者は送らない）。
 * result: clear=全ステージクリア / gameover=全滅（うぉーろーどは必ず gameover で終わる）
 */
export function trackGameEnd(p: {
  result: "clear" | "gameover";
  game_mode: "story" | "survival";
  team_diff: string;
  players: number;
  solo: boolean;
  stage: number; // 到達ステージ（1始まり）
  wave: number; // 到達ウェーブ（1始まり）
  kills: number;
  duration_sec: number;
}): void {
  window.gtag?.("event", "game_end", p);
}

/**
 * チュートリアルの進み具合。step に入った瞬間に送る（done = 最後までやりきった）。
 * どのステップでやめたかは「そのステップには入ったが次に入っていない人数」で分かる。
 */
export function trackTutorialStep(step: string, index: number): void {
  window.gtag?.("event", "tutorial_step", { step, step_index: index });
}
