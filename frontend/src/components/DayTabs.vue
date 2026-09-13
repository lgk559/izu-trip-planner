<script setup lang="ts">
import type { ItineraryDay } from '@/types/itinerary'

defineProps<{
  days: ItineraryDay[]
  currentDay: number
}>()

const emit = defineEmits<{
  (e: 'switch', index: number): void
}>()
</script>

<template>
  <nav class="flex items-center gap-6 border-b border-line mb-6 overflow-x-auto">
    <button
      v-for="(day, i) in days"
      :key="day.id"
      class="tab-btn shrink-0 pb-3 text-sm font-medium whitespace-nowrap"
      :class="{ active: i === currentDay }"
      @click="emit('switch', i)"
    >
      Day{{ day.dayNumber
      }}<span class="ml-1 text-xs text-ink/40">{{ day.dateLabel }}（{{ day.weekday }}）</span>
    </button>
  </nav>
</template>
