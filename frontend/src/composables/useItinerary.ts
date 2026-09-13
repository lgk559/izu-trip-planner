import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import type {
  ItineraryDay,
  ItineraryHotel,
  ItineraryImage,
  ItineraryMeals,
  ItineraryStop,
  TripInfo,
} from '@/types/itinerary'

// 從 Supabase 撈回來的原始列型別（只列出本階段會用到的欄位）
interface TripRow {
  id: string
  name: string
  season_label: string
}

interface DayRow {
  id: string
  date_label: string
  weekday: string
  route: string
  meals: Partial<ItineraryMeals> | null
  hotel: Partial<ItineraryHotel> | null
  sort_order: number
}

interface StopRow {
  id: string
  day_id: string
  time: string
  name: string
  tag: string
  summary: string
  detail: string
  sort_order: number
}

interface ImageRow {
  id: string
  stop_id: string
  url: string
  caption: string
  sort_order: number
  storage_path: string | null
}

// 目前站上只有一趟旅遊（ADR 007），載入時取最早建立的那筆。
// CRUD 需要知道「這些景點掛在哪趟旅遊」（新增天數要寫 trip_id），
// 所以把目前 tripId 也暴露出去給 useEditor 使用。
const days = ref<ItineraryDay[]>([])
const tripId = ref<string | null>(null)
// 行程頂層資訊（name/season_label），供頭部標題與季節標籤顯示與編輯。
const tripInfo = ref<TripInfo | null>(null)
const isLoading = ref(false)
const loadError = ref<string | null>(null)

function toMeals(raw: Partial<ItineraryMeals> | null): ItineraryMeals {
  return {
    breakfast: raw?.breakfast ?? '',
    lunch: raw?.lunch ?? '',
    dinner: raw?.dinner ?? '',
  }
}

function toHotel(raw: Partial<ItineraryHotel> | null): ItineraryHotel {
  return {
    name: raw?.name ?? '',
    address: raw?.address ?? '',
    url: raw?.url ?? '',
    note: raw?.note ?? '',
  }
}

// 撈第一趟旅遊的完整行程，組裝成巢狀結構（Phase 1 只有一趟，直接取最早建立的那筆）。
async function loadItinerary(): Promise<void> {
  isLoading.value = true
  loadError.value = null

  try {
    // 1. 取第一筆 trip（一併撈 name/season_label，組成 tripInfo）
    const { data: trip, error: tripErr } = await supabase
      .from('trips')
      .select('id, name, season_label')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle<TripRow>()

    if (tripErr) throw new Error(tripErr.message)
    if (!trip) throw new Error('資料庫裡還沒有任何旅遊資料。')
    tripId.value = trip.id
    tripInfo.value = {
      id: trip.id,
      name: trip.name,
      seasonLabel: trip.season_label,
    }

    // 2. 撈這趟的 days（排除「特別天」is_holding=true，不讓它出現在畫面上）
    const { data: dayRows, error: dayErr } = await supabase
      .from('days')
      .select('id, date_label, weekday, route, meals, hotel, sort_order')
      .eq('trip_id', trip.id)
      .eq('is_holding', false)
      .order('sort_order', { ascending: true })
      .overrideTypes<DayRow[], { merge: false }>()

    if (dayErr) throw new Error(dayErr.message)
    const dayList = dayRows ?? []
    if (dayList.length === 0) {
      days.value = []
      return
    }

    // 3. 一次撈這些 days 底下的 stops（用 in 查詢，避免逐天 N+1）
    const dayIds = dayList.map((d) => d.id)
    const { data: stopRows, error: stopErr } = await supabase
      .from('stops')
      .select('id, day_id, time, name, tag, summary, detail, sort_order')
      .in('day_id', dayIds)
      .eq('status', 'active') // 只顯示未被軟刪除的
      .order('sort_order', { ascending: true })
      .overrideTypes<StopRow[], { merge: false }>()

    if (stopErr) throw new Error(stopErr.message)
    const stopList = stopRows ?? []

    // 4. 一次撈這些 stops 底下的 images
    const stopIds = stopList.map((s) => s.id)
    let imageList: ImageRow[] = []
    if (stopIds.length > 0) {
      const { data: imageRows, error: imageErr } = await supabase
        .from('images')
        .select('id, stop_id, url, caption, sort_order, storage_path')
        .in('stop_id', stopIds)
        .order('sort_order', { ascending: true })
        .overrideTypes<ImageRow[], { merge: false }>()

      if (imageErr) throw new Error(imageErr.message)
      imageList = imageRows ?? []
    }

    // 4b. 有 storage_path 的是 Phase 3 新上傳圖片（私有 bucket），用批次簽章
    // 一次換算 signed URL（效期 1 小時），把結果覆蓋進該列的 url。
    // storage_path 為 null 的舊種子圖片維持原本 url（外部公開連結，不需簽章）。
    // 簽章失敗不讓整頁載入掛掉：記錄警告、該圖 url 留原值，其餘資料照常組裝。
    const pathsToSign = imageList
      .map((img) => img.storage_path)
      .filter((path): path is string => path !== null && path !== '')

    if (pathsToSign.length > 0) {
      const { data: signed, error: signErr } = await supabase.storage
        .from('trip-images')
        .createSignedUrls(pathsToSign, 3600)

      if (signErr) {
        console.warn('圖片簽章網址產生失敗，將以原始資料顯示：', signErr.message)
      } else if (signed) {
        const urlByPath = new Map<string, string>()
        for (const item of signed) {
          if (item.error) {
            console.warn(`圖片簽章失敗（${item.path}）：`, item.error)
            continue
          }
          if (item.path && item.signedUrl) urlByPath.set(item.path, item.signedUrl)
        }
        for (const img of imageList) {
          if (img.storage_path) {
            const url = urlByPath.get(img.storage_path)
            if (url) img.url = url
          }
        }
      }
    }

    // 5. 組裝成巢狀結構：image 掛到 stop、stop 掛到 day
    const imagesByStop = new Map<string, ItineraryImage[]>()
    for (const img of imageList) {
      const arr = imagesByStop.get(img.stop_id) ?? []
      arr.push({ id: img.id, url: img.url, caption: img.caption })
      imagesByStop.set(img.stop_id, arr)
    }

    const stopsByDay = new Map<string, ItineraryStop[]>()
    for (const stop of stopList) {
      const arr = stopsByDay.get(stop.day_id) ?? []
      arr.push({
        id: stop.id, // 保留 uuid 供 CRUD 定位
        sortOrder: stop.sort_order,
        time: stop.time,
        name: stop.name,
        tag: stop.tag,
        summary: stop.summary,
        detail: stop.detail,
        images: imagesByStop.get(stop.id) ?? [],
      })
      stopsByDay.set(stop.day_id, arr)
    }

    days.value = dayList.map((day, index) => ({
      id: day.id, // 資料庫 uuid（CRUD 用）
      sortOrder: day.sort_order,
      dayNumber: index + 1, // Day 顯示序號用陣列位置（已依 sort_order 排好）
      dateLabel: day.date_label,
      weekday: day.weekday,
      route: day.route,
      meals: toMeals(day.meals),
      hotel: toHotel(day.hotel),
      stops: stopsByDay.get(day.id) ?? [],
    }))
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
  } finally {
    isLoading.value = false
  }
}

export function useItinerary() {
  return {
    days,
    tripId,
    tripInfo,
    isLoading,
    loadError,
    loadItinerary,
  }
}
