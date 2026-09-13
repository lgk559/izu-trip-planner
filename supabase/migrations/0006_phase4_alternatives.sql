-- ============================================================
-- Phase 4 備案切換：switch_primary_stop RPC
-- 依 ADR 003（備案機制：alternative_group_id + is_primary + partial unique index）
--
-- 執行方式：整份貼進 Supabase Dashboard → SQL Editor → Run
--
-- 為什麼需要這個 RPC（而不是前端連兩次 update）：
--   切換正式景點要同時做兩件事——把舊 primary 設 false、把新 primary 設 true。
--   0001 的 uniq_alt_group_primary 是「一般 partial unique index」（不是可 deferred
--   的 constraint），Postgres 對它「每更新一列就立刻檢查」，不是等整個陳述式跑完。
--
--   若寫成「同一個 UPDATE 用 CASE 一次翻轉兩筆」（set is_primary = (id = 新primary)），
--   Postgres 處理列的順序不保證「先舊（設 false）再新（設 true）」——一旦它先處理
--   「新的要設 true」那列，此刻舊的那列仍是 true，立即撞上 unique index 噴錯。
--
--   正確解法：拆成兩個獨立 UPDATE，依序執行：
--     ① 先把整組（除了新 primary）全設 false → 群組瞬間「沒有任何 primary」
--     ② 再把新 primary 設 true
--   兩者之間那個「沒有 primary」的瞬間是合法狀態：partial unique index 只限制
--   「最多一筆 true」，不要求「至少一筆」，所以不會撞限制。順序不可顛倒。
--
-- security invoker（比照 shift_days_sort_order）：以呼叫者權限執行，內部兩個 UPDATE
--   仍受 0003 的 stops_update_editor policy（is_trip_editor()）約束——非編輯者呼叫會被
--   RLS 過濾成影響 0 列，不需要在函式內額外做授權判斷。
--   （對比 is_trip_editor() 必須 security definer 是因為它要繞過 trip_editors 自身
--    的 RLS；這個函式只是普通業務 UPDATE，沒有跨表授權需求。）
-- ============================================================

create or replace function public.switch_primary_stop(
  p_group_id uuid,
  p_new_primary_id uuid
) returns void
language sql
security invoker
set search_path = public
as $$
  -- ① 先把整組（除了新 primary）設 false，讓群組瞬間沒有 primary
  update public.stops
  set is_primary = false
  where alternative_group_id = p_group_id
    and id <> p_new_primary_id;

  -- ② 再把新 primary 設 true（此時整組已無其他 primary，不會撞 unique index）
  update public.stops
  set is_primary = true
  where id = p_new_primary_id
    and alternative_group_id = p_group_id;
$$;

-- 明確 grant：新函式的 execute 權限不保證含 authenticated，比照 shift_days_sort_order 明授。
grant execute on function public.switch_primary_stop(uuid, uuid) to authenticated;
