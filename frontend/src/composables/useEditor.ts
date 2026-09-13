import { supabase } from '@/lib/supabase'
import type { ItineraryHotel, ItineraryMeals } from '@/types/itinerary'

// 所有寫入操作的統一回傳型別：UI 端據此決定是否顯示錯誤。
export interface EditorResult {
  ok: boolean
  message?: string
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
async function trashStop(stopId: string): Promise<EditorResult> {
  try {
    const { error } = await supabase
      .from('stops')
      .update({ status: 'trashed', trashed_at: new Date().toISOString() })
      .eq('id', stopId)
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

// 從回收站復原到「指定的目標天」：改掛 day_id、接在該天最後、清 trashed_at、轉 active。
// 目標天由呼叫端（UI）決定——被特別天接住的景點原天已刪除，必須讓使用者選一個
// 現存的天放回去；即使沒被特別天接住，也允許復原到別天。
// sort_order 在函式內部查目標天真實最大值 + 1（含 trashed，避免撞號）。
async function restoreStop(stopId: string, targetDayId: string): Promise<EditorResult> {
  try {
    const nextSortOrder = (await getMaxStopSortOrder(targetDayId)) + 1
    const { error } = await supabase
      .from('stops')
      .update({
        day_id: targetDayId,
        sort_order: nextSortOrder,
        status: 'active',
        trashed_at: null,
      })
      .eq('id', stopId)
    if (error) throw new Error(error.message)
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
    loadTrashedStops,
  }
}
