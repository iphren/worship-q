# Worship Q — Voice Recognition Requirements

**Drafted:** 17 November 2026
**Status:** Reviewed with the project owner on 17 November 2026, who answered every question in
§8. Nothing is built. The requirements stand as written, to be checked against the spike. The
[discovery](voice-recognition-discovery.md) looks at how to meet them.
**Source:** [Requirements and Architecture](worship-q-requirements-and-architecture.md) §17
(*Voice recognition and automatic slide switching*); §6 (lyrics format, language-agnostic
lyrics); §7 (live state); the [Live Audio Broadcast Plan](live-audio-plan.md) (A1–A16), whose
capture this would reuse; and the [Service Records Task Breakdown](service-records-task-breakdown.md)
(R1–R22), whose recordings and presentation log give the data to measure it against.

The feature is called **Q** to volunteers (Q7).

## 1. The request

The app listens to the service and moves to the right piece as it is sung or read, so that one
volunteer can run the slides, or run them while also doing something else. It follows the song
on screen, and moves on to the song before or after it on the run sheet when the leader does.
The operator stays in charge: they can override at any time, and the app must never put
something wrong on screen more readily than a volunteer would.

## 2. The moments it is designed for

1. **A song sung as written.** The leader sings the song in run-sheet order. The next piece is
   on screen **before** its first word is sung, so that the congregation can read it in time to
   sing along smoothly.
2. **A song sung as the leader feels it.** The chorus is repeated three times, a verse is
   skipped, the bridge loops, the last chorus is sung once more after the band has stopped.
   The app follows what is sung, not the order of the lyrics.
3. **A bilingual song.** The lyrics hold two languages, entered however the workspace likes
   (§6): alternating lines in the same piece, or one block per language. Only one language is
   sung at a time, and the leader may change language at any point, typically after a few
   repeats of the chorus.
4. **Songs sung together.** The band goes straight from one song into the next on the run
   sheet, or comes back to the chorus of the song before. Some leaders weave two songs: song A,
   then B, then A again, then B, often chorus to chorus rather than from the end of one to the
   start of the other. The app follows the singing back and forth between them.
5. **A passage read aloud.** A Bible passage on the run sheet (§11) is read by a speaker, and
   the app moves through its pieces as it is read.
6. **Anything else.** Talking between songs, prayer, the band playing alone, a song that is not
   on the run sheet, the sermon. The app does nothing.

## 3. Proposed requirements

### What it does

| # | Requirement |
| --- | --- |
| V1 | **Moves within the presented item and its neighbouring songs.** The app changes which piece is shown, either within the presented item or to a piece of a neighbouring song (V23). It never presents anything else on the run sheet, never blanks or clears the screen, never ends a blank, and never edits anything. |
| V2 | **Follows any piece, in any order.** Any piece of the presented item can be the next one: forward, backward, repeated or skipped. Run-sheet order is a hint, not a rule. |
| V3 | **Songs and Bible passages.** It follows song lyrics and the text of Bible passages. A passage is followed within itself only. Media items (slide decks such as sermon slides, videos, images, websites) are never followed and never moved to. |
| V23 | **The songs of the same set are in context.** While a song is presented, every other song in its *set* is a candidate too: the unbroken run of songs around it on the run sheet, up to the nearest non-song item on each side. Bible passages, sermon slides and other media are never candidates, and a non-song item ends the set (Q9). So a leader can weave any two songs of the set, not only adjacent ones; these are the *neighbouring songs* meant elsewhere in this document. Moving to another song needs stronger evidence than moving within one (V10). A move can come from any piece and land on any piece, not only from the end of one song to the start of the next, and it can go back and forth any number of times (A, B, A, B). Leaving a song is not the same as finishing it: the song left stays a candidate while the leader is in the other one. |
| V4 | **Language-agnostic, as the lyrics are.** It works on lyrics as they are stored, with no labels for languages, verses or choruses, and no preparation of a song before it can be followed (§6). |
| V5 | **Bilingual lyrics.** When a piece holds lines in two languages, singing either language counts as singing that piece. When the language sung changes, the app keeps following without a wrong jump, whether the two languages share pieces or have blocks of their own. |
| V6 | **Languages covered.** The first church's workspaces sing in Mandarin and English together, in Mandarin alone, and in Cantonese (Q1, answered). All three must work, and a song in Chinese must be followed whether it is sung in Mandarin or in Cantonese. Other languages may work less well, and the app says nothing about languages it was not tested with. |
| V22 | **The same lyrics, sung two ways.** Chinese lyrics are written once and can be sung in Mandarin in one workspace and in Cantonese in another, from the same library song. How Chinese is sung is therefore a property of the workspace, never of the lyrics: each workspace can say in Settings whether its Chinese is sung in Mandarin or Cantonese, and the app works it out from the singing when it is not set. The lyrics stay unlabelled (V4). |

