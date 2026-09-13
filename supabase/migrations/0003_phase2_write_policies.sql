-- ============================================================
-- Phase 2 寫入權限：days / stops 的 INSERT / UPDATE / DELETE policy
-- 依 Phase 2 規格：開放核心編輯功能（天數/景點增刪改、排序、軟刪除）
--
-- 執行方式：整份貼進 Supabase Dashboard → SQL Editor → Run
--
-- 設計依據（見專案 CLAUDE.md 鐵律）：
--   1. 跨表授權一律走 SECURITY DEFINER 函式 public.is_trip_editor()，
--      不在 policy 內直接內嵌 trip_editors 子查詢（Phase 0 踩過的坑）。
--   2. CREATE POLICY 不支援 IF NOT EXISTS，改用「drop if exists 再 create」
--      達成可重入。
--
-- 範圍：只動 days 與 stops。
--   - trips：本階段不開放增刪（只有一趟旅遊，ADR 007 YAGNI）。
--   - images：Phase 3 才處理，這裡不動。
--   - trip_editors：授權表永遠只有 service_role 能寫，維持現狀。
-- ============================================================

-- ---------- days：INSERT / UPDATE / DELETE ----------

-- INSERT：新增一天。需要 with check 驗證寫入的列符合條件。
drop policy if exists "days_insert_editor" on public.days;
create policy "days_insert_editor" on public.days
  for insert to authenticated
  with check (public.is_trip_editor());

-- UPDATE：編輯當天資訊（route/meals/hotel）。
-- using 管「能不能改到這一列」，with check 管「改完後的列是否合法」，兩者都要。
drop policy if exists "days_update_editor" on public.days;
create policy "days_update_editor" on public.days
  for update to authenticated
  using (public.is_trip_editor())
  with check (public.is_trip_editor());

-- DELETE：刪除一天（FK cascade 會連帶清掉底下 stops/images）。
drop policy if exists "days_delete_editor" on public.days;
create policy "days_delete_editor" on public.days
  for delete to authenticated
  using (public.is_trip_editor());

-- ---------- stops：INSERT / UPDATE / DELETE ----------

-- INSERT：新增景點。
drop policy if exists "stops_insert_editor" on public.stops;
create policy "stops_insert_editor" on public.stops
  for insert to authenticated
  with check (public.is_trip_editor());

-- UPDATE：編輯文字欄位、軟刪除（status→trashed）、復原、排序（改 sort_order）都走 UPDATE。
drop policy if exists "stops_update_editor" on public.stops;
create policy "stops_update_editor" on public.stops
  for update to authenticated
  using (public.is_trip_editor())
  with check (public.is_trip_editor());

-- DELETE：回收站的永久刪除。
drop policy if exists "stops_delete_editor" on public.stops;
create policy "stops_delete_editor" on public.stops
  for delete to authenticated
  using (public.is_trip_editor());
