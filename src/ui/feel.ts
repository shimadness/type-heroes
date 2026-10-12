// 「手応え」のまとまり。本編（Battle）とチュートリアルで同じ見た目・同じ音にするために共用する
// （片方だけ直すと、チュートリアルで覚えた感触と本編がずれる）
import { sfx } from "../sfx";
import { centerOf, flashScreen, fx, punch, rattle } from "./fx";

const screenEl = () => document.querySelector(".battle-screen");

/** ワードを打ち切って敵に当てた瞬間（斬撃・火花・のけぞり・音）。weak = 弱点, crit = 会心 */
export function strikeFeel(sprite: Element | null, weak: boolean, crit: boolean) {
  const at = centerOf(sprite);
  const big = weak || crit;
  const color = weak ? "#ffd866" : crit ? "#ff9f43" : "#9be7ff";
  fx.slash(at, big ? 130 : 90, color, crit);
  fx.sparks(at, color, big ? 22 : 10, big ? 0.5 : 0.32);
  if (weak) fx.ring(at, "#ffd866", 90);
  punch(sprite, big ? "big" : "hit");
  if (big) punch(screenEl(), "screen");
  if (weak) sfx.weak();
  else if (crit) sfx.crit();
  else sfx.wordDone();
}

/** ぼうぎょワードを打ち切った（盾を構えた） */
export function guardReadyFeel(card: Element | null) {
  sfx.guardReady();
  fx.ring(centerOf(card), "#93c5fd", 60);
}

/** 敵の攻撃を受けた瞬間。guarded = ガード成功（青い火花で弾く）／失敗（赤く光ってガタつく） */
export function impactFeel(card: Element | null, guarded: boolean) {
  if (guarded) {
    sfx.guard();
    fx.ring(centerOf(card), "#93c5fd", 70);
    fx.sparks(centerOf(card), "#93c5fd", 16, 0.45);
    punch(screenEl(), "screen");
  } else {
    sfx.hurt();
    rattle(card);
    fx.sparks(centerOf(card), "#f87171", 18, 0.4);
    flashScreen("hurt", 260);
  }
}

/** ユニゾン成功: 全員（from）から敵（to）へ一斉射撃 */
export function unisonFeel(from: (Element | null)[], to: (Element | null)[]) {
  sfx.unisonHit();
  flashScreen("gold", 520);
  for (const f of from) {
    for (const t of to) {
      const target = centerOf(t);
      fx.bolt(centerOf(f), target, "#ffd866", () => fx.sparks(target, "#ffd866", 14, 0.5));
    }
  }
}
