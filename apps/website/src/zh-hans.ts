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
  nav: { guide: '使用指南', compare: '软件对比', releases: '更新日志' },
  navLabel: '网站',
  language: '语言',
  footer: {
    features: '功能',
    help: '帮助',
    project: '项目',
    guide: '同工操作指南',
    server: '服务器部署',
    compare: '与其他软件比较',
    releases: '更新说明（英文）',
    source: '源代码',
    licence: 'MIT 许可证',
    llms: '供 AI 助手阅读（英文）',
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
    heading: '找不到这个页面',
    text: '页面可能已被移动或更名。你可以返回首页查看下载地址、功能介绍和常见问题。',
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
    version: '版本 {version} · 发布日期：{date}。',
    notes: '更新说明（英文）',
    updates: '应用会自动更新；投影运行期间不会安装更新。',
    windowsWarning:
      'Mac 版已完成数字签名和公证。Windows 版尚未进行代码签名，首次启动时可能出现“Windows 已保护你的电脑”的提示。此时可选择“更多信息”，再选择“仍要运行”。',
    compare: '与其他教会投影软件比较',
    source: '源代码',
  },
};

const SUMMARY =
  'Worship Q 是一款面向教会的免费开源投影软件，支持 macOS 和 Windows，可在投影屏幕和直播画面中呈现诗歌歌词、圣经经文、幻灯片和视频。';

const FEATURES: Feature[] = [
  {
    title: '多语言诗歌',
    page: '/multilingual-lyrics/',
    text: '按标题或歌词查找诗歌，中文还支持拼音和首字母搜索。可以把一句歌词及其译文放在同一张幻灯片上，轻松呈现双语或多语歌词。',
  },
  {
    title: '快速查找圣经经文',
    page: '/bible/',
    text: '连接教会服务器后，可以输入经文出处（如“马可福音15:5-6”），或按书卷和章节浏览。最多可并排显示两个译本。',
  },
  {
    title: '为每次聚会安排流程',
    text: '在日历中编排流程表，也可以复制以往的安排。打开应用时，即可接着使用当天或下一个聚会日的流程表。',
  },
  {
    title: '幻灯片、PDF 和视频',
    text: '通过教会服务器把 PowerPoint、Keynote 和 PDF 转成幻灯片，连同照片、视频和诗歌一起加入流程表。视频提前下载，聚会时无需在线播放。',
  },
  {
    title: '兼顾现场投影与直播',
    page: '/obs/',
    text: '投影支持全屏显示，并可使用图片或视频背景；直播则可通过 OBS 叠加歌词字幕。还可以在 Worship Q 中切换 OBS 场景、开始直播。',
  },
  {
    title: '手机也能遥控',
    page: '/phone-remote/',
    text: '扫描二维码，经电脑端批准后，就可以在会场任何位置用手机切换幻灯片、添加经文，无需安装应用。',
  },
  {
    title: '多台电脑同步配合',
    page: '/several-computers/',
    text: '同一工作区的电脑会同步显示当前幻灯片。主控电脑出现故障时，另一台可以接手，从原来的位置继续。',
  },
  {
    title: '远程收听现场音频',
    text: '把调音台的声音传送到其他电脑或手机，让不在会场内的同工也能跟上聚会进度，及时切换幻灯片。',
  },
  {
    title: '一台电脑就能使用',
    text: '单机使用无需账号或互联网。需要共享诗歌、媒体、经文或使用手机遥控时，再连接教会自己的服务器。',
  },
  {
    title: '免费开源，没有订阅',
    text: '采用 MIT 许可证，无广告、无付费版本。应用会自动更新，但投影窗口打开期间不会安装更新。',
  },
];

