-- ============================================================
-- Phase 5 修正：移除路程時間快取表 stop_travel_segments
--
-- 執行方式：整份貼進 Supabase Dashboard → SQL Editor → Run
--
-- 背景：Phase 5 原本用 Edge Function 代理 Google Routes API 估算大眾運輸
-- 路程時間、結果快取進 stop_travel_segments（見 0007）。實測發現 Google
-- Routes API 的 TRANSIT 模式在日本查無路線資料（DRIVE 正常、TRANSIT 一律
-- ROUTE_NOT_FOUND，且 geocoding 成功、地址無誤——確認是 Google 開發者 API
-- 在日本大眾運輸的產品層級限制，非程式問題）。改用純前端的 Google Maps
-- 路線規劃 URL 導連（消費者版網頁計算，transit 資料準確），不再需要
-- Edge Function 與這張快取表。
--
-- cascade：一併移除表上的 RLS policy 與索引（uniq_travel_segment /
-- idx_travel_segment_from / idx_travel_segment_to）。
-- ============================================================

drop table if exists public.stop_travel_segments cascade;
