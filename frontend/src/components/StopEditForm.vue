<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import type { ItineraryStop } from '@/types/itinerary'
import { useEditor } from '@/composables/useEditor'

const props = defineProps<{
  stop: ItineraryStop
  saving: boolean
}>()

const emit = defineEmits<{
  (e: 'save', payload: { time: string; name: string; tag: string; summary: string; detail: string }): void
  (e: 'cancel'): void
  // 圖片有變動（上傳/改 caption/刪除成功）→ 通知父層 reload（沿用「畫面=資料庫」慣例）。
  (e: 'images-changed'): void
}>()

// 圖片操作自包含在本元件（比照 DayManagerModal 的先例）：
// 直接呼叫 useEditor 的圖片 API，成功後只 emit('images-changed')，
// 不為每種圖片操作各開一組 emit/handler 給父層。
const { uploadImage, updateImageCaption, deleteImage } = useEditor()

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

// ---- 圖片管理 ----

const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5MB（與 useEditor 一致，前端先擋一次給即時提示）
const imageError = ref<string | null>(null)

// 上傳中：擋重複點擊、顯示 loading 文字。
const uploading = ref(false)
// input file 的 ref：上傳完清空 value，讓同一張圖可以再次選取觸發 change。
const fileInput = ref<HTMLInputElement | null>(null)

// 每張圖 caption 的本地編輯值（key = imageId）。切換景點時重建。
const captionDrafts = reactive<Record<string, string>>({})
// 正在儲存 caption 的 imageId（顯示該列 loading）。
const savingCaptionId = ref<string | null>(null)
// 正在刪除的 imageId（顯示該列 loading、擋重複點擊）。
const deletingImageId = ref<string | null>(null)

// 切換景點時，用該景點目前的圖片重建 caption 草稿。
watch(
  () => props.stop.id,
  () => resetCaptionDrafts(),
  { immediate: true },
)

// 圖片清單本身變動（父層 reload 後 props.stop.images 換新）時，也重建草稿，
// 讓新上傳圖片的 caption 欄位出現、已刪圖片的草稿清掉。
watch(
  () => props.stop.images.map((img) => img.id).join(','),
  () => resetCaptionDrafts(),
)

function resetCaptionDrafts() {
  for (const key of Object.keys(captionDrafts)) delete captionDrafts[key]
  for (const img of props.stop.images) captionDrafts[img.id] = img.caption
}

// 選檔／貼上圖片後「暫存」的一張（一次只暫存一張，選新的/貼新的會取代舊的暫存）。
// 只做本地預覽＋可選填說明，不呼叫任何 API——實際上傳延後到使用者按下「上傳」，
// 讓使用者能先看清楚選對圖了沒、想加說明文字再一起送出。
const pendingFile = ref<File | null>(null)
const pendingPreviewUrl = ref<string | null>(null)
const pendingCaption = ref('')

// object URL 是瀏覽器配置的本地資源，用完（取消/上傳成功/元件卸載）要 revoke 釋放，
// 不然每暫存一張圖就洩漏一份記憶體。
function clearPending() {
  if (pendingPreviewUrl.value) URL.revokeObjectURL(pendingPreviewUrl.value)
  pendingFile.value = null
  pendingPreviewUrl.value = null
  pendingCaption.value = ''
}

// 選檔案／貼上圖片共用的暫存流程：前端先擋大小（擋下就不進暫存，也不呼叫任何 API）。
function stageFile(file: File) {
  imageError.value = null

  if (file.size > MAX_IMAGE_BYTES) {
    imageError.value = '圖片超過 5MB，請壓縮或換一張較小的圖片。'
    return
  }

  clearPending()
  pendingFile.value = file
  pendingPreviewUrl.value = URL.createObjectURL(file)
}

function onSelectFile(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (fileInput.value) fileInput.value.value = '' // 先清空，讓同一張圖也能再次選取觸發 change
  if (!file) return
  stageFile(file)
}

// 貼上剪貼簿圖片（截圖、複製的圖片檔）：只認第一個圖片類型的項目，
// 有文字混在剪貼簿裡（例如同時複製了文字+圖片）不影響文字照常貼進聚焦的欄位，
// 這裡只額外把圖片部分另外拿去暫存，不 preventDefault。
function onPaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) {
        stageFile(file)
        break
      }
    }
  }
}

