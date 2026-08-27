// ============================================================
// ストア抽象化レイヤ
//   FirebaseStore: RTDB（マルチプレイ）
//   LocalStore:    メモリ上（ひとりで特訓 / ルール未適用でも動く）
// ゲームロジックはこのインターフェースだけに依存する
// ============================================================

export type Unsubscribe = () => void;

/**
 * 結果を待たない書き込み用。失敗しても画面は止めず、原因が分かる形でログに残す。
 * （通信断・ルール違反を Uncaught (in promise) の不明なエラーにしないため）
 */
export function fireAndForget(label: string, p: Promise<unknown>): void {
  p.catch((e) => {
    console.warn(`[TYPE HEROES] 書き込み失敗: ${label}`, e);
  });
}

export interface Store {
  read(path: string): Promise<unknown>;
  write(path: string, value: unknown): Promise<void>;
  update(path: string, partial: Record<string, unknown>): Promise<void>;
  push(path: string, value: unknown): Promise<string>;
  transaction(path: string, fn: (cur: unknown) => unknown): Promise<void>;
  subscribe(path: string, cb: (value: unknown) => void): Unsubscribe;
  onDisconnectRemove(path: string): void;
  remove(path: string): Promise<void>;
}

// ------------------------------------------------------------
// LocalStore
// ------------------------------------------------------------
export class LocalStore implements Store {
  private root: Record<string, unknown> = {};
  private subs = new Map<number, { path: string; cb: (v: unknown) => void }>();
  private seq = 0;
  private pushSeq = 0;

  private get(path: string): unknown {
    const parts = path.split("/").filter(Boolean);
    let cur: unknown = this.root;
    for (const p of parts) {
      if (cur == null || typeof cur !== "object") return null;
      cur = (cur as Record<string, unknown>)[p];
    }
    return cur === undefined ? null : cur;
  }

  private set(path: string, value: unknown) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) {
      this.root = (value as Record<string, unknown>) ?? {};
      this.notify();
      return;
    }
    let cur = this.root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (cur[p] == null || typeof cur[p] !== "object") cur[p] = {};
      cur = cur[p] as Record<string, unknown>;
    }
    const last = parts[parts.length - 1];
    if (value === null || value === undefined) delete cur[last];
    else cur[last] = value;
    this.notify();
  }

  private notify() {
    // 小規模なので全購読者に再配信（値はディープコピーで純粋性を保つ）
    for (const { path, cb } of this.subs.values()) {
      const v = this.get(path);
      cb(v == null ? null : JSON.parse(JSON.stringify(v)));
    }
  }

  async read(path: string) {
    const v = this.get(path);
    return v == null ? null : JSON.parse(JSON.stringify(v));
  }
  async write(path: string, value: unknown) {
    this.set(path, value == null ? null : JSON.parse(JSON.stringify(value)));
  }
  async update(path: string, partial: Record<string, unknown>) {
    for (const [k, v] of Object.entries(partial)) {
      this.set(`${path}/${k}`, v == null ? null : JSON.parse(JSON.stringify(v)));
    }
  }
  async push(path: string, value: unknown) {
    const key = `k${Date.now()}_${this.pushSeq++}`;
    this.set(`${path}/${key}`, JSON.parse(JSON.stringify(value)));
    return key;
  }
  async transaction(path: string, fn: (cur: unknown) => unknown) {
    const next = fn(await this.read(path));
    if (next !== undefined) this.set(path, next);
  }
  subscribe(path: string, cb: (value: unknown) => void): Unsubscribe {
    const id = this.seq++;
    this.subs.set(id, { path, cb });
    // 初回即時配信（RTDB onValue と同じ挙動）
    Promise.resolve().then(() => {
      if (this.subs.has(id)) cb(this.get(path));
    });
    return () => this.subs.delete(id);
  }
  onDisconnectRemove(_path: string) {
    // ローカルでは不要
  }
  async remove(path: string) {
    this.set(path, null);
  }
}

// ------------------------------------------------------------
// FirebaseStore
// ------------------------------------------------------------
import { db } from "../firebase";
import {
  ref,
  get,
  set,
  update as fbUpdate,
  push as fbPush,
  remove as fbRemove,
  onValue,
  runTransaction,
  onDisconnect,
} from "firebase/database";

export class FirebaseStore implements Store {
  async read(path: string) {
    const snap = await get(ref(db, path));
    return snap.val();
  }
  async write(path: string, value: unknown) {
    await set(ref(db, path), value ?? null);
  }
  async update(path: string, partial: Record<string, unknown>) {
    await fbUpdate(ref(db, path), partial);
  }
  async push(path: string, value: unknown) {
    const r = await fbPush(ref(db, path), value);
    return r.key ?? "";
  }
  async transaction(path: string, fn: (cur: unknown) => unknown) {
    await runTransaction(ref(db, path), fn as (cur: any) => any);
  }
  subscribe(path: string, cb: (value: unknown) => void): Unsubscribe {
    return onValue(ref(db, path), (snap) => cb(snap.val()));
  }
  onDisconnectRemove(path: string) {
    onDisconnect(ref(db, path)).remove();
  }
  async remove(path: string) {
    await fbRemove(ref(db, path));
  }
}
