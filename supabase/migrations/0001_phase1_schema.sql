-- ============================================================
-- Phase 1 Schema：trip_editors / trips / days / stops / images
-- 依 ADR 003（schema 與備案／軟刪除）＋ ADR 007（多旅遊 trips 頂層表）
-- ＋ ADR 006（is_trip_editor SECURITY DEFINER 授權判斷）
--
-- 執行方式：整份貼進 Supabase Dashboard → SQL Editor → Run
-- 注意：verify-password Edge Function 已存在，本檔不動它。
--       trip_editors 表在 Phase 0 spike 曾手動建過，此處用 if not exists
--       重新納入正式 migration，讓整份 schema 在全新環境可完整重現。
-- ============================================================

-- ---------- 0. 授權表（ADR 006）----------
-- 為什麼放在最前面：is_trip_editor() 函式（第 3 節）與四表 RLS 都依賴這張表，
-- 若不先建，函式定義會因 relation 不存在而失敗，整份 migration 掛掉。
create table if not exists public.trip_editors (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now()
);

alter table public.trip_editors enable row level security;

-- 不在 trip_editors 上開任何 SELECT policy：is_trip_editor() 是 SECURITY
-- DEFINER，以擁有者權限執行、完全繞過呼叫者 RLS，所以不需要靠 policy 讓
-- 子查詢查得到資料。保留一條開放的 SELECT policy 只會多開一個不必要的
-- 讀取口，故不建立（寫入永遠只有 service_role 能做）。

-- ---------- 1. 業務資料表 ----------

-- 頂層：一趟旅遊（ADR 007）
create table if not exists public.trips (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- 一天的行程
create table if not exists public.days (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  date_label text not null,           -- 例："10/8"
  weekday    text not null,           -- 例："四"
  route      text not null default '',
  meals      jsonb not null default '{}'::jsonb,   -- { breakfast, lunch, dinner }
  hotel      jsonb not null default '{}'::jsonb,   -- { name, address, url, note }
  sort_order integer not null default 0
);

-- 一天裡的一個景點／停靠點
create table if not exists public.stops (
  id         uuid primary key default gen_random_uuid(),
  day_id     uuid not null references public.days(id) on delete cascade,
  time       text not null default '',   -- 顯示用字串，例："約11:00"、"上午"
  name       text not null,
  tag        text not null default '',   -- 交通／下車參觀／入內參觀／住宿
  summary    text not null default '',
  detail     text not null default '',   -- 內含 HTML <a>，前端 v-html 渲染（ADR 003 前提）
  sort_order integer not null default 0,

  -- 備案機制一：同層替代方案（ADR 003）
  alternative_group_id uuid,                       -- 同組可互換的景點共用此 id
  is_primary           boolean not null default true,

  -- 備案機制二：軟刪除／回收站（ADR 003）
  status     text not null default 'active'
             check (status in ('active', 'trashed')),
  trashed_at timestamptz,

  -- 座標／地址（Phase 2 路程估算會用到，Phase 1 先建欄位）
  address text,
  lat     numeric,
  lng     numeric
);

-- 景點圖片
create table if not exists public.images (
  id         uuid primary key default gen_random_uuid(),
  stop_id    uuid not null references public.stops(id) on delete cascade,
  url        text not null,
  caption    text not null default '',
  sort_order integer not null default 0
);

-- ---------- 2. 索引 ----------

-- 查詢用：依父鍵撈子資料
create index if not exists idx_days_trip_id  on public.days(trip_id);
create index if not exists idx_stops_day_id  on public.stops(day_id);
create index if not exists idx_images_stop_id on public.images(stop_id);

-- 備案一致性保護（ADR 003）：同一備案群組內只允許一筆 is_primary = true
-- partial unique index：只對 is_primary = true 的列建唯一約束，
-- alternative_group_id 為 null（沒有備案的一般景點）不受此約束影響。
create unique index if not exists uniq_alt_group_primary
  on public.stops(alternative_group_id)
  where is_primary = true and alternative_group_id is not null;

-- ---------- 3. 授權判斷函式（ADR 006）----------

-- SECURITY DEFINER：以函式擁有者（postgres）權限執行內部查詢，
-- 因此查 trip_editors 時不受呼叫者自身的 RLS 限制，
-- 解決「RLS policy 子查詢查不到 trip_editors」的 Phase 0 陷阱。
create or replace function public.is_trip_editor()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trip_editors
    where user_id = auth.uid()
  );
$$;

-- 前端要能直接呼叫此函式來判斷「本瀏覽器是否已通過密碼驗證」
grant execute on function public.is_trip_editor() to authenticated, anon;

-- ---------- 4. RLS ----------

alter table public.trips  enable row level security;
alter table public.days   enable row level security;
alter table public.stops  enable row level security;
alter table public.images enable row level security;

-- Phase 1 只開放「已驗證者可讀」。寫入（insert/update/delete）policy 本階段不建立，
-- 預設拒絕，符合「Phase 1 唯讀、不做編輯」的範圍。
-- CREATE POLICY 不支援 IF NOT EXISTS，改用「先 drop if exists 再 create」達成可重入。
drop policy if exists "trips_select_editor" on public.trips;
create policy "trips_select_editor" on public.trips for select to authenticated using (public.is_trip_editor());

drop policy if exists "days_select_editor" on public.days;
create policy "days_select_editor" on public.days for select to authenticated using (public.is_trip_editor());

drop policy if exists "stops_select_editor" on public.stops;
create policy "stops_select_editor" on public.stops for select to authenticated using (public.is_trip_editor());

drop policy if exists "images_select_editor" on public.images;
create policy "images_select_editor" on public.images for select to authenticated using (public.is_trip_editor());