### Who stays in charge

| # | Requirement |
| --- | --- |
| V7 | **Three modes: Off, Suggest, Auto.** *Off* is the default. *Suggest* shows the piece the app thinks comes next, on operator devices and remote controllers alike, and anyone of them presents it with one press. *Auto* presents it without a press. |
| V8 | **A person always wins.** Any navigation by an operator or remote controller takes effect at once and is never undone by the app. The app then carries on following from the piece that person chose. |
| V9 | **Controlled from anywhere.** On the Present page of any operator device, and on any remote controller, a person can see the mode and status, change the mode, and pause and resume following, without opening Settings (Q4, Q5, answered). Every change applies to every device, because the live state is shared. |
| V10 | **It waits rather than guesses.** When it is not confident, it does nothing. A missed change is the operator's to make; a wrong change is a mistake the room sees. |
| V11 | **It is quiet when there is nothing to follow.** When nothing is presented, the screen is blanked, a media item is on screen, or nobody is singing or reading, it makes no change and shows no suggestion. |

### How well it must work

| # | Requirement |
| --- | --- |
| V12 | **Ahead of the singing.** In Auto mode, the next piece is on screen before the first word of its first sung line, early enough to be read: the working target is about a second before, and never later than a volunteer would change it, to be checked against the recordings (V20). Being late is a failure, not a lesser success. In Suggest mode, the suggestion appears early enough for a person to press it and still meet the same target. |
| V13 | **Rarely wrong.** The working target for Auto mode: no more than one wrong change per service, measured over the songs of real services (V20). Suggest mode can be offered with a lower bar, because a person confirms. |
| V14 | **Never acts on stale sound.** If recognition falls behind or the audio stops, the app stops following and says so. It never makes a change based on audio more than a couple of seconds old. |

### Where it runs and what it costs

| # | Requirement |
| --- | --- |
| V15 | **Local only.** Recognition runs on a computer of the workspace. No audio and no text from the service is sent to a cloud service, and it works with the venue network alone, without internet. |
| V16 | **One listening computer.** One desktop of the workspace listens, normally the one with the mixer feed that already broadcasts live audio (A3). It sends its changes through the coordinator like any operator press, so every output and device stays in step. |
| V17 | **macOS and Windows,** with the same behaviour, on the computers churches already use for presenting. It runs alongside presenting, the slideshow, the live-audio broadcast and OBS without making any of them stutter or lag. |
| V18 | **A download, not a bundle.** Whatever the recognition needs (models, for instance) is downloaded when a church first turns the feature on, not shipped with every install. |
| V19 | **Nothing kept.** The feature keeps no audio and no transcript. The broadcast's recording (R1–R11) is unchanged by it. |

### How it is measured

| # | Requirement |
| --- | --- |
| V20 | **Measured on real services before Auto ships.** The church server already has recordings of the live audio and a presentation log of every piece shown, with its start and end (R1–R22). Together they show when a volunteer changed each slide. Every decision about models, thresholds and modes is checked against those, offline, before it reaches a service. |

### What it learns

