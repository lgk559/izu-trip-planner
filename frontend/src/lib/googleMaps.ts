// Google Maps 公開 URL scheme：用地址文字做搜尋，不需任何 API key。
// 正式景點卡（StopDetails）與備選景點卡（AlternativePanel）共用，避免各自重複組字串。
export function buildGoogleMapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

// Google Maps 路線規劃 URL scheme：點開直接是「起點→終點」的大眾運輸路線規劃頁，
// 由消費者版 Google Maps 網頁計算（日本 transit 資料準確），不需任何 API key。
// 時間軸相鄰兩景點之間用它做導連——取代原本經 Edge Function 呼叫 Routes API 的
// 路程時間估算（Routes API 的 TRANSIT 在日本查無資料，見 ADR 004 修正記錄）。
export function buildGoogleMapsDirectionsUrl(
  originAddress: string,
  destinationAddress: string,
): string {
  const origin = encodeURIComponent(originAddress)
  const destination = encodeURIComponent(destinationAddress)
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=transit`
}
