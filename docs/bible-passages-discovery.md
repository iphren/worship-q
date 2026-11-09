# Bible Passages — Discovery

**Date:** 9 November 2026
**Status:** Discovery only, on feasibility: copyright, access to Bible versions, the right to use
them, and open platforms. It is not a technical design and not legal advice. Publisher terms
were read from their public pages on the date above; they change, and several points below
are marked as unconfirmed. Get written confirmation from a publisher before relying on it.
**Source:** [Requirements and Architecture](worship-q-requirements-and-architecture.md), §17
scope table: *Bible passages — Later.*

## 1. The use case

The speaker mentions verses that are not in the run sheet. The operator types a reference
(for example `John 3:16-18` or `約 3:16`), picks a version, and puts the passage on the
slideshow and subtitle outputs straight away, without a browser, another Bible app,
copy-paste, or a temporary song item.

What that implies for rights and access:

- **Any passage, any time.** The app needs the whole Bible of each version reachable during
  the service, not a few prepared verses.
- **Offline matters.** A venue coordinator keeps working when the church instance or the
  internet is down. A version that only comes from an online API fails exactly then.
- **On screen and on the stream.** The text appears on projection, on the subtitle overlay and
  therefore on the livestream (OBS), not just in a bulletin.
- **More than one language.** Churches arrange English and Chinese side by side today; the
  same will be expected for Bible text.
- **Who Worship Q is.** MIT-licensed, free, no ads, no paid tier. Each church runs its own
  instance; a single desktop can present with no instance at all. The project publishes
  source code and downloads on worship-q.com.

## 2. Two separate permissions

Showing a verse involves two different rights, and they are often confused.

| Question | Who answers it | Summary |
| --- | --- | --- |
| May **the church** put this verse on screen in a service? | The translation's publisher, under its general permissions | Usually yes, free, with a short credit such as "(NIV)" |
| May **the software** store, ship or fetch the whole text of this version? | The publisher, under a licence to the software or an API's terms | Only for public-domain/open versions, or through a licensed API or a direct agreement |

The first is mostly settled for church use. The second is the real feasibility question for
Worship Q.

**CCLI does not help.** The CCLI Church Copyright Licence covers song and hymn lyrics, not
Scripture. Every translation sets its own terms.

## 3. Church use of the common versions

| Version | Church on-screen use | Credit | Notes |
| --- | --- | --- | --- |
| **NIV (Anglicised, UK)** — Hodder & Stoughton | Free in church, explicitly "including video, PowerPoint and other onscreen use" | "(NIV)" after each quotation | Up to 500 verses in any form without permission; not a whole book, not ≥ 25 % of the work. For new software or apps Hodder asks you to get in touch |
| **NIV (US)** — Biblica | Free for non-saleable church use (bulletins, orders of service, transparencies) | Initials | 500-verse rule is worded for "written format"; on-screen use not named explicitly |
| **ESV** — Crossway | Church bulletins, posters, transparencies etc. need only "(ESV)" | "ESV" | Projection not named explicitly |
| **KJV** | In England and Wales, liturgical use up to 500 verses needs no permission | None stated | Public domain everywhere **except the UK**, where Crown rights run through letters patent held by Cambridge University Press |
| **BSB** (Berean Standard Bible) | Any use | Not required | Dedicated to the public domain on 30 April 2023 |
| **WEB** (World English Bible) | Any use | Not required | Public domain (eBible.org) |
| **CUV 1919** 和合本 | Any use | Not required | Public domain (copyright expired) |
| **CUNP 1988** 新標點和合本 | Unconfirmed | Unconfirmed | Bible.com names the Hong Kong Bible Society as copyright agent; eBible.org lists it as public domain. **Conflicting — needs checking** |
| **RCUV** 和合本修訂版 | Unconfirmed | — | Hong Kong Bible Society copyright; terms not found |
| **CNV** 新譯本 | Unconfirmed | — | Worldwide Bible Society copyright; terms not found |

So for the church itself, showing a few verses during a service is permitted by the major
English publishers with a short credit. Chinese versions other than the 1919 CUV need to be
asked about.

## 4. Ways the software can get the text

### A. Bundle public-domain and open versions

Ship (or download once on demand) full texts whose licence allows redistribution: BSB, WEB,
KJV, CUV 1919, and other public-domain or Creative Commons texts from eBible.org or the Free
Use Bible API (AO Lab, 1,250+ translations, no key, MIT-licensed code, each text keeping its
own licence; caching and storing allowed).

