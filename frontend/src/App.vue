<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useItinerary } from '@/composables/useItinerary'
import type { ItineraryImage } from '@/types/itinerary'
import DayTabs from '@/components/DayTabs.vue'
import Timeline from '@/components/Timeline.vue'
import TodayInfo from '@/components/TodayInfo.vue'
import StopDetails from '@/components/StopDetails.vue'
import Lightbox from '@/components/Lightbox.vue'
import PasswordGate from '@/components/PasswordGate.vue'

const { isEditor, isReady, authError, initAuth } = useAuth()
const { days, isLoading, loadError, loadItinerary } = useItinerary()

// ---- 檢視狀態 ----
const currentDay = ref(0)
const activeStopIndex = ref<number | null>(null)
const openStops = ref<Set<number>>(new Set())

const currentDayData = computed(() => days.value[currentDay.value] ?? null)

// ---- Lightbox 狀態 ----
const lightboxImages = ref<ItineraryImage[]>([])
const lightboxIndex = ref(0)
const lightboxVisible = ref(false)

function switchDay(index: number) {
  currentDay.value = index
  activeStopIndex.value = null
  // 切到新的一天時，預設把所有景點展開（沿用原 HTML 行為）
  const stops = days.value[index]?.stops ?? []
  openStops.value = new Set(stops.map((_, i) => i))
}

function toggleAccordion(index: number) {
  const next = new Set(openStops.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  openStops.value = next
  activeStopIndex.value = index
}

async function focusFromTimeline(index: number) {
  const next = new Set(openStops.value)
  next.add(index)
  openStops.value = next
  activeStopIndex.value = index
  await nextTick()
  document.getElementById(`acc-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function openLightbox(payload: { images: ItineraryImage[]; index: number }) {
  lightboxImages.value = payload.images
  lightboxIndex.value = payload.index
  lightboxVisible.value = true
}

function closeLightbox() {
  lightboxVisible.value = false
}

function stepLightbox(delta: number) {
  const len = lightboxImages.value.length
  if (len === 0) return
  lightboxIndex.value = (lightboxIndex.value + delta + len) % len
}

// 驗證通過後才載入行程資料
watch(
  isEditor,
  async (editor) => {
    if (editor && days.value.length === 0) {
      await loadItinerary()
      if (days.value.length > 0) switchDay(0)
    }
  },
  { immediate: true },
)

onMounted(() => {
  initAuth()
})
</script>

<template>
  <!-- 初始化中（匿名登入 + 權限檢查） -->
  <div v-if="!isReady" class="min-h-screen flex items-center justify-center">
    <p class="text-sm text-ink/50">載入中…</p>
  </div>

  <!-- 初始化失敗 -->
  <div v-else-if="authError" class="min-h-screen flex items-center justify-center px-5">
    <p class="text-sm text-maple text-center">{{ authError }}</p>
  </div>

  <!-- 尚未通過密碼驗證 → 密碼閘門 -->
  <PasswordGate v-else-if="!isEditor" />

  <!-- 已驗證 → 行程內容 -->
  <div v-else class="max-w-2xl mx-auto px-5 pt-8 pb-16">
    <!-- 標題區 -->
    <header class="mb-8">
      <div class="flex items-end justify-between gap-4">
        <div>
          <p class="text-xs tracking-wide text-moss mb-1">2026年10月・秋</p>
          <h1 class="font-serif text-2xl sm:text-3xl font-bold text-ink leading-snug">
            伊豆半島 <span class="text-maple">×</span> 河口湖
          </h1>
          <p class="text-sm text-ink/60 mt-1">4天3夜・10/8（四）— 10/11（日）</p>
        </div>
        <svg width="72" height="44" viewBox="0 0 72 44" class="text-indigo/70 shrink-0">
          <path
            d="M2 34 Q10 24 18 34 T34 34"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
          />
          <path
            d="M20 34 L34 12 L42 22 L52 6 L70 34 Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linejoin="round"
          />
          <circle cx="52" cy="6" r="2" fill="#B3452F" stroke="none" />
        </svg>
      </div>
      <div class="h-px bg-line mt-5"></div>
    </header>

    <!-- 資料載入中 / 失敗 -->
    <p v-if="isLoading" class="text-sm text-ink/50">行程載入中…</p>
    <p v-else-if="loadError" class="text-sm text-maple">行程載入失敗：{{ loadError }}</p>

    <template v-else-if="currentDayData">
      <DayTabs :days="days" :current-day="currentDay" @switch="switchDay" />
      <Timeline
        :stops="currentDayData.stops"
        :active-stop-index="activeStopIndex"
        @focus="focusFromTimeline"
      />
      <TodayInfo :day="currentDayData" />
      <StopDetails
        :stops="currentDayData.stops"
        :active-stop-index="activeStopIndex"
        :open-stops="openStops"
        @toggle="toggleAccordion"
        @open-lightbox="openLightbox"
      />
    </template>

    <!-- Lightbox -->
    <Lightbox
      v-if="lightboxVisible"
      :images="lightboxImages"
      :index="lightboxIndex"
      @close="closeLightbox"
      @step="stepLightbox"
    />
  </div>
</template>
