# 伊豆・河口湖行程協作編輯工具

原本是純靜態網頁（`izu-kawaguchiko-itinerary.html` + `itinerary-data.json`，手動改 JSON + git commit 更新），正在改造成 4 位朋友共用一組密碼即可線上編輯行程的工具：Vue 3 + Vite + TypeScript 前端、Supabase（Postgres + RLS + Auth + Edge Functions）後端、GitHub Actions 自動部署到 GitHub Pages。

**目前進度**：Phase 0（Spike 驗證）、Phase 1（正式 schema + 密碼閘 + 唯讀行程展示 + 部署 + 保活）、Phase 2（天數/景點 CRUD + 排序 + 回收站，含 Phase 2b 天數管理重新設計）已完成並通過 build。**`supabase/migrations/0004_phase2b_day_management.sql` 尚待手動貼 Dashboard 執行**，執行前天數管理與行程頭部編輯功能會被 RLS 拒絕。Phase 3-5（圖片上傳、備案切換、Google Maps/路程估算）尚未開工。詳細時程與踩過的坑見 vault changelog（見下方文件地圖）。

## 文件地圖

| 要做的事 | 先讀哪份文件 |
|---|---|
| 了解系統全貌、資料流、找檔案 | `learning-vault/projects/izu-kawaguchiko-itinerary/architecture.md` |
| 了解密碼驗證/RLS 授權機制細節與取捨 | architecture.md「查閱區」+ `.../adr/006-密碼保護實作機制修正.md` |
| 了解資料庫 schema、備案、軟刪除設計 | `.../adr/003-資料庫schema與備案機制.md`、`.../adr/007-多旅遊支援.md` |
| 了解前端框架選型、部署與保活機制 | `.../adr/005-前端框架與部署.md` |
| 了解 Google Maps/路程估算選型（Phase 5 未實作） | `.../adr/004-路程時間估算與金鑰保護.md` |
| 想知道各 Phase 完成了什麼、遇到什麼 bug、怎麼修的 | `learning-vault/projects/izu-kawaguchiko-itinerary/changelog.md` |
| 想知道下一步該做 Phase 幾、驗收清單有哪些 | `C:\Users\Tito\.claude\plans\prancy-baking-trinket.md` |

## 歸檔紀律

完成一個 Phase 或功能後執行 `/wrap-up` 做增量歸檔（更新 changelog、architecture.md、必要時拆新的領域文件），不要用 `/init` 重新生成本檔。本檔超過 200 行時，把細節搬去 vault 對應文件，這裡只留索引與鐵律。

## 常用指令

前端（在 `frontend/` 目錄下執行，PowerShell）：
```
npm run dev      # 本機開發伺服器
npm run build    # vue-tsc 型別檢查 + vite build（build 前會先跑 prebuild 清 dist，見下方鐵律）
npm run preview  # 預覽 build 產物
```

Supabase：
- Migrations（`supabase/migrations/*.sql`）目前是**手動流程**：整份貼進 Supabase Dashboard → SQL Editor → Run，不是用 CLI `supabase db push`。
- Edge Function 部署：`supabase functions deploy verify-password`（需先 `supabase login` + `supabase link` 綁定專案）。
- 機密（`service_role` key、密碼雜湊/鹽）用 `supabase secrets set` 設定，只存在 Edge Function 環境變數。

## 架構速覽

```
frontend/                 Vue3+Vite+TS SPA，目前只有唯讀行程展示+密碼閘（Phase 2+ 會加編輯功能）
supabase/migrations/       SQL schema，手動貼 Dashboard SQL Editor 執行
supabase/functions/        Deno Edge Functions（verify-password：密碼驗證+登記編輯權限）
.github/workflows/         deploy.yml：push main 自動 build+部署到 GitHub Pages
izu-kawaguchiko-itinerary.html / itinerary-data.json
                            舊版純靜態頁與資料來源，已被 Vue 版取代上線，保留作歷史參考
```

