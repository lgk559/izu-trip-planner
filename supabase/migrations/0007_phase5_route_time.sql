-- ============================================================
-- Phase 5 路程時間估算：stop_travel_segments 快取表
-- 依 ADR 004（Google Routes API Compute Route Matrix，透過 Edge Function 代理）
--
-- 執行方式：整份貼進 Supabase Dashboard → SQL Editor → Run
--
-- 這張表快取「兩個景點之間、某個 travel_mode 下」的路程結果，避免重複打
-- Google API。寫入由前端在使用者的 RLS 權限下直接做（Edge Function 只負責
-- 呼叫 Google API 拿資料，不碰資料庫），跟其他表的寫入模式一致。
--
-- 設計依據（見專案 CLAUDE.md 鐵律）：
--   1. 跨表授權一律走 SECURITY DEFINER 函式 public.is_trip_editor()。
--   2. CREATE POLICY 不支援 IF NOT EXISTS，改用「drop if exists 再 create」。
-- ============================================================

create table if not exists public.stop_travel_segments (
  id               uuid primary key default gen_random_uuid(),
  from_stop_id     uuid not null references public.stops(id) on delete cascade,
  to_stop_id       uuid not null references public.stops(id) on delete cascade,
  -- 本階段只會用 'TRANSIT'，但欄位設計成可容納未來其他 travel_mode。
  travel_mode      text not null,
  duration_seconds integer,
  duration_text    text,   -- 人類可讀，例："25 分鐘"、"1 小時 5 分鐘"
  distance_text    text,   -- 人類可讀，例："3.2 公里"、"800 公尺"
  computed_at      timestamptz not null default now()
);

-- upsert 靠這個唯一約束做 insert-or-update（onConflict: from_stop_id,to_stop_id,travel_mode）
create unique index if not exists uniq_travel_segment
  on public.stop_travel_segments(from_stop_id, to_stop_id, travel_mode);

-- 讀取快取時常以 from_stop_id 縮小範圍（loadCachedTravelTimes 用 .in('from_stop_id', ...)）
create index if not exists idx_travel_segment_from on public.stop_travel_segments(from_stop_id);

-- updateStop 清快取時用 to_stop_id.eq 那半段查詢的對應索引（與 from 對稱）
create index if not exists idx_travel_segment_to on public.stop_travel_segments(to_stop_id);

-- ---------- RLS（比照 0003 既有寫法）----------

alter table public.stop_travel_segments enable row level security;

drop policy if exists "travel_segments_select_editor" on public.stop_travel_segments;
create policy "travel_segments_select_editor" on public.stop_travel_segments
  for select to authenticated
  using (public.is_trip_editor());

drop policy if exists "travel_segments_insert_editor" on public.stop_travel_segments;
create policy "travel_segments_insert_editor" on public.stop_travel_segments
  for insert to authenticated
  with check (public.is_trip_editor());

drop policy if exists "travel_segments_update_editor" on public.stop_travel_segments;
create policy "travel_segments_update_editor" on public.stop_travel_segments
  for update to authenticated
  using (public.is_trip_editor())
  with check (public.is_trip_editor());

drop policy if exists "travel_segments_delete_editor" on public.stop_travel_segments;
create policy "travel_segments_delete_editor" on public.stop_travel_segments
  for delete to authenticated
  using (public.is_trip_editor());
