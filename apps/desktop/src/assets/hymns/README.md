# Built-in public-domain hymns

`en.json` is the `hymns` source of the [Song Catalogue](../../../../../docs/song-catalogue-plan.md):
English hymns shipped with the app, free to show, copy and share everywhere. Why these, and why not
others, is in the [Song lyrics discovery](../../../../../docs/song-lyrics-discovery.md).

Not wired into the app yet (plan M1).

## The rule for every song

A song goes in only when **all** of these hold:

1. **Published in 1930 or earlier.** That makes it public domain in the US.
2. **Everyone who wrote the exact words died before 1 January 1956.** That covers authors,
   translators, and anyone who altered or added a stanza. It makes the song public domain in the UK
   and EU (life + 70) and in China, Hong Kong and Taiwan (life + 50).
3. **The words are copied from a named source printed in 1930 or earlier**, linked in `proof`. They
   are never taken from a modern hymnal, a lyrics site or memory. Modern hymnals often change the
   words, and those changes can be copyrighted.

Allowed changes from the source: punctuation, spelling (for example "tho'" to "though"), fixing
obvious transcription errors, leaving out "Amen", choosing which stanzas to include, and repeating a
refrain after each stanza. Any change to the words goes in the source note.

## Format

Each song has `id` (stable for ever: the app derives the song's identifier from it), `version`
(raise it when the words change), the song fields the app stores (`title`, `author`, `copyright`,
`year`), `stanzas` (one block per stanza or refrain, one string per line), and the evidence:
`writers` (with death years) and `proof` (source and link). A refrain is written out again after
each stanza, because a slide shows the blocks in order.

## Checked 21 November 2026

19 songs. Sources: _The Army and Navy Hymnal_ (1920), _Olney Hymns_ (1840 edition), _The Canadian
Soldiers' Song Book_ (c. 1917), and two Wikisource transcriptions of Charles Wesley (died 1788)
marked public domain. Fixed OCR errors include "need less" to "needless", "my courts" to "thy
courts", "0 to grace" to "O to grace", and a missing "man" in _Hark! the Herald_.

**Check before release:** the two Wesley hymns (_And Can It Be_, _O for a Thousand Tongues_) were
taken from Wikisource transcriptions that have no linked scan. They are public domain whatever their
wording, so this check is about accuracy, not copyright. Compare them with a pre-1931 Methodist
hymn book scan.

## Candidates not included yet

| Song                                   | Why not yet                                                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Be Thou My Vision                      | Writers qualify (Byrne died 1931, Hull died 1935, published 1912). Needs the words from a scan of Hull's _Poem-Book of the Gael_ (1912), not yet transcribed on Wikisource. Modern versions are altered |
| Praise to the Lord, the Almighty       | Winkworth died 1878. The only transcription found has no source and an altered line. Needs the 1863 _Chorale Book for England_                                                                          |
| Joyful, Joyful, We Adore Thee          | van Dyke died 1933, published 1911. Some hymnals still print "used by permission of Charles Scribner's Sons". Check before including                                                                    |
| To God Be the Glory                    | Crosby died 1915. No pre-1931 transcription found yet                                                                                                                                                   |
| It Is Well with My Soul, stanza 4      | The source used prints three stanzas. Add "And, Lord, haste the day…" from a scan of _Gospel Hymns No. 2_ (1876)                                                                                        |
| Silent Night, the familiar stanzas 2-3 | The source uses Jane Campbell's stanzas 2-5. Young's "Shepherds quake at the sight" stanzas are public domain too (he died 1885). Needs a pre-1931 printing                                             |

## Never include

- **Great Is Thy Faithfulness**: Chisholm died 1960, so it is protected in the UK until the end of
  2030, though public domain in the US.
- **How Great Thou Art**: © Stuart Hine Trust.
- Any modern version of an old hymn, such as _Amazing Grace (My Chains Are Gone)_.
