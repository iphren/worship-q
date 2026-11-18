// worship-q.com in Simplified Chinese (translation plan T9): the site's frame, the home page,
// its features and questions, and the Markdown pages' titles. zh-hant.ts is drafted from this
// file (`pnpm --filter @worship-q/i18n draft-hant --file`), then read through. The Markdown
// pages themselves are in pages/zh-hans/ and docs/zh-hans/.
//
// Tailwind finds the classes used here by reading this file, so write class names out in
// full: never build them from pieces.

import type { Feature, SiteContent } from './content.ts';
import type { Question } from './faq.ts';
import type { Home } from './home.ts';
import type { PageText } from './pages.ts';
import type { Words } from './words.ts';

export const words: Words = {
  nav: { guide: '指南', compare: '比较', releases: '更新说明' },
  navLabel: '网站',
  language: '语言',
  footer: {
    features: '功能',
    help: '帮助',
    project: '项目',
    guide: '同工指南',
    server: '教会服务器设置',
    compare: '与其他软件比较',
    releases: '更新说明（英文）',
    source: '源代码',
    licence: 'MIT 许可证',
    llms: '给 AI 助手（英文）',
  },
  featurePages: {
    '/bible/': '经文',
    '/multilingual-lyrics/': '多语言歌词',
    '/obs/': 'OBS 和直播',
    '/phone-remote/': '手机遥控',
    '/several-computers/': '多台电脑',
  },
  more: '详情',
  notFound: {
    title: '找不到页面 — Worship Q',
    heading: '这个页面不在这里',
    text: '网址可能已经改变。Worship Q 的下载、功能和常见问题都在首页。',
    link: '前往 worship-q.com',
  },
  markdown: {
    download: '下载',
    whatItDoes: '功能',
    questions: '常见问题',
    more: '更多',
    screenshots: '截图',
    macDownload: '下载 Mac 版',
    windowsDownload: '下载 Windows 版',
    version: '版本 {version}，发布于 {date}。',
    notes: '更新说明（英文）',
    updates: '应用会自动更新；投影运行期间不会安装更新。',
    windowsWarning:
      'Mac 应用已经过签名和公证。Windows 应用还没有经过 Microsoft 签名，所以第一次打开时 Windows 可能会显示“Windows 已保护你的电脑”：请选择“更多信息”，然后选择“仍要运行”。',
    compare: '与其他教会投影软件比较',
    source: '源代码',
  },
};

const SUMMARY =
  'Worship Q 是一款免费、开源的教会投影软件，适用于 macOS 和 Windows，可以在投影和直播中显示诗歌歌词、经文、幻灯片和视频。';

const FEATURES: Feature[] = [
  {
    title: '任何语言的诗歌',
    page: '/multilingual-lyrics/',
    text: '按标题或歌词搜索，中文诗歌还可以用拼音或首字母搜索。一句歌词和它的翻译在同一张幻灯片上，两种语言或更多都可以。',
  },
  {
    title: '经文',
    page: '/bible/',
    text: '连接教会的服务器后：输入经文出处，例如 马可福音15:5-6，或按书卷和章浏览，最多两个译本并排显示。',
  },
  {
    title: '每次聚会一份流程表',
    text: '在日历上编排，沿用之前某一周的安排，打开应用时，就能接着使用当天的流程表。',
  },
  {
    title: '幻灯片、PDF、照片和视频',
    text: '连接教会的服务器后，PowerPoint、Keynote 和 PDF 文件会变成幻灯片，与诗歌放在一起。视频会提前下载，聚会中从不在线播放。',
  },
  {
    title: '投影和直播同时进行',
    page: '/obs/',
    text: '全屏投影，可用图片或视频作背景，并为 OBS 提供字幕。在 Worship Q 中就能切换 OBS 场景和开始直播。',
  },
  {
    title: '用手机控制',
    page: '/phone-remote/',
    text: '扫描二维码，批准一次手机，就能在房间里的任何地方切换幻灯片或添加经文。',
  },
  {
    title: '多台电脑，同步投影',
    page: '/several-computers/',
    text: '每台连接的电脑都显示同一张幻灯片。如果主控电脑出了故障，另一台会从同一张幻灯片继续。',
  },
  {
    title: '现场音频',
    text: '把调音台的声音发送到其他电脑和手机，让在场外的人也能及时切换幻灯片。',
  },
  {
    title: '独立运行',
    text: '不需要账号，也不需要互联网。连接教会自己的服务器，就能共享诗歌、媒体、经文和使用手机。',
  },
  {
    title: '免费开源',
    text: 'MIT 许可证，没有广告，没有订阅。应用会自动更新；投影运行期间不会安装更新。',
  },
];

