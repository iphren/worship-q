# Worship Q — Translation Plan

**Drafted:** 17 November 2026; owner's answers and the two phases added the same day  
**Status:** Planned in two phases (§4): phase 1 sets up translation in English everywhere, phase 2 adds Simplified and Traditional Chinese. Nothing is built yet.  
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
   - a development-only test language that wraps every message (for example `⟦Settings⟧`), so a
     look through each app shows any text that missed the catalogue; it never appears in the
     Language setting of a release;
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
4. **Dates** in Chinese, for example `11月22日 星期日` (T6), and the region matching for
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
- **Phases:** two (§4). Phase 1 takes all English out of the code and sets up the layer and the Language setting on every platform; phase 2 adds Simplified and Traditional Chinese.