// 確認上傳暫存的圖片：caption 隨這次 insert 一起存，不用上傳完再多打一次 API 改說明。
async function onConfirmUpload() {
  if (!pendingFile.value) return
  imageError.value = null
  uploading.value = true
  const result = await uploadImage(props.stop.id, pendingFile.value, pendingCaption.value)
  uploading.value = false

  if (!result.ok) {
    imageError.value = result.message ?? '上傳失敗，請再試一次。'
    return // 保留暫存，讓使用者不用重選圖片就能重試
  }
  clearPending()
  emit('images-changed')
}

function onCancelPending() {
  clearPending()
}

// 只在這張表單開著時監聽，避免變成整頁到處貼圖都觸發暫存（比照 Lightbox.vue 的既有模式）。
onMounted(() => document.addEventListener('paste', onPaste))
onUnmounted(() => {
  document.removeEventListener('paste', onPaste)
  clearPending()
})

async function onSaveCaption(imageId: string) {
  imageError.value = null
  savingCaptionId.value = imageId
  const result = await updateImageCaption(imageId, captionDrafts[imageId] ?? '')
  savingCaptionId.value = null
  if (!result.ok) {
    imageError.value = result.message ?? '說明儲存失敗，請再試一次。'
    return
  }
  emit('images-changed')
}

async function onDeleteImage(imageId: string) {
  imageError.value = null
  deletingImageId.value = imageId
  const result = await deleteImage(imageId)
  deletingImageId.value = null
  if (!result.ok) {
    imageError.value = result.message ?? '圖片刪除失敗，請再試一次。'
    return
  }
  emit('images-changed')
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

    <!-- 圖片管理區塊：自包含，操作成功 emit images-changed -->
    <div class="flex flex-col gap-2 border-t border-line pt-3">
      <span class="text-xs text-ink/50">圖片管理</span>
      <p class="text-xs text-ink/40">可選擇檔案，或直接貼上剪貼簿裡的圖片（Ctrl+V／⌘V），單張上限 5MB</p>

      <!-- 選擇檔案 -->
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        :disabled="uploading"
        class="text-sm text-ink file:mr-2 file:rounded-md file:border file:border-line file:bg-white file:px-2 file:py-1 file:text-xs file:text-ink/70 disabled:opacity-50"
        @change="onSelectFile"
      />

      <p v-if="imageError" class="text-xs text-maple">{{ imageError }}</p>

      <!-- 暫存待上傳的圖片：選檔/貼上後先預覽＋可填說明，按「上傳」才真的送出 -->
      <div
        v-if="pendingFile"
        class="flex items-start gap-3 rounded-md border border-dashed border-moss bg-white p-2"
      >
        <img
          :src="pendingPreviewUrl!"
          alt="待上傳圖片預覽"
          class="w-16 h-16 shrink-0 rounded-md border border-line object-cover"
        />
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <input
            v-model="pendingCaption"
            type="text"
            placeholder="圖片說明（選填）"
            class="rounded-md border border-line bg-white px-2 py-1 text-sm text-ink"
          />
          <div class="flex items-center gap-3">
            <button
              type="button"
              class="text-xs font-medium text-moss hover:underline disabled:opacity-50"
              :disabled="uploading"
              @click="onConfirmUpload"
            >
              {{ uploading ? '上傳中…' : '上傳' }}
            </button>
            <button
              type="button"
              class="ml-auto text-xs text-ink/50 hover:text-ink disabled:opacity-50"
              :disabled="uploading"
              @click="onCancelPending"
            >
              取消
            </button>
          </div>
        </div>
      </div>

      <!-- 現有圖片：縮圖 + caption 編輯 + 刪除 -->
      <div
        v-for="img in stop.images"
        :key="img.id"
        class="flex items-start gap-3 rounded-md border border-line bg-white p-2"
      >
        <img
          :src="img.url"
          :alt="img.caption"
          loading="lazy"
          class="w-16 h-16 shrink-0 rounded-md border border-line object-cover"
        />
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <input
            v-model="captionDrafts[img.id]"
            type="text"
            placeholder="圖片說明"
            class="rounded-md border border-line bg-white px-2 py-1 text-sm text-ink"
          />
          <div class="flex items-center gap-3">
            <button
              type="button"
              class="text-xs text-moss hover:underline disabled:opacity-50"
              :disabled="savingCaptionId === img.id"
              @click="onSaveCaption(img.id)"
            >
              {{ savingCaptionId === img.id ? '儲存中…' : '儲存說明' }}
            </button>
            <button
              type="button"
              class="ml-auto text-xs text-maple hover:underline disabled:opacity-50"
              :disabled="deletingImageId === img.id"
              @click="onDeleteImage(img.id)"
            >
              {{ deletingImageId === img.id ? '刪除中…' : '刪除' }}
            </button>
          </div>
        </div>
      </div>
    </div>

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