- **Pros:** Fully offline, no keys, no rate limits, no per-church setup, fits the MIT licence.
- **Cons:** Excludes the versions most churches actually read from: NIV, ESV, NLT, NKJV, and
  the punctuated Chinese Union Version (CUNP) that Chinese churches normally use.
- **Watch:** KJV in the UK (Crown patent). For an app distributed in the UK the cautious step
  is to ask Cambridge University Press, or ship it as a separate optional download.

### B. Online APIs, with a key the church registers

| Platform | Cost | Versions | Key conditions that matter to Worship Q |
| --- | --- | --- | --- |
| **API.Bible** (American Bible Society) | Free Starter plan, strictly non-commercial; Pro from $29/month | Hundreds; open-access versions on every plan, a small number of copyrighted ones on Starter (added one by one) | Copyright attribution with every display; cache refreshed at least every 30 days; **FUMS** usage tracking required in web apps wherever Scripture is shown; no sub-licensing. NIV not available for commercial use through it |
| **ESV API** (Crossway) | Free, non-commercial | ESV only | Key must not be shared or published; ≤ 500 verses (or half a book) per query and per page; **local cache ≤ 500 verses**; "ESV" on each quotation, copyright page, and a link to esv.org on each page; 5,000 queries/day |
| **YouVersion Platform** (Life.Church) | Free for approved developers | 1,000+ versions reported, NIV reported among them | App key per application; accept each version's licence before it appears; attribution whenever text is shown. Official terms, caching rules and rate limits **not confirmed** in this discovery |
| **Free Use Bible API** (AO Lab) | Free, no key | 1,250+ | No platform restrictions of its own; excludes NIV, NASB, CSB. Effectively a source for option A |

- **Pros:** Reaches copyrighted versions the project could never bundle; free while
  non-commercial.
