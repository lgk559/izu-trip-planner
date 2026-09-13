<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import type { ItineraryImage, ItineraryStop } from '@/types/itinerary'
import { useEditor } from '@/composables/useEditor'
import StopEditForm from '@/components/StopEditForm.vue'

// 本元件掛在「某個正式景點」底下，負責它的備選區塊：
//   - 已有備選：摺疊呈現備選內容（time/tag/name/summary/detail/圖片），可編輯/刪除/切換為正式
//   - 沒有備選：顯示「+ 備案」入口，展開後兩選項——新建 / 連結既有景點
// 編輯備選一律重用 StopEditForm（唯一硬性要求），不另做編輯表單。
const props = defineProps<{
  // 這張卡片對應的正式景點（含它的 alternative / alternativeGroupId / sortOrder / dayId 資訊）
  primaryStop: ItineraryStop
  dayId: string
  tripId: string
  isEditor: boolean
  savingStopId: string | null
}>()

const emit = defineEmits<{
  // 圖片 lightbox：與正式景點共用同一套 emit，往上轉發到 App
  (e: 'open-lightbox', payload: { images: ItineraryImage[]; index: number }): void
  // 編輯備選存檔（重用 StopEditForm 的 save）：payload 帶備選自己的 id
  (
    e: 'save-stop',
    payload: {
      stopId: string
      data: { time: string; name: string; tag: string; summary: string; detail: string }
    },
  ): void
  // 刪除備選：沿用既有 trash-stop，傳備選 id
  (e: 'trash-stop', stopId: string): void
  // 切換為正式
  (e: 'switch-primary', payload: { groupId: string; newPrimaryStopId: string }): void
  // 解除備案關聯，退回成當天一個獨立的正式景點
  (e: 'detach-alternative', payload: { stopId: string; dayId: string }): void
  // 新建備選
  (
    e: 'create-alternative',
    payload: {
      primaryStopId: string
      primaryGroupId: string | null
      sortOrder: number
      data: { time: string; name: string; tag: string; summary: string; detail: string }
    },
  ): void
  // 連結既有景點為備選
  (
    e: 'link-alternative',
    payload: { primaryStopId: string; primaryGroupId: string | null; otherStopId: string },
  ): void
  // StopEditForm 圖片操作成功後往上轉發，最終由 App reload
  (e: 'images-changed'): void
}>()

// 候選清單由本元件自己呼叫載入（只在使用者點「連結既有」時才需要，
// 由父層預抓會為每張卡片都撈一次、多數用不到，浪費請求）。
const { loadAlternativeCandidates } = useEditor()

// tag 樣式（與 StopDetails 一致，沿用原 HTML 命名）
const tagClass: Record<string, string> = {
  交通: 'tag-transport',
  下車參觀: 'tag-visit',
  入內參觀: 'tag-enter',
  住宿: 'tag-stay',
}

// ---- 已有備選：摺疊區塊 ----
const altExpanded = ref(false) // 預設收合
const editingAlt = ref(false) // 是否正在編輯備選（掛 StopEditForm）

function onSaveAlt(data: { time: string; name: string; tag: string; summary: string; detail: string }) {
  if (!props.primaryStop.alternative) return
  emit('save-stop', { stopId: props.primaryStop.alternative.id, data })
  editingAlt.value = false // 樂觀關閉，比照 StopDetails 既有做法
}

function onSwitchPrimary() {
  const alt = props.primaryStop.alternative
  if (!alt || !props.primaryStop.alternativeGroupId) return
  emit('switch-primary', {
    groupId: props.primaryStop.alternativeGroupId,
    newPrimaryStopId: alt.id,
  })
}

function onDetach() {
  const alt = props.primaryStop.alternative
  if (!alt) return
  emit('detach-alternative', { stopId: alt.id, dayId: props.dayId })
}

// ---- 沒有備選：新增入口（新建 / 連結既有）----
type AddMode = null | 'create' | 'link'
const addMode = ref<AddMode>(null)

// 新建表單本地狀態（欄位與 StopEditForm 一致，但這是「新增」情境不重用 StopEditForm——
// StopEditForm 依賴一個既有 stop.id 來管理圖片，新建時還沒有 id，故此處只做純文字表單）
const createForm = reactive({ time: '', name: '', tag: '', summary: '', detail: '' })
const TAG_OPTIONS = ['', '交通', '下車參觀', '入內參觀', '住宿']

function resetCreateForm() {
  createForm.time = ''
  createForm.name = ''
  createForm.tag = ''
  createForm.summary = ''
  createForm.detail = ''
}