export const content: SiteContent = {
  summary: SUMMARY,
  features: FEATURES,
  featureList: [
    '任何语言的诗歌歌词，一张幻灯片上显示双语或多语',
    '按标题、歌词、拼音或首字母搜索诗歌',
    '最多两个译本并排显示的经文',
    '在日历上编排的流程表',
    'PowerPoint、Keynote、PDF、照片和视频幻灯片',
    '图片或视频背景',
    '为 OBS 提供字幕，并控制 OBS 的场景、推流和录制',
    '用手机控制',
    '多台电脑共享一个演示，并能故障接替',
    '把调音台的现场音频发送到其他电脑和手机',
    '离线可用，不需要账号',
  ],
  platforms: {
    mac: 'macOS 11 或更高版本，Apple 芯片和 Intel',
    windows: 'Windows 10 或更高版本，64 位',
  },
};

export const faq: Question[] = [
  {
    question: 'Worship Q 免费吗？',
    answer:
      '是的。Worship Q 以 MIT 许可证免费开源，没有广告、没有付费版，也没有订阅。教会服务器同样免费。',
  },
  {
    question: '需要账号或互联网吗？',
    answer:
      '不需要。电脑版在一台电脑上就能独立运行，不需要账号，也不需要互联网。连接教会服务器是可选的，可以增加共享的诗歌、幻灯片和视频、经文、手机控制，以及多台电脑共享一个演示。',
  },
  {
    question: '它在哪些电脑上运行？',
    answer:
      'macOS 11 或更高版本（Apple 芯片和 Intel），以及 64 位 Windows 10 或更高版本。应用会自动更新；投影运行期间不会安装更新。',
  },
  {
    question: '能显示双语歌词，例如中文和英文，或更多语言吗？',
    answer:
      '能。任何语言的歌词都可以，双语或三语诗歌会把一句歌词和它的翻译显示在同一张幻灯片上：默认两行，或者在“设置”中修改每张幻灯片行数，显示更多行，例如中文、拼音和英文。可以按标题或歌词找到诗歌，中文诗歌还可以用拼音或首字母找到。',
  },
  {
    question: '怎样显示经文？',
    answer:
      '按你平常的写法输入经文出处，例如 马可福音15:5-6 或 可15:5-6，也可以按书卷和章浏览，或搜索字词。每张幻灯片最多并排显示两个译本。经文通过教会服务器提供，它可以使用不需要密钥的 Free Use Bible API（例如和合本、KJV 和 BSB），或教会自己的 API.Bible 或 YouVersion 密钥。',
  },
  {
    question: '能显示 PowerPoint、Keynote、PDF、照片和视频吗？',
    answer:
      '能，需要教会服务器。PowerPoint、Keynote 和 OpenDocument 演示文稿以及 PDF 会变成幻灯片，照片和视频可以和诗歌一起放进流程表。视频会提前下载，所以聚会中不会在线播放任何内容。',
  },
  {
    question: '能配合 OBS 直播吗？',
    answer:
      '能。字幕页面可以作为 OBS 的“浏览器”来源显示歌词，Worship Q 还可以在教会的任何一台电脑或手机上切换 OBS 场景，开始或停止推流和录制。',
  },
  {
    question: '能用手机控制幻灯片吗？',
    answer:
      '能，需要教会服务器。手机扫描二维码，批准一次后，就可以切换幻灯片、修改流程表和添加经文。',
  },
  {
    question: '多台电脑能共享一个演示吗？',
    answer:
      '能。连接到教会服务器的电脑会显示同一张幻灯片，任何一台都可以接管；如果主控电脑出了故障，另一台会从同一张幻灯片继续。在同一个 Wi-Fi 上，即使没有互联网，它们也能继续一起工作。',
  },
  {
    question: '能从 ProPresenter、EasyWorship 或 OpenLP 导入诗歌吗？',
    answer:
      '暂时还不能。目前请把每首诗歌的歌词以文字粘贴进来，段落之间空一行；Worship Q 会把它们拆分成幻灯片。如果你的教会想转过来并需要导入功能，请发邮件到 hello@ihs.technology 商量。也欢迎在 github.com/iphren/worship-q 提交 Pull Request。',
  },
];