export const content: SiteContent = {
  summary: SUMMARY,
  features: FEATURES,
  featureList: [
    '支持任意语言的诗歌歌词，可在同一张幻灯片上显示双语或多语内容',
    '按标题、歌词、拼音或拼音首字母搜索诗歌',
    '最多并排显示两个译本的圣经经文',
    '通过日历安排每次聚会的流程表',
    '支持 PowerPoint、Keynote、PDF、照片和视频',
    '支持图片或视频作为投影背景',
    '为 OBS 提供歌词字幕，并控制场景、直播和录制',
    '用手机遥控幻灯片和流程表',
    '多台电脑同步投影，支持故障后接管',
    '将调音台的现场音频传送到其他电脑和手机',
    '单机离线可用，无需注册账号',
  ],
  platforms: {
    mac: 'macOS 11 或更高版本，Apple 芯片和 Intel',
    windows: 'Windows 10 或更高版本，64 位',
  },
};

export const faq: Question[] = [
  {
    question: 'Worship Q 是免费的吗？',
    answer:
      '是的。Worship Q 采用 MIT 开源许可证，完全免费，没有广告、订阅费用或付费版本。教会服务器也可以免费使用。',
  },
  {
    question: '需要注册账号或连接互联网吗？',
    answer:
      '不需要。只用一台电脑时，Worship Q 无需账号和互联网也能运行。连接教会服务器后，还能在多台电脑之间共享诗歌和媒体、查找圣经经文、使用手机遥控并同步投影。',
  },
  {
    question: '支持哪些电脑？',
    answer:
      '支持搭载 Apple 芯片或 Intel 处理器、运行 macOS 11 及以上版本的 Mac，以及运行 64 位 Windows 10 及以上版本的电脑。应用会自动更新，但不会在投影窗口打开期间安装更新。',
  },
  {
    question: '可以在同一张幻灯片上显示双语歌词吗？',
    answer:
      '可以。不论中文、英文还是其他语言，都能将一句歌词及其译文排在同一张幻灯片上。默认每张显示两行，也可以在设置中调整行数，例如同时显示中文、拼音和英文。诗歌支持按标题、歌词、拼音或首字母搜索。',
  },
  {
    question: '如何查找并投影圣经经文？',
    answer:
      '输入“马可福音15:5-6”或“可15:5-6”这样的经文出处，也可以浏览书卷、章节，或按关键词搜索。每张幻灯片最多可并排显示两个译本。经文由教会服务器提供，可使用无需密钥的 Free Use Bible API（如和合本、KJV、BSB），或配置教会自己的 API.Bible、YouVersion 密钥。',
  },
  {
    question: '支持 PowerPoint、Keynote、PDF 和视频吗？',
    answer:
      '支持，但需要连接教会服务器。PowerPoint、Keynote、OpenDocument 和 PDF 文件会转换为幻灯片；照片、视频也可以加入流程表。视频会提前下载，避免聚会中依赖在线播放。',
  },
  {
    question: '可以搭配 OBS 直播吗？',
    answer:
      '可以。通过 OBS 的“浏览器”来源，可将歌词以透明背景叠加到直播画面中。还可以在 Worship Q 或已获批准的手机上切换 OBS 场景，以及开始或停止直播和录制。',
  },
  {
    question: '可以用手机控制投影吗？',
    answer:
      '可以，需要连接教会服务器。手机扫描二维码并获得电脑端批准后，就能切换幻灯片、调整正在使用的流程表，或临时添加经文。',
  },
  {
    question: '多台电脑能同步显示同一套投影吗？',
    answer:
      '可以。连接到同一工作区的电脑会同步显示当前幻灯片；如果主控电脑出现故障，其他电脑可以接管并从原来的位置继续。系统设计支持在互联网中断时通过同一个局域网保持同步；正式使用前建议在实际设备上测试。',
  },
  {
    question: '能从 ProPresenter、EasyWorship 或 OpenLP 导入诗歌吗？',
    answer:
      '目前还不支持直接导入。你可以先复制歌词并粘贴到 Worship Q 中，用空行分隔段落，软件会自动生成幻灯片。如果教会需要迁移工具，欢迎通过 hello@ihs.technology 联系我们，或在 github.com/iphren/worship-q 提交 Pull Request。',
  },
];

