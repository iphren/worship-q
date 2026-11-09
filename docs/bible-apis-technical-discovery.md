# Bible APIs — Technical Discovery

**Date:** 9 November 2026
**Status:** Discovery only. Findings come from calling each API with the first church's own
keys on the date above; nothing is built. Behaviour can change without notice.
**Follows:** [Bible Passages Discovery](bible-passages-discovery.md), which covers rights and
which provider serves which version (§10).

## 1. Questions

1. How is each API called?
2. How does search work: references, free text, or both?
3. Does each API give a table of contents (book names, chapters, verses per chapter), given
   that versions number their verses differently?

## 2. The four providers at a glance

| | YouVersion Platform | API.Bible | ESV API | Free Use Bible API |
| --- | --- | --- | --- | --- |
| Base URL | `https://api.youversion.com/v1` | `https://rest.api.bible/v1` | `https://api.esv.org/v3` | `https://bible.helloao.org/api` |
| Auth | Header `X-YVP-App-Key` | Header `api-key` | Header `Authorization: Token …` | None |
| Reference IDs | USFM: `JHN.3.16-18` | USFM: `JHN.3.16-JHN.3.18` | Free text in, numeric out (`43003016` = book 43, ch 3, v 16) | USFM book + chapter: `/JHN/3.json` |
| Fetch unit | Passage within one chapter | Any passage, across chapters | Any passage, several at once | Whole chapter only |
| Formats | `text`, `html` | `text`, `html`, `json` | `text`, `html` | JSON (headings, verses, line breaks) |
| Table of contents | **Full, one call** (`/bibles/{id}/index`) | Books and chapters in one call; verses per chapter | **None** | Books with chapter and verse totals |
| Reference search | **Good**, English and Chinese | English full names only | **Excellent** parser, English | None |
| Text search | **Good**, typo-tolerant, ranked | Works; weak ranking in Chinese | Works; no typo tolerance, weak ranking | None |
| Copyright line | `/bibles/{id}` → `copyright` | Every passage response | Appended "(ESV)"; notice on copyright page | `licenseNotice` in translation list |
| Extra duty | Licence acceptance per version | **FUMS token** per passage shown | ≤ 500 verses cached | — |

All four use, or map cleanly to, the **USFM book codes** (`GEN`, `PSA`, `1CO`, `JHN` …). ESV's
numeric IDs use the book's position (43 = John), which converts one to one. A Worship Q
reference can therefore be stored as *USFM book + chapter + verse range* and sent to any
provider.

## 3. Each API in practice

### YouVersion Platform

- `GET /bibles?language_ranges[]=zh` lists versions the key may use; `all_available=true`
  shows the whole catalogue.
- `GET /bibles/{id}/index` returns every book (localised title and abbreviation, e.g. 约翰福音 /
  约), every chapter and every verse ID in one response of about 1.6 MB.
- `GET /bibles/{id}/passages/JHN.3.16-18?format=text` returns the text and a localised
  reference (约翰福音 3:16-18).
  - **No cross-chapter ranges:** `GEN.1.31-2.3` and `GEN.1.31-GEN.2.3` both return 404. Fetch
    each chapter's part and join them.
  - **`text` flattens poetry** into one line; `html` keeps lines (`<div class="q1">`) and verse
    labels, so it is the better source for slide layout.
- `GET /search-verses?query=…&bible_id=…` handles both kinds of query in one call and returns
  **references only**; text is then fetched through the passages endpoint.

### API.Bible

- `GET /bibles/{id}/books?include-chapters=true` gives localised book names and abbreviations
  (创世记 / 创) and the chapter list. Psalms includes a `PSA.intro` pseudo-chapter to skip.
- Verses per chapter need `GET /chapters/{id}/verses`, one call per chapter (1,189 for a
  whole Bible), so verse counts are best loaded when a chapter is first opened.
- `GET /bibles/{id}/passages/JHN.3.16-JHN.3.18?content-type=text` accepts ranges across
  chapters. Every response carries the copyright line and `meta.fumsToken`.
- `GET /bibles/{id}/search?query=…` returns either `passages` (when it recognises a reference)
  or `verses` (text matches, with `total`, `limit`, `range=PSA` to restrict to a book).

### ESV API

- `GET /passage/text/?q=…` (or `/passage/html/`) parses almost any English reference: `jn3.16`,
  `1 Cor 13:4-7`, several at once (`Rom 8:28;Ps 23`). The response gives the canonical
  reference, numeric ranges, and `passage_meta` with the chapter's first and last verse and the
  previous and next verse and chapter.
- **Out-of-range references are silently clamped:** `Psalm 151` returned Psalm 150. Compare
  `canonical` with what was asked before showing it.
- `GET /passage/search/?q=…` is text search only.
- No table-of-contents endpoint. Chapter lengths come from `passage_meta.chapter_start` /
  `chapter_end`, or from a standard English versification table (ESV follows the usual English
  numbering).

### Free Use Bible API

