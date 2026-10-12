// バトルの粒子エフェクト。React の再描画に乗せず、全画面キャンバス1枚へ直接描く
// （打鍵のたびに state を増やすと、ただでさえ忙しいバトル画面の再描画が重くなるため）
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface Pt {
  x: number;
  y: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 残り ms
  max: number;
  size: number;
  color: string;
  grav: number;
}
interface Bolt {
  from: Pt;
  to: Pt;
  t: number;
  dur: number;
  color: string;
  bend: number; // 軌道のふくらみ（毎回ちがう弧を描かせる）
  onHit?: () => void;
}
interface Slash {
  at: Pt;
  len: number;
  angle: number;
  t: number;
  dur: number;
  color: string;
}
interface Ring {
  at: Pt;
  r: number;
  t: number;
  dur: number;
  color: string;
}

/** 敵の「ねらい」。予告中ずっと敵から標的へ照準線を引き、発動が近づくほど濃く・照準が締まる */
export interface Aim {
  from: () => Pt | null;
  to: () => (Pt | null)[];
  at: number;
  resolveAt: number;
}

const MAX_PARTICLES = 320;
/** OS で「視差効果を減らす」を選んでいる人には、飛び道具と揺れを出さない */
export const calmMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

let canvas: HTMLCanvasElement | null = null;
let g: CanvasRenderingContext2D | null = null;
let dpr = 1;
let raf = 0;
let last = 0;
const particles: Particle[] = [];
const bolts: Bolt[] = [];
const slashes: Slash[] = [];
const rings: Ring[] = [];
let aims: Aim[] = [];

function resize() {
  if (!canvas) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
}

function kick() {
  if (raf || !canvas) return;
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

function spawn(p: Particle) {
  if (particles.length >= MAX_PARTICLES) particles.shift();
  particles.push(p);
}

function frame(nowMs: number) {
  raf = 0;
  if (!canvas || !g) return;
  const dt = Math.min(40, nowMs - last);
  last = nowMs;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, window.innerWidth, window.innerHeight);

  // 飛び道具: 2次ベジェで弧を描き、通ったあとに残像を落とす
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.t += dt;
    const k = Math.min(1, b.t / b.dur);
    const mx = (b.from.x + b.to.x) / 2 + b.bend;
    const my = (b.from.y + b.to.y) / 2;
    const u = 1 - k;
    const x = u * u * b.from.x + 2 * u * k * mx + k * k * b.to.x;
    const y = u * u * b.from.y + 2 * u * k * my + k * k * b.to.y;
    g.fillStyle = b.color;
    g.fillRect(Math.round(x - 9), Math.round(y - 3), 18, 6);
    g.fillRect(Math.round(x - 3), Math.round(y - 9), 6, 18);
    g.fillStyle = "#fff";
    g.fillRect(Math.round(x - 5), Math.round(y - 5), 10, 10);
    spawn({ x, y, vx: 0, vy: 0, life: 170, max: 170, size: 8, color: b.color, grav: 0 });
    if (k >= 1) {
      bolts.splice(i, 1);
      fx.sparks(b.to, b.color, 6, 0.26);
      b.onHit?.();
    }
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.vy += p.grav * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const a = p.life / p.max;
    const s = Math.max(1, Math.round(p.size * (0.4 + 0.6 * a)));
    g.globalAlpha = Math.min(1, a * 1.6);
    g.fillStyle = p.color;
    g.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
  }
  g.globalAlpha = 1;

  // 斬撃: 白い芯 + 色のふちが一気に走って、細くなりながら消える
  for (let i = slashes.length - 1; i >= 0; i--) {
    const s = slashes[i];
    s.t += dt;
    const k = s.t / s.dur;
    if (k >= 1) {
      slashes.splice(i, 1);
      continue;
    }
    const head = Math.min(1, k * 2.4);
    const tail = Math.max(0, k * 2.4 - 1.1);
    const dx = Math.cos(s.angle) * s.len;
    const dy = Math.sin(s.angle) * s.len;
    const x0 = s.at.x - dx / 2 + dx * tail;
    const y0 = s.at.y - dy / 2 + dy * tail;
    const x1 = s.at.x - dx / 2 + dx * head;
    const y1 = s.at.y - dy / 2 + dy * head;
    g.lineCap = "square";
    g.strokeStyle = s.color;
    g.lineWidth = 10 * (1 - k);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.strokeStyle = "#fff";
    g.lineWidth = 4 * (1 - k);
    g.stroke();
  }

  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.t += dt;
    const k = r.t / r.dur;
    if (k >= 1) {
      rings.splice(i, 1);
      continue;
    }
    g.globalAlpha = 1 - k;
    g.strokeStyle = r.color;
    g.lineWidth = 6 * (1 - k) + 1;
    g.beginPath();
    g.arc(r.at.x, r.at.y, r.r * (0.2 + 0.8 * (1 - (1 - k) ** 3)), 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
  }

  // 照準線: 敵 → 標的へ流れる点線と、標的を囲んで締まっていくカッコ
  const wall = Date.now();
  for (const a of aims) {
    const from = a.from();
    if (!from) continue;
    const k = Math.min(1, Math.max(0, (wall - a.at) / Math.max(1, a.resolveAt - a.at)));
    const hot = k > 0.75;
    for (const to of a.to()) {
      if (!to) continue;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.hypot(dx, dy);
      const step = 16;
      const offset = (nowMs / (hot ? 12 : 26)) % step;
      g.fillStyle = hot && Math.floor(nowMs / 90) % 2 ? "#fff" : "#ef4444";
      g.globalAlpha = 0.25 + 0.6 * k;
      const s = 3 + Math.round(3 * k);
      for (let d = offset; d < dist - 26; d += step) {
        g.fillRect(Math.round(from.x + (dx * d) / dist - s / 2), Math.round(from.y + (dy * d) / dist - s / 2), s, s);
      }
      const r = 44 - 20 * k;
      const c = 9;
      g.globalAlpha = 0.5 + 0.5 * k;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const cx = to.x + sx * r;
        const cy = to.y + sy * r * 0.6;
        g.fillRect(Math.round(cx - (sx > 0 ? c : 0)), Math.round(cy - 2), c, 4);
        g.fillRect(Math.round(cx - 2), Math.round(cy - (sy > 0 ? c : 0)), 4, c);
      }
      g.globalAlpha = 1;
    }
  }

  if (particles.length || bolts.length || slashes.length || rings.length || aims.length) raf = requestAnimationFrame(frame);
}

