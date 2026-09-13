<script setup lang="ts">
import { ref } from 'vue'
import type { ItineraryImage, ItineraryStop } from '@/types/itinerary'
import StopEditForm from '@/components/StopEditForm.vue'

const props = defineProps<{
  stops: ItineraryStop[]
  activeStopIndex: number | null
  openStops: Set<number>
  isEditor: boolean
  savingStopId: string | null
}>()

const emit = defineEmits<{
  (e: 'toggle', index: number): void
  (e: 'open-lightbox', payload: { images: ItineraryImage[]; index: number }): void
  (
    e: 'save-stop',
    payload: {
      stopId: string
      data: { time: string; name: string; tag: string; summary: string; detail: string }
    },
  ): void
  (e: 'trash-stop', stopId: string): void
  (e: 'move-stop', payload: { index: number; direction: -1 | 1 }): void
  // StopEditForm 圖片操作成功後往上轉發，最終由 App.vue reload。
  (e: 'images-changed'): void
}>()

// tag 對應的 CSS class（沿用原 HTML 的樣式命名）
const tagClass: Record<string, string> = {
  交通: 'tag-transport',
  下車參觀: 'tag-visit',
  入內參觀: 'tag-enter',
  住宿: 'tag-stay',
}

// 目前正在編輯哪個景點（用 stop.id 標記，null = 沒有在編輯）
const editingStopId = ref<string | null>(null)

function toggleEdit(stopId: string) {
  editingStopId.value = editingStopId.value === stopId ? null : stopId
}

function onSave(
  stopId: string,
  data: { time: string; name: string; tag: string; summary: string; detail: string },
) {
  emit('save-stop', { stopId, data })
}

// 存檔後樂觀關閉表單，不等父層重載完成。
function handleSaved(stopId: string, data: Parameters<typeof onSave>[1]) {
  onSave(stopId, data)
  editingStopId.value = null
}
</script>

<template>
  <section>
    <h2 class="font-serif text-sm text-ink/50 mb-3">景點行程細節</h2>
    <div class="flex flex-col gap-2">
      <div
        v-for="(stop, i) in stops"
        :id="`acc-${i}`"
        :key="stop.id"
        class="acc-card rounded-lg"
        :class="{ active: activeStopIndex === i, open: openStops.has(i) }"
      >
        <div class="acc-head flex items-center justify-between gap-3 px-4 py-3" @click="emit('toggle', i)">
          <div class="flex items-center gap-3 min-w-0">
            <span class="text-xs text-ink/40 tabular-nums shrink-0">{{ stop.time }}</span>
            <span class="text-sm font-medium truncate">{{ stop.name }}</span>
            <span
              v-if="stop.tag"
              class="text-[11px] px-2 py-0.5 rounded-full shrink-0"
              :class="tagClass[stop.tag]"
              >{{ stop.tag }}</span
            >
          </div>
          <svg class="acc-chevron shrink-0 text-ink/40" width="14" height="14" viewBox="0 0 14 14">
            <path
              d="M2 5 L7 10 L12 5"
              stroke="currentColor"
              stroke-width="1.6"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
        <div class="acc-body">
          <div class="acc-body-inner px-4 pb-4">
            <!-- detail 內含 HTML <a>，依 ADR 003（信任圈可編輯）用 v-html 渲染 -->
            <p class="text-sm text-ink/70 leading-relaxed" v-html="stop.detail"></p>
            <div v-if="stop.images.length" class="flex gap-2 flex-wrap mt-3">
              <img
                v-for="(img, imgI) in stop.images"
                :key="img.id"
                :src="img.url"
                :alt="img.caption"
                loading="lazy"
                class="img-thumb w-20 h-20 rounded-md border border-line"
                @click="emit('open-lightbox', { images: stop.images, index: imgI })"
              />
            </div>

            <!-- 編輯控制列：只有 isEditor 才顯示 -->
            <div v-if="isEditor" class="mt-3 flex items-center gap-2 border-t border-line pt-3">
              <button
                type="button"
                class="rounded-md border border-line px-2.5 py-1 text-xs text-ink/70 hover:bg-line/40"
                @click="toggleEdit(stop.id)"
              >
                {{ editingStopId === stop.id ? '收起編輯' : '編輯' }}
              </button>
              <button
                type="button"
                class="rounded-md border border-line px-2.5 py-1 text-xs text-ink/70 hover:bg-line/40 disabled:opacity-40"
                :disabled="i === 0"
                title="上移"
                @click="emit('move-stop', { index: i, direction: -1 })"
              >
                ↑
              </button>
              <button
                type="button"
                class="rounded-md border border-line px-2.5 py-1 text-xs text-ink/70 hover:bg-line/40 disabled:opacity-40"
                :disabled="i === stops.length - 1"
                title="下移"
                @click="emit('move-stop', { index: i, direction: 1 })"
              >
                ↓
              </button>
              <button
                type="button"
                class="ml-auto rounded-md px-2.5 py-1 text-xs text-maple hover:underline"
                @click="emit('trash-stop', stop.id)"
              >
                刪除
              </button>
            </div>

            <!-- 編輯表單：展開時才掛載 -->
            <StopEditForm
              v-if="isEditor && editingStopId === stop.id"
              :stop="stop"
              :saving="savingStopId === stop.id"
              @save="(data) => handleSaved(stop.id, data)"
              @cancel="editingStopId = null"
              @images-changed="emit('images-changed')"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
