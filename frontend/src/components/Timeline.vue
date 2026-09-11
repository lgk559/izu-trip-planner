<script setup lang="ts">
import type { ItineraryStop } from '@/types/itinerary'

defineProps<{
  stops: ItineraryStop[]
  activeStopIndex: number | null
}>()

const emit = defineEmits<{
  (e: 'focus', index: number): void
}>()
</script>

<template>
  <section class="mb-8">
    <h2 class="font-serif text-sm text-ink/50 mb-3">今日時間軸</h2>
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
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
