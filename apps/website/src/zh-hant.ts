// worship-q.com in Traditional Chinese (translation plan T9), drafted from zh-hans.ts with
// `pnpm --filter @worship-q/i18n draft-hant --file`, then read through. The Markdown pages
// themselves are in pages/zh-hant/ and docs/zh-hant/.
//
// Tailwind finds the classes used here by reading this file, so write class names out in
// full: never build them from pieces.

import type { Feature, SiteContent } from './content.ts';
import type { Question } from './faq.ts';
import type { Home } from './home.ts';
import type { PageText } from './pages.ts';
import type { Words } from './words.ts';

export const words: Words = {
  nav: { guide: '使用指南', compare: '軟體比較', releases: '更新紀錄' },
  navLabel: '網站',
  language: '語言',
  footer: {
    features: '功能',
    help: '幫助',
    project: '項目',
    guide: '同工操作指南',
    server: '伺服器部署',
    compare: '與其他軟體比較',
    releases: '更新說明（英文）',
    source: '原始碼',
    licence: 'MIT 許可證',
    llms: '供 AI 助手閱讀（英文）',
    privacy: '隱私說明',
  },
  featurePages: {
    '/bible/': '經文',
    '/multilingual-lyrics/': '多語言歌詞',
    '/obs/': 'OBS 和直播',
    '/phone-remote/': '手機遙控',
    '/several-computers/': '多台電腦',
  },
  more: '詳情',
  notFound: {
    title: '找不到頁面 — Worship Q',
    heading: '找不到這個頁面',
    text: '頁面可能已經移動或更名。你可以返回首頁查看下載連結、功能介紹和常見問題。',
    link: '前往 worship-q.com',
  },
  markdown: {
    download: '下載',
    whatItDoes: '功能',
    questions: '常見問題',
    more: '更多',
    screenshots: '截圖',
    macDownload: '下載 Mac 版',
    windowsDownload: '下載 Windows 版',
    version: '版本 {version} · 發布日期：{date}。',
    notes: '更新說明（英文）',
    updates: '應用程式會自動更新；投影執行期間不會安裝更新。',
    windowsWarning:
      'Mac 版已完成數位簽章與公證。Windows 版尚未完成程式碼簽署，首次啟動時可能出現「Windows 已保護你的電腦」的提示。此時可選擇「更多資訊」，再選擇「仍要執行」。',
    compare: '與其他教會投影軟體比較',
    source: '原始碼',
  },
};

const SUMMARY =
  'Worship Q 是一款專為教會設計的免費開源投影軟體，支援 macOS 和 Windows，可在投影螢幕和直播畫面中呈現詩歌歌詞、聖經經文、投影片及影片。';

const FEATURES: Feature[] = [
  {
    title: '多語言詩歌',
    page: '/multilingual-lyrics/',
    text: '可依標題或歌詞搜尋詩歌，中文還支援拼音和首字母搜尋。每句歌詞都能與對應譯文放在同一張投影片上，輕鬆呈現雙語或多語內容。',
  },
  {
    title: '快速查找聖經經文',
    page: '/bible/',
    text: '輸入經文出處（例如「馬可福音15:5-6」），也可以依書卷和章節瀏覽，最多並排顯示兩個譯本。',
  },
  {
    title: '為每次聚會安排流程',
    text: '在日曆中編排流程表，也可以複製以往的安排。開啟應用程式後，即可接著使用當天或下一個聚會日的流程表。',
  },
  {
    title: '投影片、PDF 與影片',
    text: '將 PowerPoint、Keynote 和 PDF 轉成投影片，再把照片、影片和詩歌一同加入流程表。影片從電腦本機播放，聚會時不必線上播放。',
  },
  {
    title: '兼顧現場投影與直播',
    page: '/obs/',
    text: '投影支援全螢幕顯示，並可使用圖片或影片背景；直播則可透過 OBS 疊加歌詞字幕。也能直接在 Worship Q 中切換 OBS 場景、開始直播。',
  },
  {
    title: '手機也能遙控',
    page: '/phone-remote/',
    text: '掃描 QR 碼並經電腦端批准後，就能在會場任何位置用手機切換投影片、新增經文，不必安裝應用程式。',
  },
  {
    title: '多台電腦同步配合',
    page: '/several-computers/',
    text: '同一工作區的電腦會同步顯示目前的投影片。主控電腦發生故障時，另一台可以接手，從原來的位置繼續。',
  },
  {
    title: '遠端收聽現場音訊',
    text: '把混音器的聲音傳送到其他電腦或手機，讓不在會場內的同工也能掌握聚會進度，及時切換投影片。',
  },
  {
    title: '一台電腦就能使用',
    text: '不需要帳號，備課和投影也不需要網際網路。手機遙控、經文和投影片透過免費的公共伺服器使用，伺服器不保留任何內容；教會自己的伺服器可在多台電腦之間共享。',
  },
  {
    title: '免費開源，無須訂閱',
    text: '採用 MIT 授權條款，沒有廣告，也沒有付費版本。應用程式會自動更新，但投影視窗開啟期間不會安裝更新。',
  },
];

