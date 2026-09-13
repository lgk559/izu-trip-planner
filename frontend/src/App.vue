<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useItinerary } from '@/composables/useItinerary'
import { useEditor } from '@/composables/useEditor'
import type { TrashedStop } from '@/composables/useEditor'
import type { ItineraryHotel, ItineraryImage, ItineraryMeals } from '@/types/itinerary'
import DayTabs from '@/components/DayTabs.vue'
import Timeline from '@/components/Timeline.vue'
import TodayInfo from '@/components/TodayInfo.vue'
import StopDetails from '@/components/StopDetails.vue'
import Lightbox from '@/components/Lightbox.vue'
import TrashBin from '@/components/TrashBin.vue'
import DayManagerModal from '@/components/DayManagerModal.vue'
import PasswordGate from '@/components/PasswordGate.vue'

const { isEditor, isReady, authError, initAuth } = useAuth()
const { days, tripId, tripInfo, isLoading, loadError, loadItinerary } = useItinerary()
const {
  updateTripInfo,
  updateDayInfo,
  updateStop,
  addStop,
  trashStop,
  restoreStop,
  purgeStop,
  swapStopOrder,
  loadTrashedStops,
} = useEditor()

// ---- 檢視狀態 ----
const currentDay = ref(0)
const activeStopIndex = ref<number | null>(null)
const openStops = ref<Set<number>>(new Set())

const currentDayData = computed(() => days.value[currentDay.value] ?? null)

// ---- 頭部「X天Y夜・起訖」自動計算 ----
const tripSummary = computed(() => {
  const list = days.value
  if (list.length === 0) return ''
  const nights = Math.max(0, list.length - 1)
  const first = list[0]
  const last = list[list.length - 1]
  const range =
    list.length === 1
      ? `${first.dateLabel}（${first.weekday}）`
      : `${first.dateLabel}（${first.weekday}）— ${last.dateLabel}（${last.weekday}）`
  return `${list.length}天${nights}夜・${range}`
})

// ---- 寫入進行中的標記（給對應 UI 顯示 loading / disable）----
const savingStopId = ref<string | null>(null)
const savingDayInfo = ref(false)
const editorError = ref<string | null>(null)

// ---- 行程頭部資訊編輯 ----
const editingTripInfo = ref(false)
const tripForm = reactive({ name: '', seasonLabel: '' })
const savingTripInfo = ref(false)

function startEditTripInfo() {
  tripForm.name = tripInfo.value?.name ?? ''
  tripForm.seasonLabel = tripInfo.value?.seasonLabel ?? ''
  editingTripInfo.value = true
}

async function onSaveTripInfo() {
  if (!tripId.value) return
  savingTripInfo.value = true
  const result = await updateTripInfo(tripId.value, {
    name: tripForm.name,
    seasonLabel: tripForm.seasonLabel,
  })
  savingTripInfo.value = false
  if (reportIfFail(result)) {
    editingTripInfo.value = false
    await reload()
  }
}

// ---- 天數管理 modal ----
const dayManagerVisible = ref(false)
async function onDayManagerChanged() {
  // modal 內某個天數操作成功了 → 重新整理；modal 不關閉（使用者可能連續多次操作）
  await reload()
}

// ---- 回收站狀態 ----
const trashedStops = ref<TrashedStop[]>([])
const trashLoading = ref(false)
const trashBusyStopId = ref<string | null>(null)

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

// ---- 寫入成功後統一重載，維持「畫面 = 資料庫」----
// 重載會重建 days，切換的天索引若仍存在就停在原地，否則退回第一天。
async function reload(keepDayIndex = currentDay.value) {
  await loadItinerary()
  const idx = keepDayIndex < days.value.length ? keepDayIndex : 0
  if (days.value.length > 0) switchDay(idx)
  else {
    currentDay.value = 0
    openStops.value = new Set()
  }
  // 天數變動可能影響回收站（刪天會把景點搬進回收站），一併刷新
  if (isEditor.value && tripId.value) await refreshTrash()
}

function reportIfFail(result: { ok: boolean; message?: string }): boolean {
  if (!result.ok) {
    editorError.value = result.message ?? '操作失敗，請再試一次。'
    return false
  }
  editorError.value = null
  return true
}

