// ============================================================
// X 拡散用クリップ生成
//   1. ゲームをビルドして vite preview で配信
//   2. headless Chromium で自動プレイしながら録画（ひとり、または なかま2〜4人のパーティー）
//   3. いちばん盛り上がった瞬間（そせい・ユニゾン・撃破・ウェーブ突破）を中心に 10 秒を切り抜き mp4 化
//
//   node clip.mjs [--no-build] [--mode story|survival] [--role attacker|...] [--party 1..4] [--seconds 10]
//                [--mates healer,tank]（なかまのロール指定） [--clumsy]（ないとめあ で なかま1人をミス連発にして そせいを起こす）
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
const TEAM_DIFF = flag("team", pick(["normal", "hard", "hard", "oni", "nightmare"]));
const NAME = flag("name", pick(["ゆうしゃ", "タイパー", "けんし", "デバッガー"]));
// パーティー人数（主役こみ）。協力プレイが売りなので複数人を多めに
const PARTY = Math.min(4, Math.max(1, Number(flag("party", pick([1, 2, 3, 3, 4])))));
const ROOM_CODE = `xclip${Math.floor(rand(100, 999))}`;
const SELF_DMG_DIFFS = ["nightmare"];
const MATES = (() => {
  const roles = ["healer", "tank", "buffer", "attacker", "berserker"].filter((r) => r !== ROLE).sort(() => Math.random() - 0.5);
  // 3人以上なら かいふく役を必ず入れる（いないとすぐ全滅して絵にならない）
  if (PARTY >= 3 && ROLE !== "healer") roles.unshift(...roles.splice(roles.indexOf("healer"), 1));
  // --mates berserker,healer のように なかまのロールを指定できる
  const fixed = flag("mates", "");
  if (fixed) roles.unshift(...fixed.split(","));
  const names = ["ミナト", "さくら", "レン", "ひなた", "そうた"].filter((n) => n !== NAME).sort(() => Math.random() - 0.5);
  return roles.slice(0, PARTY - 1).map((role, i) => ({
    role,
    name: names[i],
    diff: pick(["normal", "normal", "hard"]),
    tempo: rand(1.5, 2.4), // 主役よりゆっくり打つ（なかまが強すぎると一瞬で片づいて見せ場がなくなる）
    // ミスが自傷になる難易度では、1人目を「あわてんぼう」にすることがある（ミス連発 → 気絶 → そせいの見せ場）
    missRate: i === roles.findIndex((r) => r !== "healer") && SELF_DMG_DIFFS.includes(TEAM_DIFF) && (args.includes("--clumsy") || Math.random() < 0.6) ? 0.5 : 0.025,
    page: null,
  }));
})();

const ROLE_LABEL = { attacker: "アタッカー", healer: "ヒーラー", tank: "タンク", buffer: "バッファー", berserker: "ばーさーかー" };
const DIFF_LABEL = { easy: "かんたん", normal: "ふつう", hard: "むずかしい", oni: "おに", nightmare: "ないとめあ" };

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

