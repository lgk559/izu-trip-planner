<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import type { ItineraryImage } from '@/types/itinerary'

const props = defineProps<{
  images: ItineraryImage[]
  index: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'step', delta: number): void
}>()

const current = computed<ItineraryImage | null>(() => props.images[props.index] ?? null)
const isMulti = computed(() => props.images.length > 1)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
  if (e.key === 'ArrowLeft') emit('step', -1)
  if (e.key === 'ArrowRight') emit('step', 1)
}

// 這個元件是用 v-if 動態掛載／卸載（不是整頁常駐），
// 所以 keydown listener 必須在掛載時註冊、卸載時移除，成對出現避免洩漏。
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    id="lightbox"
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    @click.self="emit('close')"
  >
    <button
      class="lightbox-nav absolute top-4 right-4 text-white/80 hover:text-white text-3xl leading-none"
      @click="emit('close')"
    >
      &times;
    </button>
    <button
      v-if="isMulti"
      class="lightbox-nav absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl px-2"
      @click="emit('step', -1)"
    >
      &#8249;
    </button>
    <button
      v-if="isMulti"
      class="lightbox-nav absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl px-2"
      @click="emit('step', 1)"
    >
      &#8250;
    </button>
    <div v-if="current" class="max-w-3xl w-full flex flex-col items-center gap-3">
      <img
        :src="current.url"
        :alt="current.caption"
        class="max-h-[75vh] w-auto rounded-md object-contain"
      />
      <p class="text-white/80 text-sm text-center px-4">{{ current.caption }}</p>
    </div>
  </div>
</template>