| # | Requirement |
| --- | --- |
| V21 | **Learns what usually comes next.** For each song, the app learns from past services (the presentation log, R12–R19): which piece usually follows which; which piece is usually the last one sung, after which the song usually ends; which songs are usually sung with it; and, for two songs sung together, where the leader usually crosses between them in each direction (from A's chorus to B's chorus, say) and how many times they go back and forth. It uses this to choose between likely pieces (which of two identical choruses, the bridge or the chorus), to expect the move to the next song, and to be ready for it. It falls back to the order of the lyrics for a song never sung before. What was learned only ever breaks ties: when the leader clearly sings something else, the app follows the singing. |

## 4. What people see

- **The mode,** on the Present page of every operator device and on remote controllers, beside
  the other live controls: Q off, Suggest or Auto, and Pause.
- **Whether it is following,** as a small status: listening, following a piece, unsure, or not
  hearing anything. Subtle, in line with the rest of the Present page.
- **The suggestion,** in Suggest mode, as a highlight on the suggested piece, which may belong to
  the next or previous song, pressed to present it. On operator devices and remote controllers.
- **Nothing on the outputs.** The slideshow, subtitles and output links never show anything of
  this feature.

## 5. Settings

- **On the listening computer:** a switch to listen on this computer, using the audio input
  already chosen in Settings for live audio (U24, A8). Turning it on downloads what it needs.
- **Per workspace:** the mode it starts in when a live state begins (Off by default), and how
  its Chinese is sung: Mandarin, Cantonese, or not set (worked out from the singing) (V22).

## 6. Out of scope

- Presenting anything other than the presented item and its neighbouring songs (V23), or a song
  that is not on the run sheet.
- Transcribing the sermon, captions of what is said, or translation.
- Recognising songs that are not in the library, or writing lyrics from the audio.
- Cloud recognition services.
- Labelling verses, choruses or languages in the lyrics (deferred in §17).
- Phones as the listening device.

## 7. Relation to other features

- **Live audio broadcast.** Shares the capture of the mixer feed. Voice recognition works
  without the broadcast being on; if both are on, they use the same input and must not disturb
  each other (spike L7: another window asking for the microphone mutes the broadcast's capture).
- **Service records.** Not changed. Its recordings and the presentation log are the test data
  for V20 and the history V21 learns from.
- **Remote controllers.** See and control the mode, the status and the suggestions like an
  operator device (V7, V9). The mode, status and suggestion are part of what the coordinator
  shares, so they need new protocol message kinds.
- **Presenting another item.** Moving to a neighbouring song is the same as a person presenting
  a piece of the live run sheet (spec §7, rule 5); the presented content, the log and every
  output treat it alike.

## 8. Open questions for the project owner

| # | Question | Proposal |
| --- | --- | --- |
| Q1 | Which languages, and which spoken varieties, does the first church sing and read in? | **Answered 17 November 2026:** some workspaces sing Mandarin and English, some Mandarin only, some Cantonese (V6, V22) |
| Q2 | Are Bible passages read aloud in the first version, or songs only? | **Answered 17 November 2026:** songs first; passages once songs work, since speech is easier to recognise |
| Q3 | Is Suggest mode worth shipping on its own, before Auto has met V13? | **Answered 17 November 2026:** yes, it is useful even at modest accuracy and carries no risk |
| Q4 | Who can change the mode? | **Answered 17 November 2026:** every operator device and every remote controller (V9) |
| Q5 | Do remote controllers see the mode, the status and suggestions? | **Answered 17 November 2026:** yes, and they can control them (V7, V9) |
| Q6 | Should the app ever be allowed to move to another run-sheet item? | **Answered 17 November 2026:** yes, to the song before or after, since some songs are sung together and some pieces almost always end a song (V1, V21, V23) |
| Q7 | What does the feature call itself to volunteers? | **Answered 17 November 2026:** **Q** |
| Q8 | Should what is learned (V21) be per workspace, or shared across the church's workspaces for the same song? | **Answered 17 November 2026:** per workspace first, falling back to the church's when a workspace has too few services of that song |
| Q9 | When a non-song item (a Bible passage, the sermon slides) sits between two songs, should the song beyond it still be a candidate? | **Answered 17 November 2026:** no, the non-song item ends the set (V23); within a set, every song is a candidate, so weaving works between songs that are not adjacent on that side, since the band does not usually sing across it |
