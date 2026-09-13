import { supabase } from '@/lib/supabase'
import type { ItineraryHotel, ItineraryMeals } from '@/types/itinerary'

// 所有寫入操作的統一回傳型別：UI 端據此決定是否顯示錯誤。
export interface EditorResult {
  ok: boolean
  message?: string // 失敗原因，既有用途不變
  // Phase 4：操作成功但有值得告知使用者的附帶說明（例如「已還原為獨立景點」），
  // 跟 message 分開避免跟既有的錯誤顯示邏輯混在一起。
  note?: string
}

function fail(err: unknown): EditorResult {
  return { ok: false, message: err instanceof Error ? err.message : String(err) }
}

// ---------- 行程頂層資訊（trip）編輯 ----------

// 編輯行程標題與季節標籤（trips.name / trips.season_label）。
async function updateTripInfo(
  tripId: string,
  payload: { name: string; seasonLabel: string },
): Promise<EditorResult> {
  try {
    const { error } = await supabase
      .from('trips')
      .update({ name: payload.name, season_label: payload.seasonLabel })
      .eq('id', tripId)
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// ---------- 天數（day）CRUD ----------

// 編輯某一天的日期文字欄位（date_label / weekday）。純自由文字，不做任何格式驗證。
async function updateDayLabel(
  dayId: string,
  payload: { dateLabel: string; weekday: string },
): Promise<EditorResult> {
  try {
    const { error } = await supabase
      .from('days')
      .update({ date_label: payload.dateLabel, weekday: payload.weekday })
      .eq('id', dayId)
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// 編輯當天資訊：route / meals / hotel 三組欄位存回。
async function updateDayInfo(
  dayId: string,
  payload: { route: string; meals: ItineraryMeals; hotel: ItineraryHotel },
): Promise<EditorResult> {
  try {
    const { error } = await supabase
      .from('days')
      .update({ route: payload.route, meals: payload.meals, hotel: payload.hotel })
      .eq('id', dayId)
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// 取得或建立「特別天」（is_holding=true）：刪除一天前，先把該天景點的 day_id
// 改指到這個永遠存在、永遠不顯示的天，避免刪除 days 列時 FK cascade 連坐砍光景點。
//
// sort_order 隨意給（此處給 0）：只要所有「查最大 sort_order / 決定插入位置」的邏輯
// 都有 is_holding=false 過濾，特別天的 sort_order 值就不會影響任何排序計算的正確性。
async function getOrCreateHoldingDayId(tripId: string): Promise<string> {
  const { data: existing, error: findErr } = await supabase
    .from('days')
    .select('id')
    .eq('trip_id', tripId)
    .eq('is_holding', true)
    .limit(1)
    .maybeSingle<{ id: string }>()
  if (findErr) throw new Error(findErr.message)
  if (existing) return existing.id

  const { data: inserted, error: insertErr } = await supabase
    .from('days')
    .insert({
      trip_id: tripId,
      date_label: '',
      weekday: '',
      route: '',
      meals: {},
      hotel: {},
      sort_order: 0,
      is_holding: true,
    })
    .select('id')
    .single<{ id: string }>()
  if (insertErr) throw new Error(insertErr.message)
  return inserted.id
}

// 新增一天，可插入任意位置（取代舊 addDay）。
// - currentDays：目前畫面上顯示的天（已排除特別天，依 sortOrder 升冪），
//   由呼叫端傳入 days.value.map(d => ({ id, sortOrder }))。
// - position：1-based「要插入成第幾天」，呼叫端已做過 1 ~ currentDays.length+1 範圍檢查，
//   此函式內部不重複檢查範圍。
async function insertDayAt(
  tripId: string,
  position: number,
  currentDays: { id: string; sortOrder: number }[],
): Promise<EditorResult> {
  try {
    let referenceSortOrder: number

    if (position > currentDays.length) {
      // 插在最後：接在現有最大 sort_order 之後，不需位移其他天。
      referenceSortOrder = Math.max(...currentDays.map((d) => d.sortOrder), -1) + 1
    } else {
      // 插在中間/最前：取「目前第 position 天」的 sort_order 當落點，
      // 先把該落點（含）以後的所有天 sort_order 各 +1 騰出位置，再把新天填進來。
      // 位移用 RPC（PostgREST 無法表達 sort_order = sort_order + 1 這種欄位自參照更新）。
      referenceSortOrder = currentDays[position - 1].sortOrder

      const { error: shiftErr } = await supabase.rpc('shift_days_sort_order', {
        p_trip_id: tripId,
        p_from: referenceSortOrder,
        p_delta: 1,
      })
      if (shiftErr) throw new Error(shiftErr.message)
    }

    const { error } = await supabase.from('days').insert({
      trip_id: tripId,
      date_label: `Day${position}`,
      weekday: '-',
      route: '',
      meals: {},
      hotel: {},
      sort_order: referenceSortOrder,
      is_holding: false,
    })
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// 刪除一天，可刪除任意位置（取代舊 deleteDay）。
// 用「特別天」機制避免 FK cascade 連坐砍光底下景點：
//   1. 取得/建立特別天
//   2. 把該天所有景點（不分 active/trashed）搬到特別天並標記 trashed
//      （兩段式 update 等價 coalesce(trashed_at, now())：先補原本 active 的時間戳，
//      再統一搬移，不動已有的 trashed_at——PostgREST 無法表達欄位自參照的 coalesce）
//   3. 刪除該天（此時底下已無景點指向它，cascade 不會連坐）
//   4. 遞補剩餘天的 sort_order（後面的天各 -1，補上空隙，RPC）
// 步驟 2~4 不做交易回滾：規模小、失敗機率低，且部分失敗不會遺失資料（最多排序或
// 訊息需重整後再確認，可接受）。
async function deleteDayAt(
  tripId: string,
  targetDay: { id: string; sortOrder: number },
): Promise<EditorResult> {
  try {
    // 1. 特別天
    const holdingDayId = await getOrCreateHoldingDayId(tripId)

    // 2. 把該天所有景點搬到特別天並標記 trashed（兩段式，等價 coalesce）
    const now = new Date().toISOString()

    const { error: stampErr } = await supabase
      .from('stops')
      .update({ trashed_at: now })
      .eq('day_id', targetDay.id)
      .is('trashed_at', null)
    if (stampErr) throw new Error(stampErr.message)

    const { error: moveErr } = await supabase
      .from('stops')
      .update({ day_id: holdingDayId, status: 'trashed' })
      .eq('day_id', targetDay.id)
    if (moveErr) throw new Error(moveErr.message)

    // 3. 刪除該天
    const { error: delErr } = await supabase.from('days').delete().eq('id', targetDay.id)
    if (delErr) throw new Error(delErr.message)

    // 4. 遞補：把 sort_order 大於被刪天的所有天各 -1，補上空隙
    const { error: shiftErr } = await supabase.rpc('shift_days_sort_order', {
      p_trip_id: tripId,
      p_from: targetDay.sortOrder + 1,
      p_delta: -1,
    })
    if (shiftErr) throw new Error(shiftErr.message)

    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// ---------- 景點（stop）CRUD ----------

// 編輯景點文字欄位。
async function updateStop(
  stopId: string,
  payload: { time: string; name: string; tag: string; summary: string; detail: string },
): Promise<EditorResult> {
  try {
    const { error } = await supabase.from('stops').update(payload).eq('id', stopId)
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// 查某天現有景點（含已軟刪除的）的真實最大 sort_order。addStop/restoreStop 共用，
// 避免軟刪除景點占用的 sort_order 日後新增/復原時撞號。
async function getMaxStopSortOrder(dayId: string): Promise<number> {
  const { data: maxRow, error } = await supabase
    .from('stops')
    .select('sort_order')
    .eq('day_id', dayId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>()
  if (error) throw new Error(error.message)
  return maxRow?.sort_order ?? -1
}

// 新增景點：sort_order 取「該天所有景點（含已軟刪除）的最大值 + 1」。
async function addStop(dayId: string): Promise<EditorResult> {
  try {
    const nextSortOrder = (await getMaxStopSortOrder(dayId)) + 1

    const { error } = await supabase.from('stops').insert({
      day_id: dayId,
      time: '',
      name: '新景點',
      tag: '',
      summary: '',
      detail: '',
      sort_order: nextSortOrder,
      status: 'active',
    })
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// 軟刪除景點：status→trashed、記錄 trashed_at。
// 刻意不動其他景點的 sort_order，復原時才能自然回到原本相對位置。
//
// Phase 4 邊界處理：若這筆是某備案群組「目前的正式景點」、且群組裡還有現役備選，
// 直接只刪這一筆會讓備選變成孤兒——它 is_primary=false（不進主列表）又
// status='active'（不進回收站，回收站只抓 trashed），會同時被主列表與回收站的
// 篩選條件排除，形同從畫面上完全消失（資料還在，只是哪裡都撈不到）。
// 修法（使用者確認的預期行為）：刪除正式景點時，若偵測到現役備選，兩筆一起進
// 回收站——備選沒做錯事，但使用者的意圖既然是「這個時段的安排我都不要了」，
// 兩筆一起清掉才符合直覺；不對稱地只留備選單獨動 is_primary 反而更難懂。
// 不動 is_primary/alternative_group_id：跟既有單筆軟刪除一致，兩筆都保留原值，
// 復原邏輯（見 restoreStop）靠「群組現役成員數」判斷該復原成正式還是備選。
async function trashStop(stopId: string): Promise<EditorResult> {
  try {
    const { data: self, error: selfErr } = await supabase
      .from('stops')
      .select('alternative_group_id, is_primary')
      .eq('id', stopId)
      .maybeSingle<{ alternative_group_id: string | null; is_primary: boolean }>()
    if (selfErr) throw new Error(selfErr.message)

    const idsToTrash = [stopId]
    if (self?.is_primary && self.alternative_group_id) {
      const { data: alt, error: altErr } = await supabase
        .from('stops')
        .select('id')
        .eq('alternative_group_id', self.alternative_group_id)
        .eq('status', 'active')
        .eq('is_primary', false)
        .maybeSingle<{ id: string }>()
      if (altErr) throw new Error(altErr.message)
      if (alt) idsToTrash.push(alt.id)
    }

    const { error } = await supabase
      .from('stops')
      .update({ status: 'trashed', trashed_at: new Date().toISOString() })
      .in('id', idsToTrash)
    if (error) throw new Error(error.message)

    return idsToTrash.length > 1
      ? { ok: true, note: '這個景點的備案也一併移到回收站了。' }
      : { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// 從回收站復原到「指定的目標天」：改掛 day_id、接在該天最後、清 trashed_at、轉 active。
// 目標天由呼叫端（UI）決定——被特別天接住的景點原天已刪除，必須讓使用者選一個
// 現存的天放回去；即使沒被特別天接住，也允許復原到別天。
// sort_order 在函式內部查目標天真實最大值 + 1（含 trashed，避免撞號）。
//
// Phase 4 邊界處理：這筆若屬於某備案群組，復原前先查該群組目前 active 的成員數，
// 依成員數決定復原後的角色（不能只看「滿不滿」，因為 trashStop 現在會把整組一起
// 丟進回收站，可能出現「兩筆都在回收站、現役成員數是 0」的情況）：
//   - 0 個現役成員：這筆是目前唯一要復原的，沒有其他人能當正式景點，復原成正式
//   - 1 個現役成員：那筆一定是正式（群組的現役子集永遠「沒有正式」或「剛好一個正式」，
//     這是所有寫入路徑共同維持的不變量），這筆復原成備選
//   - 2 個現役成員（已滿）：復原會超過「1 正式 + 1 備選」上限，降級為獨立正式景點，
//     脫離群組，並回傳 note 讓呼叫端提示使用者
async function restoreStop(stopId: string, targetDayId: string): Promise<EditorResult> {
  try {
    // 先查這筆的群組 id（同一次 select 帶出，省一次往返）
    const { data: self, error: selfErr } = await supabase
      .from('stops')
      .select('alternative_group_id')
      .eq('id', stopId)
      .maybeSingle<{ alternative_group_id: string | null }>()
    if (selfErr) throw new Error(selfErr.message)

    // 查該群組目前現役（active）成員數（只有屬於群組時才需要查）
    let activeCount = 0
    const groupId = self?.alternative_group_id ?? null
    if (groupId) {
      const { count, error: countErr } = await supabase
        .from('stops')
        .select('id', { count: 'exact', head: true }) // head：只要 count 不抓資料
        .eq('alternative_group_id', groupId)
        .eq('status', 'active')
      if (countErr) throw new Error(countErr.message)
      activeCount = count ?? 0
    }

    const nextSortOrder = (await getMaxStopSortOrder(targetDayId)) + 1

    const payload: {
      day_id: string
      sort_order: number
      status: 'active'
      trashed_at: null
      alternative_group_id?: null
      is_primary?: boolean
    } = {
      day_id: targetDayId,
      sort_order: nextSortOrder,
      status: 'active',
      trashed_at: null,
    }

    const groupFull = activeCount >= 2
    if (groupFull) {
      // 群組已滿：降級為獨立正式景點，脫離群組。
      payload.alternative_group_id = null
      payload.is_primary = true
    } else if (groupId && activeCount === 1) {
      // 群組未滿、且已有一個現役成員（必為正式）：這筆明確復原成備選。必要性：
      // trashStop 保留 is_primary 原值，這筆 trashed 前的 is_primary 不可預期，
      // 若殘留為 true，復原後會與現役正式景點同組雙 primary，撞 uniq_alt_group_primary。
      payload.is_primary = false
    } else if (groupId && activeCount === 0) {
      // 屬於群組但目前沒有任何現役成員（例如 trashStop 把整組一起丟進回收站後，
      // 只先復原這一筆）：沒有別人能當正式，這筆自己復原成正式，避免「不是正式
      // 又不是回收站」的孤兒狀態。
      payload.is_primary = true
    }
    // 不屬於任何群組（groupId 為 null）：維持原邏輯不動這兩欄，自然以獨立景點復原。

    const { error } = await supabase.from('stops').update(payload).eq('id', stopId)
    if (error) throw new Error(error.message)

    if (groupFull) {
      return { ok: true, note: '原本的備案已被取代，這筆已還原為獨立景點。' }
    }
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// 永久刪除：真的 DELETE。UI 端須二次確認後才呼叫。
async function purgeStop(stopId: string): Promise<EditorResult> {
  try {
    const { error } = await supabase.from('stops').delete().eq('id', stopId)
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// ---------- 圖片（image）上傳／編輯／刪除 ----------

const IMAGE_BUCKET = 'trip-images'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5MB

// 從檔名安全取副檔名（小寫）。取不到就回空字串（路徑不帶副檔名，仍可正常上傳）。
function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0 || dot === fileName.length - 1) return ''
  return fileName.slice(dot + 1).toLowerCase()
}

// 查某景點現有圖片的最大 sort_order（images 表無軟刪除，撈所有列即可）。
async function getMaxImageSortOrder(stopId: string): Promise<number> {
  const { data: maxRow, error } = await supabase
    .from('images')
    .select('sort_order')
    .eq('stop_id', stopId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>()
  if (error) throw new Error(error.message)
  return maxRow?.sort_order ?? -1
}

// 上傳一張圖片到某景點：
//   1. 前端擋 >5MB（不呼叫任何 API，直接回失敗訊息）
//   2. 上傳到 trip-images bucket，物件路徑 `${stopId}/${uuid}.${ext}`
//      （以 stopId 開頭分層，方便日後依景點瀏覽 Storage）
//   3. sort_order 取該景點現有圖片最大值 +1
//   4. insert 一列 images：storage_path 填路徑、url 留空字串、caption 用呼叫端傳入的值
//      （url 空字串是 Phase 3 新圖的常態，顯示網址由 useItinerary 載入時簽章換算；
//      caption 選填參數讓 UI 能在確認上傳的同一步把使用者已填的說明文字一併存入，
//      不用「先 insert 空白 caption、上傳完再 update」多一次往返）
async function uploadImage(stopId: string, file: File, caption = ''): Promise<EditorResult> {
  try {
    if (file.size > MAX_IMAGE_BYTES) {
      return { ok: false, message: '圖片超過 5MB，請壓縮或換一張較小的圖片。' }
    }

    const ext = fileExtension(file.name)
    const objectName = ext ? `${crypto.randomUUID()}.${ext}` : crypto.randomUUID()
    const storagePath = `${stopId}/${objectName}`

    const { error: uploadErr } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(storagePath, file, {
        contentType: file.type || undefined,
        upsert: false,
      })
    if (uploadErr) throw new Error(uploadErr.message)

    const nextSortOrder = (await getMaxImageSortOrder(stopId)) + 1

    const { error: insertErr } = await supabase.from('images').insert({
      stop_id: stopId,
      url: '',
      caption,
      sort_order: nextSortOrder,
      storage_path: storagePath,
    })
    if (insertErr) throw new Error(insertErr.message)

    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// 編輯圖片說明文字（images.caption）。
async function updateImageCaption(imageId: string, caption: string): Promise<EditorResult> {
  try {
    const { error } = await supabase.from('images').update({ caption }).eq('id', imageId)
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// 刪除圖片：先刪 Storage 物件、成功後才刪資料庫記錄。
//   理由：反過來（先刪 DB）若中途失敗會留下「DB 沒記錄、Storage 卻仍占空間」的孤兒物件，
//   不易被發現；先刪 Storage 若中途失敗，畫面上該圖會變死連結、使用者容易察覺重試。
// storage_path 為 null（舊種子圖片，圖存在外部網站不在 Storage）時跳過 Storage 刪除步驟。
// deleteImage 只收 imageId：內部先查這一列拿 storage_path，不要求上層型別帶著它，
//   維持顯示元件只知道「最終顯示網址」這個抽象，不外洩 Storage 路徑等後端細節。
async function deleteImage(imageId: string): Promise<EditorResult> {
  try {
    const { data: row, error: findErr } = await supabase
      .from('images')
      .select('storage_path')
      .eq('id', imageId)
      .maybeSingle<{ storage_path: string | null }>()
    if (findErr) throw new Error(findErr.message)

    // 找不到該列（可能已被別人刪掉）：視為已達成刪除目的，回成功讓 UI 重載即可。
    if (!row) return { ok: true }

    if (row.storage_path) {
      const { error: removeErr } = await supabase.storage
        .from(IMAGE_BUCKET)
        .remove([row.storage_path])
      if (removeErr) throw new Error(removeErr.message)
    }

    const { error: delErr } = await supabase.from('images').delete().eq('id', imageId)
    if (delErr) throw new Error(delErr.message)

    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// ---------- 排序（交換相鄰兩筆的 sort_order）----------

// 交換兩個景點的 sort_order。規格明確：不需要包成 RPC，
// 前端連續兩次 update 即可（中途失敗頂多暫時重複 sort_order，不會讓資料消失，
// 下次重新整理／再排序即可自癒）。
async function swapStopOrder(
  a: { id: string; sortOrder: number },
  b: { id: string; sortOrder: number },
): Promise<EditorResult> {
  try {
    const { error: errA } = await supabase
      .from('stops')
      .update({ sort_order: b.sortOrder })
      .eq('id', a.id)
    if (errA) throw new Error(errA.message)

    const { error: errB } = await supabase
      .from('stops')
      .update({ sort_order: a.sortOrder })
      .eq('id', b.id)
    if (errB) throw new Error(errB.message)

    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// ---------- 備案（alternative）機制（Phase 4）----------

// 決定一個備案群組 id：正式景點若尚未有群組（primaryGroupId=null），產生新 uuid 並
// 寫回正式景點那筆（is_primary 維持 true 不變）；已有就直接沿用。
// 兩種新增備選方式（新建 / 連結既有）共用這一步，抽成 helper 避免重複。
async function ensureGroupId(
  primaryStopId: string,
  primaryGroupId: string | null,
): Promise<string> {
  if (primaryGroupId) return primaryGroupId
  const groupId = crypto.randomUUID()
  const { error } = await supabase
    .from('stops')
    .update({ alternative_group_id: groupId }) // is_primary 不動，維持 true
    .eq('id', primaryStopId)
  if (error) throw new Error(error.message)
  return groupId
}

// 檢查某群組目前是否「已經有一個現役備選」（status='active' 且 is_primary=false）。
// createAlternative / linkExistingAsAlternative 寫入前都要查——前端 UI 只在畫面資料
// 顯示「沒有備選」時才給入口，但這是多人協作工具：兩人同時對同一正式景點各加一個
// 備案，前端各自看到的都是「還沒有備選」，會產生同組 2 個非 primary 成員。
// uniq_alt_group_primary 只保證「最多一個 primary」，擋不住「多個非 primary」，
// 所以必須在後端寫入前再擋一次。groupId 為 null（正式景點還沒有群組）時必為空，直接回 false。
async function groupHasAlternative(groupId: string | null): Promise<boolean> {
  if (!groupId) return false
  const { count, error } = await supabase
    .from('stops')
    .select('id', { count: 'exact', head: true })
    .eq('alternative_group_id', groupId)
    .eq('status', 'active')
    .eq('is_primary', false)
  if (error) throw new Error(error.message)
  return (count ?? 0) >= 1
}

// 新建一個全新的備選景點，掛到正式景點所在群組。
// sort_order 直接沿用正式景點自己的 sort_order（呼叫端傳入），不查 max+1：
//   備選不進主列表排序計算，用相同值即可，且這樣不會拉高 getMaxStopSortOrder
//   對「該天下一個正式景點該用的 sort_order」的計算結果。
async function createAlternative(payload: {
  dayId: string
  primaryStopId: string
  primaryGroupId: string | null
  sortOrder: number
  data: { time: string; name: string; tag: string; summary: string; detail: string }
}): Promise<EditorResult> {
  try {
    // 後端滿員檢查（防競態）：已有現役備選就拒絕，不寫入。
    if (await groupHasAlternative(payload.primaryGroupId)) {
      return { ok: false, message: '這個景點已經有備案了，請先移除現有備案再新增。' }
    }

    const groupId = await ensureGroupId(payload.primaryStopId, payload.primaryGroupId)
    const { error } = await supabase.from('stops').insert({
      day_id: payload.dayId,
      time: payload.data.time,
      name: payload.data.name,
      tag: payload.data.tag,
      summary: payload.data.summary,
      detail: payload.data.detail,
      sort_order: payload.sortOrder,
      status: 'active',
      alternative_group_id: groupId,
      is_primary: false,
    })
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// 把同一天內另一個既有景點事後連結成備選。候選也包含回收站裡的景點（見
// loadAlternativeCandidates），若選到的是已刪除的，這裡順便把它復原（status/trashed_at
// 一併重設），等於「連結」跟「從回收站復原」一次做完，不用先復原再回來連結。
// 不動它的 sort_order（維持原值）：它現在不進主列表顯示，數值不影響任何排序計算；
//   且日後若被拆出群組、恢復成獨立正式景點，保留原值比塞新值更合理。
async function linkExistingAsAlternative(payload: {
  primaryStopId: string
  primaryGroupId: string | null
  otherStopId: string
}): Promise<EditorResult> {
  try {
    // 後端滿員檢查（防競態）：已有現役備選就拒絕，不寫入。
    if (await groupHasAlternative(payload.primaryGroupId)) {
      return { ok: false, message: '這個景點已經有備案了，請先移除現有備案再新增。' }
    }

    const groupId = await ensureGroupId(payload.primaryStopId, payload.primaryGroupId)
    const { error } = await supabase
      .from('stops')
      .update({
        alternative_group_id: groupId,
        is_primary: false,
        status: 'active', // 候選可能來自回收站，連結時一併復原
        trashed_at: null,
      })
      .eq('id', payload.otherStopId)
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// 解除備選的備案關聯，退回成當天一個獨立的正式景點：清空 alternative_group_id、
// is_primary 設回 true、sort_order 取該天現有最大值 +1（放到當天最後一個，比照
// addStop 的既有慣例，位置可預測、不會跟其他景點撞號）。只適用於備選——正式景點
// 本來就顯示在主列表，不需要這個操作；要移除備選改用既有的「刪除」（trashStop）。
async function detachAlternative(stopId: string, dayId: string): Promise<EditorResult> {
  try {
    const nextSortOrder = (await getMaxStopSortOrder(dayId)) + 1
    const { error } = await supabase
      .from('stops')
      .update({ alternative_group_id: null, is_primary: true, sort_order: nextSortOrder })
      .eq('id', stopId)
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// 切換群組內的正式景點：走 switch_primary_stop RPC（兩段式 UPDATE，避開 partial
// unique index 逐列檢查陷阱，見 0006 migration 檔案開頭說明）。
async function switchPrimary(
  groupId: string,
  newPrimaryStopId: string,
): Promise<EditorResult> {
  try {
    const { error } = await supabase.rpc('switch_primary_stop', {
      p_group_id: groupId,
      p_new_primary_id: newPrimaryStopId,
    })
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// 「連結既有景點」下拉選單的候選來源，分兩段撈再合併：
//   1. active 候選：限「同一天」——同天以外的行程被誤跨接成備選會很怪，維持既有限制
//   2. trashed 候選：不限天數，整趟旅遊都找（比照 loadTrashedStops 撈全部 day id，
//      含特別天——因整天被刪除而搬進特別天的回收站景點也能被連結）。回收站的景點
//      本來就不在任何一天的主列表上顯示，跨天選取不會有「同時屬於兩天」的問題
// 兩段都排除已屬於任何群組的（`alternative_group_id IS NULL`）與正式景點自己。
// 回傳格式比照 loadTrashedStops（{ ok, message?, data }）。
async function loadAlternativeCandidates(
  dayId: string,
  excludeStopId: string,
  tripId: string,
): Promise<{
  ok: boolean
  message?: string
  data: { id: string; name: string; time: string; status: 'active' | 'trashed' }[]
}> {
  try {
    const { data: activeRows, error: activeErr } = await supabase
      .from('stops')
      .select('id, name, time, status')
      .eq('day_id', dayId)
      .eq('status', 'active')
      .is('alternative_group_id', null)
      .neq('id', excludeStopId)
      .order('sort_order', { ascending: true })
      .overrideTypes<
        { id: string; name: string; time: string; status: 'active' | 'trashed' }[],
        { merge: false }
      >()
    if (activeErr) throw new Error(activeErr.message)

    const { data: dayRows, error: dayErr } = await supabase
      .from('days')
      .select('id')
      .eq('trip_id', tripId)
    if (dayErr) throw new Error(dayErr.message)
    const tripDayIds = (dayRows ?? []).map((d) => d.id as string)

    let trashedRows: { id: string; name: string; time: string; status: 'active' | 'trashed' }[] =
      []
    if (tripDayIds.length > 0) {
      // 不過濾 alternative_group_id：軟刪除不動這個欄位，回收站景點可能還留著舊群組的
      // 關聯，但它早就不是任何群組的現役成員了，舊關聯不該擋住它被連結成新的備案——
      // 連結時 linkExistingAsAlternative 會直接覆寫成新的群組 id，不會殘留舊關係。
      const { data, error: trashedErr } = await supabase
        .from('stops')
        .select('id, name, time, status')
        .in('day_id', tripDayIds)
        .eq('status', 'trashed')
        .neq('id', excludeStopId)
        .order('trashed_at', { ascending: false })
        .overrideTypes<
          { id: string; name: string; time: string; status: 'active' | 'trashed' }[],
          { merge: false }
        >()
      if (trashedErr) throw new Error(trashedErr.message)
      trashedRows = data ?? []
    }

    return { ok: true, data: [...(activeRows ?? []), ...trashedRows] }
  } catch (err) {
    return { ...fail(err), data: [] }
  }
}

// ---------- 回收站列表查詢 ----------

// 回收站的一筆景點：帶所屬天的顯示資訊，方便 UI 標示「這是哪一天的景點」。
// dayId 代表這個景點目前掛在哪個天（可能是原本的天，也可能是被刪天時搬去的特別天）。
export interface TrashedStop {
  id: string
  dayId: string
  time: string
  name: string
  tag: string
  summary: string
  trashedAt: string | null
}

interface TrashedStopRow {
  id: string
  day_id: string
  time: string
  name: string
  tag: string
  summary: string
  trashed_at: string | null
}

// 撈某趟旅遊底下所有 status='trashed' 的景點。
// loadItinerary() 只撈 active，回收站另外撈 trashed。
// 注意：這裡「所有 day id」刻意包含特別天（is_holding=true），因為被刪天搬過去的
// 景點掛在特別天底下，必須撈得到才能出現在回收站。
async function loadTrashedStops(
  tripId: string,
): Promise<{ ok: boolean; message?: string; data: TrashedStop[] }> {
  try {
    // 先取這趟旅遊的所有 day id（含特別天，trashed 景點也可能掛在特別天底下）
    const { data: dayRows, error: dayErr } = await supabase
      .from('days')
      .select('id')
      .eq('trip_id', tripId)
    if (dayErr) throw new Error(dayErr.message)
    const dayIds = (dayRows ?? []).map((d) => d.id as string)
    if (dayIds.length === 0) return { ok: true, data: [] }

    const { data: stopRows, error: stopErr } = await supabase
      .from('stops')
      .select('id, day_id, time, name, tag, summary, trashed_at')
      .in('day_id', dayIds)
      .eq('status', 'trashed')
      .order('trashed_at', { ascending: false })
      .overrideTypes<TrashedStopRow[], { merge: false }>()
    if (stopErr) throw new Error(stopErr.message)

    const data: TrashedStop[] = (stopRows ?? []).map((r) => ({
      id: r.id,
      dayId: r.day_id,
      time: r.time,
      name: r.name,
      tag: r.tag,
      summary: r.summary,
      trashedAt: r.trashed_at,
    }))
    return { ok: true, data }
  } catch (err) {
    return { ...fail(err), data: [] }
  }
}

export function useEditor() {
  return {
    updateTripInfo,
    updateDayLabel,
    updateDayInfo,
    getOrCreateHoldingDayId,
    insertDayAt,
    deleteDayAt,
    updateStop,
    addStop,
    trashStop,
    restoreStop,
    purgeStop,
    swapStopOrder,
    createAlternative,
    linkExistingAsAlternative,
    switchPrimary,
    detachAlternative,
    loadAlternativeCandidates,
    loadTrashedStops,
    uploadImage,
    updateImageCaption,
    deleteImage,
  }
}
