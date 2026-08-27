import { useCallback, useState } from "react";
import type { Store } from "./net/store";
import { LocalStore } from "./net/store";
import { Room, sanitizeRoomCode } from "./game/room";
import type { JoinProfile } from "./game/room";
import type { Difficulty } from "./typing/words";
import { useRoom } from "./hooks/useRoom";
import { Title } from "./screens/Title";
import { Lobby } from "./screens/Lobby";
import { Battle } from "./screens/Battle";
import { StageClear } from "./screens/StageClear";
import { Result } from "./screens/Result";
import { Ranking } from "./screens/Ranking";

export interface Session {
  store: Store;
  room: Room;
  isLocal: boolean;
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/permission.?denied/i.test(msg)) {
    return "サーバー設定がまだ準備中みたい…（RTDBルールにtypingブロックを追加してね。ひとりで特訓はあそべるよ）";
  }
  return msg;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [showRanking, setShowRanking] = useState(false);
  const [error, setError] = useState("");
  const state = useRoom(session?.room ?? null);

  const startSolo = useCallback(async (profile: JoinProfile, teamDiff: Difficulty) => {
    const store = new LocalStore();
    const room = await Room.create(store, "solo", profile, teamDiff);
    setSession({ store, room, isLocal: true });
  }, []);

  const createRoom = useCallback(
    async (pw: string, profile: JoinProfile, teamDiff: Difficulty) => {
      try {
        const { FirebaseStore } = await import("./net/store");
        const store = new FirebaseStore();
        const code = sanitizeRoomCode(pw);
        if (code.length < 3) throw new Error("あいことばは3文字以上にしてね");
        const existing = await store.read(`typing/rooms/${code}/meta`);
        if (
          existing &&
          Date.now() - ((existing as { createdAt?: number }).createdAt ?? 0) <
            3 * 60 * 60 * 1000
        ) {
          throw new Error("そのあいことばは使用中！べつのあいことばにするか「あいことばで参加」してね");
        }
        const room = await Room.create(store, code, profile, teamDiff);
        setSession({ store, room, isLocal: false });
        setError("");
      } catch (e) {
        setError(friendlyError(e));
      }
    },
    []
  );

  const joinRoom = useCallback(async (pw: string, profile: JoinProfile) => {
    try {
      const { FirebaseStore } = await import("./net/store");
      const store = new FirebaseStore();
      const code = sanitizeRoomCode(pw);
      const room = await Room.join(store, code, profile);
      setSession({ store, room, isLocal: false });
      setError("");
    } catch (e) {
      setError(friendlyError(e));
    }
  }, []);

  const spectateRoom = useCallback(async (pw: string) => {
    try {
      const { FirebaseStore } = await import("./net/store");
      const store = new FirebaseStore();
      const code = sanitizeRoomCode(pw);
      const room = await Room.spectate(store, code);
      setSession({ store, room, isLocal: false });
      setError("");
    } catch (e) {
      setError(friendlyError(e));
    }
  }, []);

  const leaveRoom = useCallback(() => {
    session?.room.leave();
    setSession(null);
  }, [session]);

  if (showRanking) {
    return <Ranking onBack={() => setShowRanking(false)} />;
  }

  if (!session) {
    return (
      <Title
        error={error}
        onSolo={startSolo}
        onCreate={createRoom}
        onJoin={joinRoom}
        onSpectate={spectateRoom}
        onRanking={() => setShowRanking(true)}
      />
    );
  }

  if (!state || !state.meta) {
    return <div className="screen center">よみこみ中…</div>;
  }

  const status = state.meta.status;
  const common = { session, state, onLeave: leaveRoom };

  if (status === "lobby") return <Lobby {...common} />;
  if (status === "battle") return <Battle {...common} />;
  if (status === "stageclear") return <StageClear {...common} />;
  return <Result {...common} />;
}
