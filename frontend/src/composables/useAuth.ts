import { ref } from 'vue'
import { supabase } from '@/lib/supabase'

// 模組層級的單例狀態：整個 app 共用同一份驗證狀態，
// 不同元件呼叫 useAuth() 拿到的是同一組 ref。
const isEditor = ref(false) // 是否已通過共用密碼驗證（= is_trip_editor() 回 true）
const isReady = ref(false) // 初始化（匿名登入 + 首次權限檢查）是否完成
const authError = ref<string | null>(null) // 初始化過程的錯誤訊息

// 確保匿名 session 存在：有就沿用，沒有就匿名登入。
async function ensureSession(): Promise<void> {
  const { data } = await supabase.auth.getSession()
  if (data.session) return

  const { error } = await supabase.auth.signInAnonymously()
  if (error) {
    throw new Error(`匿名登入失敗：${error.message}`)
  }
}

// 呼叫 is_trip_editor() RPC，判斷本瀏覽器目前是否已通過密碼驗證。
async function refreshEditorStatus(): Promise<void> {
  const { data, error } = await supabase.rpc('is_trip_editor')
  if (error) {
    throw new Error(`檢查授權狀態失敗：${error.message}`)
  }
  isEditor.value = data === true
}

// app 掛載時呼叫一次：建立 session 並檢查目前權限。
async function initAuth(): Promise<void> {
  try {
    authError.value = null
    await ensureSession()
    await refreshEditorStatus()
  } catch (err) {
    authError.value = err instanceof Error ? err.message : String(err)
  } finally {
    isReady.value = true
  }
}

// 呼叫 verify-password Edge Function 驗證密碼；
// 成功後 Edge Function 會把本 user 登記進 trip_editors，再重新查一次權限狀態。
// 回傳 true 代表驗證成功、狀態已更新為 editor。
async function verifyPassword(password: string): Promise<{ ok: boolean; message?: string }> {
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token
  if (!accessToken) {
    return { ok: false, message: '尚未建立連線，請重新整理頁面再試。' }
  }

  const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-password`

  try {
    const res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 帶目前匿名 session 的 access_token，Edge Function 用它取得 user_id
        Authorization: `Bearer ${accessToken}`,
        // Supabase Functions gateway 要求帶 apikey（anon key），否則請求會在
        // 抵達函式邏輯之前就被 gateway 用 401 擋掉（Phase 0 spike 已驗證的教訓）。
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ password }),
    })

    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean
      error?: string
    }

    if (!res.ok || !body.success) {
      return { ok: false, message: body.error ?? '密碼驗證失敗，請再試一次。' }
    }

    // 驗證成功：重新查詢權限狀態，讓 isEditor 變 true → 畫面切到行程內容
    await refreshEditorStatus()
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? `連線錯誤：${err.message}` : '連線錯誤，請稍後再試。',
    }
  }
}

export function useAuth() {
  return {
    isEditor,
    isReady,
    authError,
    initAuth,
    verifyPassword,
  }
}