function onSubmitCreate() {
  emit('create-alternative', {
    primaryStopId: props.primaryStop.id,
    primaryGroupId: props.primaryStop.alternativeGroupId,
    sortOrder: props.primaryStop.sortOrder,
    data: { ...createForm },
  })
  resetCreateForm()
  addMode.value = null
}

// 連結既有：進入 link 模式時載入候選（含回收站，status 用來在選項上標示來源）
const candidates = ref<{ id: string; name: string; time: string; status: 'active' | 'trashed' }[]>(
  [],
)
const candidatesLoading = ref(false)
const candidatesError = ref<string | null>(null)
const selectedCandidateId = ref('')

async function loadCandidates() {
  candidatesLoading.value = true
  candidatesError.value = null
  const result = await loadAlternativeCandidates(props.dayId, props.primaryStop.id, props.tripId)
  candidatesLoading.value = false
  if (result.ok) {
    candidates.value = result.data
    selectedCandidateId.value = result.data[0]?.id ?? ''
  } else {
    candidatesError.value = result.message ?? '候選清單載入失敗。'
  }
}

function onSubmitLink() {
  if (!selectedCandidateId.value) return
  emit('link-alternative', {
    primaryStopId: props.primaryStop.id,
    primaryGroupId: props.primaryStop.alternativeGroupId,
    otherStopId: selectedCandidateId.value,
  })
  selectedCandidateId.value = ''
  addMode.value = null
}

// 切到 link 模式就載入候選；切離就清空選取
watch(addMode, (mode) => {
  if (mode === 'link') loadCandidates()
  else selectedCandidateId.value = ''
})
</script>

