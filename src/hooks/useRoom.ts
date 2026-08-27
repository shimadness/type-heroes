import { useEffect, useRef, useState } from "react";
import type { Room } from "../game/room";
import type { RoomState } from "../game/types";

/**
 * ルーム状態の購読フック。
 * ホストが切断されたら joinedAt 最古のプレイヤーが自動でホストを引き継ぐ。
 */
export function useRoom(room: Room | null): RoomState | null {
  const [state, setState] = useState<RoomState | null>(null);
  const claimingRef = useRef(false);

  useEffect(() => {
    if (!room) return;
    const unsub = room.subscribe((s) => setState(s));
    return () => {
      unsub();
    };
  }, [room]);

  // ホスト不在検知 → 引き継ぎ
  useEffect(() => {
    if (!room || !state || room.spectator) return;
    const players = state.players ?? {};
    const hostAlive = !!players[state.meta?.hostId ?? ""];
    if (hostAlive || claimingRef.current) return;
    const sorted = Object.entries(players)
      .filter(([, p]) => !p.spectator)
      .sort((a, b) => a[1].joinedAt - b[1].joinedAt);
    if (sorted.length === 0 || sorted[0][0] !== room.myId) return;
    claimingRef.current = true;
    room.store
      .transaction(`${room.base}/meta/hostId`, (cur) => {
        if (typeof cur === "string" && players[cur]) return undefined; // 現ホスト健在なら中断
        return room.myId;
      })
      .finally(() => {
        claimingRef.current = false;
      });
  }, [room, state]);

  return state;
}
