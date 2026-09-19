// ============================================================
// X 拡散用クリップ生成
//   1. ゲームをビルドして vite preview で配信
//   2. headless Chromium で「ひとりで特訓 / うぉーろーど」を自動プレイしながら録画
//   3. いちばん盛り上がった瞬間（撃破・ウェーブ突破）を中心に 10 秒を切り抜き mp4 化
//
//   node clip.mjs [--no-build] [--mode story|survival] [--role attacker|...] [--seconds 10]
//   出力: tools/xclip/out/YYYY-MM-DD_<mode>_<role>.mp4 と同名 .json（メタ＋投稿文案）
// ============================================================
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const OUT_DIR = path.join(HERE, "out");
const TMP_DIR = path.join(HERE, "tmp");
const PORT = 4199;
const W = 1280;
const H = 720;
const KEEP_DAYS = 14;

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt;
};
const NO_BUILD = args.includes("--no-build");
const CLIP_SEC = Number(flag("seconds", 10));
const PLAY_SEC = Number(flag("play", 50)); // 録画するプレイ時間（この中から切り抜く）

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

// 日替わりでバリエーションを出す（指定があればそれを優先）
const MODE = flag("mode", pick(["story", "story", "survival"]));
const ROLE = flag("role", pick(["attacker", "attacker", "berserker", "tank", "buffer", "healer"]));
const MY_DIFF = flag("diff", pick(["normal", "hard", "hard", "oni"]));
const TEAM_DIFF = flag("team", pick(["normal", "hard", "hard", "oni"]));
const NAME = flag("name", pick(["ゆうしゃ", "タイパー", "けんし", "デバッガー"]));

const ROLE_LABEL = { attacker: "アタッカー", healer: "ヒーラー", tank: "タンク", buffer: "バッファー", berserker: "ばーさーかー" };
const DIFF_LABEL = { easy: "かんたん", normal: "ふつう", hard: "むずかしい", oni: "おに" };

const log = (...a) => console.error(`[xclip ${new Date().toLocaleTimeString("ja-JP")}]`, ...a);

// ---------- 1. ビルド & 配信 ----------
if (!NO_BUILD) {
  log("vite build …");
  execFileSync(path.join(ROOT, "node_modules/.bin/vite"), ["build"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
}
log(`vite preview :${PORT}`);
const server = spawn(
  path.join(ROOT, "node_modules/.bin/vite"),
  ["preview", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
  { cwd: ROOT, stdio: "ignore" }
);
const cleanup = () => {
  try { server.kill(); } catch {}
};
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(1); });

const BASE = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 100; i++) {
  try {
    const r = await fetch(BASE);
    if (r.ok) break;
  } catch {}
  await sleep(100);
}

// ---------- 2. 自動プレイ & 録画 ----------
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
// --zoom で CSS zoom をかけられる（deviceScaleFactor は recordVideo が CSS ピクセルで切り取るので使わない）。
// 1.33 だとバトル画面の敵エリアが上にはみ出るので既定は等倍。
const ZOOM = Number(flag("zoom", 1));
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  locale: "ja-JP",
  recordVideo: { dir: TMP_DIR, size: { width: W, height: H } },
});
await context.addInitScript(({ name, zoom }) => {
  try { localStorage.setItem("th_name", name); } catch {}
  document.addEventListener("DOMContentLoaded", () => {
    document.documentElement.style.zoom = String(zoom);
  });
}, { name: NAME, zoom: ZOOM });
const page = await context.newPage();
const T0 = Date.now(); // 録画の原点（おおよそ）
const t = () => (Date.now() - T0) / 1000;
const events = []; // { t, kind, note }
const mark = (kind, note = "") => { events.push({ t: t(), kind, note }); log(`event ${kind} ${note} @${t().toFixed(1)}s`); };

await page.goto(BASE);
await page.getByRole("button", { name: "ひとりで特訓" }).waitFor();
await sleep(600); // タイトルを少し見せる