export const fx = {
  /** いま出ている攻撃予告の照準線をまとめて差し替える（空配列で消える） */
  setAims(next: Aim[]) {
    aims = calmMotion() ? [] : next;
    kick();
  },
  /** 打鍵の一発。from から to へ飛んで、当たったら火花 */
  bolt(from: Pt | null, to: Pt | null, color: string, onHit?: () => void) {
    if (!from || !to) return;
    if (calmMotion() || !canvas) {
      onHit?.();
      return;
    }
    bolts.push({ from, to, t: 0, dur: 120, color, bend: (Math.random() - 0.5) * 160, onHit });
    kick();
  },
  /** 飛び散る火花。power は初速（px/ms） */
  sparks(at: Pt | null, color: string, n: number, power = 0.3) {
    if (!at || !canvas) return;
    const count = calmMotion() ? Math.ceil(n / 3) : n;
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const v = power * (0.4 + Math.random() * 0.9);
      const life = 260 + Math.random() * 260;
      spawn({
        x: at.x,
        y: at.y,
        vx: Math.cos(ang) * v,
        vy: Math.sin(ang) * v - power * 0.3,
        life,
        max: life,
        size: 5 + Math.random() * 7,
        color: Math.random() < 0.25 ? "#fff" : color,
        grav: 0.0009,
      });
    }
    kick();
  },
  /** ワード完了の斬撃。cross = 会心（×の字に2本） */
  slash(at: Pt | null, len: number, color: string, cross = false) {
    if (!at || !canvas) return;
    const base = -Math.PI / 4 + (Math.random() - 0.5) * 0.5;
    slashes.push({ at, len, angle: base, t: 0, dur: 190, color });
    if (cross) slashes.push({ at, len, angle: base + Math.PI / 2, t: -60, dur: 190, color });
    kick();
  },
  /** 撃破: ドットが砕けて四方へ飛び散る。big = ボス（数も勢いも大きく、少しずつずらして連鎖させる） */
  explode(at: Pt | null, big = false) {
    if (!at || !canvas) return;
    const palette = ["#fff", "#ffd866", "#ff9f43", "#ff6b6b", "#c084fc"];
    const blast = (p: Pt, n: number, power: number) => {
      const count = calmMotion() ? Math.ceil(n / 3) : n;
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const v = power * (0.3 + Math.random());
        const life = 380 + Math.random() * 520;
        spawn({
          x: p.x + (Math.random() - 0.5) * 30,
          y: p.y + (Math.random() - 0.5) * 30,
          vx: Math.cos(ang) * v,
          vy: Math.sin(ang) * v - power * 0.5,
          life,
          max: life,
          size: 6 + Math.random() * 10,
          color: palette[Math.floor(Math.random() * palette.length)],
          grav: 0.0014,
        });
      }
      rings.push({ at: p, r: big ? 150 : 90, t: 0, dur: 380, color: "#fff" });
      kick();
    };
    blast(at, big ? 50 : 34, big ? 0.7 : 0.5);
    if (big) {
      for (let i = 1; i <= 5; i++) {
        setTimeout(
          () => blast({ x: at.x + (Math.random() - 0.5) * 160, y: at.y + (Math.random() - 0.5) * 110 }, 30, 0.6),
          i * 150
        );
      }
    }
  },
  /** そせい: 足元から光の粒が柱になって立ちのぼる */
  pillar(at: Pt | null, color = "#8be08b") {
    if (!at || !canvas) return;
    const n = calmMotion() ? 14 : 46;
    for (let i = 0; i < n; i++) {
      const life = 500 + Math.random() * 600;
      spawn({
        x: at.x + (Math.random() - 0.5) * 110,
        y: at.y + 30 + Math.random() * 20,
        vx: (Math.random() - 0.5) * 0.03,
        vy: -(0.12 + Math.random() * 0.32),
        life,
        max: life,
        size: 5 + Math.random() * 8,
        color: Math.random() < 0.35 ? "#fff" : color,
        grav: -0.0002,
      });
    }
    rings.push({ at, r: 100, t: 0, dur: 450, color });
    kick();
  },
  /** 広がる輪（弱点ヒットなど「効いた」の合図） */
  ring(at: Pt | null, color: string, r = 80) {
    if (!at || !canvas || calmMotion()) return;
    rings.push({ at, r, t: 0, dur: 320, color });
    kick();
  },
};