// ---- 當天資訊 ----
async function onSaveDayInfo(payload: {
  dayId: string
  route: string
  meals: ItineraryMeals
  hotel: ItineraryHotel
}) {
  savingDayInfo.value = true
  const result = await updateDayInfo(payload.dayId, {
    route: payload.route,
    meals: payload.meals,
    hotel: payload.hotel,
  })
  savingDayInfo.value = false
  if (reportIfFail(result)) await reload()
}

// ---- 景點 ----
async function onSaveStop(payload: {
  stopId: string
  data: { time: string; name: string; tag: string; summary: string; detail: string }
}) {
  savingStopId.value = payload.stopId
  const result = await updateStop(payload.stopId, payload.data)
  savingStopId.value = null
  if (reportIfFail(result)) await reload()
}

async function onAddStop() {
  const day = currentDayData.value
  if (!day) return
  // sort_order 由 addStop 內部查詢資料庫真實最大值（含已軟刪除的），不用前端 state 推算。
  const result = await addStop(day.id)
  if (reportIfFail(result)) await reload()
}

async function onTrashStop(stopId: string) {
  const result = await trashStop(stopId)
  if (reportIfFail(result)) {
    await reload()
    if (isEditor.value && tripId.value) await refreshTrash()
  }
}

async function onMoveStop(payload: { index: number; direction: -1 | 1 }) {
  const day = currentDayData.value
  if (!day) return
  const targetIndex = payload.index + payload.direction
  if (targetIndex < 0 || targetIndex >= day.stops.length) return
  const a = day.stops[payload.index]
  const b = day.stops[targetIndex]
  // 直接交換兩筆的真實 sort_order（不是陣列索引）。
  const result = await swapStopOrder(
    { id: a.id, sortOrder: a.sortOrder },
    { id: b.id, sortOrder: b.sortOrder },
  )
  if (reportIfFail(result)) await reload()
}

// ---- 回收站 ----
async function refreshTrash() {
  if (!tripId.value) return
  trashLoading.value = true
  const result = await loadTrashedStops(tripId.value)
  trashLoading.value = false
  if (result.ok) trashedStops.value = result.data
  else editorError.value = result.message ?? '回收站載入失敗。'
}

async function onRestore(payload: { stopId: string; targetDayId: string }) {
  trashBusyStopId.value = payload.stopId
  // sort_order 由 restoreStop 內部查目標天真實最大值 +1，這裡不用先查。
  const result = await restoreStop(payload.stopId, payload.targetDayId)
  trashBusyStopId.value = null
  if (reportIfFail(result)) {
    await reload()
    await refreshTrash()
  }
}

async function onPurge(stopId: string) {
  const target = trashedStops.value.find((t) => t.id === stopId)
  const ok = window.confirm(`確定要永久刪除「${target?.name ?? '此景點'}」嗎？\n此操作無法復原。`)
  if (!ok) return
  trashBusyStopId.value = stopId
  const result = await purgeStop(stopId)
  trashBusyStopId.value = null
  if (reportIfFail(result)) await refreshTrash()
}