- Static JSON files, no key, no rate limit published.
- `/{translation}/books.json` gives localised names (约翰福音 / 约), chapter count and total
  verses per book; `/{translation}/{BOOK}/{chapter}.json` gives the chapter with headings,
  verse content and line breaks, plus `numberOfVerses`.
- No search and no verse ranges: fetch the chapter and slice it.

## 4. Search behaviour, tested

| Query | YouVersion (NIVUK / CCB) | API.Bible (NIVUK / CCB) | ESV |
| --- | --- | --- | --- |
| `John 3:16-18` | JHN.3.16–18 | JHN.3.16-JHN.3.18 | John 3:16–18 |
| `jn 3 16` / `jn3.16` | JHN.3.16 | Nothing | John 3:16 |
| `1 Cor 13:4-7` | 1CO.13.4–7 | **Nothing** (`1 Corinthians 13:4-7` works, returns 13:4 only) | 1 Corinthians 13:4–7 |
| `Romans 8` | Text hits in ch. 8 | ROM.8.1 only | — |
| `约翰福音 3:16`, `约3:16`, `约翰福音3章16节` | **JHN.3.16** for all three | **Nothing** | — |
| `John 3:16` against a Chinese Bible | JHN.3.16 | Nothing | — |
| `love your enemies` | MAT.5.44, LUK.6.27, LUK.6.35 | MAT.5.43, 5.44, LUK.6.27 | 1 Sam 20:15, Ps 143:12, Matt 5:44 |
| `love your enimies` (typo) | Same as above | — | 0 results |
| `上帝爱世人` | **JHN.3.16** first | 6 hits, JHN.12.43 first, 3:16 not in top 2 | — |

YouVersion also offers `GET /search-queries` (autocomplete suggestions, e.g. "love your" →
"love your enemies") and topical search.

**Conclusion:** searching is both structured and free text, but only YouVersion handles
Chinese references and typos well, and the providers disagree on reference syntax. Worship Q
should parse references itself (§6) and use provider search only for free text.

## 5. Versification differs, as expected

Compared through YouVersion's indexes:

- **NIVUK has 31,103 verses; CCB has 30,961.** 143 NIVUK verse IDs are missing from CCB's list
  because CCB **merges verses**: 1 Chronicles 16:12–13 is one unit, listed by API.Bible as
  `1CH.16.12-1CH.16.13`. YouVersion returns the merged text for `1CH.16.12`, for `1CH.16.13`
  and for the range; its HTML labels it `12-13`.
- **CCB has Revelation 12:18; NIVUK does not** (NIVUK places that sentence in 12:17).
- **3 John has 15 verses in NIV and ESV, 14 in KJV.**
- Hebrew-numbered texts (for example the JPS Tanakh) number Malachi 4 as 3:19–24 and count
  psalm titles as verse 1. None of the first church's versions do this, but the reference model
  should allow it.

So a reference typed by the operator must be **validated against the chosen version's own
table of contents**, and showing the same reference in two versions side by side (English +
Chinese) can produce different verse spans. Merged verses must show their combined label
("12-13") and must not repeat when a range covers both.

## 6. Suggestions for the design

1. **One search box, two steps.**
   - Parse the input as a reference locally first. Book names and abbreviations come from each
     enabled version's table of contents (English and Chinese), plus common forms: `Jn 3:16`,
     `1 Cor 13:4-7`, `约3:16`, `约翰福音3章16节`, chapter-only (`Psalm 23`), cross-chapter
     (`Gen 1:31-2:3`).
   - If it is not a reference, run text search with a provider that supports it for that
     version (YouVersion first; API.Bible; ESV for ESV), and show results as references with a
     text preview.
   - Free Use Bible API versions are reference-only.
2. **Store references as USFM** (book, chapter, verse range), never as provider-specific
   strings. Convert per provider: YouVersion splits at chapter boundaries, ESV gets a plain
   reference, Free Use gets chapters to slice.
3. **Cache each version's table of contents.** It is metadata, not Scripture text, so it is not
   expected to count against the text-cache limits; confirm with the providers if in doubt.
   Sources: YouVersion `index` (one call); API.Bible books + chapters (one call) and verses per
   chapter on demand; Free Use `books.json` + chapters on demand; ESV from a standard English
   table or `passage_meta`.
4. **Prefer HTML/JSON over plain text** to keep poetry lines and verse labels for slide layout.
5. **Check what came back:** compare the provider's canonical reference with the request
   (ESV clamps), and handle merged verses and missing verses (e.g. Matthew 17:21 in versions
   that omit it).

## 7. Open technical questions

- [ ] YouVersion rate limits (not documented on the pages read).
- [ ] Does YouVersion's `index` change when a publisher revises a version, and how is that
      signalled (version field, ETag)?
- [ ] API.Bible: the exact FUMS reporting call and when it should fire (on show, per output).
- [ ] Bilingual display: how to align an English and a Chinese passage whose verse divisions
      differ (merged verses), for slides that show both languages.