- **Cons:** Needs the internet at the moment of lookup. Caching limits (ESV's 500 verses,
  API.Bible's 30-day refresh) mean a version cannot be fully stored at the venue, so an
  unplanned verse fails when the venue is offline.
- **Keys cannot live in the repository.** Worship Q is open source, ESV forbids publishing the
  key, and a single project key would be shared by every church in the world (one rate limit,
  one point of revocation). The natural fit is that **each church registers its own key** and
  enters it in its instance (or on a standalone desktop). Each church then holds its own
  agreement with the API provider, which also keeps the project out of the licensing chain.
- **Rendering obligations carry into the app:** per-slide version credit, a copyright/about
  page, no changes to the wording (omitting verse numbers or headings is allowed; partial
  omissions marked with an ellipsis), and limits on how much is shown or stored. FUMS was
  written for websites; how it applies to a desktop slideshow and an OBS overlay needs asking.

### C. The church imports its own files

The OpenLP model: the church imports OSIS, USFM or Zefania files it is entitled to use, and
the app stores them locally. OpenLP's own forum notes that most popular Bibles cannot be
distributed with it for copyright reasons.

- **Pros:** Little project effort; any version, fully offline, once the church has a file.
- **Cons:** Legal responsibility moves to the church, and lawful files of NIV, ESV or CUNP are
  hard to obtain. Fine as a supplement, weak as the main route.
- **Avoid scraping.** OpenLP's Bible Gateway downloader broke in 2019 once on-demand fetching
  was enforced; building on scraping a website is neither lawful nor stable.

### D. A direct licence from publishers

What commercial tools do: ProPresenter sells Bible licences **per computer**, and some
versions (NIV among them) cost extra because the publisher takes a royalty.

- **Pros:** The only route to NIV/ESV/CUNP fully offline.
- **Cons:** Needs an organisation to contract and usually money per seat; awkward for a free,
  MIT-licensed, self-hosted project with no store. Hodder's invitation to "get in touch" about
  new apps, and the Hong Kong Bible Society for Chinese texts, are still worth one email each:
  a free church tool with per-slide credits may be granted something.

## 5. Is Worship Q "non-commercial"?

All the free API tiers depend on it. Today it looks non-commercial: free software, no ads,
no paid plan. Watch these:

- **Donations.** Crossway counts a site that solicits donations as commercial. The project
  owner confirmed on 9 November 2026 that worship-q.com will have no donation button.
- **Managed hosting.** If anyone later sells hosting of Worship Q instances, the paid service
  is commercial even though the code is free.
- **Who is the API user.** With per-church keys, the church is the user of the API, and the
  church's use (showing verses in its own service) is plainly non-commercial. This is another
  reason to prefer per-church keys over a project key.

## 6. Feasibility verdict

**Feasible, in layers.** Nothing blocks the feature legally, but no single source gives every
church its usual version offline for free.

| Layer | What churches get | Offline | Effort / risk |
| --- | --- | --- | --- |
| 1. Bundled open versions | BSB, WEB, CUV 1919 (KJV with UK caveat), any eBible.org text | Yes | Low |
| 2. Church-supplied API keys | API.Bible versions, ESV, possibly YouVersion | Only what fits the cache rules | Medium; per-API terms to honour |
| 3. Import | Whatever the church holds lawfully | Yes | Low for the project, risk sits with the church |
| 4. Publisher agreements | NIV, CUNP, RCUV, CNV offline | Yes | Unknown; depends on replies |

**Suggestion:** start with layers 1 and 3 (works offline, no external dependency), add layer 2
starting with API.Bible (many versions, one integration) and the ESV API, and send the
publisher enquiries in §8 in parallel. Show the version credit on every Bible slide from the
start, since every source asks for it and it costs nothing.

**Superseded:** the project owner chose a narrower layer 1 plus layer 2, with provider
fallback; see §9.

**Offline consequence for layer 2:** prefetching passages already on the run sheet is within
the cache rules; the "speaker mentions an unplanned verse" case needs the venue online for an
API-only version. The operator should see which versions are available offline.

## 7. Requirements this places on a later design

Not a design; constraints any design must meet:

1. A version credit (abbreviation) on every Bible slide and subtitle piece, on all outputs.
2. A copyright/about listing per version in settings, with the full notice text.
3. Wording shown exactly as supplied; only verse numbers, headings and footnotes may be
   omitted.
4. Per-version limits enforced: verses per query/page, cache size, cache refresh age.
5. API keys stored per church instance or per standalone desktop, never in the repository or
   shared across churches; a key is a secret and should be handled like one.
6. Each version marked as bundled, imported or online so the operator knows what works
   offline.
7. Usage reporting (FUMS) where an API requires it, if confirmed to apply.

## 8. Actions and open questions

- [ ] **Hodder & Stoughton (NIV UK):** permission for an open-source presentation app to hold
      the NIV text, or confirmation that per-church API access is the right route.
- [ ] **Hong Kong Bible Society:** status of CUNP 新標點和合本 and RCUV 和合本修訂版 for church
      projection and for software; is CUNP available through API.Bible or YouVersion?
- [ ] **Worldwide Bible Society:** terms for CNV 新譯本 projection and software use.
- [ ] **API.Bible:** does FUMS apply to a desktop slideshow and an OBS overlay; is a Starter key
      per church acceptable for an open-source app; which copyrighted versions Starter allows.
- [ ] **Crossway:** the "link to esv.org on each page" rule on a projected slide (a link cannot
      be followed); confirm "(ESV)" alone is enough on screen as it is for bulletins.
- [ ] **Crossway, API.Bible:** confirm that a passage the church puts into its own run sheet is
      the church's quotation under church-use permission, and only the app's lookup cache
      follows the API cache rules (§9, point 5).
- [ ] **YouVersion Platform:** read the official terms (caching, offline, rate limits, NIV) at
      platform.youversion.com.
- [ ] **Cambridge University Press:** KJV in an app distributed in the UK.
- [x] **Project:** no donation button on worship-q.com (confirmed 9 November 2026).
- [ ] **Project:** decide whether anyone will ever offer paid hosting of instances, given §5.

## 9. Agreed direction

Decided by the project owner on 9 November 2026, after this discovery: **layers 1 and 2**.
Layers 3 (import) and 4 (publisher agreements) are not pursued now; the enquiries in §8 still
apply, since they decide what layer 2 may show and how.

### Versions and providers

- **Online first.** Versions come from APIs. Open versions come from a no-key provider such as
  the Free Use Bible API; copyrighted versions come from providers that need a church key
  (API.Bible, ESV API, possibly YouVersion).
- **Bundle only as a last resort.** The desktop ships a version only when it is needed and no
  API offers it, to keep the app small. Most open versions (BSB, WEB, KJV, CUV 1919) are
  expected to be on at least one API, so the bundled set may well be empty; to be checked per
  version. For scale, a full plain-text Bible is a few megabytes before compression (estimate).
- **Provider fallback.** A version available from several providers lists them in order; when
  one fails (offline, rate limit, revoked key), the next is tried.

### Church instance filters the list

- The church instance chooses which versions its devices offer, a subset of everything
  available. The filter also hides bundled versions, even though their text is on the desktop.
- Its admin also holds the church's API keys (§7, item 5).

### Points the design must settle

1. **Same name, different text.** Providers may label different editions with one
   abbreviation: NIV (US) vs NIV Anglicised, CUNP traditional vs simplified, KJV with or
   without the 1769 spellings. Fallback must only map providers that serve the same edition,
   or the text changes silently between services.
2. **Credit follows the provider.** Attribution text and rules come from the provider that
   actually supplied the passage, so a fallback can change the copyright notice.
3. **One passage, one provider.** A passage on screen should not mix verses from two
   providers.
4. **Cache rules are per provider.** ESV ≤ 500 verses, API.Bible refresh ≤ 30 days; a passage
   cached from one provider cannot be served under another's rules.
5. **Lookup cache vs the church's own slides.** Two kinds of stored text, under two different
   permissions:
   - **Lookup cache** — passages the app fetches while the operator searches, browses or
     prefetches. This is API content held by the app and follows the provider's cache rules
     (size, refresh age).
   - **Run sheet content** — a passage the operator deliberately puts into a run sheet. This is
     the church quoting Scripture in its own material, as it does today by copying from a Bible
     site into a sermon slide, and falls under the publisher's church-use permission (for
     example, up to 500 NIV verses in any form, credited). It is kept like any other item,
     including in past run sheets, with its version credit, edition and source stored with it.
     Ask the providers to confirm this split (§8).
