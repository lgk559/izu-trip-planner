<script setup lang="ts">
import { reactive, watch } from 'vue'
import type { ItineraryStop } from '@/types/itinerary'

const props = defineProps<{
  stop: ItineraryStop
  saving: boolean
}>()

const emit = defineEmits<{
  (e: 'save', payload: { time: string; name: string; tag: string; summary: string; detail: string }): void
  (e: 'cancel'): void
}>()

// 本地編輯副本：避免直接改 props（單向資料流），存檔才 emit 回父層。
const form = reactive({
  time: props.stop.time,
  name: props.stop.name,
  tag: props.stop.tag,
  summary: props.stop.summary,
  detail: props.stop.detail,
})

// 切換到不同景點（同一表單元件被複用）時，同步表單內容。
watch(
  () => props.stop.id,
  () => {
    form.time = props.stop.time
    form.name = props.stop.name
    form.tag = props.stop.tag
    form.summary = props.stop.summary
    form.detail = props.stop.detail
  },
)

const TAG_OPTIONS = ['', '交通', '下車參觀', '入內參觀', '住宿']

function onSave() {
  emit('save', { ...form })
}
</script>

<template>
  <div class="mt-3 flex flex-col gap-3 border-t border-line pt-3">
    <div class="grid grid-cols-2 gap-3">
      <label class="flex flex-col gap-1 text-xs text-ink/50">
        時間
        <input
          v-model="form.time"
          type="text"
          class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
        />
      </label>
      <label class="flex flex-col gap-1 text-xs text-ink/50">
        標籤
        <select
          v-model="form.tag"
          class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
        >
          <option v-for="opt in TAG_OPTIONS" :key="opt" :value="opt">{{ opt || '（無）' }}</option>
        </select>
      </label>
    </div>
    <label class="flex flex-col gap-1 text-xs text-ink/50">
      名稱
      <input
        v-model="form.name"
        type="text"
        class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
      />
    </label>
    <label class="flex flex-col gap-1 text-xs text-ink/50">
      摘要（時間軸顯示）
      <input
        v-model="form.summary"
        type="text"
        class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
      />
    </label>
    <label class="flex flex-col gap-1 text-xs text-ink/50">
      細節（可含 HTML 連結）
      <textarea
        v-model="form.detail"
        rows="4"
        class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink leading-relaxed"
      ></textarea>
    </label>
    <div class="flex gap-2 justify-end">
      <button
        type="button"
        class="rounded-md px-3 py-1.5 text-xs text-ink/60 hover:text-ink"
        :disabled="saving"
        @click="emit('cancel')"
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
