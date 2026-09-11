// 行程資料的前端型別。刻意組裝成跟原本 itinerary-data.json 相同的巢狀結構，
// 讓沿用自舊 HTML 的渲染邏輯不用改資料存取方式。

export interface ItineraryImage {
  url: string
  caption: string
}

export interface ItineraryStop {
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
  id: number // 顯示用的 Day 序號（1、2、3…），來自 sort_order
  dateLabel: string
  weekday: string
  route: string
  meals: ItineraryMeals
  hotel: ItineraryHotel
  stops: ItineraryStop[]
}
