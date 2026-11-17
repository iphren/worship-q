# Voice Recognition — Discovery

**Date:** 17 November 2026
**Status:** Discovery. Nothing is built and nothing has been measured. Figures below are
published numbers, several of them reported by the model's own authors, and are marked so. The
spike in §11 is what turns them into decisions.
**Source:** [Voice Recognition Requirements](voice-recognition-requirements.md) (V1–V23, Q1–Q9),
referred to here as "the requirements"; the [Live Audio Broadcast Plan](live-audio-plan.md) and
[spike](spikes/live-audio.md), whose capture this reuses; the
[Service Records Task Breakdown](service-records-task-breakdown.md), whose recordings and
presentation log are the test data.

## 1. What kind of problem this is

It is **not transcription**. The app already knows the text that will be sung: the lyrics of
the presented song and of the other songs of its set on the run sheet (V23), split into blocks
(blank lines), lines and pieces (§6 of the spec). The job
is to work out, a second or two at a time, **where in that known text the singer is**, and to
move to the next piece just before it is needed.

That is the problem that music research calls *score following* or *lyrics following*, and
that voice-tracked teleprompters solve for speech. Both fields have converged on the same
three-part shape, which this discovery follows:

1. **A recogniser** turns audio into evidence: words, or likelihoods of sounds.
2. **A tracker** keeps a belief over positions in the known text, combining that evidence
   with what usually comes next, and copes with repeats and jumps.
3. **A decision policy** turns the belief into an action (suggest, advance, or wait), with
   thresholds and timing.

Recognition accuracy matters, but much less than for transcription: a 30 % word error rate is
useless as captions and can still be plenty to tell verse 2 from the chorus. Most of the
reliability comes from the tracker and the policy.

## 2. Prior art

### Church presentation software