/** The Markdown pages' titles and descriptions, by their English path. */
export const pages: Record<string, PageText> = {
  '/guide/': {
    title: 'Worship Q 同工操作指南 — Worship Q',
    description:
      '从添加诗歌、编排流程表到控制投影，了解经文、幻灯片、视频、手机遥控、OBS 和现场音频的使用方法。',
  },
  '/server/': {
    title: 'Worship Q 教会服务器部署指南 — Worship Q',
    description:
      '使用 Docker 部署免费的 Worship Q 教会服务器，实现诗歌和媒体共享、经文查询、手机遥控、备份及后台管理。',
  },
  '/bible/': {
    title: '投影圣经经文 — Worship Q',
    description: '快速查找经文，最多并排显示两个译本；也可以提前将经文加入聚会流程表。',
  },
  '/multilingual-lyrics/': {
    title: '在同一张幻灯片上显示双语或多语歌词 — Worship Q',
    description: '支持中文、拼音、英文等多种语言组合，还可以用拼音或首字母搜索中文诗歌。',
  },
  '/obs/': {
    title: 'OBS 歌词字幕与场景控制 — Worship Q',
    description: '将歌词字幕叠加到 OBS 直播画面，并通过 Worship Q 或手机切换场景、控制直播与录制。',
  },
  '/phone-remote/': {
    title: '用手机遥控投影 — Worship Q',
    description: '扫描二维码并获得批准后，即可通过手机切换幻灯片、调整流程表或添加经文。',
  },
  '/several-computers/': {
    title: '多台电脑同步投影 — Worship Q',
    description: '多台电脑同步显示当前幻灯片。主控电脑出现故障时，其他电脑可以接手，继续投影。',
  },
  '/compare/': {
    title: 'Worship Q 与其他教会投影软件对比 — Worship Q',
    description:
      '了解 Worship Q 与 ProPresenter、EasyWorship、OpenLP、FreeShow 和 Proclaim 在价格、平台及功能上的差异。',
  },
};

export const home: Home = {
  title: 'Worship Q — 免费开源的教会投影软件',
  description:
    'Worship Q 是适用于 Mac 和 Windows 的免费开源教会投影软件，支持双语歌词、双译本经文、幻灯片、视频、OBS 直播字幕和手机遥控，无需注册账号。',
  ogTitle: 'Worship Q — 免费的教会投影软件',
  ogDescription:
    '在投影和直播中显示诗歌歌词、经文、幻灯片和视频。免费开源，适用于 Mac 和 Windows。',
  ogImageAlt: 'Worship Q：免费的教会投影软件，显示歌词、经文、幻灯片，并支持直播',
  markdownTitle: 'Worship Q 首页（Markdown）',
  body: `<p class="text-sm font-medium tracking-wide text-amber-300">多屏协同，默契呈现。</p>
<h1 class="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
  免费开源的教会投影软件
</h1>
<p class="mt-4 max-w-xl text-lg text-slate-300">
  %SUMMARY%轻松编排聚会流程，无需注册账号；单机使用时也不需要互联网。
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
        Windows 版目前尚未进行代码签名。首次启动时，如果看到“Windows 已保护你的电脑”，请选择“更多信息”，再选择“仍要运行”。后续更新无需重复操作。
      </dd>
    </div>
  </dl>
</section>

<!-- Rendered from the app's code by apps/screenshots (\\\`pnpm screenshots\\\`), with
     public-domain hymns and Bible text, each time the site is built. -->
<section class="mt-14" aria-labelledby="screenshots">
  <h2 id="screenshots" class="text-2xl font-bold tracking-tight">界面预览</h2>
  <figure class="mt-6">
    <a href="/screenshots/zh-hans/present.png">
      <img
        src="/screenshots/zh-hans/present.webp"
        width="1600"
        height="1000"
        class="shot"
        alt="Worship Q 的“投影控制”页面：左侧是流程表和投影预览，正显示两个译本的诗篇 23 篇；旁边是一段视频、一首双语诗歌、这段经文和一份讲道幻灯片，各自一列幻灯片"
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
      <figcaption>投影屏幕上的歌词。</figcaption>
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
      <figcaption>两个译本的经文并排显示。</figcaption>
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
      <figcaption>在日历中安排每次聚会的流程。</figcaption>
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
      <figcaption>粘贴歌词，即可自动生成幻灯片。</figcaption>
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
