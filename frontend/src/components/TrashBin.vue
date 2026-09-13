<script setup lang="ts">
import { reactive } from 'vue'
import type { TrashedStop } from '@/composables/useEditor'
import type { ItineraryDay } from '@/types/itinerary'

const props = defineProps<{
  items: TrashedStop[]
  loading: boolean
  busyStopId: string | null
  days: ItineraryDay[] // 復原目標天的下拉選單來源（已排除特別天）
}>()

const emit = defineEmits<{
  (e: 'restore', payload: { stopId: string; targetDayId: string }): void
  (e: 'purge', stopId: string): void
  (e: 'refresh'): void
}>()

// 每個回收站項目目前選定的復原目標天（key = stopId）。
// 預設值規則：
//   - 若該景點目前的 dayId 仍在 days 清單中（不是被特別天接住）→ 預設選它原本的天
//   - 若不在（被特別天接住，原天已刪）→ 不預設，強制使用者自己選（空字串）
const selectedDayId = reactive<Record<string, string>>({})

function defaultDayIdFor(item: TrashedStop): string {
  return props.days.some((d) => d.id === item.dayId) ? item.dayId : ''
}

function currentSelection(item: TrashedStop): string {
  // 尚未手動選過 → 用預設；選過 → 用使用者選的值
  return selectedDayId[item.id] ?? defaultDayIdFor(item)
}

function onRestore(item: TrashedStop) {
  const targetDayId = currentSelection(item)
  if (!targetDayId) return // 未選天（被特別天接住的情況）→ 不送出
  emit('restore', { stopId: item.id, targetDayId })
}
</script>

<template>
  <section class="mt-10 border-t border-line pt-6">
    <div class="flex items-center justify-between mb-3">
      <h2 class="font-serif text-sm text-ink/50">回收站</h2>
      <button
        type="button"
        class="text-xs text-ink/50 hover:text-ink"
        :disabled="loading"
        @click="emit('refresh')"
      >
        {{ loading ? '載入中…' : '重新整理' }}
      </button>
    </div>

    <p v-if="!loading && items.length === 0" class="text-xs text-ink/40">回收站是空的。</p>

    <div v-else class="flex flex-col gap-2">
      <div
        v-for="item in items"
        :key="item.id"
        class="flex flex-col gap-2 rounded-lg border border-line bg-[#F7F4EA] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-xs text-ink/40 tabular-nums shrink-0">{{ item.time }}</span>
            <span class="text-sm font-medium truncate">{{ item.name }}</span>
          </div>
          <p v-if="item.summary" class="text-xs text-ink/50 mt-0.5 truncate">{{ item.summary }}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <!-- 復原目標天下拉：常駐，選定後才能按復原 -->
          <select
            :value="currentSelection(item)"
            class="rounded-md border border-line bg-white px-2 py-1 text-xs text-ink"
            @change="selectedDayId[item.id] = ($event.target as HTMLSelectElement).value"
          >
            <option value="">選擇天…</option>
            <option v-for="(day, i) in days" :key="day.id" :value="day.id">
              Day{{ i + 1 }}（{{ day.dateLabel }}）
            </option>
          </select>
          <button
            type="button"
            class="rounded-md border border-line px-2.5 py-1 text-xs text-ink/70 hover:bg-line/40 disabled:opacity-40"
            :disabled="busyStopId === item.id || !currentSelection(item)"
            @click="onRestore(item)"
          >
            復原
          </button>
          <button
            type="button"
            class="rounded-md px-2.5 py-1 text-xs text-maple hover:underline disabled:opacity-40"
            :disabled="busyStopId === item.id"
            @click="emit('purge', item.id)"
          >
            永久刪除
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
