# Search and AI discovery plan

Goal: someone who asks Google, Bing, ChatGPT, Claude, Perplexity or Copilot for church lyrics,
Bible or slides presentation software finds Worship Q, and the answer describes it correctly.

## Where we are (17 November 2026)

| Check                                     | State                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| worship-q.com                             | One page on GitHub Pages, about 250 words, built by `apps/website`            |
| `robots.txt`, `sitemap.xml`               | Both 404                                                                      |
| Search Console / Bing Webmaster Tools     | Not set up, so nothing has asked either engine to crawl the site              |
| Canonical, Open Graph, Twitter card       | None; a shared link has no image or summary                                   |
| Structured data (JSON-LD)                 | None                                                                          |
| Features named on the page                | Songs, run sheets, slideshow, OBS subtitles, offline. **Not** Bible passages, phone control, slides/PDF/video, OBS control, live audio, several computers |
| Chinese content                           | None on the site, although bilingual Chinese–English lyrics are a key feature |
| Docs                                      | Only on GitHub (`docs/*.md`), linked from the footer, none on the domain      |
| GitHub repo                               | Description and homepage set; no topics; 0 stars; created October 2026        |
| Links from other sites                    | None we know of                                                               |

**Why nobody can find it.** The domain is a month old, nothing links to it, and it was never
submitted to a search engine, so Google may not have crawled it at all. And when it is crawled,
there is one short page with little for a search to match. Fixing discovery is the first step;
content and links decide where it ranks after that.

**AI agents mostly read the same index.** ChatGPT search and Copilot use Bing, Gemini and AI
Overviews use Google, Claude and Perplexity use their own crawlers plus web search. On top of
that, models suggest software they have seen named in many places (lists, forums, comparisons,
package managers). So the plan is: get indexed by both engines, make the site say plainly and
quotably what Worship Q is, and get it mentioned in places AI answers cite.

**What we can realistically aim for.** "Church presentation software" alone is crowded
(ProPresenter, EasyWorship, OpenLP, FreeShow, Proclaim and others). We can win the more
specific searches that match what is different about Worship Q:

- free / open-source church presentation software for Mac
- bilingual worship lyrics (Chinese and English on one slide); 中文 敬拜 歌词 投影 软件
- Bible verses on the projector in two versions side by side
- lyrics subtitles for OBS live stream; control OBS from the presentation software
- control worship slides from a phone; several computers sharing one presentation
- ProPresenter / EasyWorship alternatives that are free

## Phase 1 — Get indexed (a day, mostly by hand)

**Status (17 November 2026):** done. Search Console is verified by DNS; Bing Webmaster Tools
is set up.

1. **Google Search Console**: add `worship-q.com` as a domain property, verify with a DNS TXT
   record, submit the sitemap, request indexing of the home page. _(Your account; manual.)_
2. **Bing Webmaster Tools**: import from Search Console, submit the sitemap. This is what
   ChatGPT search, Copilot and DuckDuckGo draw on, so it matters as much as Google here.
   _(Manual.)_
3. **`apps/website/public/robots.txt`**: allow everything, name the sitemap, and explicitly
   allow the AI crawlers (`GPTBot`, `OAI-SearchBot`, `ChatGPT-User`, `ClaudeBot`,
   `Claude-SearchBot`, `Claude-User`, `PerplexityBot`, `Google-Extended`, `Applebot-Extended`)
   so the intent is unambiguous.
4. **`sitemap.xml`**: generated at build time from the list of pages, with `lastmod` from the
   release date for the home page. Starts with one URL; grows in phase 3.
5. **IndexNow**: ping Bing/Yandex from `website.yml` after each deploy, so a new release is
   re-crawled within hours. Needs a key file in `public/`.
6. **GitHub repo**: add topics (`church`, `worship`, `lyrics`, `presentation`,
   `presentation-software`, `bible`, `projector`, `obs`, `tauri`, `church-software`,
   `worship-software`) and a longer description, e.g. "Free, open-source church lyrics, Bible
   and slides presentation software for macOS and Windows." GitHub repo pages rank well and
   are read by AI crawlers, so this is the cheapest win.

## Phase 2 — Make the home page say what it is (code, `apps/website`)

**Status (17 November 2026):** done. Screenshots are rendered from the app's code at every
site build by `apps/screenshots` (public-domain hymns and Bible text), so they follow the UI
without anyone taking them by hand. The share image (`apps/website/og-image.svg` →
`public/og.png`) is still a designed card. FAQ answers live in `apps/website/src/faq.ts`.

1. **Title and description** with the words people search:
   - Title: `Worship Q — free church presentation software for lyrics, Bible and slides`
   - Description: "Free, open-source worship presentation software for Mac and Windows.
     Bilingual lyrics, Bible passages in two versions, slides, PDFs and videos, OBS
     subtitles and phone control. No account needed."
