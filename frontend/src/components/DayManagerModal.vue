<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useEditor } from '@/composables/useEditor'
import type { ItineraryDay } from '@/types/itinerary'

// modal 自己 import useEditor 直接呼叫 API，成功後只 emit('changed') 讓父層 reload。
// 這樣天數管理的資料流內聚在此元件，父層（App.vue）不需再為每種操作各開一個 handler。
const props = defineProps<{
  days: ItineraryDay[] // 已排除特別天，依 sortOrder 升冪
  tripId: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'changed'): void // 有寫入成功、父層需重新整理
}>()

const { updateDayLabel, insertDayAt, deleteDayAt } = useEditor()

// ---- 天數列表逐項編輯 ----
// 目前正在編輯哪一天（dayId），null = 都在檢視狀態。
const editingDayId = ref<string | null>(null)
const labelForm = reactive({ dateLabel: '', weekday: '' })
const savingLabel = ref(false)

function startEditLabel(day: ItineraryDay) {
  editingDayId.value = day.id
  labelForm.dateLabel = day.dateLabel
  labelForm.weekday = day.weekday
  clearMessages()
}

function cancelEditLabel() {
  editingDayId.value = null
}

async function saveLabel(dayId: string) {
  savingLabel.value = true
  const result = await updateDayLabel(dayId, {
    dateLabel: labelForm.dateLabel,
    weekday: labelForm.weekday,
  })
  savingLabel.value = false
  if (!result.ok) {
    errorMsg.value = result.message ?? '儲存失敗，請再試一次。'
    return
  }
  editingDayId.value = null
  successMsg.value = '已儲存'
  emit('changed')
}

// ---- 新增區塊 ----
const insertPosition = ref<number>(props.days.length + 1)
const inserting = ref(false)

async function onInsert() {
  clearMessages()
  const pos = Number(insertPosition.value)
  // 前端範圍檢查：1 ~ 目前天數 + 1。超出擋下，不送 API。
  if (!Number.isInteger(pos) || pos < 1 || pos > props.days.length + 1) {
    errorMsg.value = `請輸入 1 到 ${props.days.length + 1} 之間的數字。`
    return
  }
  inserting.value = true
  const result = await insertDayAt(
    props.tripId,
    pos,
    props.days.map((d) => ({ id: d.id, sortOrder: d.sortOrder })),
  )
  inserting.value = false
  if (!result.ok) {
    errorMsg.value = result.message ?? '新增失敗，請再試一次。'
    return
  }
  successMsg.value = '已新增'
  emit('changed')
}

// ---- 刪除區塊 ----
const deletePosition = ref<number>(1)
const deleting = ref(false)

async function onDelete() {
  clearMessages()
  const pos = Number(deletePosition.value)
  // 前端範圍檢查：1 ~ 目前天數。超出擋下，不送 API。
  if (!Number.isInteger(pos) || pos < 1 || pos > props.days.length) {
    errorMsg.value = `請輸入 1 到 ${props.days.length} 之間的數字。`
    return
  }
  const target = props.days[pos - 1]
  deleting.value = true
  const result = await deleteDayAt(props.tripId, { id: target.id, sortOrder: target.sortOrder })
  deleting.value = false
  if (!result.ok) {
    errorMsg.value = result.message ?? '刪除失敗，請再試一次。'
    return
  }
  successMsg.value = '已刪除'
  emit('changed')
}

// 天數變動後（新增/刪除成功、父層 reload 完成），輸入框的預設值跟著重算，
// 避免使用者連續操作時看到殘留的舊數字（reviewer 審查 W1）。
watch(
  () => props.days.length,
  (len) => {
    insertPosition.value = len + 1
    deletePosition.value = 1
  },
)

// ---- 訊息 ----
const errorMsg = ref<string | null>(null)
const successMsg = ref<string | null>(null)
function clearMessages() {
  errorMsg.value = null
  successMsg.value = null
}

