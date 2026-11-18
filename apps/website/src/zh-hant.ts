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
  nav: { guide: '指南', compare: '比較', releases: '更新說明' },
  navLabel: '網站',
  language: '語言',
  footer: {
    features: '功能',
    help: '幫助',
    project: '項目',
    guide: '同工指南',
    server: '教會伺服器設定',
    compare: '與其他軟體比較',
    releases: '更新說明（英文）',
    source: '原始碼',
    licence: 'MIT 許可證',
    llms: '給 AI 助手（英文）',
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
    heading: '這個頁面不在這裡',
    text: '網址可能已經改變。Worship Q 的下載、功能和常見問題都在首頁。',
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
    version: '版本 {version}，釋出於 {date}。',
    notes: '更新說明（英文）',
    updates: '已安裝的應用程式會自動更新，但從不在投影開啟時更新。',
    windowsWarning:
      'Mac 應用程式已經過簽名和公證。Windows 應用程式還沒有經過 Microsoft 簽名，所以第一次開啟時 Windows 可能會顯示「Windows 已保護你的電腦」：請選擇「更多資訊」，然後選擇「仍要執行」。',
    compare: '與其他教會投影軟體比較',
    source: '原始碼',
  },
};

const SUMMARY =
  'Worship Q 是一款免費、開源的教會投影軟體，適用於 macOS 和 Windows，可以在投影和直播中顯示詩歌歌詞、經文、投影片和影片。';

const FEATURES: Feature[] = [
  {
    title: '任何語言的詩歌',
    page: '/multilingual-lyrics/',
    text: '按標題或歌詞搜尋，中文詩歌還可以用拼音或首字母搜尋。一句歌詞和它的翻譯在同一張投影片上，兩種語言或更多都可以。',
  },
  {
    title: '經文',
    page: '/bible/',
    text: '連線教會的伺服器後：輸入經文出處，例如 馬可福音15:5-6，或按書卷和章瀏覽，最多兩個譯本並排顯示。',
  },
  {
    title: '每次聚會一份流程表',
    text: '在日曆上編排，沿用之前某一週的安排，開啟時就是今天的聚會，並且已經開始。',
  },
  {
    title: '投影片、PDF、照片和影片',
    text: '連線教會的伺服器後，PowerPoint、Keynote 和 PDF 檔案會變成投影片，與詩歌放在一起。影片會提前下載，聚會中從不線上播放。',
  },
  {
    title: '投影和直播同時進行',
    page: '/obs/',
    text: '全螢幕投影，可用圖片或影片作背景，併為 OBS 提供字幕。在 Worship Q 中就能切換 OBS 場景和開始直播。',
  },
  {
    title: '用手機控制',
    page: '/phone-remote/',
    text: '掃描 QR 碼，批准一次手機，就能在房間裡的任何地方切換投影片或新增經文。',
  },
  {
    title: '多台電腦，一個演示',
    page: '/several-computers/',
    text: '每台連線的電腦都顯示同一張投影片。如果主控演示的電腦出了故障，另一台會從同一張投影片繼續。',
  },
  {
    title: '現場音訊',
    text: '把調音台的聲音傳送到其他電腦和手機，讓在場外的人也能及時切換投影片。',
  },
  {
    title: '獨立執行',
    text: '不需要帳號，也不需要網際網路。連線教會自己的伺服器，就能共享詩歌、媒體、經文和使用手機。',
  },
  {
    title: '免費開源',
    text: 'MIT 許可證，沒有廣告，沒有訂閱。已安裝的應用程式會自動更新，但從不在投影開啟時更新。',
  },
];

export const content: SiteContent = {
  summary: SUMMARY,
  features: FEATURES,
  featureList: [
    '任何語言的詩歌歌詞，一張投影片上顯示雙語或多語',
    '按標題、歌詞、拼音或首字母搜尋詩歌',
    '最多兩個譯本並排顯示的經文',
    '在日曆上編排的流程表',
    'PowerPoint、Keynote、PDF、照片和影片投影片',
    '圖片或影片背景',
    '為 OBS 提供字幕，並控制 OBS 的場景、串流和錄製',
    '用手機控制',
    '多台電腦共享一個演示，並能故障接替',
    '把調音台的現場音訊傳送到其他電腦和手機',
    '離線可用，不需要帳號',
  ],
  platforms: {
    mac: 'macOS 11 或更高版本，Apple 晶片和 Intel',
    windows: 'Windows 10 或更高版本，64 位',
  },
};

