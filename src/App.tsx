import { useCallback, useEffect, useState } from "react";
import type { Store } from "./net/store";
import { LocalStore } from "./net/store";
import { Room, sanitizeRoomCode } from "./game/room";
import type { JoinProfile } from "./game/room";
import type { TeamDifficulty } from "./game/data";
import type { GameMode } from "./game/types";
import { useRoom } from "./hooks/useRoom";
import { Title } from "./screens/Title";
import { Lobby } from "./screens/Lobby";
import { Battle } from "./screens/Battle";
import { StageClear } from "./screens/StageClear";
import { Result } from "./screens/Result";
import { Ranking } from "./screens/Ranking";
import { Tutorial } from "./screens/Tutorial";
import { Legal } from "./screens/Legal";
import { trackPlayStart, trackScreen } from "./analytics";

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
  const [showTutorial, setShowTutorial] = useState(false);
  const [showLegal, setShowLegal] = useState(false);
  const [error, setError] = useState("");
  const state = useRoom(session?.room ?? null);

  const startSolo = useCallback(
    async (profile: JoinProfile, teamDiff: TeamDifficulty, mode: GameMode) => {
      const store = new LocalStore();
      if (import.meta.env.DEV) {
        // 開発時の確認用: コンソールから await __thStore.read("typing/...") で中身を見られる
        (window as unknown as { __thStore?: Store }).__thStore = store;
      }
      const room = await Room.create(store, "solo", profile, teamDiff, mode);
      trackPlayStart("solo");
      setSession({ store, room, isLocal: true });
    },
    []
  );

  const createRoom = useCallback(
    async (pw: string, profile: JoinProfile, teamDiff: TeamDifficulty, mode: GameMode) => {
      try {
        const { FirebaseStore } = await import("./net/store");
        const store = new FirebaseStore();
        const code = sanitizeRoomCode(pw);
        if (code.length < 3) throw new Error("あいことばは3文字以上にしてね");
        // 「使用中」＝いまも遊んでいる人がいる部屋だけ。
        // 全滅・クリア後に全員がタイトルへ戻った部屋は同じあいことばで作り直せる
        if (await Room.hasLivePlayers(store, code)) {
          throw new Error("そのあいことばは使用中！べつのあいことばにするか「あいことばで参加」してね");
        }
        const room = await Room.create(store, code, profile, teamDiff, mode);
        trackPlayStart("create");
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
      trackPlayStart("join");
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
      trackPlayStart("spectate");
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

  // 画面名（URL が変わらないSPAなので、切り替わるたびに自前で計測する）
  const screen = showTutorial
    ? "tutorial"
    : showRanking
      ? "ranking"
      : showLegal
        ? "legal"
        : !session
          ? "title"
          : (state?.meta?.status ?? "loading");
  useEffect(() => {
    if (screen !== "loading") trackScreen(screen);
  }, [screen]);

  if (showTutorial) {
    return <Tutorial onExit={() => setShowTutorial(false)} />;
  }

  if (showRanking) {
    return <Ranking onBack={() => setShowRanking(false)} />;
  }

  if (showLegal) {
    return <Legal onBack={() => setShowLegal(false)} />;
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
        onTutorial={() => setShowTutorial(true)}
        onLegal={() => setShowLegal(true)}
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