/** The Markdown pages' titles and descriptions, by their English path. */
export const pages: Record<string, PageText> = {
  '/guide/': {
    title: '同工指南 — Worship Q',
    description:
      '如何用 Worship Q 添加诗歌、编排流程表和演示：经文、幻灯片、视频、手机、OBS 和现场音频。',
  },
  '/server/': {
    title: '教会服务器设置 — Worship Q',
    description:
      '用 Docker 运行你教会自己的免费 Worship Q 服务器：共享诗歌和媒体、经文、手机遥控、备份和管理后台。',
  },
  '/bible/': {
    title: '在投影上显示经文 — Worship Q',
    description:
      '几秒钟就能显示经文：输入经文出处，两个译本并排查看，然后演示。免费的教会投影软件。',
  },
  '/multilingual-lyrics/': {
    title: '一张幻灯片上显示两种或更多语言的歌词 — Worship Q',
    description:
      '在同一张幻灯片上显示双语或多语敬拜歌词，例如中文、拼音和英文。用拼音或首字母搜索中文诗歌。',
  },
  '/obs/': {
    title: '为 OBS 提供歌词字幕和场景控制 — Worship Q',
    description: '用 OBS 浏览器来源将诗歌歌词叠加到直播画面，并在 Worship Q 或手机上切换场景、推流和录制。',
  },
  '/phone-remote/': {
    title: '用手机控制幻灯片 — Worship Q',
    description: '扫描二维码，就能在房间里的任何地方用手机切换幻灯片、修改流程表或添加经文。',
  },
  '/several-computers/': {
    title: '多台电脑，同步投影 — Worship Q',
    description:
      '场地里的每台电脑都显示同一张幻灯片；如果主控电脑出了故障，另一台会从同一张幻灯片继续。',
  },
  '/compare/': {
    title: 'Worship Q 与 ProPresenter、EasyWorship、OpenLP、FreeShow 和 Proclaim 比较',
    description:
      '免费开源的教会投影软件 Worship Q，与 ProPresenter、EasyWorship、OpenLP、FreeShow 和 Proclaim 的比较。',
  },
};

