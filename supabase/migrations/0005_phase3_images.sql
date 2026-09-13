-- ============================================================
-- Phase 3 圖片上傳：
--   1. 私有 Storage bucket：trip-images
--   2. storage.objects 的 RLS policy（select/insert/delete，限本 bucket + 編輯者）
--   3. images 表新增 storage_path 欄位（新上傳圖片存 Storage 路徑，
--      舊種子圖片此欄位為 null、維持用 images.url 的外部完整網址顯示）
--   4. public.images 表的寫入 RLS policy（insert/update/delete）
--      —— 0001 只建了 SELECT、0003 明確跳過 images，寫入權限至今不存在，
--         這裡補齊，否則 uploadImage / updateImageCaption / deleteImage 全被 RLS 擋。
--
-- 執行方式：整份貼進 Supabase Dashboard → SQL Editor → Run
--
-- 設計依據（見專案 CLAUDE.md 鐵律）：
--   - 跨表授權一律走 SECURITY DEFINER 函式 public.is_trip_editor()，
--     不在 policy 內內嵌 trip_editors 子查詢（Phase 0 踩過的坑）。
--   - CREATE POLICY 不支援 IF NOT EXISTS，改用「drop if exists 再 create」達成可重入。
--
-- 為什麼 images.url 語意不能改成「一律 Storage 路徑」：
--   0002_seed_izu_trip.sql 匯入的舊圖片，url 存的是外部網站完整網址（jreast.co.jp 等），
--   不是 Storage 路徑。若改語意舊圖片全部失效。故新增 storage_path（nullable）：
--   有值 = 新上傳圖片（前端用它換 signed URL 顯示）；null = 舊圖片（直接用 url 顯示）。
-- ============================================================

-- ---------- 1. 私有 bucket ----------

-- public=false：私有 bucket，物件不可匿名直連，顯示一律靠 createSignedUrl 簽章。
-- on conflict do nothing：可重入，重跑不報錯。
insert into storage.buckets (id, name, public)
values ('trip-images', 'trip-images', false)
on conflict (id) do nothing;

-- ---------- 2. storage.objects 的 RLS policy ----------

-- storage.objects 是 Supabase 內建表，RLS 已由內建機制啟用，這裡只需建 policy。
-- 三條 policy 一律限定 bucket_id = 'trip-images' 且 public.is_trip_editor()、to authenticated：
--   - 非本 bucket 的物件不受這些 policy 影響（其他 bucket 各自的 policy 管）。
--   - 授權判斷走 is_trip_editor()（SECURITY DEFINER），不在此內嵌 trip_editors 子查詢。
-- 不建 UPDATE policy：圖片改動只有「改 caption」（動 images 表，不動 Storage 物件）
--   與「刪除重傳」，物件本身不做 in-place 覆寫，故 Storage 層不需要 UPDATE。

drop policy if exists "trip_images_select_editor" on storage.objects;
create policy "trip_images_select_editor" on storage.objects
  for select to authenticated
  using (bucket_id = 'trip-images' and public.is_trip_editor());

drop policy if exists "trip_images_insert_editor" on storage.objects;
create policy "trip_images_insert_editor" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'trip-images' and public.is_trip_editor());

drop policy if exists "trip_images_delete_editor" on storage.objects;
create policy "trip_images_delete_editor" on storage.objects
  for delete to authenticated
  using (bucket_id = 'trip-images' and public.is_trip_editor());

-- ---------- 3. images 表新增 storage_path ----------

-- nullable：舊種子圖片維持 null（用 url 顯示），新上傳圖片填 Storage 內的物件路徑。
alter table public.images
  add column if not exists storage_path text;

-- ---------- 4. public.images 表的寫入 RLS policy ----------

-- 0001_phase1_schema.sql 對 images 已 enable row level security，但只建了 SELECT
-- （images_select_editor）；0003 第 15 行明確寫「images：Phase 3 才處理，這裡不動」。
-- 因此 images 的 INSERT/UPDATE/DELETE 至今無 policy = RLS 預設拒絕。
-- Phase 3 的三個圖片寫入操作都要靠這裡補齊，否則：
--   - uploadImage 的 insert 被擋
--   - updateImageCaption 的 update 被擋
--   - deleteImage 會「先刪 Storage 物件成功、再刪 DB 記錄時被擋」，必然留下孤兒物件
-- 比照 0003 對 stops/days 的既有寫法：走 is_trip_editor()、drop if exists 再 create、
-- to authenticated；update 的 using 與 with check 兩者都要（能改到哪列 + 改完是否合法）。

-- INSERT：新增一列圖片（uploadImage）。
drop policy if exists "images_insert_editor" on public.images;
create policy "images_insert_editor" on public.images
  for insert to authenticated
  with check (public.is_trip_editor());

-- UPDATE：編輯 caption（updateImageCaption）。
drop policy if exists "images_update_editor" on public.images;
create policy "images_update_editor" on public.images
  for update to authenticated
  using (public.is_trip_editor())
  with check (public.is_trip_editor());

-- DELETE：刪除圖片列（deleteImage 的第二步，先刪 Storage 物件後才刪這列）。
drop policy if exists "images_delete_editor" on public.images;
create policy "images_delete_editor" on public.images
  for delete to authenticated
  using (public.is_trip_editor());