if (MODE === "survival") {
  await page.getByRole("button", { name: "うぉーろーど" }).click();
  await page.getByRole("button", { name: "ひとりで挑む" }).click();
} else {
  await page.getByRole("button", { name: "ひとりで特訓" }).click();
}

// ロビー: ロール / 自分の難易度 / チーム難易度
await page.locator(".role-grid").waitFor();
await page.locator(".role-card", { hasText: ROLE_LABEL[ROLE] }).click();
await page.locator(".my-setup .diff-row").nth(0).locator(".diff-btn", { hasText: DIFF_LABEL[MY_DIFF] }).click();
await page.locator(".my-setup .diff-row").nth(1).locator(".diff-btn", { hasText: DIFF_LABEL[TEAM_DIFF] }).click();
await sleep(400);
await page.locator(".lobby-actions .btn.primary").click();
await page.locator(".battle-screen").waitFor();
mark("battle");
const battleStart = t();

// 画面の状態をまとめて読む（1 回の evaluate で済ませて打鍵テンポを落とさない）
const readState = () =>
  page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const restOf = (sel) => q(sel)?.textContent ?? null;
    const rest = restOf(".unison-card .card-romaji .rest") ?? restOf(".reel-card .card-romaji .rest") ?? restOf(".active-card .card-romaji .rest");
    return {
      screen: q(".battle-screen") ? "battle" : q(".stageclear-screen") ? "stageclear" : q(".lobby-screen") ? "lobby" : "other",
      rest,
      downed: !!q(".downed-overlay"),
      dead: document.querySelectorAll(".enemy-card.dead").length,
      alive: document.querySelectorAll(".enemy-card:not(.dead)").length,
      wave: q(".stage-label")?.textContent ?? "",
      chain: !!q(".chain-banner"),
      unison: !!q(".unison-card"),
    };
  });

let stats = { words: 0, keys: 0, kills: 0, waves: 0, stages: 0 };
let lastDead = 0;
let lastWave = "";
let lastChain = false;
let lastUnison = false;
let inWord = false;
const deadline = battleStart + PLAY_SEC;

let lastDebug = 0;
while (t() < deadline) {
  const s = await readState();
  if (t() - lastDebug > 5) {
    lastDebug = t();
    log(`state ${s.screen} alive=${s.alive} dead=${s.dead} rest=${s.rest ? JSON.stringify(s.rest.slice(0, 12)) : null} keys=${stats.keys}`);
  }
  if (s.screen === "stageclear") {
    stats.stages++;
    mark("stageclear");
    await sleep(2500); // クリア演出を見せる
    const eq = page.locator(".equip-card");
    if ((await eq.count()) > 0) await eq.nth(Math.floor(Math.random() * (await eq.count()))).click();
    await sleep(800);
    await page.locator(".stageclear-screen .btn.primary", { hasText: "つぎのステージ" }).click().catch((e) => log("next-stage click failed", e.message));
    await page.locator(".battle-screen").waitFor({ timeout: 5000 }).catch(() => log("battle did not resume"));
    lastDead = 0;
    lastWave = "";
    continue;
  }
  if (s.screen !== "battle") {
    mark("end", s.screen);
    break;
  }
  if (s.downed) {
    mark("downed");
    break;
  }
  if (s.dead > lastDead) {
    stats.kills += s.dead - lastDead;
    mark("kill", `${s.dead}`);
  }
  lastDead = s.dead;
  if (s.wave !== lastWave) {
    if (lastWave) { stats.waves++; mark("wave", s.wave.trim()); }
    lastWave = s.wave;
  }
  if (s.chain && !lastChain) mark("chain");
  lastChain = s.chain;
  if (s.unison && !lastUnison) mark("unison");
  lastUnison = s.unison;

  if (!s.rest) {
    inWord = false;
    await sleep(120);
    continue;
  }
  const ch = s.rest[0];
  if (!/^[a-z0-9\-,.!?/]$/i.test(ch)) {
    await sleep(120);
    continue;
  }
  if (!inWord) {
    await sleep(rand(120, 320)); // ワードを見て構える間
    inWord = true;
  }
  // たまにミスタイプ（人間っぽさ）。おに難易度は自傷ダメージが痛いので控えめ
  if (Math.random() < (TEAM_DIFF === "oni" ? 0.01 : 0.025)) {
    await page.keyboard.press(pick("qwertyuiopasdfghjklzxcvbnm".split("")));
    await sleep(rand(80, 160));
  }
  await page.keyboard.press(ch);
  stats.keys++;
  if (s.rest.length === 1) { stats.words++; inWord = false; }
  await sleep(rand(55, 115));
}
const playEnd = t();
await sleep(1200); // 最後の演出を録画に残す
const videoHandle = page.video();
await context.close();
await browser.close();
const webm = await videoHandle.path();
cleanup();

