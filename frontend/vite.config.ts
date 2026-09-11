import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // @ 指向 src，讓 import 路徑不受檔案層級影響
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // GitHub Pages 專案頁部署在 /<repo-name>/ 子路徑，資源路徑要對齊，否則 build 後 404
  base: '/izu-trip-planner/',
  build: {
    // 本機 Windows 的 node fs.rmSync 清空 dist 會原生崩潰（見專案 CLAUDE.md 地雷紀錄），
    // 關掉讓 Vite 內建的清空行為，改用 package.json 的 prebuild script 走 PowerShell 清
    emptyOutDir: false,
  },
})
