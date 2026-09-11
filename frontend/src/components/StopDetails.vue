<script setup lang="ts">
import type { ItineraryImage, ItineraryStop } from '@/types/itinerary'

defineProps<{
  stops: ItineraryStop[]
  activeStopIndex: number | null
  openStops: Set<number>
}>()

const emit = defineEmits<{
  (e: 'toggle', index: number): void
  (e: 'open-lightbox', payload: { images: ItineraryImage[]; index: number }): void
}>()

// tag 對應的 CSS class（沿用原 HTML 的樣式命名）
const tagClass: Record<string, string> = {
  交通: 'tag-transport',
  下車參觀: 'tag-visit',
  入內參觀: 'tag-enter',
  住宿: 'tag-stay',
}
</script>

<template>
  <section>
    <h2 class="font-serif text-sm text-ink/50 mb-3">景點行程細節</h2>
    <div class="flex flex-col gap-2">
      <div
        v-for="(stop, i) in stops"
        :id="`acc-${i}`"
        :key="i"
        class="acc-card rounded-lg"
        :class="{ active: activeStopIndex === i, open: openStops.has(i) }"
      >
        <div class="acc-head flex items-center justify-between gap-3 px-4 py-3" @click="emit('toggle', i)">
          <div class="flex items-center gap-3 min-w-0">
            <span class="text-xs text-ink/40 tabular-nums shrink-0">{{ stop.time }}</span>
            <span class="text-sm font-medium truncate">{{ stop.name }}</span>
            <span class="text-[11px] px-2 py-0.5 rounded-full shrink-0" :class="tagClass[stop.tag]">{{
              stop.tag
            }}</span>
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
                :key="imgI"
                :src="img.url"
                :alt="img.caption"
                loading="lazy"
                class="img-thumb w-20 h-20 rounded-md border border-line"
                @click="emit('open-lightbox', { images: stop.images, index: imgI })"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
