/**
 * The few pages a person sees while connecting an assistant (MCP plan, C3): the consent
 * page and the refusals. Server-rendered, in the browser's language among the app's three,
 * with no script, so nothing on them can act without the person's click.
 */

export type PageLanguage = 'en' | 'zh-Hans' | 'zh-Hant';

const STRINGS = {
  en: {
    consentTitle: 'Connect an AI assistant',
    consentLead: '{client} wants to read and change run sheets and songs as {email}.',
    redirect: 'After you allow it, you return to {host}.',
    workspaces: 'It will reach these workspaces:',
    allWorkspaces: 'Every workspace, including new ones',
    noWorkspaces: 'No workspaces yet. An administrator can give you some.',
    can: 'It can list run sheets and songs, add and edit songs, and add, move or remove run sheet items. It cannot delete songs from the library.',
    allow: 'Allow',
    deny: 'Deny',
    notAllowedTitle: 'Not allowed',
    notAllowed:
      '{email} may not connect AI assistants to this server. Ask an administrator to add you on the MCP users page.',
    failedTitle: 'Could not connect',
    failed: 'The connection could not be finished. Start again from your assistant.',
    noEmail: 'Your account did not give a verified e-mail address, so it cannot be matched.',
    badRequestTitle: 'Invalid request',
    badRequest: 'The assistant asked in a way this server does not accept: {reason}',
    notConfiguredTitle: 'Not available',
    notConfigured: 'Sign-in is not configured on this server.',
    deniedTitle: 'Not connected',
    denied: 'You did not allow the connection. You can close this page.',
  },
  'zh-Hans': {
    consentTitle: '连接 AI 助手',
    consentLead: '{client} 想以 {email} 的身份查看和修改流程表与歌曲。',
    redirect: '允许后，你将返回 {host}。',
    workspaces: '它能访问这些工作区：',
    allWorkspaces: '所有工作区，包括新建的',
    noWorkspaces: '还没有工作区。管理员可以为你添加。',
    can: '它可以查看流程表和歌曲，添加和编辑歌曲，以及添加、移动或移除流程表中的项目。它不能从歌库中删除歌曲。',
    allow: '允许',
    deny: '拒绝',
    notAllowedTitle: '未获允许',
    notAllowed: '{email} 不能把 AI 助手连接到这台服务器。请管理员在“MCP 用户”页面添加你。',
    failedTitle: '无法连接',
    failed: '连接未能完成。请从你的助手重新开始。',
    noEmail: '你的账号没有提供已验证的电子邮件地址，因此无法匹配。',
    badRequestTitle: '请求无效',
    badRequest: '助手的请求方式不被这台服务器接受：{reason}',
    notConfiguredTitle: '不可用',
    notConfigured: '这台服务器未配置登录。',
    deniedTitle: '未连接',
    denied: '你没有允许这次连接。可以关闭此页面。',
  },
  'zh-Hant': {
    consentTitle: '連接 AI 助手',
    consentLead: '{client} 想以 {email} 的身分檢視和修改流程表與詩歌。',
    redirect: '允許後，你將返回 {host}。',
    workspaces: '它能存取這些工作區：',
    allWorkspaces: '所有工作區，包括新建立的',
    noWorkspaces: '還沒有工作區。管理員可以為你加入。',
    can: '它可以檢視流程表和詩歌，新增和編輯詩歌，以及新增、移動或移除流程表中的項目。它不能從詩歌庫中刪除詩歌。',
    allow: '允許',
    deny: '拒絕',
    notAllowedTitle: '未獲允許',
    notAllowed: '{email} 不能把 AI 助手連接到這台伺服器。請管理員在「MCP 使用者」頁面加入你。',
    failedTitle: '無法連接',
    failed: '連接未能完成。請從你的助手重新開始。',
    noEmail: '你的帳號沒有提供已驗證的電子郵件地址，因此無法比對。',
    badRequestTitle: '請求無效',
    badRequest: '助手的請求方式不被這台伺服器接受：{reason}',
    notConfiguredTitle: '無法使用',
    notConfigured: '這台伺服器未設定登入。',
    deniedTitle: '未連接',
    denied: '你沒有允許這次連接。可以關閉此頁面。',
  },
} satisfies Record<PageLanguage, Record<string, string>>;

