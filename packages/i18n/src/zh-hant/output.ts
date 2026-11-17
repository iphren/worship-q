/** The output text in Traditional Chinese: drafted from Simplified by scripts/draft-hant.ts, then read through. */
import type { output as en } from '../en/output';

export const output: Record<keyof typeof en, string> = {
  'app.title': 'Worship Q 輸出',
  'output.noToken': '這個連結沒有金鑰。請在 Worship Q 的「設定 → 瀏覽器輸出」中新增一個輸出連結。',
  'output.updateNeeded': '教會伺服器執行的 Worship Q 版本不同。請重新載入此頁面。',
  'output.revoked': '這個輸出連結已被撤銷。請在 Worship Q 的「設定 → 瀏覽器輸出」中新增一個。',
  'output.website': '網站',
};