2. **Canonical** `<link rel="canonical" href="https://worship-q.com/">`.
3. **Open Graph and Twitter card**: title, description, and a 1200×630 image (a screenshot of
   the Present page with a bilingual slide). Shows up when the link is shared in WhatsApp,
   WeChat, Slack, Facebook groups, which is how church volunteers pass software around.
4. **JSON-LD `SoftwareApplication`**, filled by the existing `releaseInfo()` plugin so it
   stays current with each release: `name`, `description`, `applicationCategory:
   "MultimediaApplication"`, `operatingSystem: "macOS 11+, Windows 10+"`, `offers` (price 0),
   `softwareVersion`, `datePublished`, `downloadUrl`, `license` (MIT), `screenshot`,
   `featureList`, `codeRepository`. Plus a `WebSite` and an `Organization` block with
   `sameAs` pointing to the GitHub repo.
5. **Name every feature**, each with a short heading and two sentences: songs in any language,
   bilingual slides, Bible passages (typed references in English and Chinese, two versions
   side by side), slides/PDFs/photos/videos, run sheets on a calendar, OBS subtitles and OBS
   control, phone remote, several computers with failover, live audio, works offline, free
   and open source. The volunteer guide is the source; keep the wording factual.
6. **Screenshots** with descriptive `alt` text (Present page, Bible window, phone remote,
   slideshow). They help image search and make the page convincing.
7. **One plain, quotable opening sentence** that AI answers can lift as-is: "Worship Q is a
   free, open-source church presentation app for macOS and Windows that shows song lyrics,
   Bible passages, slides and videos on the projector and the live stream." Use the same
   sentence at the top of `README.md`.
8. **FAQ section** (with `FAQPage` JSON-LD): Is it free? Does it need internet or an account?
   Mac and Windows? Chinese and other languages? Which Bible versions? Does it work with OBS?
   Can I control it from a phone? Can I import from ProPresenter / EasyWorship / OpenLP? (Answer
   honestly; if not yet, say so.) Questions phrased like this are what people type into
   chatbots, and FAQ answers are what the chatbots quote.
9. **Housekeeping**: a `404.html`, `lang` attributes, real `<h1>` text that names the product
   category (keep "Every screen. In harmony." as the tagline below it).

## Phase 3 — Put more pages on the domain (code)

One page is not enough to rank for many searches. Turn `apps/website` into a small multi-page
static site (Vite multi-page input; no framework needed).

**Status (17 November 2026):** items 1, 2, 3 and 5 done, in English: `/guide/`, `/server/`,
`/bible/`, `/bilingual-lyrics/`, `/obs/`, `/phone-remote/`, `/several-computers/`,
`/compare/` and `/releases/`, each with its Markdown copy (`index.md`) and in the sitemap and
`llms.txt`. The pages are Markdown: the guides from `docs/`, the others in
`apps/website/pages/`, the release notes from GitHub; `apps/website/src/pages.ts` lists them.
The comparison's facts were checked on 17 November 2026; check them again now and then.

**Scope (17 November 2026):** items 1, 2, 3 and 5, in English. Chinese pages (item 4) are part
of the [Translation plan](translation-plan.md), so the website is translated together with the
desktop app, the admin app and the phone remote.

1. **Docs on the domain.** Render `docs/volunteer-guide.md` and `docs/server-deployment.md` to
   `/guide/` and `/server/` at build time with a Markdown library, so the GitHub files stay
   the one source. Footer links move to these pages; each page links back to the GitHub source.
   The site's English pages show no Chinese, so the guide's Chinese examples (such as
   `马可福音15章5-6节` and `当代译本`) come out of the English guide then, and out of
   `llms-full.txt` with it; they belong in the Chinese guide (Translation plan).
   Decided 17 November 2026: these two documents only. The server guide lost its legacy import
   section and its notes on updating from earlier phases, so it goes on the site whole; it
   links to `docs/local-api.md`, which stays on GitHub. Plans, the spec, task breakdowns,
   acceptance records and spikes stay on GitHub.
2. **Feature pages**, each aimed at one of the searches listed above: `/bible/`,
   `/bilingual-lyrics/`, `/obs/`, `/phone-remote/`, `/several-computers/`. Short, with a
   screenshot, and linking to the guide section.
3. **Comparison pages**: `/compare/` with honest tables against ProPresenter, EasyWorship,
   OpenLP, FreeShow and Proclaim (price, platforms, open source, offline, bilingual, Bible,
   OBS, phone control). "X alternative" searches are common, and AI agents answering "what
   is a free alternative to ProPresenter" lean on comparison pages. Keep every claim about
   other products checkable and dated.
4. **Chinese pages:** moved to the [Translation plan](translation-plan.md), in Simplified and
   Traditional Chinese, with `hreflang` both ways. Chinese-speaking churches abroad are a
   natural audience, and the Chinese search space for this is much less crowded. (Baidu does
   not matter for this audience; Google and Bing in Chinese do.)