export type PageString = keyof (typeof STRINGS)['en'];

/** The page language for an `Accept-Language` header: Chinese by script, else English. */
export function pageLanguage(header: string | undefined): PageLanguage {
  for (const part of (header ?? '').split(',')) {
    const tag = part.split(';')[0]!.trim().toLowerCase();
    if (!tag) continue;
    if (tag.startsWith('zh')) {
      return /hant|-tw|-hk|-mo/.test(tag) ? 'zh-Hant' : 'zh-Hans';
    }
    if (tag.startsWith('en')) return 'en';
  }
  return 'en';
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A string with its placeholders filled; every value is escaped. */
export function say(language: PageLanguage, key: PageString, values: Record<string, string> = {}) {
  return escapeHtml(STRINGS[language][key]).replace(/\{(\w+)\}/g, (_, name: string) =>
    name in values ? `<strong>${escapeHtml(values[name]!)}</strong>` : `{${name}}`,
  );
}

function page(language: PageLanguage, title: string, body: string): string {
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · Worship Q</title>
<style>
:root { color-scheme: light dark; --bg: #f8fafc; --card: #fff; --text: #0f172a; --muted: #475569; --line: #e2e8f0; --accent: #4f46e5; }
@media (prefers-color-scheme: dark) { :root { --bg: #020617; --card: #0f172a; --text: #e2e8f0; --muted: #94a3b8; --line: #1e293b; --accent: #818cf8; } }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 32rem; margin: 3rem auto; padding: 0 1rem; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 1.5rem; }
h1 { font-size: 1.25rem; margin: 0 0 1rem; }
p, li { color: var(--muted); }
strong { color: var(--text); }
ul { padding-left: 1.25rem; }
.actions { display: flex; gap: .75rem; margin-top: 1.5rem; }
button { font: inherit; padding: .6rem 1.2rem; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--text); cursor: pointer; }
button[value="allow"] { background: var(--accent); border-color: var(--accent); color: #fff; }
</style>
</head>
<body><main><div class="card"><h1>${title}</h1>${body}</div></main></body>
</html>`;
}

/** A page that only says something. */
export function messagePage(
  language: PageLanguage,
  title: PageString,
  message: PageString,
  values: Record<string, string> = {},
): string {
  return page(language, say(language, title), `<p>${say(language, message, values)}</p>`);
}

export function consentPage(
  language: PageLanguage,
  input: {
    client: string;
    email: string;
    redirectHost: string;
    allWorkspaces: boolean;
    workspaces: string[];
    authorizationId: string;
    consent: string;
  },
): string {
  const workspaces = input.allWorkspaces
    ? `<li>${say(language, 'allWorkspaces')}</li>`
    : input.workspaces.length > 0
      ? input.workspaces.map((name) => `<li>${escapeHtml(name)}</li>`).join('')
      : `<li>${say(language, 'noWorkspaces')}</li>`;
  return page(
    language,
    say(language, 'consentTitle'),
    `<p>${say(language, 'consentLead', { client: input.client, email: input.email })}</p>
<p>${say(language, 'workspaces')}</p>
<ul>${workspaces}</ul>
<p>${say(language, 'can')}</p>
<p>${say(language, 'redirect', { host: input.redirectHost })}</p>
<form method="post" action="/oauth/consent">
<input type="hidden" name="authorization" value="${escapeHtml(input.authorizationId)}">
<input type="hidden" name="consent" value="${escapeHtml(input.consent)}">
<div class="actions">
<button type="submit" name="decision" value="allow">${say(language, 'allow')}</button>
<button type="submit" name="decision" value="deny">${say(language, 'deny')}</button>
</div>
</form>`,
  );
}
