<script setup lang="ts">
import { computed } from 'vue'
import type { ItineraryStop } from '@/types/itinerary'
import type { TravelGap } from '@/composables/useEditor'

const props = defineProps<{
  stops: ItineraryStop[]
  activeStopIndex: number | null
  // Phase 5：相鄰景點間隔的路程狀態（長度 = stops.length - 1）。
  // null 代表尚未載入 → 所有間隔都顯示「尚未計算」。
  travelGaps: TravelGap[] | null
  isEditor: boolean
  computingTravelTimes: boolean
}>()

const emit = defineEmits<{
  (e: 'focus', index: number): void
  (e: 'compute-travel-times'): void
}>()

// 把「時間軸上每個位置對應的路程間隔」預先算成具名陣列，template 只讀單一
// 區域變數，避免重複索引存取導致 vue-tsc 跨行窄化失效。
const gapsByIndex = computed<(TravelGap | null)[]>(() =>
  props.stops.map((_, i) => props.travelGaps?.[i] ?? null),
)
</script>

<template>
  <section class="mb-8">
    <div class="mb-3 flex items-center justify-between gap-3">
      <h2 class="font-serif text-sm text-ink/50">今日時間軸</h2>
      <button
        v-if="isEditor"
        type="button"
        class="rounded-md border border-line px-2.5 py-1 text-xs text-moss hover:bg-line/30 disabled:opacity-50"
        :disabled="computingTravelTimes"
        @click="emit('compute-travel-times')"
      >
        {{ computingTravelTimes ? '計算中…' : '計算預估時間' }}
      </button>
    </div>
    <div class="flex flex-col">
      <div
        v-for="(stop, i) in stops"
        :key="i"
        class="tl-item"
        :class="{ active: activeStopIndex === i }"
      >
        <div class="flex gap-3">
          <div class="flex flex-col items-center">
            <div class="tl-dot" @click="emit('focus', i)"></div>
            <div v-if="i < stops.length - 1" class="tl-line"></div>
          </div>
          <div class="tl-row pb-4 -mt-0.5" @click="emit('focus', i)">
            <div class="flex items-baseline gap-2">
              <span class="text-xs text-ink/45 font-medium tabular-nums">{{ stop.time }}</span>
              <span class="tl-name text-sm font-medium">{{ stop.name }}</span>
            </div>
            <p class="text-xs text-ink/50 mt-0.5">{{ stop.summary }}</p>
            <!-- Phase 5：到下一個景點的路程預估（小字淡色，不搶時間軸重點）。
                 用 gapsByIndex 一次取值，避免 template 內重複索引造成窄化失效。 -->
            <template v-if="i < stops.length - 1">
              <p class="mt-1 text-[11px] text-ink/35">
                <template v-if="gapsByIndex[i] && gapsByIndex[i]!.status === 'ok'">
                  約 {{ gapsByIndex[i]!.durationText
                  }}<template v-if="gapsByIndex[i]!.distanceText"
                    >・{{ gapsByIndex[i]!.distanceText }}</template
                  >
                </template>
                <template v-else-if="gapsByIndex[i] && gapsByIndex[i]!.status === 'missing-address'">
                  缺地址，無法估算
                </template>
                <template v-else>尚未計算</template>
              </p>
            </template>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