export const content: SiteContent = {
  summary: SUMMARY,
  features: FEATURES,
  featureList: [
    '支援各種語言的詩歌歌詞，可在同一張投影片上顯示雙語或多語內容',
    '可依標題、歌詞、拼音或拼音首字母搜尋詩歌',
    '最多並排顯示兩個譯本的聖經經文',
    '透過日曆安排每次聚會的流程表',
    '支援 PowerPoint、Keynote、PDF、照片與影片',
    '支援圖片或影片作為投影背景',
    '為 OBS 提供歌詞字幕，並控制場景、直播與錄製',
    '使用手機遙控投影片與流程表',
    '多台電腦同步投影，支援故障時接管',
    '將混音器的現場音訊傳送到其他電腦與手機',
    '單機離線可用，不需要註冊帳號',
  ],
  platforms: {
    mac: 'macOS 11 或更高版本，Apple 晶片和 Intel',
    windows: 'Windows 10 或更高版本，64 位',
  },
};

export const faq: Question[] = [
  {
    question: 'Worship Q 是免費的嗎？',
    answer:
      '是的。Worship Q 採用 MIT 開源授權條款，完全免費，沒有廣告、訂閱費或付費版本。手機遙控、經文和投影片所用的公共伺服器免費，教會伺服器也能免費使用。',
  },
  {
    question: '需要註冊帳號或連線網路嗎？',
    answer:
      '不需要帳號；只用一台電腦備課和投影時，也不需要網際網路。手機遙控、聖經經文以及 PowerPoint 或 PDF 投影片透過免費的 Worship Q 公共伺服器使用，這需要網際網路，伺服器不保留任何內容。執行教會自己的伺服器是可選的，可以讓多台電腦同步投影、共享詩歌與媒體、異地備份，並使用需要金鑰的聖經譯本。',
  },
  {
    question: '支援哪些電腦？',
    answer:
      '支援搭載 Apple 晶片或 Intel 處理器、執行 macOS 11 以上版本的 Mac，以及執行 64 位元 Windows 10 以上版本的電腦。應用程式會自動更新，但不會在投影視窗開啟期間安裝更新。',
  },
  {
    question: '能在同一張投影片上顯示雙語歌詞嗎？',
    answer:
      '可以。無論中文、英文或其他語言，都能將一句歌詞及其譯文排在同一張投影片上。預設每張顯示兩行，也可以在設定中調整行數，例如同時顯示中文、拼音和英文。詩歌支援依標題、歌詞、拼音或首字母搜尋。',
  },
  {
    question: '如何查找並投影聖經經文？',
    answer:
      '輸入「馬可福音15:5-6」或「可15:5-6」等經文出處，也可以依書卷、章節瀏覽，或使用關鍵字搜尋。每張投影片最多能並排顯示兩個譯本。沒有教會伺服器時，經文由免費的 Worship Q 公共伺服器提供，可使用不需金鑰的譯本（例如和合本、KJV、BSB）。教會伺服器還可以使用教會自己的 API.Bible、YouVersion 或 ESV 金鑰，提供 NIV、NKJV、ESV 等譯本。',
  },
  {
    question: '支援 PowerPoint、Keynote、PDF 和影片嗎？',
    answer:
      '支援。PowerPoint、Keynote、OpenDocument 和 PDF 檔案會轉換為投影片；照片和影片也可以加入流程表。沒有教會伺服器時，投影片由免費的 Worship Q 公共伺服器轉換後保存在電腦上，影片也保存在電腦上。連線教會伺服器後，教會的每台電腦都能使用這些內容，影片會預先下載，避免聚會中依賴線上播放。',
  },
  {
    question: '可以搭配 OBS 直播嗎？',
    answer:
      '可以。透過 OBS 的「瀏覽器」來源，可以將透明背景的歌詞字幕疊加到直播畫面上。也能在 Worship Q 或已批准的手機上切換 OBS 場景，以及開始或停止直播與錄製。',
  },
  {
    question: '可以用手機控制投影嗎？',
    answer:
      '可以。手機掃描 QR 碼並經電腦端批准後，就能切換投影片、調整正在使用的流程表，或臨時新增經文。沒有教會伺服器時，最多兩支手機可同時透過免費的 Worship Q 公共伺服器連線，因此電腦和手機都需要網際網路。',
  },
  {
    question: '多台電腦能同步顯示同一套投影嗎？',
    answer:
      '可以。連線到同一工作區的電腦會同步顯示目前的投影片；如果主控電腦發生故障，其他電腦可以接管，從原來的位置繼續。網際網路中斷時，同一區域網路中的電腦仍可保持同步；這項功能已通過兩台電腦的斷網測試。',
  },
  {
    question: '什麼是 Worship Q 公共伺服器？它會保存什麼？',
    answer:
      '這是由 Worship Q 專案執行的免費伺服器。沒有教會伺服器的電腦會自動使用它來進行手機遙控、查找經文、轉換投影片和現場音訊，不需任何設定或登入。它不保留任何內容：電腦取得投影片後立即刪除，其他內容一天內刪除；詩歌、流程表和錄音從不會上傳到那裡。所以它只是單台電腦的幫手，而不是保存教會內容的地方。經過它的內容和保留時間，詳見隱私說明 worship-q.com/zh-hant/privacy/。',
  },
  {
    question: '教會為什麼還要執行自己的伺服器？',
    answer:
      '為了共享：多台電腦同步投影，教會的每台電腦都有詩歌、流程表、投影片和影片，教會資源庫，異地備份，供直播電腦使用的瀏覽器遠端畫面，NIV、ESV 等需要金鑰的聖經譯本，現場音訊錄製，以及管理後台。之後加入的電腦會帶上它的投影片和影片。',
  },
  {
    question: '能從 ProPresenter、EasyWorship 或 OpenLP 匯入詩歌嗎？',
    answer:
      '目前還不支援直接匯入。你可以先複製歌詞並貼到 Worship Q，以空白行分隔段落，軟體便會自動產生投影片。如果教會需要轉移工具，歡迎透過 hello@ihs.technology 聯絡我們，或在 github.com/iphren/worship-q 提交 Pull Request。',
  },
];