// ---------- 3. 切り抜き ----------
// 「撃破 > ウェーブ突破 > チェイン > ユニゾン」の重み付きで、その瞬間が終盤に来るように窓を取る
const weight = { stageclear: 6, wave: 5, kill: 4, chain: 3, unison: 3 };
const minStart = battleStart + 0.3;
const maxStart = Math.max(minStart, playEnd + 1.0 - CLIP_SEC);
let best = { score: -1, start: Math.min(maxStart, battleStart + 1.5) };
for (const ev of events) {
  if (!weight[ev.kind]) continue;
  let start = ev.t + 1.8 - CLIP_SEC;
  start = Math.min(Math.max(start, minStart), maxStart);
  const end = start + CLIP_SEC;
  const score = events
    .filter((e) => weight[e.kind] && e.t >= start && e.t <= end)
    .reduce((a, e) => a + weight[e.kind], 0);
  if (score > best.score) best = { score, start };
}
const startAt = Math.max(0, best.start);
log(`clip window ${startAt.toFixed(1)}s〜 (score ${best.score}) / events ${events.length}`);

const stamp = new Date().toISOString().slice(0, 10);
const baseName = `${stamp}_${MODE}_${ROLE}`;
const mp4 = path.join(OUT_DIR, `${baseName}.mp4`);
execFileSync(
  "ffmpeg",
  [
    "-y", "-loglevel", "error",
    "-ss", startAt.toFixed(2), "-t", String(CLIP_SEC),
    "-i", webm,
    "-vf", `scale=${W}:${H},fps=30,format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-profile:v", "high",
    "-movflags", "+faststart", "-an",
    mp4,
  ],
  { stdio: ["ignore", "ignore", "inherit"] }
);
fs.rmSync(TMP_DIR, { recursive: true, force: true });

// 古い出力を掃除
for (const f of fs.readdirSync(OUT_DIR)) {
  const p = path.join(OUT_DIR, f);
  if (Date.now() - fs.statSync(p).mtimeMs > KEEP_DAYS * 86400e3) fs.rmSync(p);
}

const highlight = events.filter((e) => weight[e.kind] && e.t >= startAt && e.t <= startAt + CLIP_SEC);
const modeLabel = MODE === "survival" ? "☠️うぉーろーど（サバイバル）" : "🗡️ストーリー";
const post = [
  `TYPE HEROES ${modeLabel} ${ROLE_LABEL[ROLE]}でプレイ`,
  `難易度: てき=${DIFF_LABEL[TEAM_DIFF]} / 出題=${DIFF_LABEL[MY_DIFF]}`,
  stats.kills ? `この10秒で ${highlight.filter((e) => e.kind === "kill").length} 体撃破！` : "",
  "みんなで協力してタイピングでバグを倒すRPG。ブラウザですぐ遊べます👇",
  "https://typeheroes.net/",
  "#TYPEHEROES #タイピングゲーム #インディーゲーム",
].filter(Boolean).join("\n");

const meta = {
  file: mp4,
  bytes: fs.statSync(mp4).size,
  date: stamp,
  mode: MODE, role: ROLE, myDiff: MY_DIFF, teamDiff: TEAM_DIFF, name: NAME,
  clipStart: Number(startAt.toFixed(2)), clipSeconds: CLIP_SEC,
  stats, highlight, post,
};
fs.writeFileSync(path.join(OUT_DIR, `${baseName}.json`), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));
