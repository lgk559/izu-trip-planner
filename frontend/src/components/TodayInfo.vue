<script setup lang="ts">
import type { ItineraryDay } from '@/types/itinerary'

defineProps<{
  day: ItineraryDay
}>()
</script>

<template>
  <section class="mb-8 rounded-lg bg-[#F7F4EA] border border-line p-4">
    <p class="font-serif text-sm text-indigo mb-3">{{ day.route }}</p>
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
  </section>
</template>