<template>
  <!-- 只有編輯者看得到備案相關 UI -->
  <div v-if="isEditor" class="mt-3 border-t border-line pt-3">
    <!-- A. 已有備選：摺疊區塊 -->
    <template v-if="primaryStop.alternative">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-2 text-xs text-moss hover:underline"
        @click="altExpanded = !altExpanded"
      >
        <span>備案：{{ primaryStop.alternative.name }}</span>
        <span class="text-ink/40">{{ altExpanded ? '收合' : '展開' }}</span>
      </button>

      <div v-if="altExpanded" class="mt-2 rounded-md border border-dashed border-moss/50 bg-line/10 p-3">
        <!-- 備選內容：與正式卡片一致的呈現 -->
        <div class="flex items-center gap-2">
          <span class="text-xs text-ink/40 tabular-nums shrink-0">{{ primaryStop.alternative.time }}</span>
          <span class="text-sm font-medium">{{ primaryStop.alternative.name }}</span>
          <span
            v-if="primaryStop.alternative.tag"
            class="text-[11px] px-2 py-0.5 rounded-full shrink-0"
            :class="tagClass[primaryStop.alternative.tag]"
            >{{ primaryStop.alternative.tag }}</span
          >
        </div>
        <p
          v-if="primaryStop.alternative.detail"
          class="mt-2 text-sm text-ink/70 leading-relaxed"
          v-html="primaryStop.alternative.detail"
        ></p>
        <div v-if="primaryStop.alternative.images.length" class="mt-2 flex flex-wrap gap-2">
          <img
            v-for="(img, imgI) in primaryStop.alternative.images"
            :key="img.id"
            :src="img.url"
            :alt="img.caption"
            loading="lazy"
            class="img-thumb w-20 h-20 rounded-md border border-line"
            @click="emit('open-lightbox', { images: primaryStop.alternative!.images, index: imgI })"
          />
        </div>

        <!-- 備選操作列 -->
        <div class="mt-3 flex items-center gap-2">
          <button
            type="button"
            class="rounded-md border border-line px-2.5 py-1 text-xs text-ink/70 hover:bg-line/40"
            @click="editingAlt = !editingAlt"
          >
            {{ editingAlt ? '收起編輯' : '編輯' }}
          </button>
          <button
            type="button"
            class="rounded-md border border-line px-2.5 py-1 text-xs text-moss hover:bg-line/40"
            @click="onSwitchPrimary"
          >
            切換為正式
          </button>
          <button
            type="button"
            class="rounded-md border border-line px-2.5 py-1 text-xs text-ink/70 hover:bg-line/40"
            @click="onDetach"
          >
            解除備案
          </button>
          <button
            type="button"
            class="ml-auto rounded-md px-2.5 py-1 text-xs text-maple hover:underline"
            @click="emit('trash-stop', primaryStop.alternative.id)"
          >
            刪除
          </button>
        </div>

        <!-- 編輯備選：重用 StopEditForm，傳備選當 :stop -->
        <StopEditForm
          v-if="editingAlt"
          :stop="primaryStop.alternative"
          :saving="savingStopId === primaryStop.alternative.id"
          @save="onSaveAlt"
          @cancel="editingAlt = false"
          @images-changed="emit('images-changed')"
        />
      </div>
    </template>

    <!-- B. 沒有備選：新增入口 -->
    <template v-else>
      <!-- 收合狀態：一個入口按鈕 -->
      <button
        v-if="addMode === null"
        type="button"
        class="rounded-md border border-dashed border-line px-2.5 py-1 text-xs text-moss hover:bg-line/30"
        @click="addMode = 'create'"
      >
        ＋ 備案
      </button>

      <!-- 展開狀態：新建 / 連結既有 兩選項 + 對應面板 -->
      <div v-else class="rounded-md border border-dashed border-moss/50 bg-line/10 p-3">
        <div class="mb-3 flex items-center gap-2">
          <button
            type="button"
            class="rounded-md px-2.5 py-1 text-xs"
            :class="addMode === 'create' ? 'bg-moss text-white' : 'border border-line text-ink/70'"
            @click="addMode = 'create'"
          >
            新建
          </button>
          <button
            type="button"
            class="rounded-md px-2.5 py-1 text-xs"
            :class="addMode === 'link' ? 'bg-moss text-white' : 'border border-line text-ink/70'"
            @click="addMode = 'link'"
          >
            連結既有景點
          </button>
          <button
            type="button"
            class="ml-auto text-xs text-ink/50 hover:text-ink"
            @click="addMode = null"
          >
            取消
          </button>
        </div>

        <!-- 新建表單（純文字，欄位與 StopEditForm 一致；不重用 StopEditForm 見設計說明） -->
        <div v-if="addMode === 'create'" class="flex flex-col gap-3">
          <div class="grid grid-cols-2 gap-3">
            <label class="flex flex-col gap-1 text-xs text-ink/50">
              時間
              <input
                v-model="createForm.time"
                type="text"
                class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <label class="flex flex-col gap-1 text-xs text-ink/50">
              標籤
              <select
                v-model="createForm.tag"
                class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
              >
                <option v-for="opt in TAG_OPTIONS" :key="opt" :value="opt">
                  {{ opt || '（無）' }}
                </option>
              </select>
            </label>
          </div>
          <label class="flex flex-col gap-1 text-xs text-ink/50">
            名稱
            <input
              v-model="createForm.name"
              type="text"
              class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <label class="flex flex-col gap-1 text-xs text-ink/50">
            摘要（時間軸顯示）
            <input
              v-model="createForm.summary"
              type="text"
              class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <label class="flex flex-col gap-1 text-xs text-ink/50">
            細節（可含 HTML 連結）
            <textarea
              v-model="createForm.detail"
              rows="4"
              class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink leading-relaxed"
            ></textarea>
          </label>
          <div class="flex justify-end">
            <button
              type="button"
              class="rounded-md bg-maple px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              :disabled="!createForm.name.trim()"
              @click="onSubmitCreate"
            >
              新增備案
            </button>
          </div>
        </div>

        <!-- 連結既有景點：下拉選單 -->
        <div v-else-if="addMode === 'link'" class="flex flex-col gap-3">
          <p v-if="candidatesLoading" class="text-xs text-ink/50">候選景點載入中…</p>
          <p v-else-if="candidatesError" class="text-xs text-maple">{{ candidatesError }}</p>
          <p v-else-if="candidates.length === 0" class="text-xs text-ink/50">
            沒有可連結的景點（需為未關聯備案的獨立景點：同一天的現有景點，或整趟旅遊回收站裡的任一景點）。
          </p>
          <template v-else>
            <label class="flex flex-col gap-1 text-xs text-ink/50">
              選擇要連結為備案的景點（同一天的現有景點＋整趟旅遊回收站的景點，回收站的連結後會一併復原）
              <select
                v-model="selectedCandidateId"
                class="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
              >
                <option v-for="c in candidates" :key="c.id" :value="c.id">
                  {{ c.time ? `${c.time}｜` : '' }}{{ c.name }}{{ c.status === 'trashed' ? '（回收站）' : '' }}
                </option>
              </select>
            </label>
            <div class="flex justify-end">
              <button
                type="button"
                class="rounded-md bg-maple px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                :disabled="!selectedCandidateId"
                @click="onSubmitLink"
              >
                連結為備案
              </button>
            </div>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>
