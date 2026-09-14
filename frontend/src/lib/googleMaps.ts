// Google Maps 公開 URL scheme：用地址文字做搜尋，不需任何 API key。
// 正式景點卡（StopDetails）與備選景點卡（AlternativePanel）共用，避免各自重複組字串。
export function buildGoogleMapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}