5. **Release notes page** `/releases/` generated from GitHub releases at build time: fresh,
   dated content on the domain after every release.

## Phase 4 — Make it easy for AI agents (code)

**Status (17 November 2026):** done. `llms.txt`, `llms-full.txt` (with the volunteer guide) and
`index.md` are generated at each build from `apps/website/src/content.ts`, `faq.ts` and
`docs/volunteer-guide.md`, the same sources as the page; the page's `<head>` names `index.md`
as its Markdown version. Item 3 is done for the home page; other pages get theirs in phase 3.

1. **`/llms.txt`**: a short Markdown summary (what it is, who it is for, platforms, price,
   features, links to the guide, FAQ, download and repo), following the llms.txt convention.
   **`/llms-full.txt`**: the same plus the volunteer guide and FAQ in full, generated at build
   time. Cheap to add; some agents and coding tools read them, and none are harmed.
2. **Keep the content in the HTML.** The site is static and the text is in `index.html`, not
   rendered by JavaScript; keep it that way for every new page, since most AI crawlers do not
   run JavaScript.
3. **Markdown twins**: serve each page also as `.md` (e.g. `/guide.md`), linked from
   `llms.txt`, for agents that fetch pages to answer a question.
4. **Consistent facts everywhere**: the same one-sentence description, feature list and
   platform requirements on the site, README, GitHub description, release notes and every
   listing in phase 5. Models trust facts they see repeated consistently.

## Phase 5 — Get mentioned elsewhere (manual, ongoing)

Links bring crawlers and ranking; mentions in lists and forums are what AI answers draw on.

| Where                                                    | What                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| AlternativeTo                                            | List it; mark it as an alternative to ProPresenter, EasyWorship, OpenLP, FreeShow |
| winget (`microsoft/winget-pkgs`)                         | Manifest for the Windows installer; no popularity bar          |
| Homebrew cask                                            | Once the repo meets homebrew-cask's notability bar (stars/forks); until then a tap |
| GitHub "awesome" lists                                   | PRs to church / worship / open-source-alternatives lists       |
| Reddit r/churchtech, r/ChurchMedia                       | A genuine "I built this, feedback welcome" post, then answer questions where it fits |
| Hacker News (Show HN), Product Hunt                      | One launch each, ideally after phase 2 so the page converts    |
| Church tech forums and Facebook groups                   | Answer "what software do you use" threads, not spam            |
| Chinese-speaking church networks                         | WeChat articles or groups, Zhihu answers                       |
| YouTube                                                  | A 2–3 minute demo; video results show for "how to" searches and the description links back |
| Wikidata                                                 | An item for the software (open source, licence, platforms, website, repo) |

Ask the first church to link to worship-q.com from its own site if it has one (without naming
it in this repo).

## Phase 6 — Measure

- **Search Console and Bing Webmaster**: indexed pages, queries, clicks. Check weekly for the
  first month, then monthly.
- **GitHub release download counts** (`gh api repos/iphren/worship-q/releases`) as the
  real outcome measure.
- **Analytics:** Cloudflare Web Analytics, which sets no cookies, so there is no consent
  banner. worship-q.com is not proxied through Cloudflare, so it uses Cloudflare's JS beacon
  (`static.cloudflareinsights.com/beacon.min.js` with the site's token) on every page. GitHub
  Pages has no server logs, so this is the only view of visits and referrers. It does not see
  crawlers, which run no JavaScript.
- **AI answer check, monthly**: ask ChatGPT, Claude, Perplexity, Gemini and Copilot the same
  five prompts (e.g. "free church lyrics software for Mac", "software to show Chinese and
  English worship lyrics", "how to show Bible verses on the projector and in OBS") and note
  whether Worship Q appears and whether the facts are right. Keep the results in this file.

Expect Google to index the site within days of phase 1, ranking for the specific searches over
weeks to a few months as pages and links grow, and AI answers to lag behind both.

## Order and size

| Step                         | Effort         | Who            |
| ---------------------------- | -------------- | -------------- |
| Phase 1                      | Under a day    | You (accounts), me (files, workflow) |
| Phase 2                      | 1–2 days       | Me, plus screenshots from you or the app |
| Phase 4                      | Half a day     | Me             |
| Phase 3                      | 3–5 days       | Me (English pages; Chinese in the translation plan) |
| Phase 5                      | Ongoing        | You            |
| Phase 6                      | Ongoing        | You, with me updating this file |

Phase 4 comes before phase 3 because it is small and only depends on phase 2's wording.

## Open questions

None open. Answered:

- **Chinese pages:** Simplified and Traditional, as a separate piece of work with the apps'
  translation ([Translation plan](translation-plan.md)).
- **Naming other products:** yes, on comparison pages and in `llms.txt`, with factual, dated
  claims.
- **Importing from other software:** none yet; the FAQ invites churches that need one to get in
  touch.
- **Analytics:** Cloudflare Web Analytics, with its JS beacon (phase 6).
