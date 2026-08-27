// ===== Firebase 初期化（Realtime Database のみ）=====================
// プロジェクト: triple-slot-ranking（TWINKLE DROP RUSH ランキングと共用・Spark無料プラン）
// ※ apiKey はクライアント公開前提の識別子で「秘密鍵」ではない。
//   アクセス制御は RTDB ルール側で行う（docs/rtdb-rules.json 参照）。
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCdEggx3PB8Wbc9u2bPYhdvysh5Peum3y4",
  authDomain: "triple-slot-ranking.firebaseapp.com",
  databaseURL:
    "https://triple-slot-ranking-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "triple-slot-ranking",
  storageBucket: "triple-slot-ranking.firebasestorage.app",
  messagingSenderId: "985881004531",
  appId: "1:985881004531:web:ef9d5660d59927f48eaa86",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const db = getDatabase(firebaseApp);

/** このゲームが使う RTDB ルートパス */
export const ROOT = "typing";
