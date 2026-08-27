// ============================================================
// ローマ字タイピング判定エンジン
// かな文字列 → 入力候補（複数パターン）を並列ステートで受理する
//   例: 「し」= si / shi / ci, 「っか」= kka / xtuka / ltuka,
//       「ん」= nn / xn / n(次が子音のときのみ)
// ============================================================

// ---- 基本かなテーブル（先頭が「推奨表記」= 画面表示に使う） ----
const KANA: Record<string, string[]> = {
  あ: ["a"], い: ["i", "yi"], う: ["u", "wu", "whu"], え: ["e"], お: ["o"],
  か: ["ka", "ca"], き: ["ki"], く: ["ku", "cu", "qu"], け: ["ke"], こ: ["ko", "co"],
  さ: ["sa"], し: ["si", "shi", "ci"], す: ["su"], せ: ["se", "ce"], そ: ["so"],
  た: ["ta"], ち: ["ti", "chi"], つ: ["tu", "tsu"], て: ["te"], と: ["to"],
  な: ["na"], に: ["ni"], ぬ: ["nu"], ね: ["ne"], の: ["no"],
  は: ["ha"], ひ: ["hi"], ふ: ["fu", "hu"], へ: ["he"], ほ: ["ho"],
  ま: ["ma"], み: ["mi"], む: ["mu"], め: ["me"], も: ["mo"],
  や: ["ya"], ゆ: ["yu"], よ: ["yo"],
  ら: ["ra"], り: ["ri"], る: ["ru"], れ: ["re"], ろ: ["ro"],
  わ: ["wa"], を: ["wo"], ん: ["nn", "xn"],
  が: ["ga"], ぎ: ["gi"], ぐ: ["gu"], げ: ["ge"], ご: ["go"],
  ざ: ["za"], じ: ["zi", "ji"], ず: ["zu"], ぜ: ["ze"], ぞ: ["zo"],
  だ: ["da"], ぢ: ["di"], づ: ["du"], で: ["de"], ど: ["do"],
  ば: ["ba"], び: ["bi"], ぶ: ["bu"], べ: ["be"], ぼ: ["bo"],
  ぱ: ["pa"], ぴ: ["pi"], ぷ: ["pu"], ぺ: ["pe"], ぽ: ["po"],
  ぁ: ["xa", "la"], ぃ: ["xi", "li"], ぅ: ["xu", "lu"], ぇ: ["xe", "le"], ぉ: ["xo", "lo"],
  ゃ: ["xya", "lya"], ゅ: ["xyu", "lyu"], ょ: ["xyo", "lyo"],
  っ: ["xtu", "ltu", "ltsu"],
  ゔ: ["vu"],
  ー: ["-"],
  "、": [","], "。": ["."], "！": ["!"], "？": ["?"], "・": ["/"],
  " ": [" "], "　": [" "],
};

// ---- 拗音（2文字）テーブル ----
const YOON: Record<string, string[]> = {
  きゃ: ["kya"], きぃ: ["kyi"], きゅ: ["kyu"], きぇ: ["kye"], きょ: ["kyo"],
  しゃ: ["sya", "sha"], しぃ: ["syi"], しゅ: ["syu", "shu"], しぇ: ["sye", "she"], しょ: ["syo", "sho"],
  ちゃ: ["tya", "cha", "cya"], ちぃ: ["tyi"], ちゅ: ["tyu", "chu", "cyu"], ちぇ: ["tye", "che", "cye"], ちょ: ["tyo", "cho", "cyo"],
  にゃ: ["nya"], にゅ: ["nyu"], にょ: ["nyo"],
  ひゃ: ["hya"], ひゅ: ["hyu"], ひょ: ["hyo"],
  みゃ: ["mya"], みゅ: ["myu"], みょ: ["myo"],
  りゃ: ["rya"], りゅ: ["ryu"], りょ: ["ryo"],
  ぎゃ: ["gya"], ぎゅ: ["gyu"], ぎょ: ["gyo"],
  じゃ: ["zya", "ja", "jya"], じゅ: ["zyu", "ju", "jyu"], じぇ: ["zye", "je", "jye"], じょ: ["zyo", "jo", "jyo"],
  ぢゃ: ["dya"], ぢゅ: ["dyu"], ぢょ: ["dyo"],
  びゃ: ["bya"], びゅ: ["byu"], びょ: ["byo"],
  ぴゃ: ["pya"], ぴゅ: ["pyu"], ぴょ: ["pyo"],
  ふぁ: ["fa"], ふぃ: ["fi"], ふぇ: ["fe"], ふぉ: ["fo"],
  うぁ: ["wha"], うぃ: ["wi", "whi"], うぇ: ["we", "whe"], うぉ: ["who"],
  ゔぁ: ["va"], ゔぃ: ["vi"], ゔぇ: ["ve"], ゔぉ: ["vo"],
  てぃ: ["thi"], てゅ: ["thu"], でぃ: ["dhi"], でゅ: ["dhu"],
  とぅ: ["twu"], どぅ: ["dwu"],
  しゅう: [], // ダミー禁止(未使用)
};