// --- 複数人プレイ用の共有ストア ---
// マルチプレイは本来 RTDB 経由だが、撮影のたびに本番DBへ部屋やランキングを書きたくないので、
// この Node プロセスに部屋の状態を持ち、各ページの window.__thNetStore（App.tsx の netStore が拾う）から読み書きさせる。
// 値は JSON 文字列で受け渡す（transaction の比較をキー順まで含めて厳密にするため）。
const shared = { root: {} };
const segs = (p) => p.split("/").filter(Boolean);
const getAt = (p) => {
  let cur = shared.root;
  for (const k of segs(p)) {
    if (cur == null || typeof cur !== "object") return null;
    cur = cur[k];
  }
  return cur ?? null;
};
const setAt = (p, v) => {
  const parts = segs(p);
  let cur = shared.root;
  for (const k of parts.slice(0, -1)) {
    if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
  }
  if (v == null) delete cur[parts.at(-1)];
  else cur[parts.at(-1)] = v;
};
const subs = new Set(); // { page, id, path, last }
let flushQueued = false;
const flush = () => {
  flushQueued = false;
  for (const s of subs) {
    const json = JSON.stringify(getAt(s.path));
    if (json === s.last) continue;
    s.last = json;
    s.page.evaluate(([id, j]) => window.__thDeliver(id, j), [s.id, json]).catch(() => {});
  }
};
const touch = () => {
  if (flushQueued) return;
  flushQueued = true;
  setImmediate(flush);
};
let pushSeq = 0;
const bridge = ({ page }, op, path, a, b) => {
  switch (op) {
    case "read":
      return JSON.stringify(getAt(path));
    case "write":
      setAt(path, JSON.parse(a));
      break;
    case "update":
      for (const [k, v] of Object.entries(JSON.parse(a))) setAt(`${path}/${k}`, v);
      break;
    case "push": {
      const key = `k${Date.now()}_${pushSeq++}`;
      setAt(`${path}/${key}`, JSON.parse(a));
      touch();
      return key;
    }
    case "cas": // a = 読んだときの値, b = 書きたい値。読んだあとに他の人が書いていたら false（ページ側でやり直す）
      if (JSON.stringify(getAt(path)) !== a) return false;
      setAt(path, JSON.parse(b));
      touch();
      return true;
    case "sub":
      subs.add({ page, id: a, path, last: undefined });
      break;
    case "unsub":
      for (const s of subs) if (s.page === page && s.id === a) subs.delete(s);
      return;
  }
  touch();
};
const installNetStore = () => {
  const cbs = new Map();
  let seq = 0;
  const B = (...a) => window.__thBridge(...a);
  const J = (v) => JSON.stringify(v ?? null);
  window.__thDeliver = (id, json) => cbs.get(id)?.(JSON.parse(json));
  window.__thNetStore = {
    read: async (p) => JSON.parse(await B("read", p)),
    write: (p, v) => B("write", p, J(v)),
    update: (p, partial) => B("update", p, J(partial)),
    push: (p, v) => B("push", p, J(v)),
    remove: (p) => B("write", p, "null"),
    async transaction(p, fn) {
      for (let i = 0; i < 30; i++) {
        const prev = await B("read", p);
        const next = fn(JSON.parse(prev));
        if (next === undefined) return;
        if (await B("cas", p, prev, J(next))) return;
      }
    },
    subscribe(p, cb) {
      const id = ++seq;
      cbs.set(id, cb);
      B("sub", p, id);
      return () => {
        cbs.delete(id);
        B("unsub", p, id);
      };
    },
    onDisconnectRemove() {},
  };
};
const newPlayerContext = async (name, extra = {}) => {
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    locale: "ja-JP",
    ...extra,
  });
  await ctx.exposeBinding("__thBridge", bridge);
  await ctx.addInitScript(installNetStore);
  await ctx.addInitScript(({ name, zoom }) => {
    try { localStorage.setItem("th_name", name); } catch {}
    document.addEventListener("DOMContentLoaded", () => {
      document.documentElement.style.zoom = String(zoom);
    });
  }, { name, zoom: ZOOM });
  return ctx;
};

const context = await newPlayerContext(NAME, { recordVideo: { dir: TMP_DIR, size: { width: W, height: H } } });
const page = await context.newPage();
// 画面側の例外は録画に映らないので、ここで拾ってログに出す（演出や BGM の不具合に気づけるように）
page.on("pageerror", (e) => log("PAGE ERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") log("console.error", m.text().slice(0, 200)); });
const T0 = Date.now(); // 録画の原点（おおよそ）
const t = () => (Date.now() - T0) / 1000;
const events = []; // { t, kind, note }
const mark = (kind, note = "") => { events.push({ t: t(), kind, note }); log(`event ${kind} ${note} @${t().toFixed(1)}s`); };

// メニュー名はアイコン付き（PixelIcon）なので部分一致で拾う
const menuBtn = (pg, name) => pg.getByRole("button", { name, exact: false });
const pwInput = (pg) => pg.getByPlaceholder("例:", { exact: false });
const pickSetup = async (pg, role, diff) => {
  await pg.locator(".role-grid").waitFor();
  await pg.locator(".role-card", { hasText: ROLE_LABEL[role] }).click();
  await pg.locator(".my-setup .diff-row").nth(0).locator(".diff-btn", { hasText: DIFF_LABEL[diff] }).click();
};

await page.goto(BASE);
await menuBtn(page, "ひとりでしゅぎょう").waitFor();
await sleep(600); // タイトルを少し見せる

