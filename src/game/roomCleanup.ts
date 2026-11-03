// ============================================================
// 部屋の掃除（サーバー側の仕組みが無いので、クライアントが後始末する）
//   1. 最後の人が抜けたら、その部屋ごと消す
//   2. 自分が触った部屋が作成から24時間たっていたら、次に遊んだときに消す
// 消すのは typing/rooms/{あいことば} だけ。ランキング（typing/ranking・survival）は触らない。
// ============================================================
import type { Store } from "../net/store";
import type { RoomMeta, RoomState } from "./types";
import { ROOT, livePlayersOf } from "./room";

export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const KEY = "th_seen_rooms";

function loadSeen(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function saveSeen(seen: Record<string, number>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(seen));
  } catch {
    /* 保存できなくても遊びには影響しない */
  }
}

/** 自分が作った・入った部屋を覚えておく（あとで掃除する候補） */
export function rememberRoom(code: string) {
  const seen = loadSeen();
  seen[code] = Date.now();
  saveSeen(seen);
}

/** 誰も残っていなければ部屋ごと消す。入れ違いの参加者を巻き込まないようトランザクションで判定 */
export async function removeRoomIfEmpty(store: Store, code: string) {
  await store.transaction(`${ROOT}/rooms/${code}`, (cur) => {
    const room = cur as RoomState | null;
    if (!room) return cur;
    return livePlayersOf(room.players).length === 0 ? null : cur;
  });
}

/**
 * 覚えている部屋のうち、作成から24時間たったものを消す。
 * 同じあいことばで作り直された新しい部屋・まだ誰かが遊んでいる部屋は残す。
 */
export async function sweepOldRooms(store: Store, exceptCode?: string) {
  const seen = loadSeen();
  const now = Date.now();
  let changed = false;
  for (const code of Object.keys(seen)) {
    if (code === exceptCode) continue;
    try {
      const meta = (await store.read(`${ROOT}/rooms/${code}/meta`)) as RoomMeta | null;
      if (meta && now - meta.createdAt < ROOM_TTL_MS) continue;
      if (meta) {
        await store.transaction(`${ROOT}/rooms/${code}`, (cur) => {
          const room = cur as RoomState | null;
          if (!room?.meta || now - room.meta.createdAt < ROOM_TTL_MS) return cur;
          return livePlayersOf(room.players, now).length === 0 ? null : cur;
        });
      }
      delete seen[code];
      changed = true;
    } catch (e) {
      console.warn("[TYPE HEROES] 古い部屋の掃除に失敗", code, e);
    }
  }
  if (changed) saveSeen(seen);
}
