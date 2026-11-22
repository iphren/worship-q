# Song Lyrics from the Public Server — Discovery

**Date:** 21 November 2026
**Status:** Discovery only, on feasibility: copyright and the right to distribute. It is not a
technical design and not legal advice. Publisher terms were read from their public pages on the
date above; they change. Points marked *verify* were not confirmed from a primary source. Get
written confirmation from a rights holder before relying on anything here.
**Follow-up:** the [Song Catalogue plan](song-catalogue-plan.md), and the checked hymns in
`apps/desktop/src/assets/hymns/`.
**See also:** [Public server plan](public-server-plan.md), [Bible passages discovery](bible-passages-discovery.md)
(the same "two permissions" problem for Scripture).

The question: can the project's public server offer a catalogue of worship song lyrics that a
local-mode workspace can add to its library, and which songs can it offer without paying a
copyright fee?

## 1. Answer in short

**Yes, but only for songs nobody owns any more, and for the few whose owners say so in writing.**

- **Church licences do not help.** A church's CCLI licence covers *that church* storing and
  projecting lyrics. It does not let the project hand lyrics to the public. CCLI has also retired
  its SongSelect API partner programme and takes no new partners, so there is no paid route
  through CCLI either.
- **Public-domain hymns are free.** For the server's audience (worldwide, project based in the
  UK), the safe test is: **the words were published in 1930 or earlier, and every writer,
  translator and reviser of the exact text served died before 1 January 1956.** That covers a
  large set of classic English hymns and carols (§5).
- **Many "old hymns" fail the test.** *Great Is Thy Faithfulness* (UK until 2031), *How Great Thou
  Art* (Stuart Hine Trust), and modern versions of old hymns (*Amazing Grace (My Chains Are
  Gone)*) are still owned.
- **Chinese is the hard part.** Almost every Chinese text in use today is a translation or
  revision from after 1930, or its translator died after 1955. Few Chinese songs pass the test
  without research song by song. The realistic Chinese route is **permission**, and **Stream of
  Praise (赞美之泉)** is the most promising: it already lets anyone show its lyrics on a web page
  for free (§6).

**Recommendation:** start with a checked catalogue of 50–100 public-domain English hymns and
carols, each with its proof (§8). Ask Stream of Praise in writing about Chinese. Do not include
anything from CCLI-only catalogues, Living Stream Ministry, or 迦南诗选.

## 2. Two separate permissions

| Question | Who answers it | Today |
| --- | --- | --- |
| May **the church** project this song in its service? | The publisher, usually through CCLI or One License | Yes, with the church's own licence. The app already records the CCLI number (D7) |
| May **the project** store the lyrics and send them to anyone who asks? | Each rights holder, directly | Only for public-domain songs, or with written permission |

A public catalogue is the second question. Hymnary.org puts it this way: with a licence a church
"may project the song or make copies of it for congregational use". That is reproduction by the
licensed church, not distribution by a third party. CCLI's own advice for publishers outside its
scheme is to "contact the publisher directly", and a software company is in the same position for
every song.

## 3. Licensed routes, and why they are closed

| Route | Status |
| --- | --- |
| **CCLI SongSelect API** | Retired: "no longer accepting new API partners" (CCLI API docs). Developers were told the same in 2018 and 2022 |
| **SongSelect account linking** (as in ProPresenter, WorshipTools) | Each church imports with its own subscription. Needs CCLI partnership; not available to a new app |
| **One License** | Licenses congregations, not software distribution |
| **A licence from each publisher** | Possible in principle, but it means fees and negotiation per catalogue. That conflicts with a free, unfunded project |