export const faq: Question[] = [
  {
    question: 'Worship Q 免費嗎？',
    answer:
      '是的。Worship Q 以 MIT 許可證免費開源，沒有廣告、沒有付費版，也沒有訂閱。教會伺服器同樣免費。',
  },
  {
    question: '需要帳號或網際網路嗎？',
    answer:
      '不需要。電腦版在一台電腦上就能獨立執行，不需要帳號，也不需要網際網路。連線教會伺服器是可選的，可以增加共享的詩歌、投影片和影片、經文、手機控制，以及多台電腦共享一個演示。',
  },
  {
    question: '它在哪些電腦上執行？',
    answer:
      'macOS 11 或更高版本（Apple 晶片和 Intel），以及 64 位 Windows 10 或更高版本。已安裝的應用程式會自動更新，但從不在投影開啟時更新。',
  },
  {
    question: '能顯示雙語歌詞，例如中文和英文，或更多語言嗎？',
    answer:
      '能。任何語言的歌詞都可以，雙語或三語詩歌會把一句歌詞和它的翻譯顯示在同一張投影片上：預設兩行，或者在「設定」中修改每張投影片行數，顯示更多行，例如中文、拼音和英文。可以按標題或歌詞找到詩歌，中文詩歌還可以用拼音或首字母找到。',
  },
  {
    question: '怎樣顯示經文？',
    answer:
      '按你平常的寫法輸入經文出處，例如 馬可福音15:5-6 或 可15:5-6，也可以按書卷和章瀏覽，或搜尋字詞。每張投影片最多並排顯示兩個譯本。經文透過教會伺服器提供，它可以使用不需要金鑰的 Free Use Bible API（例如和合本、KJV 和 BSB），或教會自己的 API.Bible 或 YouVersion 金鑰。',
  },
  {
    question: '能顯示 PowerPoint、Keynote、PDF、照片和影片嗎？',
    answer:
      '能，需要教會伺服器。PowerPoint、Keynote 和 OpenDocument 簡報以及 PDF 會變成投影片，照片和影片可以和詩歌一起放程序序單。影片會提前下載，所以聚會中不會線上播放任何內容。',
  },
  {
    question: '能配合 OBS 直播嗎？',
    answer:
      '能。字幕頁面可以作為 OBS 的「瀏覽器」來源顯示歌詞，Worship Q 還可以在教會的任何一台電腦或手機上切換 OBS 場景，開始或停止串流和錄製。',
  },
  {
    question: '能用手機控制投影片嗎？',
    answer:
      '能，需要教會伺服器。手機掃描 QR 碼，批准一次後，就可以切換投影片、修改流程表和新增經文。',
  },
  {
    question: '多台電腦能共享一個演示嗎？',
    answer:
      '能。連線到教會伺服器的電腦會顯示同一張投影片，任何一台都可以接管；如果主控演示的電腦出了故障，另一台會從同一張投影片繼續。在同一個 Wi-Fi 上，即使沒有網際網路，它們也能繼續一起工作。',
  },
  {
    question: '能從 ProPresenter、EasyWorship 或 OpenLP 匯入詩歌嗎？',
    answer:
      '暫時還不能。目前請把每首詩歌的歌詞以文字貼上進來，段落之間空一行；Worship Q 會把它們拆分成投影片。如果你的教會想轉過來並需要匯入功能，請發郵件到 hello@ihs.technology 商量。也歡迎在 github.com/iphren/worship-q 提交 Pull Request。',
  },
];

