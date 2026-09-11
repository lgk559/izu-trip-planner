import { createClient } from '@supabase/supabase-js'

// 這兩個值從建置時的環境變數注入（Vite 會把 import.meta.env.VITE_* 內聯進 bundle）。
// 兩者皆為公開值，非機密。
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '缺少 Supabase 環境變數。請確認 frontend/.env 已設定 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY（可從 .env.example 複製）。',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