const VOWELS = new Set(["a", "i", "u", "e", "o"]);
const SMALL = new Set(["ゃ", "ゅ", "ょ", "ぁ", "ぃ", "ぅ", "ぇ", "ぉ"]);

/** カタカナ→ひらがな変換（word DB はひらがな前提だが保険で用意） */
export function kataToHira(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60)
  );
}

/** ひらがな→カタカナ変換（ボスの「カタカナ化」ギミック表示用） */
export function hiraToKata(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) + 0x60)
  );
}

interface Token {
  kana: string;
  alts: string[]; // 受理できるローマ字候補
  isN?: boolean; // 「ん」トークン（単独 n の特別処理用）
}

/** かな文字列をトークン列に分解する */
function tokenize(kanaRaw: string): Token[] {
  const kana = kataToHira(kanaRaw);
  const tokens: Token[] = [];
  let i = 0;
  while (i < kana.length) {
    const two = kana.slice(i, i + 2);
    const one = kana[i];

    // 促音「っ」: 次のトークンと結合して [子音重ね | xtu+次] を候補にする
    if (one === "っ" && i + 1 < kana.length) {
      const rest = tokenize(kana.slice(i + 1));
      if (rest.length > 0) {
        const next = rest[0];
        const alts: string[] = [];
        for (const a of next.alts) {
          const c = a[0];
          if (c && !VOWELS.has(c) && c !== "n" && /[a-z]/.test(c)) {
            alts.push(c + a); // kka, ssi, sshi ...
          }
        }
        for (const x of KANA["っ"]) for (const a of next.alts) alts.push(x + a);
        tokens.push({ kana: "っ" + next.kana, alts });
        return tokens.concat(rest.slice(1));
      }
    }
    // 文末の「っ」単独
    if (one === "っ") {
      tokens.push({ kana: "っ", alts: KANA["っ"] });
      i += 1;
      continue;
    }

    // 拗音（2文字）
    if (two.length === 2 && SMALL.has(two[1])) {
      const yoon = YOON[two];
      const base = KANA[two[0]];
      const smallAlts = KANA[two[1]];
      const alts: string[] = [];
      if (yoon && yoon.length > 0) alts.push(...yoon);
      // 分解入力（si + xya など）も常に受理
      if (base && smallAlts) {
        for (const b of base) for (const s of smallAlts) alts.push(b + s);
      }
      if (alts.length > 0) {
        tokens.push({ kana: two, alts });
        i += 2;
        continue;
      }
    }

    // 「ん」
    if (one === "ん") {
      tokens.push({ kana: "ん", alts: ["nn", "xn"], isN: true });
      i += 1;
      continue;
    }

    const alts = KANA[one];
    if (alts) {
      tokens.push({ kana: one, alts });
    } else {
      // テーブル外の文字（英数字等）はそのまま1打鍵として扱う
      tokens.push({ kana: one, alts: [one.toLowerCase()] });
    }
    i += 1;
  }
  return tokens;
}

/** 「ん」を単独 n で入力できるか（次トークンの候補で判定） */
function nSingleOk(next: Token | undefined): boolean {
  if (!next) return false;
  return next.alts.some((a) => {
    const c = a[0];
    return c && /[a-z]/.test(c) && !VOWELS.has(c) && c !== "n" && c !== "y";
  });
}

interface ParseState {
  tokenIdx: number;
  altIdx: number;
  pos: number; // alt 内の何文字目まで入力済みか
  viaSingleN?: boolean; // 直前の「ん」を単独 n で確定したか（次トークン先頭子音制約）
}

