// ============================================================
// compute-route-matrix Edge Function（Phase 5，依 ADR 004）
// 職責：驗證身分 + 編輯權限後，呼叫 Google Routes API 的
//       Compute Route Matrix，回傳相鄰配對的路程時間。
//       本函式完全不碰資料庫——快取寫入由前端在自己的 RLS 權限下做。
//
// 安全重點：任何持有 anon key 的人都能打到這個 URL，若不檢查權限等於
//   任何人都能免費消耗 Google API 額度。做法比照 verify-password：
//   ① 用 anon client + JWT 驗身分（auth.getUser）
//   ② 再用同一個 JWT context 呼叫 is_trip_editor() RPC，false 就 403
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// 上限：正常一天最多十幾個景點，30 已很寬鬆，純防呆／防濫用。
const MAX_PAIRS = 30;

// Request body 裡的一組相鄰配對。
interface RoutePair {
  fromStopId: string;
  fromAddress: string;
  toStopId: string;
  toAddress: string;
}

// Google computeRouteMatrix 回傳的單一元素（只列會用到的欄位）。
interface RouteMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  duration?: string; // 例："1500s"
  distanceMeters?: number;
  condition?: string; // "ROUTE_EXISTS" | "ROUTE_NOT_FOUND" ...
}

// 秒數 → 人類可讀（<60 分鐘顯示「N 分鐘」，否則「N 小時 M 分鐘」）。
function formatDuration(totalSeconds: number): string {
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} 分鐘`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} 小時` : `${hours} 小時 ${minutes} 分鐘`;
}

// 公尺 → 人類可讀（<1000 公尺顯示「N 公尺」，否則「N.N 公里」）。
function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} 公尺`;
  return `${(meters / 1000).toFixed(1)} 公里`;
}

// 解析 Google 的 duration 字串（"1500s"）成整數秒；解析不出來回 null。
function parseDurationSeconds(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(raw.trim());
  if (!match) return null;
  return Math.round(Number(match[1]));
}

Deno.serve(async (req: Request) => {
  // 預檢請求直接放行
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // 1. 讀環境變數
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const googleApiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");

    if (!supabaseUrl || !anonKey || !googleApiKey) {
      return json(
        {
          error:
            "Server 環境變數未設定（SUPABASE_URL / SUPABASE_ANON_KEY / GOOGLE_MAPS_API_KEY）",
        },
        500,
      );
    }

    // 2. 從 Authorization header 取出前端匿名 session 的 JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return json({ error: "缺少 Authorization（請先在前端完成匿名登入）" }, 401);
    }

    // 3. 用 anon client + JWT 驗證身分
    const anonClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userErr } = await anonClient.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return json({ error: "匿名 session 無效或已過期，請重新整理頁面" }, 401);
    }

    // 4. 用同一個 JWT context 呼叫 is_trip_editor()，非編輯者直接拒絕
    //    （不往下打 Google API，避免免費額度被任何持 anon key 的人消耗）
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: isEditor, error: editorErr } =
      await userClient.rpc("is_trip_editor");
    if (editorErr) {
      // 不把資料庫錯誤細節回給前端（可能洩漏內部資訊），細節寫 server log。
      console.error("is_trip_editor RPC 失敗：", editorErr.message);
      return json({ error: "檢查授權狀態失敗，請稍後再試。" }, 500);
    }
    if (isEditor !== true) {
      return json({ error: "沒有編輯權限，無法使用路程估算。" }, 403);
    }

    // 5. 解析 body
    const body = (await req.json().catch(() => ({}))) as {
      travelMode?: unknown;
      pairs?: unknown;
    };
    const travelMode =
      typeof body.travelMode === "string" && body.travelMode
        ? body.travelMode
        : "TRANSIT";
    const rawPairs = Array.isArray(body.pairs) ? body.pairs : [];

    // 型別收斂：只保留欄位齊全的配對
    const pairs: RoutePair[] = rawPairs.filter(
      (p): p is RoutePair =>
        !!p &&
        typeof p.fromStopId === "string" &&
        typeof p.fromAddress === "string" &&
        typeof p.toStopId === "string" &&
        typeof p.toAddress === "string" &&
        p.fromAddress.trim() !== "" &&
        p.toAddress.trim() !== "",
    );

    if (pairs.length === 0) {
      return json({ error: "沒有可估算的有效配對（配對需兩端皆有地址）。" }, 400);
    }
    if (pairs.length > MAX_PAIRS) {
      return json(
        { error: `配對數量過多（上限 ${MAX_PAIRS} 組），請分批估算。` },
        400,
      );
    }

    // 6. 呼叫 Google Routes API Compute Route Matrix
    //    origins[i] 對 destinations[i]：originIndex === destinationIndex 的元素
    //    就正好是 pairs[i]，避開不相鄰景點之間的無意義路程。
    const googleRes = await fetch(
      "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": googleApiKey,
          "X-Goog-FieldMask":
            "originIndex,destinationIndex,duration,distanceMeters,condition",
        },
        body: JSON.stringify({
          origins: pairs.map((p) => ({ waypoint: { address: p.fromAddress } })),
          destinations: pairs.map((p) => ({
            waypoint: { address: p.toAddress },
          })),
          travelMode,
          languageCode: "zh-TW",
        }),
      },
    );

    if (!googleRes.ok) {
      // 金鑰不會出現在回應 body（只在 header），這樣回傳不會外洩金鑰。
      const detail = await googleRes.text().catch(() => "");
      return json(
        { error: `Google Routes API 呼叫失敗（${googleRes.status}）：${detail}` },
        502,
      );
    }

    const elements = (await googleRes.json()) as RouteMatrixElement[];

    // Google 正常會回一個 JSON 陣列。若回的不是陣列（格式異動、非預期回應等），
    // 下方迴圈會靜默產出空 segments、前端只看到「尚未計算」，難以察覺問題。
    // 這裡記一筆 server log 留線索，但不改變回傳行為（這不是使用者能處理的錯誤，
    // 仍走正常流程回空 segments）。
    if (!Array.isArray(elements)) {
      console.error(
        "Google Routes API 回應非預期（不是陣列）：",
        JSON.stringify(elements),
      );
    }

    // 7. 只保留 originIndex === destinationIndex 且 condition === 'ROUTE_EXISTS'
    //    的元素（其餘忽略，不視為錯誤——可能只是那組沒查到路線）。
    const segments: {
      fromStopId: string;
      toStopId: string;
      durationSeconds: number;
      durationText: string;
      distanceText: string;
    }[] = [];

    for (const el of Array.isArray(elements) ? elements : []) {
      if (
        typeof el.originIndex !== "number" ||
        el.originIndex !== el.destinationIndex ||
        el.condition !== "ROUTE_EXISTS"
      ) {
        continue;
      }
      const pair = pairs[el.originIndex];
      if (!pair) continue;

      const durationSeconds = parseDurationSeconds(el.duration);
      const distanceMeters =
        typeof el.distanceMeters === "number" ? el.distanceMeters : null;
      if (durationSeconds === null) continue;

      segments.push({
        fromStopId: pair.fromStopId,
        toStopId: pair.toStopId,
        durationSeconds,
        durationText: formatDuration(durationSeconds),
        distanceText:
          distanceMeters !== null ? formatDistance(distanceMeters) : "",
      });
    }

    return json({ success: true, segments }, 200);
  } catch (err) {
    return json({ error: `Server 錯誤：${String(err)}` }, 500);
  }
});