export const home: Home = {
  title: 'Worship Q — 免费的教会投影软件，显示歌词、经文和幻灯片',
  description:
    '免费、开源的敬拜投影软件，适用于 Mac 和 Windows。一张幻灯片上显示双语和多语诗歌歌词，两个译本并排的经文，幻灯片、PDF 和视频，OBS 字幕和手机控制。不需要账号。',
  ogTitle: 'Worship Q — 免费的教会投影软件',
  ogDescription:
    '在投影和直播中显示诗歌歌词、经文、幻灯片和视频。免费开源，适用于 Mac 和 Windows。',
  ogImageAlt: 'Worship Q：免费的教会投影软件，显示歌词、经文、幻灯片，并支持直播',
  markdownTitle: 'Worship Q 的 Markdown 版本',
  body: `<p class="text-sm font-medium tracking-wide text-amber-300">每一块屏幕，默契同步。</p>
<h1 class="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
  免费的教会投影软件，显示歌词、经文和幻灯片
</h1>
<p class="mt-4 max-w-xl text-lg text-slate-300">
  %SUMMARY%编排每周的流程表，轻松控制投影。不需要账号，也不需要互联网。
</p>

<section class="mt-10" aria-labelledby="download">
  <h2 id="download" class="sr-only">下载</h2>
  <div class="grid gap-3 sm:max-w-md">
    <a class="download" data-download="mac" href="%MAC_URL%">
      <svg
        viewBox="0 0 24 24"
        class="size-7 shrink-0"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.53 2.66-.39 6.6 1.1 8.75.73 1.05 1.6 2.24 2.73 2.2 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.4 1.2-2.47-.03-.01-2.3-.88-2.32-3.5zM14.2 6.13c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.64-1.05 1.67-.92 2.66.97.08 1.96-.49 2.56-1.21z"
        />
      </svg>
      <span>
        <span class="font-semibold">下载 Mac 版</span>
        <small>Apple 芯片和 Intel · macOS 11 或更高版本</small>
      </span>
    </a>
    <a class="download" data-download="windows" href="%WINDOWS_URL%">
      <svg
        viewBox="0 0 24 24"
        class="size-7 shrink-0"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          d="M3 5.5 10.4 4.5v7H3zM11.4 4.36 21 3v8.5h-9.6zM3 12.5h7.4v7L3 18.5zM11.4 12.5H21V21l-9.6-1.36z"
        />
      </svg>
      <span>
        <span class="font-semibold">下载 Windows 版</span>
        <small>64 位 · Windows 10 或更高版本</small>
      </span>
    </a>
  </div>
  <p class="mt-4 text-sm text-slate-400">
    版本 %RELEASE_VERSION% · %RELEASE_DATE% ·
    <a href="/releases/" class="text-sky-400 hover:text-sky-300">更新内容（英文）</a>
  </p>
  <p class="mt-1 text-sm text-slate-400">
    应用会自动更新；投影运行期间不会安装更新。
  </p>
</section>

<!-- The Mac app is signed and notarized; until the Windows app is signed too (plan
     phase 5): how to open it the first time. -->
<section
  class="mt-10 rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-300"
  aria-labelledby="first-open"
>
  <h2 id="first-open" class="font-semibold text-slate-100">第一次打开</h2>
  <dl class="mt-3 space-y-2">
    <div>
      <dt class="font-medium text-slate-100">Mac</dt>
      <dd>把 Worship Q 拖到“应用程序”文件夹，然后打开它。</dd>
    </div>
    <div>
      <dt class="font-medium text-slate-100">Windows</dt>
      <dd>
        Worship Q 还没有经过 Microsoft 签名，所以 Windows 第一次打开前会询问一次。如果出现“Windows 已保护你的电脑”，请选择“更多信息”，然后选择“仍要运行”。之后的更新不需要任何操作。
      </dd>
    </div>
  </dl>
</section>

<!-- Rendered from the app's code by apps/screenshots (\\\`pnpm screenshots\\\`), with
     public-domain hymns and Bible text, each time the site is built. -->
<section class="mt-14" aria-labelledby="screenshots">
  <h2 id="screenshots" class="text-2xl font-bold tracking-tight">看看它</h2>
  <figure class="mt-6">
    <a href="/screenshots/zh-hans/present.png">
      <img
        src="/screenshots/zh-hans/present.webp"
        width="1600"
        height="1000"
        class="shot"
        alt="Worship Q 的“演示”页面：左侧是流程表和投影预览，正显示两个译本的诗篇 23 篇；旁边是一段视频、一首双语诗歌、这段经文和一份讲道幻灯片，各自一列幻灯片"
      />
    </a>
    <figcaption>
      投影控制：查看流程表和当前画面，点击即可切换幻灯片。
    </figcaption>
  </figure>
  <div class="mt-8 grid gap-8 sm:grid-cols-2">
    <figure>
      <a href="/screenshots/zh-hans/slideshow.png">
        <img
          src="/screenshots/zh-hans/slideshow.webp"
          width="1600"
          height="900"
          class="shot"
          loading="lazy"
          alt="投影上显示主祷文的开头"
        />
      </a>
      <figcaption>投影上的歌词。</figcaption>
    </figure>
    <figure>
      <a href="/screenshots/zh-hans/slideshow-bible.png">
        <img
          src="/screenshots/zh-hans/slideshow-bible.webp"
          width="1600"
          height="900"
          class="shot"
          loading="lazy"
          alt="投影上的诗篇 23 篇，和合本与英王钦定本（KJV）并排，带经节编号"
        />
      </a>
      <figcaption>两个译本并排的经文。</figcaption>
    </figure>
    <figure>
      <a href="/screenshots/zh-hans/calendar.png">
        <img
          src="/screenshots/zh-hans/calendar.webp"
          width="1600"
          height="1000"
          class="shot"
          loading="lazy"
          alt="日历：标出了聚会日的一个月，以及所选主日的流程表"
        />
      </a>
      <figcaption>在日历上编排流程表。</figcaption>
    </figure>
    <figure>
      <a href="/screenshots/zh-hans/library.png">
        <img
          src="/screenshots/zh-hans/library.webp"
          width="1600"
          height="1000"
          class="shot"
          loading="lazy"
          alt="诗歌资源库，正在编辑主祷文的歌词"
        />
      </a>
      <figcaption>输入或粘贴歌词，自动拆分成幻灯片。</figcaption>
    </figure>
  </div>
</section>

<section class="mt-14" aria-labelledby="features">
  <h2 id="features" class="text-2xl font-bold tracking-tight">功能</h2>
  <div class="mt-6 grid gap-6 sm:grid-cols-2">
    <!-- %FEATURES% -->
  </div>
</section>

<section class="mt-14" aria-labelledby="faq">
  <h2 id="faq" class="text-2xl font-bold tracking-tight">常见问题</h2>
  <div class="mt-4 divide-y divide-slate-800 border-y border-slate-800">
    <!-- %FAQ% -->
  </div>
</section>`,
};
