/**
 * Simplified Chinese to Traditional (translation plan T5): OpenCC's conversion to Taiwan's
 * characters and vocabulary, then the corrections in `FIXES`, where conversion alone picks
 * the wrong word for Worship Q. One Traditional for every region.
 */
import * as OpenCC from 'opencc-js';

const convert = OpenCC.Converter({ from: 'cn', to: 'twp' });

/**
 * Hand corrections after conversion, applied in order: [what OpenCC wrote, what we want].
 * Add one whenever a drafted Traditional message is corrected, so the next draft keeps it.
 */
export const FIXES: [string, string][] = [
  // Words that convert to another meaning.
  ['程式碼', '代碼'], // a pairing code, not source code
  ['專案', '項目'], // a run sheet item, not a project
  ['查詢', '尋找'],
  // Vocabulary used in Taiwan and Hong Kong alike.
  ['幻燈片', '投影片'],
  ['全屏', '全螢幕'],
  ['清屏', '清除畫面'],
  ['只讀', '唯讀'],
  ['新建', '新增'],
  ['響應', '回應'],
  ['拖動', '拖曳'],
  ['憑據', '憑證'],
  ['鑰匙串', '鑰匙圈'],
  ['當前', '目前'],
  ['通過', '透過'],
  ['伺服器地址', '伺服器位址'],
  ['丟失', '遺失'],
  ['推流', '串流'],
  ['攝像機', '攝影機'],
  ['錄像', '錄影'],
  ['檢測', '偵測'],
  ['畫素', '像素'],
  ['電平', '音量'],
  ['採集', '擷取'],
  ['自帶', '內建'],
  ['二維碼', 'QR 碼'],
  ['例項', '執行個體'],
  ['賬號', '帳號'],
  ['退出登入', '登出'],
  ['許可權', '權限'],
  ['型別', '類型'],
  ['訪問', '存取'],
  ['資料卷', '磁碟區'],
  ['儲存卷', '磁碟區'],
  ['配置', '設定'],
  ['的資料資料夾', '的資料夾'],
  ['應用', '應用程式'],
  ['應用程式程式', '應用程式'],
  // Characters as commonly written.
  ['臺', '台'],
  ['后', '後'],
];

/** Quotation marks as Traditional Chinese writes them. */
const QUOTES: [RegExp, string][] = [
  [/“/g, '「'],
  [/”/g, '」'],
  [/‘/g, '『'],
  [/’/g, '』'],
];

export function toTraditional(simplified: string): string {
  let text = convert(simplified);
  for (const [from, to] of FIXES) text = text.split(from).join(to);
  for (const [from, to] of QUOTES) text = text.replace(from, to);
  // A space between Chinese and the Latin letters of a term that replaced a Chinese one.
  return text.replace(/([\u4e00-\u9fff])QR 碼/g, '$1 QR 碼');
}
