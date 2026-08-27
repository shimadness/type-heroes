import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages 配信を想定して相対パスでビルドする
export default defineConfig({
  base: "./",
  plugins: [react()],
});