/**
 * 画面全体が一瞬光る（hurt = 被弾の赤いふち / white = ボス撃破 / rage = いかり爆発）。
 * body に直接置くので、直後に画面が切り替わっても（ボス撃破 → ステージクリア）最後まで光りきる
 */
export function flashScreen(kind: "hurt" | "white" | "rage" | "gold", ms: number) {
  const el = document.createElement("div");
  el.className = `screen-flash ${kind}`;
  el.style.animationDuration = `${ms}ms`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function centerOf(el: Element | null | undefined): Pt | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// 色違いの敵は --tint でフィルタを掛けている。未指定のときに none を混ぜると filter 全体が無効になるので brightness(1) を既定にする
const TINT = "var(--tint, brightness(1))";

/** 敵の攻撃発動: 標的のほうへ飛びかかって戻る */
export function lunge(el: Element | null | undefined, toward: Pt | null) {
  const from = centerOf(el);
  if (!el || !from || !toward || calmMotion() || typeof el.animate !== "function") return;
  const dx = (toward.x - from.x) * 0.45;
  const dy = (toward.y - from.y) * 0.45;
  el.animate(
    [
      { transform: "translate(0,0) scale(1)" },
      { transform: `translate(${-dx * 0.12}px,${-dy * 0.12}px) scale(0.9)`, offset: 0.25 },
      { transform: `translate(${dx}px,${dy}px) scale(1.25)`, filter: `${TINT} brightness(1.8)`, offset: 0.5 },
      { transform: "translate(0,0) scale(1)" },
    ],
    { duration: 360, easing: "cubic-bezier(.3,0,.2,1)" }
  );
}

/** 被弾したカードがガタつく */
export function rattle(el: Element | null | undefined) {
  if (!el || calmMotion() || typeof el.animate !== "function") return;
  el.animate(
    [
      { transform: "translate(0,0)" },
      { transform: "translate(-6px,3px) rotate(-2deg)" },
      { transform: "translate(5px,-2px) rotate(2deg)" },
      { transform: "translate(-3px,1px)" },
      { transform: "translate(0,0)" },
    ],
    { duration: 260 }
  );
}

/**
 * 一瞬の「手応え」アニメ。className を React と取り合わないよう Web Animations API で直接かける
 * hit = 敵がのけぞる / big = 白く光って大きくのけぞる / screen = 画面が小さく跳ねる
 */
export function punch(el: Element | null | undefined, kind: "hit" | "big" | "screen") {
  if (!el || calmMotion() || typeof el.animate !== "function") return;
  if (kind === "screen") {
    el.animate(
      [
        { transform: "translate(0,0) scale(1)" },
        { transform: "translate(3px,-4px) scale(1.012)" },
        { transform: "translate(-3px,2px) scale(1.004)" },
        { transform: "translate(0,0) scale(1)" },
      ],
      { duration: 170, easing: "ease-out" }
    );
    return;
  }
  const big = kind === "big";
  el.animate(
    [
      { transform: "translate(0,0) scale(1)", filter: `${TINT} brightness(${big ? 4 : 2.2})` },
      { transform: `translate(${big ? 12 : 6}px,${big ? -4 : 0}px) scale(${big ? 0.82 : 0.93})`, filter: `${TINT} brightness(1.6)`, offset: 0.3 },
      { transform: `translate(${big ? -4 : -2}px,0) scale(${big ? 1.08 : 1.02})`, offset: 0.65 },
      { transform: "translate(0,0) scale(1)", filter: `${TINT} brightness(1)` },
    ],
    { duration: big ? 300 : 160, easing: "ease-out" }
  );
}

/**
 * エフェクト用キャンバス。画面揺れ（transform）の影響を受けないよう body 直下に置く。
 * App の一番上に1枚だけ置く（バトル画面の中に置くと、ボス撃破の爆発がステージクリアへの切り替えで途切れる）
 */
export function FxCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    canvas = ref.current;
    g = canvas?.getContext("2d") ?? null;
    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
      raf = 0;
      particles.length = bolts.length = slashes.length = rings.length = 0;
      aims = [];
      canvas = null;
      g = null;
    };
  }, []);
  return createPortal(<canvas ref={ref} className="fx-canvas" aria-hidden="true" />, document.body);
}