## 鐵律

- **Windows node fs 崩潰地雷的專案內對策**：`frontend/vite.config.ts` 設 `build.emptyOutDir: false`，`package.json` 的 `prebuild` script 改用 `child_process.execSync` 呼叫 PowerShell（Windows）/`rm -rf`（其他平台）清 `dist/`。改動 build 流程時不要移除這個機制，也不要改回讓 Vite 自己清空 `dist`（會在本機原生崩潰，無錯誤訊息，見使用者全域 CLAUDE.md 的完整說明）。
- **共用密碼絕不能貼進對話**：要改密碼時，走「產生隨機 salt 給使用者 → 使用者本機用 PowerShell 算 `SHA-256(salt+password)` → 只把雜湊值回傳」的流程，密碼明文全程不進聊天記錄。Edge Function 端用 `SHARED_PASSWORD_HASH`/`SHARED_PASSWORD_SALT` 環境變數比對。
- **`service_role` key 絕不可交給或請求給 AI 助手**：只有 `anon`/`publishable` key 與 Project URL 適合在對話中分享，兩者皆為公開值（安全邊界在 RLS，不在藏 key）。
- **跨表授權檢查一律走 `SECURITY DEFINER` 函式，不要直接內嵌子查詢**：RLS policy 裡查其他表的子查詢不會自動繞過那張表自身的 RLS，Phase 0 已實測踩過這個坑（`trip_editors` 沒開 SELECT policy 時子查詢永遠查不到資料）。現行解法是 `is_trip_editor()` 函式，新增需要跨表授權判斷的邏輯比照辦理。
- **`CREATE POLICY` 不支援 `IF NOT EXISTS`**：可重入的 migration 要用 `drop policy if exists "..." on ...;` 接著 `create policy "..." on ...;`，不要寫 `create policy if not exists`（會是無效語法）。
- **呼叫 Supabase Edge Function 必須同時帶 `Authorization` 與 `apikey` 兩個 header**：只帶 `Authorization` 會被 Functions gateway 在抵達函式邏輯之前就用 401 擋掉（`apikey` 用 anon key）。
- **`.returns<T>()` 已淘汰**：`@supabase/postgrest-js` 現行寫法是 `.overrideTypes<T, { merge: false }>()`（`merge: false` = 完全取代推斷型別，等同舊版 `.returns` 的行為）。
- **PostgREST 的 `.update()` 無法表達「欄位自參照的算術更新」**（例如 `sort_order = sort_order + 1`、`coalesce(trashed_at, now())`），只能寫死常數值。需要這類更新時：批次算術位移用 `security invoker` 的 RPC 函式（見 `shift_days_sort_order`，仍受呼叫者既有 RLS 約束，不用額外開權限）；`coalesce` 語意可拆成兩段式 UPDATE 達成等價效果（不需要為此也開 RPC）。Phase 4 備案切換若也需要類似操作，比照辦理。

## 外部依賴前置條件

- Supabase 專案（URL/anon key 見 `frontend/.env.example`）需已啟用 **Anonymous Sign-in**（Dashboard → Authentication → Providers）。
- GitHub repo（`lgk559/izu-trip-planner`）Settings → Pages → Source 需設為「GitHub Actions」（切換設定本身不會自動套用之前的部署結果，需手動重跑一次 workflow）。
- cron-job.org 已設定每 2 天打 `GET /rest/v1/trips?select=id&limit=1`（帶 `apikey`），防 Supabase 免費版 7 天閒置自動暫停。

## 資料儲存位置

正式行程資料存在 Supabase Postgres（`trips`/`days`/`stops`/`images`/`trip_editors` 五表）。`itinerary-data.json` 是舊資料來源，已一次性匯入（`supabase/migrations/0002_seed_izu_trip.sql`），不再是 source of truth，之後不需要再手動編輯它來更新行程內容。
