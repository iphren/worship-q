# Worship Q — Translation Plan

**Drafted:** 17 November 2026; owner's answers added the same day  
**Status:** A future plan, not scheduled. Requirements and proposals only; nothing here is built.  
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

## 2. Where we are

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
| T6 | **Dates and numbers** per language: "Sunday 1st Nov" becomes, for example, `11月22日 星期日`, through `Intl` rather than English ordinals. |
| T7 | **Messages from the server and the native core** are codes, translated by the app that shows them, not English sentences. Existing English messages keep working for older servers. |
| T8 | **Interface language is not content language.** Lyrics, Bible versions and song search are unaffected by the interface language; a Chinese interface can present English songs and the other way round. |
| T9 | **Website:** every page and document on worship-q.com in both scripts (the home page, features, FAQ, screenshots' descriptions, and every guide or page the site carries: today the volunteer guide and server setup guide, plus the pages of [SEO plan](seo-plan.md) phase 3). Chinese pages live under `/zh-hans/` and `/zh-hant/`, mirroring the English paths, with `hreflang` linking all three languages and a language link on every page. `llms.txt` and `index.md` stay English; the Chinese pages get their own Markdown copies. Documents that stay on GitHub only (README, plans, release notes) stay English. |
| T10 | **Glossary first:** the key terms are agreed before translating (§5), and kept in this plan or beside the catalogue. |

## 4. Order (proposed)

1. **Glossary** (§5), agreed with the project owner.
2. **The layer:** the shared catalogue package, language choice (T2), dates (T6), and `lang` attributes on every page.
3. **Desktop app** in Simplified Chinese, the largest part.
4. **Phone remote, admin app, output pages:** move their text into the catalogue, then translate.
5. **Server and native messages** to codes (T7).
6. **Traditional Chinese** for everything above (T5), with review.
7. **Website and guides** in both scripts (T9), with the guide's Chinese examples moving into the Chinese guides.

Screenshots for the Chinese website can come from the same pipeline (`apps/screenshots`), with the app set to the language and Chinese hymns or Bible text that are in the public domain.

## 5. Glossary to agree

Terms that appear everywhere and need one translation each, in both scripts, for example:

| English | To decide |
| --- | --- |
| Run sheet | |
| Slideshow / Present / Go live | |
| Workspace | |
| Church server / Church Library | |
| Library, Media, Web | |
| Viewer mode | |
| Blank / Clear screen | |
| Subtitle overlay | |
| Meeting day | |

## 6. Open questions

1. **Keeping translations current:** how later changes to English messages and pages reach the translations, for example a release check that lists messages changed since they were translated, for Claude to translate and the project owner to review.

Answered (17 November 2026):

- **Website addresses:** `/zh-hans/` and `/zh-hant/` (T9).
- **Traditional variant:** one Traditional Chinese for all regions (T5).
- **Who translates and reviews:** Claude translates; the project owner reviews (T5).
- **Which documents:** everything that goes on worship-q.com (T9).
