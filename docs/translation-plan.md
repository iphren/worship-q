# Worship Q — Translation Plan

**Drafted:** 17 November 2026; owner's answers and the two phases added the same day  
**Status:** Phase 1 built (17 November 2026): every app and the website read their words from a catalogue, with a Language setting everywhere, in English only (§7). Phase 2 built the same day, on a branch for the project owner's review: Simplified and Traditional Chinese in every app and on worship-q.com (§8). The glossary (§5) is proposed, to be agreed in that review.  
**Source:** the project owner's request of 17 November 2026 (Chinese in Simplified and Traditional, across the apps and the website, as one piece of work); the [Search and AI discovery plan](seo-plan.md), phase 3 item 4; the code at version 2.9.0.

## 1. Goal

Worship Q in **English**, **Simplified Chinese** and **Traditional Chinese**, everywhere a person reads it:

- the desktop app (including the slideshow window and the subtitle overlay's few words)
- the admin web app
- the phone remote
- the browser slideshow and subtitle pages
- worship-q.com, with the volunteer guide and the server setup guide
- messages from the church server and the native core that reach the screen

Done as one piece of work, so the same words mean the same things in the app, on the phone and on the website.

## 2. Where we were (before phase 1)

| Part | Text today |
| --- | --- |
| Desktop app | Behind a translation layer (`apps/desktop/src/i18n`): about 660 messages in `en.ts`, read with `t()`. Only English exists, and nothing calls `setLocale`. Run sheet dates are built in English ("Sunday 1st Nov"), with English ordinals. |
| Admin app | English written into the components (`apps/admin/src`, about 3,900 lines). |
| Phone remote | English written into the components (`apps/remote/src`, about 1,750 lines). |
| Browser output pages | A few words (`apps/output/src`). |
| Native core (Rust) | A few strings that can reach the screen, such as the slideshow window's title and OBS connection reasons. |
| Church server | Some refusals carry an English message that the desktop shows (`refused:<message>`). |
| Website | English only, by decision, until this work ([SEO plan](seo-plan.md)). The volunteer guide has a few Chinese examples, to move into the Chinese guide. |
| Pages' `lang` | `en` everywhere. |

Already in place: Chinese **content** works (lyrics in any language, search by pinyin and initials, both scripts matched through `opencc-js` in `packages/search`), and Bible references and book names already follow each **version's** language. This plan is about the **interface**.

## 3. Requirements (proposed)

| ID | Requirement |
| --- | --- |
| T1 | **Languages:** English (`en`), Simplified Chinese (`zh-Hans`), Traditional Chinese (`zh-Hant`). |
| T2 | **Choosing:** each app follows the system or browser language by default, with Chinese scripts matched by region (for example Taiwan and Hong Kong to Traditional). The desktop has a **Language** setting that overrides it, per computer. The phone remote and admin app follow the browser, with a switch in their menus. |
| T3 | **One catalogue:** the messages move into a shared package (for example `packages/i18n`), used by the desktop, phone remote, admin and output pages, so a term is translated once. Each app keeps only the messages it uses. |
| T4 | **Every key in every language:** the type system already requires a `Record<MessageKey, string>` per language; a test checks no message is left in English by mistake. |
| T5 | **Translated by Claude, reviewed by the project owner:** Claude writes Simplified, and drafts Traditional from it with OpenCC's conversion (`opencc-js`, already a dependency) before correcting the wording by hand; the project owner reviews both before release. Conversion alone gets characters right but not all vocabulary. One Traditional for all regions, not separate Taiwan and Hong Kong versions. |
| T6 | **Dates and numbers** per language: "Sunday 1st Nov" becomes, for example, `11月22日星期日`, through `Intl` rather than English ordinals. |
| T7 | **Messages from the server and the native core** are codes, translated by the app that shows them, not English sentences. Existing English messages keep working for older servers. |
| T8 | **Interface language is not content language.** Lyrics, Bible versions and song search are unaffected by the interface language; a Chinese interface can present English songs and the other way round. |
| T9 | **Website:** every page and document on worship-q.com in both scripts (the home page, features, FAQ, screenshots' descriptions, and every guide or page the site carries: today the volunteer guide and server setup guide, plus the pages of [SEO plan](seo-plan.md) phase 3). Chinese pages live under `/zh-hans/` and `/zh-hant/`, mirroring the English paths, with `hreflang` linking all three languages and a language link on every page. `llms.txt` and `index.md` stay English; the Chinese pages get their own Markdown copies. Documents that stay on GitHub only (README, plans, release notes) stay English. |
| T10 | **Glossary first:** the key terms are agreed before translating (§5, at the start of phase 2), and kept in this plan or beside the catalogue. |

## 4. Phases

Two phases. Phase 1 changes no words on screen: everything still reads in English, but nothing
is written into the code any more. Phase 2 adds the two Chinese languages on top.

### Phase 1: the layer, in English

Every app, page and message reads its words from a catalogue, with the language chosen in one
place; English is the only language in the catalogue at the end of it.

1. **Shared catalogue package** (`packages/i18n`, T3): `t()`, placeholders, the current
   language and the `MessageKey` type, moved out of `apps/desktop/src/i18n` so every app uses
   the same layer. Messages are grouped by area, so each app loads only what it uses.
2. **Desktop app:** the remaining English written into components moves into the catalogue
   (most of it is there already).
3. **Phone remote, admin app and browser output pages:** all their English moves into the
   catalogue.
4. **Native core and church server** (T7): the strings that reach the screen become codes,
   with their English in the catalogue. Older servers' English `refused:<message>` still shows
   as it is.
5. **Dates and numbers** (T6) through `Intl` and the current language. English keeps its
   present wording ("Sunday 1st Nov").
6. **Language setting** (T2): a **Language** setting in the desktop's Settings, per computer,
   and a language switch in the phone remote's and admin app's menus, kept in the browser. Each
   offers **Automatic** (the system or browser language) and **English**; Chinese is added to
   the list in phase 2. The choice reaches the slideshow window and the subtitle overlay. The
   browser output pages follow the browser.
7. **`lang` attributes** set from the current language on every page and window.
8. **Website:** its text (`apps/website/src/content.ts`, `faq.ts`, `layout.ts`, `pages/*.md`
   and the guides it builds) is arranged by language, and the build can write a set of pages
   per language under its own path (T9). Only the English pages are built and linked; there is
   no language link or `hreflang` until phase 2, so no Chinese appears on the site
   before then.
9. **Keeping it so:**
   - a lint rule that refuses plain English text in components (JSX text and user-facing
     attributes such as `title`, `aria-label` and `placeholder`), with a short allow list for
     brand names;
   - the existing type check that every language has every key (T4).

**Done when:** the apps, pages and website look and read as they do today; the lint rule passes
across `apps/` and `packages/`; with the test language on, no unwrapped text is left in the
desktop app, slideshow, subtitle overlay, phone remote, admin app or output pages; the Language
setting and switches work and are remembered.

### Phase 2: Simplified and Traditional Chinese

1. **Glossary** (§5), agreed with the project owner before translating (T10).
2. **Simplified Chinese** (`zh-Hans`) for the whole catalogue, written by Claude (T5).
3. **Traditional Chinese** (`zh-Hant`), drafted from Simplified with `opencc-js` and corrected
   by hand (T5).
4. **Dates** in Chinese, for example `11月22日星期日` (T6), and the region matching for
   Automatic (T2: Taiwan, Hong Kong and Macau to Traditional; mainland China, Singapore and
   other Chinese to Simplified).
5. **Chinese added to the Language setting** and switches, each language named in itself
   (English, 简体中文, 繁體中文).
6. **Website and guides** in both scripts under `/zh-hans/` and `/zh-hant/` (T9), with
   `hreflang`, a language link on every page, their own Markdown copies, and the volunteer
   guide's Chinese examples moved into the Chinese guides.
7. **Screenshots** for the Chinese website from the same pipeline (`apps/screenshots`), with
   the app set to the language and Chinese hymns or Bible text that are in the public domain.
8. **Review** of both languages by the project owner, in the apps and on the site, before
   release.
9. **A check for later changes** (§6 question 1), so English edits after this reach the
   translations.

**Done when:** every key has Simplified and Traditional text that is not a copy of the English
(T4); the owner has reviewed both; Automatic picks the right script for the system language;
worship-q.com serves all three languages with `hreflang` linking them.

## 5. Glossary (proposed, for the owner's review)

The terms that appear everywhere, one translation each. Traditional follows usage common to
Taiwan and Hong Kong; where the two differ, Taiwan's word was chosen.

| English | 简体中文 | 繁體中文 | Note |
| --- | --- | --- | --- |
| Run sheet | 流程表 | 流程表 | The order of service |
| Slideshow (the screen) | 投影 | 投影 | Slideshow screen 投影屏幕 / 投影螢幕 |
| Slide | 幻灯片 | 投影片 | |
| Present (the page and the verb) | 投影控制 / 投影 | 投影控制 / 投影 | 页面名称 / 显示内容的按钮 |
| Live (a run sheet) / Go live | 进行中 / 启用 | 進行中 / 啟用 | “Go live with {date}”: 启用{date}的流程表 / 啟用{date}的流程表；不会立即切换投影内容 |
| Live (OBS, audio) | 直播中 | 直播中 | |
| Blank / Show lyrics | 隐藏文字 / 显示文字 | 隱藏文字 / 顯示文字 | Blank keeps the background, so not 黑屏; the phone remote's button says 隐藏内容 / 隱藏內容 |
| Clear screen | 清屏 | 清除畫面 | |
| Workspace | 工作区 | 工作區 | |
| Church server | 教会服务器 | 教會伺服器 | |
| Library | 资源库 | 資源庫 | Not 資料庫, which is “database” in Traditional |
| Church Library | 教会资源库 | 教會資源庫 | |
| Songs, Media, Web | 诗歌、媒体、网页 | 詩歌、媒體、網頁 | |
| Bible passage / version | 经文 / 译本 | 經文 / 譯本 | |
| Viewer mode / a viewer | 仅观看模式 / 观看端 | 僅觀看模式 / 觀看端 | |
| Holds the presentation (coordinator) / Follow | 主控（演示） / 副控 | 主控（演示） / 副控 | Take over presenting: 接管演示 |
| Subtitle overlay | 字幕 | 字幕 | |
| Output / Browser outputs | 远程画面 / 浏览器远程画面 | 遠端畫面 / 瀏覽器遠端畫面 | |
| On this network (connected directly) / this network | 在本地网络上 / 本地网络 | 在本地網路上 / 本地網路 | |
| New song, New website | 添加诗歌、添加网站 | 新增詩歌、新增網站 | |
| Meeting day | 聚会日 | 聚會日 | |
| Phone remote | 手机遥控 | 手機遙控 | |
| Operator | 操作员 | 操作員 | |
| Administrator / admin app | 管理员 / 管理后台 | 管理員 / 管理後台 | |
| Approve / pairing | 批准 / 配对 | 批准 / 配對 | |
| Connection code | 连接码 | 連線碼 | |
| Synchronize | 同步 | 同步 | |
| Live audio / broadcast / listen | 现场音频 / 广播 / 收听 | 現場音訊 / 廣播 / 收聽 | |
| OBS: Stream, Record, Camera, Program, Scene | 直播、录制、虚拟摄像机、节目画面、场景 | 直播、錄製、虛擬攝影機、節目畫面、場景 | “直播”对教会操作员更直观 |
| Undo / Restore | 撤销 / 恢复 | 復原 / 還原 | |

## 6. Open questions

None left. Answered (17 November 2026):

- **Keeping translations current:** for the apps, a test fails when an English message changed or was added since it was translated (§8); for the website, the Chinese pages sit beside the English ones and change with them.

- **Website addresses:** `/zh-hans/` and `/zh-hant/` (T9).
- **Traditional variant:** one Traditional Chinese for all regions (T5).
- **Who translates and reviews:** Claude translates; the project owner reviews (T5).
- **Which documents:** everything that goes on worship-q.com (T9).
- **Phases:** two (§4). Phase 1 takes all English out of the code and sets up the layer and the Language setting on every platform; phase 2 adds Simplified and Traditional Chinese.

## 7. Phase 1 as built

**Where the words are**

| Part | Where |
| --- | --- |
| Shared layer | `packages/i18n/src/index.ts`: the current language, `parsePreference`, `resolveLocale`, `applyPreference`, the browser apps' saved choice, `format`, `translator`, plural forms, dates (`formatDate`, `formatMonth`, `weekdayName`, `meetingDaysLabel`), `listFormat` and `formatNumber` |
| Catalogues | `packages/i18n/src/en/`: `common.ts` (shared), `desktop.ts`, `remote.ts`, `admin.ts`, `output.ts` |
| Each app's entry | `@worship-q/i18n/desktop` (and `/remote`, `/admin`, `/output`): `t(key, params)`, `tp(key, count)` for `key.one` and `key.other`, `messages`, and `formatNodes` and `useLocale` for React |
| Website | `apps/website/src/locales.ts` (the site's languages and paths), `words.ts` (header, footer, not-found page), `home.ts` (the home page, as HTML), `content.ts` `CONTENT` and `faq.ts` `FAQS`; Markdown pages per language through `PAGES_BY_LOCALE` in `pages.ts` |

**Adding or changing text**

- Add the English to the app's catalogue and use `t('area.key')`. A message with an element in it (a name in bold, a time) uses `formatNodes(t('key'), { name: <strong>…</strong> })`; a count uses `tp('key', n)` with `key.one` and `key.other`.
- The lint rule `worship-q/no-literal-ui-text` (`eslint/no-literal-ui-text.js`) refuses JSX text and plain strings in `title`, `aria-label`, `placeholder`, `alt`, `label` and the like in the apps' components. Names and symbols are on its allow list.
- `t()` runs when a component renders, so text in a module-level constant is a key, translated where it is shown.
- The test in `packages/i18n/src/index.test.ts` checks that every language has every key with the same placeholders.

**Choosing the language**

- Desktop: **Settings → Language** (Automatic or English), kept per computer with the other device settings; the slideshow window follows. Changing it draws the window again without losing the page.
- Phone remote: the globe in its header. Admin app: the Language select beside **Sign out**. Both are kept in the browser (`wq.language`).
- Output pages and the localhost slideshow and subtitle pages follow the browser.
- `?lang=zh-Hans` (or `en`, `zh-Hant`) in the address shows a page in that language, whatever the setting. A test language that wrapped every message in `⟦…⟧` was used while taking the English out of the code and removed after phase 2.

**Messages from the server and the native core (T7)**: upload refusals reach the desktop as `refused:<code>:<message>`; the server sends an image's `reason` (`image-too-large`, `image-unreadable`) beside its message, and the desktop shows its own words for the codes it knows and the message otherwise, so older servers still read. The slideshow window's title is set from the interface. Left in English on purpose: the OBS connection's technical details shown after the translated sentence, and the power-assertion reasons on macOS and Windows, which only diagnostic tools show.

**Notes for phase 2**

- The website's other home pages: `index.html` is the English one; the Chinese home pages are written from it with `HOME[locale]` (`HOME_LOCALE` in `vite.config.ts`), and the not-found page likewise.
- Words placed inside sentences, such as the Church Library type nouns in the admin app (`libraryType.noun.*`), are translated alone; check the sentences read well in Chinese.
- The desktop's window title adds the year after the run sheet's date in English order (`App.tsx`).
- The Bible's joined and missing verse notes name the book in English (`warningParams` in `packages/bible`).
- The release notes page stays English.

## 8. Phase 2 as built

Built 17 November 2026 on the branch `translation-phase-2`, for the project owner to read through
before release. Claude wrote the Simplified Chinese; Traditional was drafted from it and
corrected (T5).

**Where the words are**

| Part | Where |
| --- | --- |
| App catalogues | `packages/i18n/src/zh-hans/` and `zh-hant/`, one file per app beside `en/`, each typed to have every English key |
| Website frame, home page, features, questions, page titles | `apps/website/src/zh-hans.ts` and `zh-hant.ts` |
| Website pages | `apps/website/pages/zh-hans/`, `zh-hant/`; the guides in `docs/zh-hans/`, `docs/zh-hant/` |
| Screenshots' Chinese content | `apps/screenshots/src/content-zh.ts` |

**Choosing the language (T2):** Automatic picks Traditional for `zh-TW`, `zh-HK`, `zh-MO` and
any tag with `Hant`, and Simplified for every other Chinese. The Language lists name each
language in itself: English, 简体中文, 繁體中文. `?lang=zh-Hans` in an address forces one, in any
letter case.

**Dates (T6):** a run sheet is `11月22日星期日`, and with its year (window title, “last used”)
`2026年11月22日星期日`; English keeps “Sunday 22nd Nov 2026” (`formatDateWithYear`). The Bible's
joined and missing verse notes name the book in the interface language.

**Traditional from Simplified:** `pnpm --filter @worship-q/i18n draft-hant` drafts the Traditional
catalogues with OpenCC (`cn` to `twp`) and the corrections in `packages/i18n/scripts/hant.ts`
(`FIXES`: 幻燈片 to 投影片, 專案 to 項目, quotation marks to 「」 and the like). It
drafts only new keys unless told `--keys a,b` or `--all`, so corrections made by hand in
`src/zh-hant/` stay. `--file in out` drafts any file, as was done for the website.

**Keeping translations current (§6):** `packages/i18n/src/translated.json` records each English
message as it was when translated. The i18n test fails for any English message changed or added
since, listing them. Translate them (Simplified, then `draft-hant --keys`), then run
`pnpm --filter @worship-q/i18n translated`. The test also fails when a Chinese message is the
English left in place, beyond names such as OBS and placeholders. For the website, a change to an
English page needs the same change in its two Chinese copies.

**Website (T9):** every page except the release notes is under `/zh-hans/` and `/zh-hant/`, with
`hreflang` links between the three and `x-default` to English, links to the other languages in
every header, and its own `index.md`. The release notes, `llms.txt` and `llms-full.txt` stay
English; the Chinese pages link to the English release notes, marked （英文）. The not-found page
stays English: GitHub Pages serves only the root `404.html`. The English guide had no Chinese
examples left to move; the Chinese guides use Chinese references (`马可福音15:5-6`).

**Screenshots:** `SCREENSHOT_LANG=zh-Hans pnpm screenshots apps/website/public/screenshots/zh-hans`
(and `zh-Hant`) renders the app in Chinese with the Lord's Prayer, Psalm 100 (Chinese and KJV line
by line) and Psalm 121 as songs, and Psalm 23 beside the KJV, all from the 1919 Chinese Union
Version, which is in the public domain; the English hymns stay in the library. The scenes find
buttons by the catalogue's words. The website workflow renders all three, with Noto CJK
installed on Linux.

**For the review**

- The glossary (§5), especially 投影控制 for Present, 资源库 for Library and 流程表 for run sheet.
- Sentences built from parts, such as the admin app's `{noun}` messages (`library.*`,
  `workspace.manage*`) and `workspace.codeState` (“连接码目前已{state}”).
- Traditional vocabulary: one Traditional for all regions, leaning to Taiwan's words (伺服器,
  影片, 檔案, 預設). Hong Kong readers may prefer 服務器 or 視頻 in places.
- The screenshots' Psalm 23 is labelled 和合本 with the catalogue's CUNP versions, though its
  text is the 1919 wording; the passage is the same in both.
- The settings' font sample is Psalm 23:1 in Chinese (耶和华是我的牧者 / 我必不至缺乏), in place
  of Amazing Grace, whose Chinese words may be under copyright.
- The volunteer guide in English names a few buttons the app no longer has (**Edit lyrics**,
  **Use this computer**, **Click for sound**, **End**); the Chinese guides use the app's current
  words instead.