/** The Markdown pages' titles and descriptions, by their English path. */
export const pages: Record<string, PageText> = {
  '/privacy/': {
    title: '隱私說明 — Worship Q',
    description:
      'Worship Q 應用程式、免費公共伺服器和本網站會處理哪些資訊、保留多久，以及還涉及哪些第三方。',
  },
  '/guide/': {
    title: 'Worship Q 同工操作指南 — Worship Q',
    description:
      '從新增詩歌、編排流程表到控制投影，了解經文、投影片、影片、手機遙控、OBS 和現場音訊的使用方法。',
  },
  '/server/': {
    title: 'Worship Q 教會伺服器部署指南 — Worship Q',
    description:
      '使用 Docker 部署免費的 Worship Q 教會伺服器，實現多台電腦同步投影、詩歌和媒體共享、備份、使用教會金鑰的聖經譯本及後台管理。',
  },
  '/bible/': {
    title: '投影聖經經文 — Worship Q',
    description: '快速查找經文，最多並排顯示兩個譯本；也可以提前將經文加入聚會流程表。',
  },
  '/multilingual-lyrics/': {
    title: '在同一張投影片上顯示雙語或多語歌詞 — Worship Q',
    description: '支援中文、拼音、英文等多種語言組合，也可以用拼音或首字母搜尋中文詩歌。',
  },
  '/obs/': {
    title: 'OBS 歌詞字幕與場景控制 — Worship Q',
    description: '將歌詞字幕疊加到 OBS 直播畫面，並透過 Worship Q 或手機切換場景、控制直播與錄製。',
  },
  '/phone-remote/': {
    title: '使用手機遙控投影 — Worship Q',
    description: '掃描 QR 碼並獲得批准後，即可透過手機切換投影片、調整流程表或新增經文。',
  },
  '/several-computers/': {
    title: '多台電腦同步投影 — Worship Q',
    description: '多台電腦同步顯示目前的投影片。主控電腦發生故障時，其他電腦可以接手，繼續投影。',
  },
  '/compare/': {
    title: 'Worship Q 與其他教會投影軟體比較 — Worship Q',
    description:
      '了解 Worship Q 與 ProPresenter、EasyWorship、OpenLP、FreeShow 和 Proclaim 在價格、平台及功能上的差異。',
  },
};