const dayCount = computed(() => props.days.length)
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    style="background: rgba(0, 0, 0, 0.88)"
    @click.self="emit('close')"
  >
    <div
      class="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-lg border border-line bg-[#F7F4EA] p-5"
    >
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-serif text-lg font-bold text-ink">編輯日期</h2>
        <button
          type="button"
          class="text-ink/50 hover:text-ink text-2xl leading-none"
          @click="emit('close')"
        >
          &times;
        </button>
      </div>

      <!-- 全域訊息 -->
      <p v-if="errorMsg" class="mb-3 text-sm text-maple">{{ errorMsg }}</p>
      <p v-if="successMsg" class="mb-3 text-sm text-moss">{{ successMsg }}</p>

      <!-- a. 天數列表：逐項編輯 date_label / weekday -->
      <section class="mb-6">
        <h3 class="text-xs font-medium text-ink/50 mb-2">目前天數</h3>
        <p v-if="dayCount === 0" class="text-xs text-ink/40">目前沒有任何天，請於下方新增。</p>
        <div v-else class="flex flex-col gap-2">
          <div
            v-for="(day, i) in days"
            :key="day.id"
            class="rounded-md border border-line bg-white px-3 py-2"
          >
            <!-- 檢視 -->
            <template v-if="editingDayId !== day.id">
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm text-ink">
                  <span class="text-ink/40 mr-1">Day{{ i + 1 }}</span>
                  {{ day.dateLabel }}（{{ day.weekday }}）
                </span>
                <button
                  type="button"
                  class="shrink-0 rounded-md border border-line px-2 py-0.5 text-xs text-ink/70 hover:bg-line/40"
                  @click="startEditLabel(day)"
                >
                  編輯
                </button>
              </div>
            </template>
            <!-- 編輯 -->
            <template v-else>
              <div class="flex flex-col gap-2">
                <label class="flex flex-col gap-1 text-xs text-ink/50">
                  日期文字
                  <input
                    v-model="labelForm.dateLabel"
                    type="text"
                    class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
                  />
                </label>
                <label class="flex flex-col gap-1 text-xs text-ink/50">
                  星期
                  <input
                    v-model="labelForm.weekday"
                    type="text"
                    class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
                  />
                </label>
                <div class="flex gap-2 justify-end">
                  <button
                    type="button"
                    class="rounded-md px-3 py-1 text-xs text-ink/60 hover:text-ink"
                    :disabled="savingLabel"
                    @click="cancelEditLabel"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    class="rounded-md bg-maple px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                    :disabled="savingLabel"
                    @click="saveLabel(day.id)"
                  >
                    {{ savingLabel ? '儲存中…' : '儲存' }}
                  </button>
                </div>
              </div>
            </template>
          </div>
        </div>
      </section>

      <!-- b. 新增區塊 -->
      <section class="mb-6 border-t border-line pt-4">
        <h3 class="text-xs font-medium text-ink/50 mb-2">新增一天</h3>
        <p class="text-xs text-ink/45 mb-2">會新增空白的行程，新增後再到該頁編輯。</p>
        <div class="flex items-end gap-2">
          <label class="flex flex-col gap-1 text-xs text-ink/50">
            要新增第幾天
            <input
              v-model.number="insertPosition"
              type="number"
              min="1"
              :max="dayCount + 1"
              class="w-24 rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <button
            type="button"
            class="rounded-md bg-maple px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            :disabled="inserting"
            @click="onInsert"
          >
            {{ inserting ? '新增中…' : '新增' }}
          </button>
        </div>
      </section>

      <!-- c. 刪除區塊 -->
      <section class="border-t border-line pt-4">
        <h3 class="text-xs font-medium text-ink/50 mb-2">刪除一天</h3>
        <p class="text-xs text-ink/45 mb-2">
          刪除行程的景點會移到回收站，如要復原/永久刪除可到回收站操作。
        </p>
        <div class="flex items-end gap-2">
          <label class="flex flex-col gap-1 text-xs text-ink/50">
            要刪除第幾天
            <input
              v-model.number="deletePosition"
              type="number"
              min="1"
              :max="dayCount"
              class="w-24 rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <button
            type="button"
            class="rounded-md border border-maple px-3 py-1.5 text-xs font-medium text-maple hover:bg-maple/10 disabled:opacity-50"
            :disabled="deleting || dayCount === 0"
            @click="onDelete"
          >
            {{ deleting ? '刪除中…' : '刪除' }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
