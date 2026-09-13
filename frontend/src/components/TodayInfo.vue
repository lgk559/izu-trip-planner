<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import type { ItineraryDay, ItineraryHotel, ItineraryMeals } from '@/types/itinerary'

const props = defineProps<{
  day: ItineraryDay
  isEditor: boolean
  saving: boolean
}>()

const emit = defineEmits<{
  (
    e: 'save-day-info',
    payload: { dayId: string; route: string; meals: ItineraryMeals; hotel: ItineraryHotel },
  ): void
}>()

const editing = ref(false)

// 本地編輯副本，避免直接改 props
const form = reactive({
  route: props.day.route,
  meals: { ...props.day.meals },
  hotel: { ...props.day.hotel },
})

// 切換到不同天時同步表單並收合編輯模式
watch(
  () => props.day.id,
  () => {
    form.route = props.day.route
    form.meals = { ...props.day.meals }
    form.hotel = { ...props.day.hotel }
    editing.value = false
  },
)

function onSave() {
  emit('save-day-info', {
    dayId: props.day.id,
    route: form.route,
    meals: { ...form.meals },
    hotel: { ...form.hotel },
  })
  // 樂觀關閉：比照 StopDetails/StopEditForm 存檔後立刻收合表單，
  // 不等 reload 或 watch(day.id)（同一天存檔 day.id 不變，watch 不會觸發）。
  editing.value = false
}
</script>

<template>
  <section class="mb-8 rounded-lg bg-[#F7F4EA] border border-line p-4">
    <!-- 檢視模式 -->
    <template v-if="!editing">
      <div class="flex items-start justify-between gap-3">
        <p class="font-serif text-sm text-indigo mb-3">{{ day.route }}</p>
        <button
          v-if="isEditor"
          type="button"
          class="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs text-ink/70 hover:bg-line/40"
          @click="editing = true"
        >
          編輯當天資訊
        </button>
      </div>
      <div class="grid grid-cols-3 gap-3 text-xs mb-4">
        <div>
          <p class="text-ink/40 mb-1">早餐</p>
          <p class="text-ink/80">{{ day.meals.breakfast }}</p>
        </div>
        <div>
          <p class="text-ink/40 mb-1">午餐</p>
          <p class="text-ink/80">{{ day.meals.lunch }}</p>
        </div>
        <div>
          <p class="text-ink/40 mb-1">晚餐</p>
          <p class="text-ink/80">{{ day.meals.dinner }}</p>
        </div>
      </div>
      <div class="h-px bg-line mb-3"></div>
      <div class="flex items-start gap-2">
        <span class="text-indigo mt-0.5">🏨</span>
        <div class="text-sm">
          <p class="font-medium">{{ day.hotel.name }}</p>
          <p class="text-xs text-ink/55">{{ day.hotel.address }}</p>
          <p v-if="day.hotel.note" class="text-xs text-ink/45 mt-0.5">{{ day.hotel.note }}</p>
          <a
            v-if="day.hotel.url"
            :href="day.hotel.url"
            target="_blank"
            class="text-xs text-maple underline underline-offset-2"
            >查看訂房資訊</a
          >
        </div>
      </div>
    </template>

    <!-- 編輯模式（只有 isEditor 能進入，因為切換按鈕本身受 isEditor 保護） -->
    <template v-else>
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1 text-xs text-ink/50">
          路線
          <input
            v-model="form.route"
            type="text"
            class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <div class="grid grid-cols-3 gap-3">
          <label class="flex flex-col gap-1 text-xs text-ink/50">
            早餐
            <input
              v-model="form.meals.breakfast"
              type="text"
              class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <label class="flex flex-col gap-1 text-xs text-ink/50">
            午餐
            <input
              v-model="form.meals.lunch"
              type="text"
              class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <label class="flex flex-col gap-1 text-xs text-ink/50">
            晚餐
            <input
              v-model="form.meals.dinner"
              type="text"
              class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
            />
          </label>
        </div>
        <label class="flex flex-col gap-1 text-xs text-ink/50">
          住宿名稱
          <input
            v-model="form.hotel.name"
            type="text"
            class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-ink/50">
          住宿地址
          <input
            v-model="form.hotel.address"
            type="text"
            class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-ink/50">
          訂房連結
          <input
            v-model="form.hotel.url"
            type="text"
            class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-ink/50">
          住宿備註
          <input
            v-model="form.hotel.note"
            type="text"
            class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <div class="flex gap-2 justify-end">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-xs text-ink/60 hover:text-ink"
            :disabled="saving"
            @click="editing = false"
          >
            取消
          </button>
          <button
            type="button"
            class="rounded-md bg-maple px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            :disabled="saving"
            @click="onSave"
          >
            {{ saving ? '儲存中…' : '儲存' }}
          </button>
        </div>
      </div>
    </template>
  </section>
</template>