if (PARTY > 1) {
  if (MODE === "survival") {
    await menuBtn(page, "うぉーろーど").click();
    await menuBtn(page, "みんなでいどむ").click();
  } else {
    await menuBtn(page, "ぼうけんをはじめる").click();
  }
  await pwInput(page).fill(ROOM_CODE);
  await page.locator(".setup-actions .btn.primary").click();
  await page.locator(".role-grid").waitFor();
  // なかまは録画しない別コンテキストで参加させる
  await Promise.all(MATES.map(async (m) => {
    const ctx = await newPlayerContext(m.name);
    m.page = await ctx.newPage();
    await m.page.goto(BASE);
    await menuBtn(m.page, "あいことばでくわわる").click();
    await pwInput(m.page).fill(ROOM_CODE);
    await m.page.locator(".setup-actions .btn.primary").click();
    await pickSetup(m.page, m.role, m.diff);
    await m.page.locator(".lobby-actions .btn.big").click(); // じゅんびOK！
  }));
  log(`party ${PARTY}: ${[ROLE, ...MATES.map((m) => m.role)].join(", ")}`);
} else if (MODE === "survival") {
  await menuBtn(page, "うぉーろーど").click();
  await menuBtn(page, "ひとりでいどむ").click();
} else {
  await menuBtn(page, "ひとりでしゅぎょう").click();
}

// ロビー: ロール / 自分の難易度 / チーム難易度
await pickSetup(page, ROLE, MY_DIFF);
await page.locator(".my-setup .diff-row").nth(1).locator(".diff-btn", { hasText: DIFF_LABEL[TEAM_DIFF] }).click();
await sleep(PARTY > 1 ? 1200 : 400); // 複数人のときはメンバーが揃ったロビーを少し見せる
await page.locator(".lobby-actions .btn.primary").click(); // 全員じゅんびOKになるまで押せない（click が待つ）
await page.locator(".battle-screen").waitFor();
mark("battle");
const battleStart = t();

// 画面の状態をまとめて読む（1 回の evaluate で済ませて打鍵テンポを落とさない）
const readState = (pg) =>
  pg.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const restOf = (sel) => q(sel)?.textContent ?? null;
    const rest = restOf(".unison-card .card-romaji .rest") ?? restOf(".reel-card .card-romaji .rest") ?? restOf(".active-card .card-romaji .rest");
    const kindOf = (el) => (el.classList.contains("revive") ? "revive" : el.classList.contains("defense") ? "defense" : "genre");
    const reel = q(".reel-card");
    const hps = [...document.querySelectorAll(".player-hp-bar .hp-fill")].map((e) => parseFloat(e.style.width) || 0).filter((w) => w > 0);
    return {
      screen: q(".battle-screen") ? "battle" : q(".stageclear-screen") ? "stageclear" : q(".lobby-screen") ? "lobby" : "other",
      rest,
      downed: !!q(".downed-overlay"),
      dead: document.querySelectorAll(".enemy-card.dead").length,
      alive: document.querySelectorAll(".enemy-card:not(.dead)").length,
      wave: q(".stage-label")?.textContent ?? "",
      chain: !!q(".chain-banner"),
      unison: !!q(".unison-panel"),
      unisonReady: !!q(".unison-btn.ready:not(:disabled)"),
      activeKind: reel ? kindOf(reel) : null,
      // リールに乗っているカード。todo = まだ打つ意味がある（ガード済みのぼうぎょカードは false）
      chips: [...document.querySelectorAll(".reel-chip")].map((c) => ({
        kind: kindOf(c),
        cur: c.classList.contains("cur"),
        todo: !(c.title || "").includes("ガードOK"),
      })),
      minHp: hps.length ? Math.min(...hps) / 100 : 1,
      canHeal: !!q(".mode-btn.heal"),
      healSel: !!q(".mode-btn.heal.sel"),
    };
  });

let stats = { words: 0, keys: 0, kills: 0, waves: 0, stages: 0, revives: 0, unisons: 0 };
const deadline = battleStart + PLAY_SEC;
let stop = false; // 主役が終わったらなかまも止める

/**
 * 1人ぶんの自動プレイ。main = 録画している主役（イベント記録とステージ進行を受け持つ）
 * tempo = 打鍵間隔の倍率、guardRate = ぼうぎょワードに反応する確率（なかまは時々くらって気絶 → そせいの見せ場になる）
 */
