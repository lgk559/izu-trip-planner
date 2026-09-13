-- ============================================================
-- Phase 2b 天數管理：
--   1. trips 新增 season_label（行程頭部季節標籤）
--   2. days 新增 is_holding（「特別天」旗標，永遠不顯示、承接被刪天的景點）
--   3. trips 新增 UPDATE policy（0003 未動 trips，需補上讓編輯者可改 name/season_label）
--   4. shift_days_sort_order RPC（批次算術位移天的 sort_order，用於新增/刪除天的重排）
--
-- 執行方式：整份貼進 Supabase Dashboard → SQL Editor → Run
--
-- 設計依據（見專案 CLAUDE.md 鐵律）：
--   - 跨表授權一律走 SECURITY DEFINER 函式 public.is_trip_editor()。
--   - CREATE POLICY 不支援 IF NOT EXISTS，改用「drop if exists 再 create」達成可重入。
--
-- 為什麼「特別天」不需要額外 RLS 規則：
--   is_holding 的保護（不顯示、不可刪改）完全靠前端查詢時 .eq('is_holding', false)
--   排除它來實現。它與一般 day 共用同一組 days 的 SELECT/UPDATE/INSERT/DELETE
--   policy（都由 is_trip_editor() 把關），資料庫層不區分特別天與一般天。
-- ============================================================

-- ---------- 1. 新增欄位（可重入：用 if not exists）----------

-- trips 季節標籤，例："2026年10月・秋"。預設空字串，既有列不需補資料也不會 null。
alter table public.trips
  add column if not exists season_label text not null default '';

-- days 特別天旗標。預設 false，既有的天全部視為一般天。
alter table public.days
  add column if not exists is_holding boolean not null default false;

-- ---------- 2. trips UPDATE policy ----------

-- 0003 完全沒動 trips，trips 目前只有 Phase 1 的 SELECT policy。
-- 編輯行程標題/季節標籤需要 UPDATE 權限，比照 days/stops 的可重入寫法。
drop policy if exists "trips_update_editor" on public.trips;
create policy "trips_update_editor" on public.trips
  for update to authenticated
  using (public.is_trip_editor())
  with check (public.is_trip_editor());

-- ---------- 3. 批次算術位移 sort_order 的 RPC ----------

-- 為什麼需要這個函式：
--   PostgREST（@supabase/postgrest-js）的 .update({ col: value }) 只能寫「常數值」，
--   無法表達「sort_order = sort_order + 1」這種引用欄位自身現值的算術更新。
--   新增天（插入中間要把後面的天 +1）、刪除天（遞補要把後面的天 -1）都需要它。
--
-- security invoker（預設值，明寫是為了強調）：以「呼叫者」權限執行，
--   因此仍受 days_update_editor policy 的 is_trip_editor() 把關——
--   非編輯者呼叫會被 RLS 擋在 UPDATE 之外，不需要額外授權判斷。
--   （對比 is_trip_editor() 本身必須 security definer，是因為它要繞過 trip_editors
--    自身的 RLS 去查授權；這個函式只是普通業務 UPDATE，沒有跨表授權需求。）
--
-- 用法：
--   - 插入中間：shift_days_sort_order(tripId, referenceSortOrder, 1)
--   - 刪除遞補：shift_days_sort_order(tripId, targetSortOrder + 1, -1)
create or replace function public.shift_days_sort_order(
  p_trip_id uuid,
  p_from integer,
  p_delta integer
)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.days
  set sort_order = sort_order + p_delta
  where trip_id = p_trip_id
    and is_holding = false
    and sort_order >= p_from;
$$;

-- 明確 grant：新函式的 execute 權限不保證包含 authenticated 角色，比照 is_trip_editor() 明授。
grant execute on function public.shift_days_sort_order(uuid, integer, integer) to authenticated;
