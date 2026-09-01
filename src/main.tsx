import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// 万一どこかの画面が例外で落ちても、真っ黒画面ではなく
// エラー内容と「タイトルにもどる」を出す（原因調査もできるように）
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("画面クラッシュ:", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="screen center">
          <h1>💥 エラーが発生しました</h1>
          <div className="error-box" style={{ maxWidth: 640, wordBreak: "break-all" }}>
            {String(this.state.error)}
          </div>
          <button className="btn primary big" onClick={() => window.location.reload()}>
            タイトルに もどる
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