async function play(pg, { main, role, tempo, guardRate, missRate }) {
  let lastDead = 0;
  let lastWave = "";
  let lastChain = false;
  let lastUnison = false;
  let inWord = false;
  let wasDowned = false;
  let equipPicked = false;
  let guard = null; // いま出ているぼうぎょカードに反応するか（カードが出るたびに決め直す）
  let unisonAt = null;
  let lastDebug = 0;
  while (!stop && t() < deadline) {
    const s = await readState(pg);
    if (main && t() - lastDebug > 5) {
      lastDebug = t();
      log(`state ${s.screen} alive=${s.alive} dead=${s.dead} rest=${s.rest ? JSON.stringify(s.rest.slice(0, 12)) : null} keys=${stats.keys}`);
    }
    if (s.screen === "stageclear") {
      if (!main) {
        if (!equipPicked) {
          equipPicked = true;
          const eq = pg.locator(".equip-card");
          if ((await eq.count()) > 0) await eq.nth(Math.floor(Math.random() * (await eq.count()))).click().catch(() => {});
        }
        await sleep(300);
        continue;
      }
      stats.stages++;
      mark("stageclear");
      await sleep(PARTY > 1 ? 1800 : 2500); // クリア演出を見せる
      const eq = pg.locator(".equip-card");
      if ((await eq.count()) > 0) await eq.nth(Math.floor(Math.random() * (await eq.count()))).click();
      await sleep(800);
      await pg.locator(".stageclear-screen .btn.primary", { hasText: "つぎのステージ" }).click().catch((e) => log("next-stage click failed", e.message));
      await pg.locator(".battle-screen").waitFor({ timeout: 5000 }).catch(() => log("battle did not resume"));
      lastDead = 0;
      lastWave = "";
      continue;
    }
    equipPicked = false;
    if (s.screen !== "battle") {
      if (main) mark("end", s.screen);
      break;
    }
    if (s.downed) {
      if (main && !wasDowned) mark("downed");
      wasDowned = true;
      if (main && PARTY === 1) break; // ひとりなら起こしてくれる人がいない
      await sleep(150);
      continue;
    }
    if (wasDowned) {
      wasDowned = false;
      if (main) mark("revived");
    }
    if (main) {
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
      // ユニゾンは決着した瞬間に印をつける（切り抜きの終盤に結果が来るように）
      if (!s.unison && lastUnison) { stats.unisons++; mark("unison"); }
      lastUnison = s.unison;
    }

    // ユニゾンは主役が撃つ。たまったら即ではなく少し引っぱる（毎回おなじ絵にならないように）
    if (main && s.unisonReady) {
      unisonAt ??= t() + rand(2, 12);
      if (t() >= unisonAt) {
        unisonAt = null;
        await pg.locator(".unison-btn.ready").click({ timeout: 1000 }).catch(() => {});
        await sleep(200);
        continue;
      }
    }
    if (!s.unison) {
      // ヒーラーは味方のHPを見て かいふく⇄こうげき を切り替える
      if (role === "healer" && s.canHeal) {
        const wantHeal = s.minHp < 0.6 ? true : s.minHp > 0.9 ? false : s.healSel;
        if (wantHeal !== s.healSel) {
          await pg.keyboard.press(" ");
          await sleep(rand(150, 250));
          continue;
        }
      }
      // リール: そせい > ぼうぎょ の順で優先して回す
      const hasGuard = s.chips.some((c) => c.kind === "defense" && c.todo);
      if (!hasGuard) guard = null;
      else if (guard === null) guard = Math.random() < guardRate;
      const cur = s.chips.findIndex((c) => c.cur);
      let want = s.chips.findIndex((c) => c.kind === "revive");
      if (want < 0 && guard) want = s.chips.findIndex((c) => c.kind === "defense" && c.todo);
      if (cur >= 0 && want >= 0 && s.chips[cur].kind === "genre") {
        const fwd = (want - cur + s.chips.length) % s.chips.length;
        const back = s.chips.length - fwd;
        for (let i = 0; i < Math.min(fwd, back); i++) await pg.keyboard.press(fwd <= back ? "Tab" : "Shift+Tab");
        inWord = false;
        await sleep(rand(120, 220));
        continue;
      }
    }

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
      await sleep(rand(120, 320) * tempo); // ワードを見て構える間
      inWord = true;
    }
    // たまにミスタイプ（人間っぽさ）。おに難易度は自傷ダメージが痛いので控えめ
    if (Math.random() < (missRate ?? (TEAM_DIFF === "oni" ? 0.01 : 0.025))) {
      await pg.keyboard.press(pick("qwertyuiopasdfghjklzxcvbnm".split("")));
      await sleep(rand(80, 160));
    }
    await pg.keyboard.press(ch);
    if (s.rest.length === 1) {
      inWord = false;
      if (main && s.activeKind === "revive" && !s.unison) { stats.revives++; mark("revive"); }
    }
    if (main) {
      stats.keys++;
      if (s.rest.length === 1) stats.words++;
    }
    await sleep(rand(55, 115) * tempo);
  }
}