export const home: Home = {
  title: 'Worship Q — 免費開源的教會投影軟體',
  description:
    'Worship Q 是適用於 Mac 與 Windows 的免費開源教會投影軟體，支援雙語歌詞、雙譯本經文、投影片、影片、OBS 直播字幕和手機遙控，不需註冊帳號。',
  ogTitle: 'Worship Q — 免費的教會投影軟體',
  ogDescription:
    '在投影和直播中顯示詩歌歌詞、經文、投影片和影片。免費開源，適用於 Mac 和 Windows。',
  ogImageAlt: 'Worship Q：免費的教會投影軟體，顯示歌詞、經文、投影片，並支援直播',
  markdownTitle: 'Worship Q 首頁（Markdown）',
  body: `<p class="text-sm font-medium tracking-wide text-amber-300">多螢幕協作，默契呈現。</p>
<h1 class="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
  免費開源的教會投影軟體
</h1>
<p class="mt-4 max-w-xl text-lg text-slate-300">
  %SUMMARY%輕鬆編排聚會流程，不需註冊帳號；單機使用時也不需要網際網路。
</p>

<section class="mt-10" aria-labelledby="download">
  <h2 id="download" class="sr-only">下載</h2>
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
        <span class="font-semibold">下載 Mac 版</span>
        <small>Apple 晶片和 Intel · macOS 11 或更高版本</small>
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
        <span class="font-semibold">下載 Windows 版</span>
        <small>64 位 · Windows 10 或更高版本</small>
      </span>
    </a>
  </div>
  <p class="mt-4 text-sm text-slate-400">
    版本 %RELEASE_VERSION% · %RELEASE_DATE% ·
    <a href="/releases/" class="text-sky-400 hover:text-sky-300">更新內容（英文）</a>
  </p>
  <p class="mt-1 text-sm text-slate-400">
    應用程式會自動更新；投影執行期間不會安裝更新。
  </p>
</section>

<!-- The Mac app is signed and notarized; until the Windows app is signed too (plan
     phase 5): how to open it the first time. -->
<section
  class="mt-10 rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-300"
  aria-labelledby="first-open"
>
  <h2 id="first-open" class="font-semibold text-slate-100">第一次開啟</h2>
  <dl class="mt-3 space-y-2">
    <div>
      <dt class="font-medium text-slate-100">Mac</dt>
      <dd>把 Worship Q 拖到「應用程式」資料夾，然後開啟它。</dd>
    </div>
    <div>
      <dt class="font-medium text-slate-100">Windows</dt>
      <dd>
        Windows 版目前尚未完成程式碼簽署。首次啟動時，如果看到「Windows 已保護你的電腦」，請選擇「更多資訊」，再選擇「仍要執行」。後續更新不需重複操作。
      </dd>
    </div>
  </dl>
</section>

<!-- Rendered from the app's code by apps/screenshots (\\\`pnpm screenshots\\\`), with
     public-domain hymns and Bible text, each time the site is built. -->
<section class="mt-14" aria-labelledby="screenshots">
  <h2 id="screenshots" class="text-2xl font-bold tracking-tight">介面預覽</h2>
  <figure class="mt-6">
    <a href="/screenshots/zh-hant/present.png">
      <img
        src="/screenshots/zh-hant/present.webp"
        width="1600"
        height="1000"
        class="shot"
        alt="Worship Q 的「投影控制」頁面：左側是流程表和投影預覽，正顯示兩個譯本的詩篇 23 篇；旁邊是一段影片、一首雙語詩歌、這段經文和一份講道投影片，各自一列投影片"
      />
    </a>
    <figcaption>
      投影控制：查看流程表和目前畫面，點選即可切換投影片。
    </figcaption>
  </figure>
  <div class="mt-8 grid gap-8 sm:grid-cols-2">
    <figure>
      <a href="/screenshots/zh-hant/slideshow.png">
        <img
          src="/screenshots/zh-hant/slideshow.webp"
          width="1600"
          height="900"
          class="shot"
          loading="lazy"
          alt="投影上顯示主禱文的開頭"
        />
      </a>
      <figcaption>投影螢幕上的歌詞。</figcaption>
    </figure>
    <figure>
      <a href="/screenshots/zh-hant/slideshow-bible.png">
        <img
          src="/screenshots/zh-hant/slideshow-bible.webp"
          width="1600"
          height="900"
          class="shot"
          loading="lazy"
          alt="投影上的詩篇 23 篇，和合本與英王欽定本（KJV）並排，帶經節編號"
        />
      </a>
      <figcaption>兩個譯本的經文並排顯示。</figcaption>
    </figure>
    <figure>
      <a href="/screenshots/zh-hant/calendar.png">
        <img
          src="/screenshots/zh-hant/calendar.webp"
          width="1600"
          height="1000"
          class="shot"
          loading="lazy"
          alt="日曆：標出了聚會日的一個月，以及所選主日的流程表"
        />
      </a>
      <figcaption>在日曆中安排每次聚會的流程。</figcaption>
    </figure>
    <figure>
      <a href="/screenshots/zh-hant/library.png">
        <img
          src="/screenshots/zh-hant/library.webp"
          width="1600"
          height="1000"
          class="shot"
          loading="lazy"
          alt="詩歌資源庫，正在編輯主禱文的歌詞"
        />
      </a>
      <figcaption>貼上歌詞，就能自動產生投影片。</figcaption>
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
  <h2 id="faq" class="text-2xl font-bold tracking-tight">常見問題</h2>
  <div class="mt-4 divide-y divide-slate-800 border-y border-slate-800">
    <!-- %FAQ% -->
  </div>
</section>`,
};
