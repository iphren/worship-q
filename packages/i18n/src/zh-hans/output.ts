/** The output app's text, in Simplified Chinese. */
import type { output as en } from '../en/output';

export const output: Record<keyof typeof en, string> = {
  'app.title': 'Worship Q 输出',
  'output.noToken': '这个链接没有密钥。请在 Worship Q 的“设置 → 浏览器输出”中新建一个输出链接。',
  'output.updateNeeded': '教会服务器运行的 Worship Q 版本不同。请重新加载此页面。',
  'output.revoked': '这个输出链接已被撤销。请在 Worship Q 的“设置 → 浏览器输出”中新建一个。',
  'output.website': '网站',
};