const mateRuns = MATES.map((m) =>
  play(m.page, { main: false, role: m.role, tempo: m.tempo, guardRate: 0.3, missRate: m.missRate }).catch((e) => log(`mate ${m.name} stopped`, e.message))
);
await play(page, { main: true, role: ROLE, tempo: 1, guardRate: 0.85 });
stop = true;
await Promise.all(mateRuns);
const playEnd = t();
await sleep(1200); // 最後の演出を録画に残す
const videoHandle = page.video();
const closedAt = t();
await context.close();
await browser.close();
const webm = await videoHandle.path();
cleanup();
// 録画は T0 より少し遅れて始まる（なかまの参加で重いと数秒ずれる）。動画の長さから実際のずれを出して補正する
const webmSec = Number(
  execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", webm]).toString().trim()
);
const videoLag = Number.isFinite(webmSec) ? Math.max(0, closedAt - webmSec) : 0;
log(`video ${webmSec.toFixed(1)}s / lag ${videoLag.toFixed(2)}s`);

// ---------- 3. 切り抜き ----------
// 「そせい > ユニゾン・ステージクリア > ウェーブ突破 > 撃破 > チェイン」の重み付きで、その瞬間が終盤に来るように窓を取る
const weight = { revive: 8, revived: 7, unison: 6, stageclear: 6, wave: 5, kill: 4, chain: 3 };
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
    "-ss", Math.max(0, startAt - videoLag).toFixed(2), "-t", String(CLIP_SEC),
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
const has = (kind) => highlight.some((e) => e.kind === kind);
const modeLabel = MODE === "survival" ? "☠️うぉーろーど（サバイバル）" : "🗡️ストーリー";
const post = [
  PARTY > 1
    ? `TYPE HEROES ${modeLabel} ${PARTY}人パーティー（${[ROLE, ...MATES.map((m) => m.role)].map((r) => ROLE_LABEL[r]).join("・")}）`
    : `TYPE HEROES ${modeLabel} ${ROLE_LABEL[ROLE]}でプレイ`,
  `難易度: てき=${DIFF_LABEL[TEAM_DIFF]} / 出題=${DIFF_LABEL[MY_DIFF]}`,
  has("revive") ? "たおれた なかまを タイピングで そせい！" : has("revived") ? "きぜつしても なかまが おこしてくれる！" : "",
  has("unison") ? (PARTY > 1 ? "全員で同じワードを打つ ユニゾンアタック！" : "ゲージをためて ユニゾンアタック！") : "",
  has("kill") ? `この10秒で ${highlight.filter((e) => e.kind === "kill").length} 体撃破！` : "",
  "みんなで協力してタイピングでバグを倒すRPG。ブラウザですぐ遊べます👇",
  "https://typeheroes.net/?utm_source=x&utm_medium=social&utm_campaign=daily_clip",
  "#TYPEHEROES #タイピングゲーム #インディーゲーム",
].filter(Boolean).join("\n");

const meta = {
  file: mp4,
  bytes: fs.statSync(mp4).size,
  date: stamp,
  mode: MODE, role: ROLE, myDiff: MY_DIFF, teamDiff: TEAM_DIFF, name: NAME,
  party: PARTY, mates: MATES.map(({ role, name, diff }) => ({ role, name, diff })),
  clipStart: Number(startAt.toFixed(2)), clipSeconds: CLIP_SEC,
  stats, highlight, post,
};
fs.writeFileSync(path.join(OUT_DIR, `${baseName}.json`), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));