**Creative Commons** worship songs exist but are few and scattered. Most use NonCommercial or
NoDerivatives licences (for example Daniel Mount's songs, CC BY-NC-ND), which allow free
redistribution of the unchanged text. The catalogue could serve them as published, with their
licence and credit, song by song.
No sizeable CC BY collection was found.

So the fee-free catalogue has two sources: public domain and voluntary permission.

## 4. The public-domain test

The public server is reached worldwide through CloudFront, and the project is run from the UK.
Use the strictest common rule, so that one test works everywhere the app is used:

| Place | Term | What is free in 2026 |
| --- | --- | --- |
| UK, EU | Author's life + 70 years | Authors who died before 1956 |
| US | Works published before 1978: 95 years from publication | Published in 1930 or earlier |
| Mainland China, Hong Kong, Taiwan | Life + 50 years | Authors who died before 1976 (so the UK rule covers them) |

**Test: published ≤ 1930 *and* everyone who wrote the exact words died < 1956.**

Pitfalls:

- **Every layer counts.** For a translated hymn, the translator matters as much as the original
  author. For an altered text, so does the reviser. A 1980s hymnal that replaced "thee" with
  "you" has a copyrighted edit of a public-domain hymn. Serve the text as printed in a pre-1931
  source.
- **Added verses and choruses.** *Amazing Grace* is free. The "My chains are gone" chorus (2006)
  is not.
- **Only lyrics.** The catalogue holds words, which is all the app shows. Tunes and arrangements
  do not matter for it. They do matter if anyone later adds sheet music.
- **UK typographical arrangement right** (25 years from an edition) protects a page's layout, not
  the words. Typing the text out again is fine. Copying a recent hymnal's scanned page is not.
- **Hymnary.org and the Open Hymnal labels are US-centric.** Hymnary marks *Great Is Thy
  Faithfulness* as public domain, which is true in the US since 2019 but not in the UK. Its FAQ
  makes no claim about how accurate its labels are. Use these sites to find candidates, then check
  dates yourself.

## 5. English songs that pass the test

Dates are writers' deaths. *Verify* each against a primary source before shipping (§8).

| Song | Writers of the words | Passes? |
| --- | --- | --- |
| Amazing Grace (original verses) | John Newton (d. 1807); "When we've been there…" verse anon., by 1829 | Yes |
| Holy, Holy, Holy | Reginald Heber (d. 1826) | Yes |
| It Is Well with My Soul | Horatio Spafford (d. 1888) | Yes |
| Be Thou My Vision | Mary Byrne, tr. (d. 1931); Eleanor Hull, versified (d. 1935); pub. 1912 | Yes (*verify* the wording against the 1912 text) |
| Come, Thou Fount of Every Blessing | Robert Robinson (d. 1790) | Yes |
| Crown Him with Many Crowns | Matthew Bridges (d. 1894), Godfrey Thring (d. 1903) | Yes |
| Joyful, Joyful, We Adore Thee | Henry van Dyke (d. 1933), pub. 1907 | Yes |
| Blessed Assurance; To God Be the Glory | Fanny Crosby (d. 1915) | Yes |
| What a Friend We Have in Jesus | Joseph Scriven (d. 1886) | Yes |
| When I Survey the Wondrous Cross; Joy to the World | Isaac Watts (d. 1748) | Yes |
| And Can It Be; O for a Thousand Tongues | Charles Wesley (d. 1788) | Yes |
| Abide with Me | Henry Francis Lyte (d. 1847) | Yes |
| All Hail the Power of Jesus' Name | Edward Perronet (d. 1792) | Yes |
| Rock of Ages | Augustus Toplady (d. 1778) | Yes |
| Silent Night (English) | John Freeman Young, tr. (d. 1885) | Yes |
| O Come, All Ye Faithful | Frederick Oakeley, tr. (d. 1880) | Yes |
| Hark! the Herald Angels Sing | Charles Wesley, George Whitefield (d. 1770) | Yes |
| **Great Is Thy Faithfulness** | Thomas Chisholm (d. 1960) | **No.** Free in the US, protected in the UK until end of 2030 |
| **How Great Thou Art** | Stuart K. Hine (d. 1989), © 1949/1953 Stuart Hine Trust | **No** |
| **In Christ Alone, 10,000 Reasons**, and any modern worship song | Living writers | **No** |

Hymnary.org lists thousands of texts marked public domain. A first catalogue of 50–100 of the
most-sung ones is a few days of careful checking, not a research project.

## 6. Chinese songs

### Public domain: few and slow to prove

- **普天颂赞 (1936).** Published after 1930, so it is not free in the US until 2032 whoever the
  translator was. Translators include 刘廷芳 (d. 1947, *verify*), 杨荫浏 (d. 1984) and 赵紫宸
  (d. 1979). The two later ones fail the UK test too. The current Hong Kong edition (基督教文艺出版社)
  is revised and copyrighted.
- **赞美诗（新编）(1983, China Christian Council).** Copyrighted. Its texts are often revised
  versions of older translations.
- **19th- and early-20th-century missionary hymnals** (pre-1931, translators long dead) do pass.
  But their wording is often not what churches sing today, and finding a reliable scan and the
  translator for each hymn is slow.
- **Scripture songs.** The 1919 Chinese Union Version is public domain, but a song that sets it
  still has a songwriter who owns the song. Do not treat it as free.

### Owned, with known terms

| Source | Terms found | For the catalogue |
| --- | --- | --- |
| **Stream of Praise 赞美之泉** (sop.org) | Church use, including ProPresenter, is free with no application. "Free to display the lyrics (not including guitar chords, numbered musical notation, or music sheet) of a song on a web page." The church category excludes any "intention of publishing". SOP may ask for content to be taken down | **Most promising.** An app catalogue is not named either way. Ask copyright@sop.org for written permission to serve lyrics only, with credit. New songs (< 1 year) may be excluded |
| **Living Stream Ministry** (小群诗歌, Hymns) | "All rights reserved"; no electronic copies "except … specifically authorized in writing". Watchman Nee died 1972 | No, unless LSM agrees in writing |
| **迦南诗选** (吕小敏) | No published terms or rights holder found. The writer is living | No: there is nobody to grant permission |
| Others (小羊诗歌, 约书亚乐团, 有情天, 生命河…) | Not researched | Possible future requests, one email each |

## 7. How it fits the public server

- **The "nothing is kept" rule (plan §3)** is about each user's content. A read-only catalogue
  that the project owns is a different thing and does not break it. But the spec says the public
  website is not a "global song library" (§ Public website and self-hosted instances). **This is a
  new decision for the owner.**
- **A server is not needed at all.** Public-domain lyrics could ship inside the desktop app as a
  starter set, which works offline and for church workspaces too. Permission-based songs (Stream
  of Praise) are better served from the public server: if permission is withdrawn, the project can
  remove them in one place. Songs already added to a library stay there, as the church's own copy
  under its own licence.
- **The song model already fits.** `author`, `copyright` ("Public domain") and `ccli` (null) are in
  D7 and the local API. The catalogue would add a source note per song (edition and year), kept
  for proof but not shown.

## 8. If we go ahead

1. **The owner decides** whether the project offers a song catalogue at all (§7), and whether
   public-domain songs ship in the app, on the server, or both.
2. **English set:** pick 50–100 hymns and carols from §5 and Hymnary's most-printed list. For each,
   record every writer's death year and a pre-1931 source scan (archive.org, Hymnary page images),
   and type the words from that source. A second person checks each entry against the test in §4.
3. **Chinese:** email Stream of Praise for written permission (lyrics only, with credit, removal on
   request). If they agree, add their best-known songs with their credit line. Approach other
   Chinese publishers one at a time if demand shows up.
4. **Takedown:** publish a contact address and remove any song on a credible claim.
5. **Unchanged:** churches keep adding owned songs themselves, under their own CCLI licence, as
   they do today.

## 9. Open questions

- Is a song catalogue in scope for the project (§7)?
- Is the UK test enough, or should the catalogue be checked against other countries where users
  are, such as Canada (life + 70 since 2022) or Australia?
- Would Stream of Praise's permission cover Traditional and Simplified Chinese texts both?

## Sources

- [CCLI API documentation (Postman): SongSelect API partner programme retired](https://documenter.gw.postman.com/view/metadata/TzseGkmA)
- [OpenSong feature request #401: SongSelect API not available to new partners](https://sourceforge.net/p/opensong/feature-requests/401)
- [WorshipTools: SongSelect import through CCLI account linking](https://www.worshiptools.com/en-us/docs/114-pl-songselect)
- [CCLI: when the publisher is not covered by CCLI](https://support-ccli-us.helpscoutdocs.com/article/1355-what-do-i-need-to-do-when-the-publisher-is-not-covered-by-ccli)
- [CCLI: SongSelect for personal use](https://support-ccli-us.helpscoutdocs.com/article/1133-can-i-have-access-to-songselect-for-my-personal-use)
- [Out of the Ark: which licence do I need](https://www.outoftheark.co.uk/which-licence-do-i-need/esongbooks)
- [Methodist Church: copyright guide for streamed worship](https://www.methodist.org.uk/for-churches/digital-church/online-worship-toolkit/copyright-guide-for-streamed-worship/)
- [Hymnary.org FAQ](https://www.hymnary.org/faq)
- [Hymnary.org: Great Is Thy Faithfulness](https://hymnary.org/text/great_is_thy_faithfulness_o_god_my_fathe?page=1)
- [Wikipedia: Great Is Thy Faithfulness](https://en.wikipedia.com/wiki/Great_Is_Thy_Faithfulness)
- [Hymnary.org: How Great Thou Art](https://hymnary.org/text/o_lord_my_god_when_i_in_awesome_wonder?page=1)
- [Church of Jesus Christ hymnal: How Great Thou Art (licensing note)](https://www.churchofjesuschrist.org/music/text/hymns/how-great-thou-art?lang=eng)
- [Open Hymnal data mirror (GitHub)](https://redirect.github.com/mzealey/openhymnal)
- [UMC Discipleship: Public domain hymns](https://umcdiscipleship.org/resources/public-domain-hymns)
- [Stream of Praise: copyright categories and regulations](https://sop.org/en/copyright/)
- [Living Stream Ministry: copyright policy](https://www.lsm.org/copyright-policy.html)
- [Hymns by Witness Lee and Watchman Nee](https://witness-lee-hymns.org/)
- [Wikipedia: 普天颂赞](https://zh.wikipedia.org/zh-hans/%E6%99%AE%E5%A4%A9%E9%A0%8C%E8%AE%9A)
- [Hymnary.org: Hymns of Universal Praise (1936)](https://hymnary.org/hymnal/HUP1936)
- [刘博韵、朱帅: 论1920–30年代圣诗中译的实践 (JSCC 32)](http://jscc.ruc.edu.cn/sites/default/files/ckeditor_files/Vol32%20LIU%20Boyun%20%20ZHU%20Shuai%20SCN%20JSCC.pdf)
- [神州团契: 诗歌版权](https://www.sztq.org/article-2183-1.html)
- [Wikipedia: Canaan Hymns](https://en.wikipedia.org/wiki/Canaan_Hymns)
- [Daniel Mount: song licence (CC BY-NC-ND example)](https://danielmount.com/license/)
