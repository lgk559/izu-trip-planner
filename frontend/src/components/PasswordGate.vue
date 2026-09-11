<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from '@/composables/useAuth'

const { verifyPassword } = useAuth()

const password = ref('')
const submitting = ref(false)
const errorMessage = ref<string | null>(null)

async function onSubmit() {
  if (submitting.value || !password.value) return
  submitting.value = true
  errorMessage.value = null

  const result = await verifyPassword(password.value)
  if (!result.ok) {
    errorMessage.value = result.message ?? '密碼錯誤'
    password.value = ''
  }
  // 成功時 isEditor 會變 true，App.vue 會自動切換畫面，這裡不用做事
  submitting.value = false
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-5">
    <div class="w-full max-w-sm">
      <div class="text-center mb-6">
        <p class="text-xs tracking-wide text-moss mb-1">2026年10月・秋</p>
        <h1 class="font-serif text-2xl font-bold text-ink leading-snug">
          伊豆半島 <span class="text-maple">×</span> 河口湖
        </h1>
        <p class="text-sm text-ink/60 mt-2">請輸入共用密碼以檢視行程</p>
      </div>

      <form
        class="rounded-lg bg-[#F7F4EA] border border-line p-5 flex flex-col gap-3"
        @submit.prevent="onSubmit"
      >
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          placeholder="共用密碼"
          class="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-maple"
          :disabled="submitting"
        />
        <button
          type="submit"
          class="w-full rounded-md bg-indigo px-3 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
          :disabled="submitting || !password"
        >
          {{ submitting ? '驗證中…' : '進入行程' }}
        </button>
        <p v-if="errorMessage" class="text-xs text-maple text-center">
          {{ errorMessage }}
        </p>
      </form>
    </div>
  </div>
</template>