6. **Venue offline.** Accepted consequence: with no internet, only bundled versions, passages
   already in the run sheet, and the lookup cache work for anything new. The operator should
   see that state.
7. **Filter scope.** Whether the filter is per instance or per workspace, and what a standalone
   desktop with no instance offers (all versions it has keys for, plus bundled ones?).
8. **Where calls go.** Desktops call providers directly with keys from the instance, or the
   instance fetches on their behalf. This affects key exposure, rate limits shared across the
   church's devices, and whether a phone remote can look up a passage.

## Sources

- [API.Bible — Licensing policies quick reference](https://care.api.bible/article/396-licensing-policies-quick-reference)
- [API.Bible — Comparing plans](https://care.api.bible/article/378-comparing-api-bible-plans)
- [API.Bible — Commercial licensing for the NIV](https://care.api.bible/article/394-commercial-licensing-for-the-niv)
- [API.Bible — Licensing and access](https://docs.api.bible/quick-start/licensing-and-access)
- [ESV API — Introduction and conditions](https://www.esv.org/api/)
- [Crossway — ESV permissions](https://www.crossway.org/permissions/)
- [YouVersion Platform — API usage](https://developers.youversion.com/api-usage)
- [YouVersion platform-sdk-react](https://github.com/youversion/platform-sdk-react)
- [Free Use Bible API (AO Lab)](https://bible.helloao.org/docs/)
- [Hodder & Stoughton — NIV permissions](https://johnmurraypress.co.uk/landing-page/hodder-faith-more)
- [Biblica — Permissions](https://www.biblica.com/permissions/)
- [Biblica — Terms of use](https://www.biblica.com/terms-of-use/)
- [Berean Bible — Terms (public domain dedication)](https://berean.bible/terms.htm)
- [eBible.org — KJV copyright](https://ebible.org/kjv/copr.htm)
- [Cambridge University Press — KJV copyright information](https://assets.cambridge.org/97805211/63347/copyright/9780521163347_copyright_info.pdf)
- [Wikipedia — Chinese Union Version](https://en.wikipedia.org/wiki/Chinese_Union_Version)
- [Bible.com — CUNP (Hong Kong Bible Society)](https://www.bible.com/versions/46)
- [eBible.org — 新標點和合本 copyright page](https://ebible.org/cmn-cu89t/copyright.htm)
- [Bible.com — CNV (Worldwide Bible Society)](https://www.bible.com/hy/versions/40-CNV-)
- [Methodist Church — Understanding church copyright licences](https://methodist.org.uk/for-churches/digital-church/digital-training-blog/understanding-church-copyright-licences)
- [OpenLP manual — Bibles](https://manual.openlp.org/bibles.html)
- [OpenLP — Integration with BibleGateway broken (2019)](https://openlp.org/blog/blog/2019/07/14/integration-with-biblegateway-broken.html)
- [ProPresenter — Bible licences](https://support.renewedvision.com/hc/en-us/articles/360011789553)
