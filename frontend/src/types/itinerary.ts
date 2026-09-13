// 行程資料的前端型別。刻意組裝成跟原本 itinerary-data.json 相同的巢狀結構，
// 讓沿用自舊 HTML 的渲染邏輯不用改資料存取方式。
//
// Phase 2 起，ItineraryDay / ItineraryStop 都保留資料庫的 uuid（id）與 sortOrder，
// 供編輯/刪除/排序功能定位到正確的資料庫列、並用真實 sort_order 計算新增與交換。

export interface ItineraryImage {
  url: string
  caption: string
}

export interface ItineraryStop {
  id: string // 資料庫 uuid（CRUD 用）
  sortOrder: number // 資料庫 sort_order（排序交換用真實值）
  time: string
  name: string
  tag: string
  summary: string
  detail: string // 內含 HTML，前端以 v-html 渲染（ADR 003 前提：編輯者為信任圈）
  images: ItineraryImage[]
}

export interface ItineraryMeals {
  breakfast: string
  lunch: string
  dinner: string
}

export interface ItineraryHotel {
  name: string
  address: string
  url: string
  note: string
}

export interface ItineraryDay {
  id: string // 資料庫 uuid（CRUD 用）
  sortOrder: number // 資料庫 sort_order（新增一天取 max+1）
  dayNumber: number // 顯示用的 Day 序號（1、2、3…），來自陣列位置
  dateLabel: string
  weekday: string
  route: string
  meals: ItineraryMeals
  hotel: ItineraryHotel
  stops: ItineraryStop[]
}

// 行程頂層資訊（trips 表的可編輯欄位）。用於頭部標題與季節標籤的顯示與編輯。
export interface TripInfo {
  id: string
  name: string
  seasonLabel: string
}