| Product | What it does | Recognition | Notes |
| --- | --- | --- | --- |
| AI Display (open source, GPL-3.0, Windows) | Finds the song being sung and follows it verse by verse; detects spoken Bible references | whisper.cpp offline with `ggml-base.en` (142 MB), or Deepgram/AssemblyAI with the user's key | English-only model by default; matching and repeat handling not documented |
| Vifug (free, offline-first) | Auto-follow advances slides "in the language you sing"; manual control always wins | Deepgram (cloud, user's key) | The only cloud part of an otherwise offline app |
| Worship Light (paid) | AI voice detection moves lyric and scripture slides; manual fallback | Not documented | Vendor claims only |
| WayPresenter | Detects Bible verses in speech and **queues them for an operator to approve** | Not documented | The suggest-first pattern of V7 |

None publishes accuracy figures or how it handles repeats, and the one open-source example uses
an English speech model that was not trained on singing. Nothing here is a design to copy;
it does confirm the shape operators expect: manual override always wins, and approval before
going live is a recognised mode.

### Score and lyrics following (research)

- **Real-time lyrics alignment** (Nam et al., ICASSP 2024; an ISMIR 2021 predecessor): live
  singing aligned to lyrics in real time with *on-line time warping* over phonetic features,
  with a 160 ms audio buffer. Assumes the performance follows the text in order.
- **Repeats and jumps** are the hard part the literature names: *JumpDTW* (Fremerey, Müller and
  Clausen, ISMIR 2010) handles repeats and jumps **when block boundaries are known in advance**;
  Arzt and Widmer use a two-level tracker, where a higher level proposes candidate positions and
  a lower level follows within one; Nakamura et al. use an HMM whose states are all linked by
  repeat and skip probabilities; Brazier and Widmer (2021) track opera with an adaptive JumpDTW
  plus a second tracker for large mismatches.
- **Why this matters here:** our block boundaries *are* known — they are the blank lines of the
  lyrics. The limitation that hurts JumpDTW in classical music is absent for us, and the HMM
  with repeat and skip transitions maps directly onto blocks and lines.

### Voice-tracked teleprompters

Open-source teleprompters (autocue, promptme-ai and others) follow speech against a script.
Their lessons carry over directly:

- fuzzy-match a short window of recent words, not single words;
- stay **anchored** near the current position, rather than jumping to whichever distant window
  scores best;
- treat a large jump back as deliberate only with strong evidence;
- **do not move** when what was heard matches nothing (V10);
- recognisers deliver text in bursts (about 600 ms in one project), so the tracker must buffer.

One maintainer reports rewriting the tracking core because a first version became "messy and
unreliable" — the tracker is where the engineering effort belongs, and it needs a test harness
from day one (§10).

## 3. Architecture

```text
 mixer feed ─▶ capture (webview, shared with broadcast) ─▶ 16 kHz mono PCM ─▶ Rust core
                                                                               │
          ┌────────────────────────────────────────────────────────────────────┘
          ▼
   singing/speech activity ─▶ recogniser ─▶ words + timing ─▶ matcher ─▶ line likelihoods
                                                                              │
          presented song + rest of its set ───────▶ tracker (HMM) ◀───────────┘
          learned transition prior (§7) ──────────▶      │
                                                         ▼
                                     decision policy ─▶ Suggest / Advance / Wait
                                                         │
                                         coordinator ◀───┘  (like any operator press)
```

Everything after capture runs in the **Rust core of the listening desktop** (V16): it keeps
heavy work off the webview, it can use the GPU, and recognition engines all have C or Rust
bindings.

## 4. Audio front end

- **The source decides more than the model.** The best input is a **dry feed of the lead
  singer's microphone** from the mixing desk (an aux send, ideally pre-fader, without the band).
  The second best is the main mix. A room microphone hears the congregation, which sings the
  same words a beat behind, and the PA's delay; avoid it. This is the same advice as for the
  broadcast, but stronger: the broadcast wants the whole mix, recognition wants the voice. A
  church may need a second aux, or a second input on the same interface.
- **Share the capture.** The broadcast already captures the chosen input in the main window's
  webview (A8), and another window asking for the microphone mutes that capture (spike L7). So
  recognition should take its audio **from the same capture**: an `AudioWorklet` on the existing
  track, downsampled to 16 kHz mono and sent to the Rust core (about 64 KB/s as 16-bit PCM over
  IPC). Native capture in Rust (`cpal`) is the fallback, as it is for the broadcast. If a
  separate vocal input is used, it is a second track in the same webview.
- **Activity detection.** Run recognition only when someone is singing or speaking: it saves
  power and avoids the known failure of Whisper-family models inventing text over silence and
  instrumental passages. Silero VAD is built into whisper.cpp (`--vad`) and sherpa-onnx; it was
  trained on speech, so whether it fires reliably on singing over a band is a spike question.
- **Source separation: not now.** Real-time vocal separation exists in research (MMDenseNet,
  Hybrid Spectrogram-TasNet, a few with ~23 ms latency), but good separators (HT Demucs) are not
  causal and are too slow on a CPU, and every separator costs compute that the recogniser wants.
  A vocal aux from the desk does the same job for free. Revisit only if churches cannot provide
  one.

## 5. Recognisers

All local (V15). Cloud services (Deepgram, AssemblyAI) are out.

| Option | Languages | Singing | Streaming | Biasing to the lyrics | Runs locally via | Fit |
| --- | --- | --- | --- | --- | --- | --- |
| **Qwen3-ASR-0.6B** (Apache-2.0, Jan 2026) | 30 languages + 22 Chinese dialects, including Mandarin, Cantonese, English | Trained on it; best published singing figures (§5.1) | Officially via vLLM only (GPU server); 2 s chunks in the report | Context in the prompt | Community GGUF/llama.cpp (`ggml-org/Qwen3-ASR-0.6B-GGUF`), a C/ggml CLI, MLX, ONNX | **Most promising accuracy; least mature runtime** |
| **Whisper** (large-v3-turbo, small) via whisper.cpp | ~100, including Mandarin and Cantonese | Weaker (§5.1); invents text over music and silence | Sliding windows (`whisper-stream`, 0.5 s step, 5 s window), not true streaming | Initial prompt | whisper.cpp / `whisper-rs`: Metal and Core ML on macOS, Vulkan on Windows, built-in Silero VAD | **Most mature runtime; the baseline** |
| **sherpa-onnx streaming Zipformer** (transducer) | Models per language; a bilingual zh-en model | Speech-trained; unknown on singing | True streaming, low latency | **Hotwords**, and **open-vocabulary keyword spotting**: decodes only given phrases, with per-phrase boost and threshold | `sherpa-onnx` Rust crate (static, prebuilt libraries for macOS and Windows) | **Cheap, constrained second opinion** |
| SenseVoice / Paraformer (sherpa-onnx) | zh, en, ja, ko, yue | Not documented | Non-streaming but very fast | None in sherpa-onnx | `sherpa-onnx` | Possible for Chinese; no biasing |
| Apple SpeechAnalyzer (macOS 26) | ~30 locales | Not documented | Yes | Custom vocabulary through `DictationTranscriber` only | System framework, no download | macOS only; breaks V17 on its own |

### 5.1 What the published numbers say about singing

From the Qwen3-ASR technical report (January 2026). These are **the authors' own figures**,
word error rate in %, on clean sung vocals unless marked:

| Test set | Qwen3-ASR-1.7B | Whisper-large-v3 |
| --- | --- | --- |
| M4Singer (Mandarin singing) | 5.98 | 13.58 |
| MIR-1k vocals | 6.25 | 11.71 |
| Opencpop (Mandarin singing) | 3.08 | 9.52 |
| Popcs | 8.52 | 13.77 |
| Whole songs with backing, English | 14.60 | could not handle |
| Whole songs with backing, Chinese | 13.91 | could not handle |

The 0.6B model, the one sized for a laptop, is not broken out for singing; on speech it loses
about a fifth of the 1.7B's accuracy, and streaming costs a little more. Independent work on
Whisper and singing is less flattering still: language detection is often wrong on songs, which
matters for bilingual services (§6), and zero-shot Whisper-medium scored 92 % WER on Greek songs
in one thesis. Separated vocals help Whisper markedly (2025), which supports the vocal-aux advice
of §4.

Two consequences:

1. **The candidate list for the spike is Qwen3-ASR-0.6B, Whisper (large-v3-turbo and small) and
   sherpa-onnx keyword spotting,** on the church's own recordings. No published figure is on
   worship music, through a church desk, in the first church's languages.
2. **Qwen3-ASR's local runtime is the main technical risk.** It is ten months old; official
   streaming needs vLLM and an NVIDIA GPU; the local ports are community projects. A chunked,
   non-streaming loop through a GGUF build (2 s of audio every 0.5–1 s) is probably enough,
   since the tracker does not need word-by-word output, but its speed on a typical church
   laptop, especially on Windows without a strong GPU, must be measured.

### 5.2 Constrained recognition

Because the possible text is known, recognition can be **restricted** to it rather than
cleaned up afterwards:

- **Keyword spotting with the lyrics as keywords** (sherpa-onnx): every line, or every half
  line, of the presented song and its neighbours (V23) becomes a keyword. The model can then
  only say "heard line 7" or nothing. This is the natural form of V10 (wait rather than guess), and it is cheap enough
  to run beside a general recogniser as a second opinion.
- **Prompt biasing** (Whisper initial prompt, Qwen3-ASR context): give the recogniser the
  current item's lyrics. This helps with rare words and names but is known to cause invented
  text when the prompt does not match the audio; it needs testing on talking between songs.

## 6. Matching heard words to lyrics

The matcher scores **each line** of the presented song and its neighbours against the last few
seconds of recognised text. Lines, not pieces, because a piece can hold two languages (V5) and because
timing depends on which line ends a piece (§8).

- **Normalise** both sides: case, punctuation, full-width characters; **Traditional and
  Simplified Chinese to one form** (OpenCC), since recognisers output either.
- **Compare by sound as well as spelling.** For Chinese, compare toneless **pinyin syllables**
  (or Jyutping for Cantonese) as well as characters: sung recognition often picks a different
  character with the same sound, and singing distorts tones anyway. For English, a phonetic
  key (for example Double Metaphone) beside plain letters.
- **Local alignment, not exact match.** A banded edit distance or Smith-Waterman alignment of
  the recent word window against each line gives a score that tolerates dropped and wrong words,
  and says how far through the line the singer is.
- **Repeated identical lines** (common in choruses) are one text in several places; the matcher
  scores them equally and leaves the choice to the tracker, which knows where the singer was.

### Mandarin and Cantonese from the same lyrics

The first church's workspaces sing in Mandarin with English, in Mandarin alone, and in Cantonese
(V6). Written Chinese is shared, so one library song can be sung in Mandarin in one workspace
and in Cantonese in another (V22). What this means:

- **Characters work for both.** A recogniser that writes standard Chinese characters for either
  variety can be matched on characters regardless of how the song was sung. Cantonese
  recognisers sometimes write colloquial Cantonese characters (佢, 嘅, 咗) instead of the written
  forms in the lyrics; normalise the common ones, and lean on sound (next point) for the rest.
- **Sound depends on the variety.** The phonetic comparison must convert the lyrics to
  **pinyin** for a Mandarin workspace and to **Jyutping** for a Cantonese one (character-to-
  Jyutping data such as that behind PyCantonese, or the open Jyutping dictionaries). The same
  line has quite different sounds in each, so comparing in the wrong one wastes the evidence.
- **The variety is a workspace setting, with detection as fallback.** The workspace says which
  it sings (V22); if not set, score both conversions for the first lines heard and keep the one
  that matches better. Nothing is written into the lyrics.
- **The recogniser must be told, or must cope.** Qwen3-ASR and SenseVoice cover Cantonese
  natively (Qwen3-ASR lists Hong Kong and Guangdong accents). Whisper has a Cantonese language
  code from large-v3, but its Cantonese is weaker than its Mandarin and it is often detected as
  Mandarin; it should be forced to the workspace's variety rather than left to detect. The
  sherpa-onnx zh-en models are Mandarin; Cantonese keyword spotting needs a Cantonese model,
  which the spike must find or rule out.
- **The learned transitions are per workspace** (§7.1, Q8), which suits workspaces that sing the
  same song differently.

### Bilingual lyrics

The spec forbids labelling languages in the lyrics (§6), and nothing here needs labels:

- A piece counts as heard if **any** of its lines matches, so switching language never moves the
  slide by itself.
- The tracker learns **which lines are being sung** from the matches. With alternating lines,
  odd lines match and even lines never do; the tracker keeps a small hidden variable for "which
  set of lines is active" and treats a strong match on the other set as **a change of language,
  not a jump** (§7).
- Script (CJK or Latin characters) is a cheap, reliable hint for that variable inside the
  matcher. It is never stored, shown or required; lyrics in two languages of the same script work
  from matching alone, more slowly.
- **The recogniser's language** is the weak point: Whisper detects the language once per window
  and handles a change of language poorly. Options, in order of preference for the spike:
  (a) a recogniser that handles both languages in one pass (Qwen3-ASR, the zh-en Zipformer);
  (b) detection on every window with both languages' lyrics as context; (c) two passes per
  window, one per language, keeping whichever matches the lyrics better, at twice the compute.
  When the languages share pieces, a missed language switch costs time, not a wrong slide.

## 7. Tracking

A **hidden Markov model over lines** of the presented song and its neighbours, updated as
evidence arrives — the
HMM-with-jumps family of §2, simplified by knowing the blocks.

- **States:** each line of the presented item and, for a song, of the other songs of its set:
  the unbroken run of songs around it on the run sheet (V23); plus *not singing* (talking,
  instrumental, a song not on the run sheet). For bilingual items, each state carries the
  active set of lines (§6). A set of four or five songs is still well under a thousand lines,
  so the cost is negligible.
- **Transitions:** stay on the line; go to the next line; at the end of a block, go to the start
  of any block (repeat, skip, back to the chorus); switch the active set of lines (a change of
  language); go to or from *not singing*. Mid-block jumps are allowed but improbable.
- **Between songs:** from the end of any block of the presented song to the start of any block
  of another song of the set: the next song's first block after a song ends, but also chorus
  to chorus when a leader weaves two songs (A, B, A, B). Run-sheet order shapes the starting
  probabilities: the next song is the likeliest, the previous one next, songs further away
  less likely. These transitions start improbable, become likely after the piece that usually
  ends the song, and are learned per pair of songs (§7.1). Bible passages and media never take
  part (V3).
- **Weaving keeps both songs in play.** The set does not change when the app moves from A to B,
  so A stays a candidate without any special case, whether or not A and B are adjacent. What
  must not happen is treating the move as A being *finished*: the tracker keeps where in A the
  leader left, since a return to A often resumes from there or from A's chorus.
- **Emissions:** the matcher's line scores (§6), and a high *not singing* likelihood when the
  activity detector hears nothing.
- **Belief:** the forward algorithm gives, at every update, a probability for every line; the
  decision policy reads it. No Viterbi back-tracking is needed live.
- **Re-anchoring:** a person's navigation (V8) resets the belief to the chosen piece.

### 7.1 Learning the most likely next slide

The transition probabilities can be **learned from the presentation log**, which records every
piece shown, in order, with its revision, start and end (R13–R16). For each song, the log
already says what operators actually did: after the second chorus, this congregation goes to the
bridge 70 % of the time and repeats the chorus 30 %.

- **It is counting, not a neural network.** Count transitions between pieces per song and turn
  them into probabilities, with smoothing. It is explainable, cheap, works from a handful of
  services, and needs no training infrastructure.
- **Back off when data is thin.** A song is sung a few times a year. Use, in order: this song in
  this workspace; this song across the church; generic structure for songs never logged (next
  piece in order; at the end of a block, a block whose text appears more than once — the chorus,
  detected from the lyrics themselves, so verse/chorus labels stay unnecessary, as §17 of the
  spec deferred).
- **Key on text, not piece ids.** Edits and a change of lines-per-piece renumber pieces, so map
  logged pieces to their lines' text through the revision the entry names.
- **Clean the data.** The log is operator behaviour: a press too early, a wrong slide corrected
  within a few seconds, stepping through to reach a verse (entries under one second are already
  dropped, R14). Ignore entries shown for less than a few seconds, and weight recent services
  more, since a leader's arrangement changes over time.
- **How songs end.** The last piece shown before the log moves to another item is, for most
  songs, nearly always the same one: the final chorus, or a closing line. Counting it per song
  gives the probability that the song is over once that piece has been sung, which is what the
  move to the next song depends on (§8).
- **Which songs go together, and how.** The log also records which item followed which, piece
  by piece. For a pair of songs it shows more than "A then B": a leader who weaves them appears
  as A, B, A, B, with the crossing points (the last piece of A before B, the first piece of B
  after A) and the number of rounds. Count **crossings per pair of songs in each direction, by
  piece**: "from A's chorus, 60 % go to B's chorus", "after two rounds, they finish on B". That
  makes the move more probable at the places this leader usually crosses, and says where in the
  other song it lands.
- **Leaving is not ending.** With weaving, the last piece of A before B is often not A's ending.
  Count a song's last piece only from its final appearance in a stretch of singing, and count
  temporary exits separately, so "the song is over" and "the leader has gone to B for now" are
  learned as different things.
- **Bilingual patterns are learnable too:** "the chorus is sung twice in English, then once in
  Chinese" appears in the log as a pattern of pieces when the languages have their own blocks.
- **It is a prior, never a decision.** The prior must never beat clear acoustic evidence: if
  the leader repeats the chorus for the fifth time, the app follows. The prior's job is to break
  ties (which of two identical choruses), cut wrong jumps, and let Suggest mode highlight a
  likely next piece even before anything is heard.

A learned prior is worth more than its cost: it uses data the server already keeps, and it is
the main defence against the most visible failure, a wrong jump between similar sections.

## 8. Decision policy and timing

- **Advance early, not late.** A volunteer changes the slide during the last words of a piece,
  so the congregation sees the next line before it is sung. Recognition is 0.5–2 s behind the
  voice, so the app must act on **the start of the last sung line of the piece** — the last line
  of the active set (§6), not the last line of the piece — once the tracker is confident and
  enough of the line has been heard. The threshold ("how much of the line") is tuned on the
  recordings.
- **About a second ahead (V12).** The next piece should be readable before its first word, so
  with 1–2.5 s from sound to slide (below), the app must decide roughly 2–3.5 s before the next
  piece begins. A sung line lasts some 3–6 s, so the decision falls **during the last line**,
  often in its first half. Deciding that early is the main source of risk: the last line of a
  piece can also open another one, which is why the learned prior (§7.1) and the hysteresis
  below carry so much weight.
- **A learned duration helps.** The log also gives how long each piece usually stays on screen;
  combined with how far through the line the matcher puts the singer, it predicts when the line
  will end, so the app can act at a set time ahead of it rather than at a fixed point in the
  line.
- **Moving to the next song cannot wait for its words.** A new song usually starts with an
  instrumental introduction, and its first piece must be on screen before the first word. The
  words that would confirm the new song come too late. So the move is predicted from what came
  before: the piece that usually ends this song has been sung (§7.1), the singing has stopped,
  the next run-sheet item is a song, and ideally the two are a learned pair. That is a strong
  but not certain pattern, since a leader may still repeat the chorus after a pause. Proposed:
  in Suggest mode, suggest the next song's usual first piece as soon as the pattern holds; in
  Auto mode, present it only when the learned pattern for this song is strong, and otherwise
  wait for the first sung words and present at once. Then, if the first words heard belong to
  the old song after all, go back to it: one of the few cases where the app corrects itself
  quickly, before anyone sings the wrong words.
- **Crossing mid-song has no introduction.** When a leader weaves A and B, the move from A's
  chorus to B's chorus usually comes straight on the next bar, with no instrumental gap. The
  first words of B arrive with no time to spare, so the move has to be predicted the same way as
  a move within a song: from the learned crossing points for this pair (§7.1) and the hysteresis
  above, during the last line of A's piece. Where this pair has no history, Auto mode waits for
  B's first words and accepts being late for that one piece; Suggest mode shows the crossing as
  soon as it becomes likely.
- **Hearing the band.** Telling an instrumental introduction from silence or talking would
  help the move between songs. Activity detection (§4) tells singing from no singing; music
  without singing is a further class to try in the spike, using the main mix rather than the
  vocal aux.
- **Confidence and hysteresis.** Advance only when the belief in the target is well above every
  alternative and has held for a short time; never flip back and forth. Different thresholds for
  *next piece* (common, low risk), *jump within a song* (rarer) and *another song* (rarest,
  highest bar, V23); Suggest mode can show moves that Auto mode would not make.
- **Staleness (V14).** Every result carries the audio time it describes; anything older than
  about two seconds is discarded, and if recognition falls behind the app pauses itself and says
  so.

**Latency budget** (estimates, to be measured):

| Stage | Estimate |
| --- | --- |
| Capture and transfer to the Rust core | 20–50 ms |
| Collecting enough audio for a window | 0.5–1 s step |
| Recognition of a 2–5 s window | 0.2–1 s (model and machine dependent) |
| Matching and tracking | < 10 ms |
| Command through the coordinator to the outputs | ~50–150 ms (existing path) |
| **Total, sound to slide** | **~1–2.5 s** |

That is why acting on the start of the last line matters: a decision made at the end of a piece
would land one or two seconds into the next.

## 9. Running on the listening computer

- **Models are downloaded** when the feature is turned on (V18): about 0.5–1 GB for
  Qwen3-ASR-0.6B quantised or Whisper large-v3-turbo, under 100 MB for a Zipformer.
- **GPU where available:** Metal (and Core ML for Whisper's encoder) on Apple Silicon; Vulkan
  on Windows through whisper.cpp or llama.cpp. CPU-only Windows laptops are the worst case and
  set the minimum model.
- **Never disturb presenting (V17).** Recent releases fixed the slideshow's pace when the window
  is minimised or on another desktop on macOS; recognition must run on its own low-priority
  thread, with a fixed budget, and must be measured beside the slideshow, the broadcast and OBS
  on the same machine.
- **Bindings:** `whisper-rs` (Metal and Vulkan features), the `sherpa-onnx` crate (static
  linking, prebuilt libraries for macOS and Windows), and llama.cpp's C API for a GGUF Qwen3-ASR.
  `transcribe-rs` wraps several engines behind one interface and may save work if more than one
  engine ships.

## 10. Measuring it (V20)

The church server holds exactly the data needed:

- **Recordings** of the broadcast (R1–R11), and **the presentation log** with every piece shown,
  its start and end (R12–R19). Both carry the coordinator's clock offset (R16), so a recording
  lines up with the log.
- An **offline harness** replays a recording through the whole pipeline at faster than real time
  and compares the app's changes with the operator's:

| Measure | Meaning |
| --- | --- |
| Wrong changes per service | A change to a piece the operator did not show next (V13) |
| Missed changes | The operator changed, the app did not within a few seconds |
| Lead or lag | The app's change time minus the operator's, per change (V12) |
| Recovery | Time to follow again after a jump, a language switch, or a person's override |

- **The operator is not ground truth.** Volunteers press early, late and occasionally wrong. Hand-
  mark a few songs (when each line actually starts) to calibrate, and report results per song so
  outliers are visible.
- The same harness tunes thresholds, compares recognisers and checks every change to the tracker
  before it reaches a service. It should be the first thing built.

## 11. Spike to run before planning

- [ ] Collect five to ten services' recordings and logs from the church server; choose songs that
      cover in-order, repeated and bilingual singing with a language switch.
- [ ] Note which input each recording used (main mix or room); if possible record one service
      from a vocal aux as well.
- [ ] Recognisers on those recordings, offline: Qwen3-ASR-0.6B (GGUF), Whisper large-v3-turbo and
      small (whisper.cpp), sherpa-onnx zh-en keyword spotting with the lyrics as keywords. For
      each: word error rate on a few hand-transcribed songs, and **line-identification accuracy**,
      which is what matters.
- [ ] Speed of each on an Apple Silicon Mac and on a Windows laptop without a discrete GPU,
      beside a running slideshow.
- [ ] Silero VAD on singing over a band: does it detect sung passages; what does it do in
      instrumental breaks.
- [ ] Bilingual songs: how each recogniser handles the switch; one pass with both languages
      against two passes.
- [ ] Cantonese: recordings from a Cantonese-singing workspace; line identification with
      Qwen3-ASR, SenseVoice and Whisper forced to Cantonese; matching on characters against
      Jyutping; whether a Cantonese keyword-spotting model exists for sherpa-onnx.
- [ ] One song in the library sung in Mandarin in one workspace and in Cantonese in another, if
      the recordings have one: the same lyrics followed both ways.
- [ ] A first tracker and the transition counts from the logs, in the harness: wrong changes,
      missed changes and lead or lag per service, against the one-second-ahead target (V12).
- [ ] From the logs alone: how often each song ends on its most common last piece, and how often
      songs of a set are sung back to back, and how often they are woven (A, B, A, B), with
      their crossing points. This says how far the move to the next song can
      be predicted before any audio work.
- [ ] Capture from the broadcast's track through an `AudioWorklet` to the Rust core, with the
      broadcast running (no mute, L7).

## 12. Recommendation

1. **Build the measuring harness first** (§10). Every later decision is made on it.
2. **Shape:** recogniser → line matcher → HMM tracker with a learned transition prior → decision
   policy, in the listening desktop's Rust core, with audio taken from the broadcast's capture.
3. **Recogniser:** decided by the spike between Qwen3-ASR-0.6B (best singing accuracy, immature
   local runtime) and Whisper via whisper.cpp (mature, weaker on singing), with sherpa-onnx
   keyword spotting as a cheap constrained second opinion. Expect Qwen3-ASR to win on accuracy
   if its local speed is acceptable.
4. **Learn the transitions from the presentation log** (§7.1), as counts with backoff, used as a
   prior and never as a decision.
5. **Ship Suggest mode first,** then Auto once the harness shows V13 met on the church's own
   services.
6. **Ask churches for a vocal aux** in the setup guide; it improves every option above more than
   any change of model.

## 13. Open decisions, narrowed

| Decision | Discovery's suggestion |
| --- | --- |
| Recogniser | Spike between Qwen3-ASR-0.6B and Whisper; keyword spotting as second opinion |
| Tracker | HMM over lines with block-level jumps and an active-line-set variable for bilingual items |
| Next-slide prediction | Counted from the presentation log with backoff; a prior only (V21) |
| Audio source | The broadcast's capture; recommend a vocal aux from the desk |
| Neighbouring songs | Every song of the presented song's set (the run of songs between non-song items) is part of the tracker; the move to the next song is predicted from the learned last piece, never left until its words are heard (V23) |
| Mode, status and suggestions | Shared by the coordinator to every operator device and remote controller, with new protocol message kinds (V7, V9) |
| Mandarin and Cantonese | A workspace setting for how Chinese is sung, detected when unset; pinyin or Jyutping matching to suit (V22) |
| Where it runs | The listening desktop's Rust core; models downloaded on first use |
| Order of delivery | Harness → Suggest mode → Auto mode |

## Sources

- [Qwen3-ASR Technical Report (arXiv 2601.21337)](https://arxiv.org/html/2601.21337v1)
- [Qwen3-ASR repository](https://github.com/QwenLM/Qwen3-ASR)
- [Qwen3-ASR & Qwen3-ForcedAligner announcement — Alibaba Cloud](https://www.alibabacloud.com/blog/602843)
- [ggml-org/Qwen3-ASR-0.6B-GGUF](https://huggingface.co/ggml-org/Qwen3-ASR-0.6B-GGUF)
- [Qwen3-ASR for llama.cpp — community patch](https://github.com/shershah1024/qwen3-asr-llamacpp)
- [Qwen3-ASR-GGUF (ONNX encoder + llama.cpp decoder)](https://github.com/HaujetZhao/Qwen3-ASR-GGUF)
- [Qwen3-ASR-0.6B ONNX CPU build](https://huggingface.co/Daumee/Qwen3-ASR-0.6B-ONNX-CPU)
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
- [whisper-rs](https://docs.rs/crate/whisper-rs/latest)
- [sherpa-onnx documentation](https://k2-fsa.github.io/sherpa/onnx/)
- [sherpa-onnx keyword spotting](https://k2-fsa.github.io/sherpa/onnx/kws/index.html)
- [sherpa-onnx hotwords](https://csukuangfj.github.io/sherpa/onnx/hotwords/index.html)
- [sherpa-onnx Rust crate](https://docs.rs/sherpa-onnx)
- [transcribe-rs](https://docs.rs/crate/transcribe-rs)
- [Apple Speech framework](https://developer.apple.com/documentation/speech)
- [SpeechAnalyzer AnalysisContext — Apple developer forums](https://developer.apple.com/forums/thread/811083)
- [A Real-Time Lyrics Alignment System Using Chroma and Phonetic Features (ICASSP 2024)](https://arxiv.org/html/2401.09200)
- [On-Line Audio-to-Lyrics Alignment Based on a Reference Performance (ISMIR 2021)](https://archives.ismir.net/ismir2021/paper/000007.pdf)
- [Automatic Lyrics Display System for Live Music Performances (IEEE SPM 2016)](https://sigport.org/sites/default/files/docs/VombatkereLi_AutomaticLyricsDisplaySystem_IEEESPM16_Final_0.pdf)
- [Handling Structural Mismatches in Real-time Opera Tracking (Brazier & Widmer)](https://arxiv.org/pdf/2105.08531)
- [JumpDTW: Handling repeats and jumps (Fremerey, Müller & Clausen, ISMIR 2010)](https://www.audiolabs-erlangen.com/content/05_fau/professor/00_mueller/03_publications/2010_FremereyMuellerClausen_PartialSync_ISMIR.pdf)
- [Simple Tempo Models for Real-Time Music Tracking (Arzt & Widmer)](https://www.cp.jku.at/research/papers/Arzt_Widmer_SMC_2010.pdf)
- [Hierarchical DTW for repeats and jumps (arXiv 2007.14580)](https://arxiv.org/pdf/2007.14580.pdf)
- [Lyrics Transcription for Humans: A Readability-Aware Benchmark (Jam-ALT)](https://arxiv.org/pdf/2408.06370)
- [Exploiting Music Source Separation for Lyrics Transcription with Whisper (2025)](https://arxiv.org/pdf/2506.15514)
- [Automatic Lyrics Transcription for Greek Songs (thesis)](https://pergamos.lib.uoa.gr/uoa/dl/object/5310603/file.pdf)
- [Real-time accompaniment separation with MMDenseNet](https://arxiv.org/html/2407.00657v1)
- [Real-time low-latency source separation with Hybrid Spectrogram-TasNet](https://ar5iv.labs.arxiv.org/html/2402.17701)
- [AI Display church presentation software](https://github.com/rameezimdad/AI-Display-Church-Presentation-Software)
- [Vifug](https://www.vifug.com/)
- [Worship Light](https://www.worshiplight.com/)
- [WayPresenter](https://waypresenter.com/)
- [autocue voice-tracked teleprompter](https://github.com/EdNutting/autocue)
- [Voice-tracked teleprompter using on-device ASR in the browser](https://hnshowcase.com/post/47385615/voice-tracked-teleprompter-using-on-device-asr-in-the-browse)