export class TypingWord {
  readonly kana: string;
  readonly display: string;
  private tokens: Token[];
  private states: ParseState[];
  typedCount = 0; // 正しい打鍵数
  missCount = 0;
  finished = false;

  constructor(display: string, kana: string) {
    this.display = display;
    this.kana = kataToHira(kana);
    this.tokens = tokenize(kana);
    this.states = this.startStates(0, false);
  }

  private startStates(tokenIdx: number, afterSingleN: boolean): ParseState[] {
    const t = this.tokens[tokenIdx];
    if (!t) return [];
    const states: ParseState[] = [];
    for (let a = 0; a < t.alts.length; a++) {
      if (afterSingleN) {
        const c = t.alts[a][0];
        if (!c || VOWELS.has(c) || c === "n" || c === "y") continue;
      }
      states.push({ tokenIdx, altIdx: a, pos: 0 });
    }
    return states;
  }

  /** 1打鍵を処理。true=正解, false=ミス */
  input(ch: string): boolean {
    if (this.finished) return false;
    const c = ch.toLowerCase();
    const nextStates: ParseState[] = [];

    for (const s of this.states) {
      const t = this.tokens[s.tokenIdx];
      const alt = t.alts[s.altIdx];

      // 「ん」トークンで pos=0 のとき、単独 n による短縮確定も候補に入れる
      if (t.isN && s.pos === 0 && c === "n") {
        // nn / xn の1文字目として進める
        if (alt[0] === "n") nextStates.push({ ...s, pos: 1 });
        // 単独 n 確定 → 次トークンへ（子音制約付き）
        if (nSingleOk(this.tokens[s.tokenIdx + 1])) {
          for (const ns of this.startStates(s.tokenIdx + 1, true)) {
            nextStates.push(ns);
          }
        }
        continue;
      }

      if (alt[s.pos] === c) {
        const pos = s.pos + 1;
        if (pos >= alt.length) {
          // トークン完了 → 次トークンの開始ステートを展開
          const nexts = this.startStates(s.tokenIdx + 1, false);
          if (nexts.length === 0 && s.tokenIdx + 1 >= this.tokens.length) {
            // 単語完了
            this.typedCount++;
            this.finished = true;
            this.states = [];
            return true;
          }
          nextStates.push(...nexts);
        } else {
          nextStates.push({ ...s, pos });
        }
      }
    }

    if (nextStates.length === 0) {
      this.missCount++;
      return false;
    }
    // 重複除去
    const seen = new Set<string>();
    this.states = nextStates.filter((s) => {
      const k = `${s.tokenIdx}:${s.altIdx}:${s.pos}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    this.typedCount++;
    return true;
  }

  /** 表示用: [入力済みローマ字, 残りローマ字] */
  romajiParts(): [string, string] {
    if (this.finished) return [this.fullRomaji(), ""];
    // 最良ステート（先頭候補優先）で残りを構成
    const s = this.best();
    if (!s) return ["", this.fullRomaji()];
    const t = this.tokens[s.tokenIdx];
    let remaining = t.alts[s.altIdx].slice(s.pos);
    for (let i = s.tokenIdx + 1; i < this.tokens.length; i++) {
      remaining += this.tokens[i].alts[0];
    }
    // 入力済み = 全体推奨表記から残りを引いた形にすると表記ゆれで崩れるので、
    // 「入力済み文字数」と「これから打つ文字列」を別々に返す
    const typed = this.typedRomaji(s);
    return [typed, remaining];
  }

  private best(): ParseState | undefined {
    if (this.states.length === 0) return undefined;
    return [...this.states].sort(
      (a, b) => b.tokenIdx - a.tokenIdx || a.altIdx - b.altIdx || b.pos - a.pos
    )[0];
  }

  private typedRomaji(s: ParseState): string {
    let out = "";
    for (let i = 0; i < s.tokenIdx; i++) out += this.tokens[i].alts[0];
    out += this.tokens[s.tokenIdx].alts[s.altIdx].slice(0, s.pos);
    return out;
  }

  fullRomaji(): string {
    return this.tokens.map((t) => t.alts[0]).join("");
  }

  /** 残り打鍵数の目安（進捗バー用） */
  progress(): number {
    const total = this.fullRomaji().length;
    if (this.finished) return 1;
    const [, rest] = this.romajiParts();
    return Math.max(0, Math.min(1, 1 - rest.length / Math.max(1, total)));
  }
}