/** The Markdown pages' titles and descriptions, by their English path. */
export const pages: Record<string, PageText> = {
  '/guide/': {
    title: '同工指南 — Worship Q',
    description:
      '如何用 Worship Q 新增詩歌、編排流程表和演示：經文、投影片、影片、手機、OBS 和現場音訊。',
  },
  '/server/': {
    title: '教會伺服器設定 — Worship Q',
    description:
      '用 Docker 執行你教會自己的免費 Worship Q 伺服器：共享詩歌和媒體、經文、手機遙控、備份和管理後台。',
  },
  '/bible/': {
    title: '在投影上顯示經文 — Worship Q',
    description:
      '幾秒鐘就能顯示經文：輸入經文出處，兩個譯本並排檢視，然後演示。免費的教會投影軟體。',
  },
  '/multilingual-lyrics/': {
    title: '一張投影片上顯示兩種或更多語言的歌詞 — Worship Q',
    description:
      '在同一張投影片上顯示雙語或多語敬拜歌詞，例如中文、拼音和英文。用拼音或首字母搜尋中文詩歌。',
  },
  '/obs/': {
    title: '為 OBS 提供歌詞字幕和場景控制 — Worship Q',
    description: '用 OBS 的字幕把詩歌歌詞放進直播，並在 Worship Q 或手機上切換場景、串流和錄製。',
  },
  '/phone-remote/': {
    title: '用手機控制投影片 — Worship Q',
    description: '掃描 QR 碼，就能在房間裡的任何地方用手機切換投影片、修改流程表或新增經文。',
  },
  '/several-computers/': {
    title: '多台電腦，一個演示 — Worship Q',
    description:
      '場地裡的每台電腦都顯示同一張投影片；如果主控演示的電腦出了故障，另一台會從同一張投影片繼續。',
  },
  '/compare/': {
    title: 'Worship Q 與 ProPresenter、EasyWorship、OpenLP、FreeShow 和 Proclaim 比較',
    description:
      '免費開源的教會投影軟體 Worship Q，與 ProPresenter、EasyWorship、OpenLP、FreeShow 和 Proclaim 的比較。',
  },
};

export const home: Home = {
  title: 'Worship Q — 免費的教會投影軟體，顯示歌詞、經文和投影片',
  description:
    '免費、開源的敬拜投影軟體，適用於 Mac 和 Windows。一張投影片上顯示雙語和多語詩歌歌詞，兩個譯本並排的經文，投影片、PDF 和影片，OBS 字幕和手機控制。不需要帳號。',
  ogTitle: 'Worship Q — 免費的教會投影軟體',
  ogDescription:
    '在投影和直播中顯示詩歌歌詞、經文、投影片和影片。免費開源，適用於 Mac 和 Windows。',
  ogImageAlt: 'Worship Q：免費的教會投影軟體，顯示歌詞、經文、投影片，並支援直播',
  markdownTitle: 'Worship Q 的 Markdown 版本',
  body: `<p class="text-sm font-medium tracking-wide text-amber-300">每個螢幕，和諧一致。</p>
<h1 class="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
  免費的教會投影軟體，顯示歌詞、經文和投影片
</h1>
<p class="mt-4 max-w-xl text-lg text-slate-300">
  %SUMMARY%編排每週的流程表並演示，不需要帳號，也不需要網際網路。
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
    已安裝的應用程式會自動更新，但從不在投影開啟時更新。
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
        Worship Q 還沒有經過 Microsoft 簽名，所以 Windows 第一次開啟前會詢問一次。如果出現「Windows 已保護你的電腦」，請選擇「更多資訊」，然後選擇「仍要執行」。之後的更新不需要任何操作。
      </dd>
    </div>
  </dl>
</section>

<!-- Rendered from the app's code by apps/screenshots (\\\`pnpm screenshots\\\`), with
     public-domain hymns and Bible text, each time the site is built. -->
<section class="mt-14" aria-labelledby="screenshots">
  <h2 id="screenshots" class="text-2xl font-bold tracking-tight">看看它</h2>
  <figure class="mt-6">
    <a href="/screenshots/zh-hant/present.png">
      <img
        src="/screenshots/zh-hant/present.webp"
        width="1600"
        height="1000"
        class="shot"
        alt="Worship Q 的「演示」頁面：左側是流程表和投影預覽，正顯示兩個譯本的詩篇 23 篇；旁邊是一段影片、一首雙語詩歌、這段經文和一份講道投影片，各自一列投影片"
      />
    </a>
    <figcaption>
      演示中：流程表、螢幕上現在的內容，每張投影片一點就到。
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
      <figcaption>投影上的歌詞。</figcaption>
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
      <figcaption>兩個譯本並排的經文。</figcaption>
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
      <figcaption>在日曆上編排流程表。</figcaption>
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
      <figcaption>輸入或貼上詩歌，自動拆分成投影片。</figcaption>
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
