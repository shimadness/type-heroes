import { useEffect, useRef, useState } from "react";
import { isLivePlayer, type Room } from "../game/room";
import type { RoomState } from "../game/types";
import { fireAndForget } from "../net/store";

/** 心拍がこれだけ止まっていたら（ホストの時計基準で）部屋から外す */
const STALE_MS = 30000;
/** 名前もHPもないゾンビノードはもっと早く掃除する */
const ZOMBIE_MS = 8000;

/**
 * ルーム状態の購読フック。
 * - ホストが切断されたら joinedAt 最古のプレイヤーが自動でホストを引き継ぐ
 * - ホストは心拍の止まったプレイヤー／ゾンビノードを掃除する
 *   （残るとロビーで「じゅんび中…」のまま出発できない、次ステージへ進めない、の原因になる）
 */
export function useRoom(room: Room | null): RoomState | null {
  const [state, setState] = useState<RoomState | null>(null);
  const claimingRef = useRef(false);
  // pid → 最後に lastSeen が変わったのを見た時刻（自分の時計）。他人の時計とは比べない
  const seenRef = useRef<Map<string, { lastSeen: number; at: number }>>(new Map());

  useEffect(() => {
    if (!room) return;
    seenRef.current = new Map();
    const unsub = room.subscribe((s) => setState(s));
    return () => {
      unsub();
    };
  }, [room]);

  // ホスト不在検知 → 引き継ぎ
  useEffect(() => {
    if (!room || !state || room.spectator) return;
    const players = state.players ?? {};
    const hostAlive = isLivePlayer(players[state.meta?.hostId ?? ""]);
    if (hostAlive || claimingRef.current) return;
    const sorted = Object.entries(players)
      .filter(([, p]) => isLivePlayer(p) && !p.spectator)
      .sort((a, b) => a[1].joinedAt - b[1].joinedAt);
    if (sorted.length === 0 || sorted[0][0] !== room.myId) return;
    claimingRef.current = true;
    room.store
      .transaction(`${room.base}/meta/hostId`, (cur) => {
        if (typeof cur === "string" && isLivePlayer(players[cur])) return undefined; // 現ホスト健在なら中断
        return room.myId;
      })
      .finally(() => {
        claimingRef.current = false;
      });
  }, [room, state]);

  // ホストによる掃除（自分の心拍で state が5秒ごとに更新されるので、ここが定期チェックにもなる）
  useEffect(() => {
    if (!room || !state || room.spectator) return;
    if (state.meta?.hostId !== room.myId) return;
    const now = Date.now();
    const players = state.players ?? {};
    const seen = seenRef.current;
    for (const pid of [...seen.keys()]) if (!(pid in players)) seen.delete(pid);
    for (const [pid, raw] of Object.entries(players)) {
      if (pid === room.myId) continue;
      const p = raw as Partial<RoomState["players"][string]>;
      const ls = p.lastSeen ?? 0;
      const e = seen.get(pid);
      if (!e || e.lastSeen !== ls) {
        seen.set(pid, { lastSeen: ls, at: now });
        continue;
      }
      const limit = isLivePlayer(p) ? STALE_MS : ZOMBIE_MS;
      if (now - e.at > limit) {
        seen.delete(pid);
        fireAndForget(
          "いないプレイヤーの掃除",
          room.store.remove(`${room.base}/players/${pid}`)
        );
      }
    }
  }, [room, state]);

  return state;
}