// 驗證通過後才載入行程資料
watch(
  isEditor,
  async (editor) => {
    if (editor && days.value.length === 0) {
      await loadItinerary()
      if (days.value.length > 0) switchDay(0)
      await refreshTrash()
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
        <div class="min-w-0">
          <!-- 檢視模式 -->
          <template v-if="!editingTripInfo">
            <div class="flex items-center gap-2 mb-1">
              <p class="text-xs tracking-wide text-moss">{{ tripInfo?.seasonLabel }}</p>
              <button
                v-if="isEditor"
                type="button"
                class="text-xs text-ink/40 hover:text-ink underline underline-offset-2"
                @click="startEditTripInfo"
              >
                編輯
              </button>
            </div>
            <h1 class="font-serif text-2xl sm:text-3xl font-bold text-ink leading-snug">
              {{ tripInfo?.name }}
            </h1>
            <p v-if="tripSummary" class="text-sm text-ink/60 mt-1">{{ tripSummary }}</p>
          </template>

          <!-- 編輯模式（只有 isEditor 能進入，切換入口受 isEditor 保護） -->
          <template v-else>
            <div class="flex flex-col gap-2">
              <label class="flex flex-col gap-1 text-xs text-ink/50">
                季節標籤
                <input
                  v-model="tripForm.seasonLabel"
                  type="text"
                  class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
                />
              </label>
              <label class="flex flex-col gap-1 text-xs text-ink/50">
                行程標題
                <input
                  v-model="tripForm.name"
                  type="text"
                  class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
                />
              </label>
              <div class="flex gap-2 justify-start">
                <button
                  type="button"
                  class="rounded-md px-3 py-1 text-xs text-ink/60 hover:text-ink"
                  :disabled="savingTripInfo"
                  @click="editingTripInfo = false"
                >
                  取消
                </button>
                <button
                  type="button"
                  class="rounded-md bg-maple px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                  :disabled="savingTripInfo"
                  @click="onSaveTripInfo"
                >
                  {{ savingTripInfo ? '儲存中…' : '儲存' }}
                </button>
              </div>
            </div>
          </template>
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

      <!-- 編輯日期入口：唯一入口，isEditor 常駐（不依賴 days.length，0 天也能開） -->
      <button
        v-if="isEditor"
        type="button"
        class="mt-4 rounded-md border border-line px-3 py-1.5 text-xs text-moss hover:bg-line/30"
        @click="dayManagerVisible = true"
      >
        編輯日期
      </button>

      <div class="h-px bg-line mt-5"></div>
    </header>

    <!-- 資料載入中 / 失敗 -->
    <p v-if="isLoading" class="text-sm text-ink/50">行程載入中…</p>
    <p v-else-if="loadError" class="text-sm text-maple">行程載入失敗：{{ loadError }}</p>

    <!-- 編輯操作錯誤提示（放在條件外，天數歸零時仍看得到錯誤） -->
    <p v-if="editorError" class="mb-3 text-sm text-maple">{{ editorError }}</p>

    <!-- 有天數時顯示行程內容 -->
    <template v-if="!isLoading && !loadError && currentDayData">
      <DayTabs :days="days" :current-day="currentDay" @switch="switchDay" />
      <Timeline
        :stops="currentDayData.stops"
        :active-stop-index="activeStopIndex"
        @focus="focusFromTimeline"
      />
      <TodayInfo
        :day="currentDayData"
        :is-editor="isEditor"
        :saving="savingDayInfo"
        @save-day-info="onSaveDayInfo"
      />
      <StopDetails
        :stops="currentDayData.stops"
        :active-stop-index="activeStopIndex"
        :open-stops="openStops"
        :is-editor="isEditor"
        :saving-stop-id="savingStopId"
        @toggle="toggleAccordion"
        @open-lightbox="openLightbox"
        @save-stop="onSaveStop"
        @trash-stop="onTrashStop"
        @move-stop="onMoveStop"
        @images-changed="reload()"
      />

      <!-- 新增景點按鈕（只有 isEditor 才顯示） -->
      <button
        v-if="isEditor"
        type="button"
        class="mt-3 w-full rounded-lg border border-dashed border-line py-2.5 text-sm text-moss hover:bg-line/30"
        @click="onAddStop"
      >
        ＋ 新增景點
      </button>
    </template>

    <!-- 0 天空狀態（已載入、無錯誤、但沒有任何天） -->
    <p
      v-else-if="!isLoading && !loadError && days.length === 0"
      class="text-sm text-ink/50 mt-4"
    >
      目前還沒有任何行程天，點上方「編輯日期」新增一天。
    </p>

    <!-- 回收站（只有 isEditor 才顯示，放在天數內容之外，天數歸零時仍可操作回收站） -->
    <TrashBin
      v-if="isEditor && !isLoading && !loadError"
      :items="trashedStops"
      :loading="trashLoading"
      :busy-stop-id="trashBusyStopId"
      :days="days"
      @restore="onRestore"
      @purge="onPurge"
      @refresh="refreshTrash"
    />

    <!-- 天數管理 modal -->
    <DayManagerModal
      v-if="dayManagerVisible && tripId"
      :days="days"
      :trip-id="tripId"
      @close="dayManagerVisible = false"
      @changed="onDayManagerChanged"
    />

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
