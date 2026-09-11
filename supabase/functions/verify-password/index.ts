// ============================================================
// Spike: verify-password Edge Function (ADR 006 版)
// 職責：驗證匿名 session + 比對密碼 → 正確則把該 user_id
//       登記進 trip_editors（用 service_role 繞過 RLS 寫入）
// 不再簽發任何 JWT，不再回傳 token。
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- CORS：spike.html 從 file:// 或 localhost 打過來，需要放行 ---
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --- 用 Web Crypto 算 SHA-256，回傳 hex 字串（Deno 內建，零依賴）---
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --- 常數時間字串比對，避免計時攻擊 ---
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const expectedHash = Deno.env.get("SHARED_PASSWORD_HASH");
    const salt = Deno.env.get("SHARED_PASSWORD_SALT");

    if (!supabaseUrl || !anonKey || !serviceRoleKey || !expectedHash || !salt) {
      return json(
        { error: "Server 環境變數未設定（SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / SHARED_PASSWORD_HASH / SHARED_PASSWORD_SALT）" },
        500,
      );
    }

    // 2. 從 Authorization header 取出前端匿名 session 的 JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return json({ error: "缺少 Authorization（請先在前端完成匿名登入）" }, 401);
    }

    // 3. 用 anon client + 這個 JWT 驗證身分並取得 user_id
    const anonClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userErr } = await anonClient.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return json({ error: "匿名 session 無效或已過期，請重新整理頁面" }, 401);
    }
    const userId = userData.user.id;

    // 4. 解析 body 拿密碼
    const body = await req.json().catch(() => ({}));
    const password = typeof body?.password === "string" ? body.password : "";
    if (!password) {
      return json({ error: "缺少 password 欄位" }, 400);
    }

    // 5. 比對密碼 hash（SHA-256(salt + password) 的 hex）
    const actualHash = await sha256Hex(salt + password);
    if (!timingSafeEqual(actualHash, expectedHash)) {
      return json({ error: "密碼錯誤" }, 401);
    }

    // 6. 密碼正確：用 service_role client（bypass RLS）把 user_id 登記進 trip_editors
    //    使用 upsert（update + insert 的合成字），意思是「有就更新、沒有就新增」
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: insertErr } = await serviceClient
      .from("trip_editors")
      .upsert({ user_id: userId }, { onConflict: "user_id" });

    if (insertErr) {
      return json({ error: `登記授權失敗：${insertErr.message}` }, 500);
    }

    // 7. 只回成功旗標，不含任何 token
    return json({ success: true }, 200);
  } catch (err) {
    return json({ error: `Server 錯誤：${String(err)}` }, 500);
  }
});
