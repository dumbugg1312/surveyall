# SurveyAll pedagogy roadmap — ten features, argued with

> **STATUS: all ten features below are BUILT and live-verified**
> (2026-08-16, same session as this document). See the implementation
> appendix at the end for the v1 scope decisions, one schema migration
> that must be run against production before deploying, and what each
> live verification proved.

Written 2026-08-16 after a three-track research pass: (1) first-year
composition pedagogy and its evidence base, (2) the classroom-response-system
research literature, (3) how writing/humanities instructors actually use
polling tools and where they hit walls. Sources are linked throughout; every
citation was verified by web search during the research pass — none are
invented. Evidence quality is flagged honestly (writing studies has strong
consensus and few RCTs).

**The one-sentence thesis of the whole document:** the meta-analytic finding
(Hunsu et al. 2016, 111 effect sizes) is that response *devices* barely move
learning — the pedagogy wrapped around them does. So these ten features
scaffold specific evidence-backed teaching moves rather than adding chart
types. SurveyAll's two structural advantages — real anonymity and the
re-ask delta — turn out to sit directly on top of the two best-evidenced
practices in the literature (participation equity and Peer Instruction).
Most of what follows is leaning into that luck on purpose.

Each feature below has: the classroom moment it serves (in ENC1101 terms),
the evidence, how it rides the existing engine, a build sketch, and — per
the brief — **the argument against it**, and what that argument changed.

---

## 1. The Discussion Engine (Peer Instruction, made first-class)

**Classroom moment.** You ask a best-answer question about a passage ("Which
of these four is the strongest thesis for this prompt?"). 48% pick B. Instead
of telling them, you hit one key: phones lock, a 3-minute "convince your
neighbor" timer takes the projector, then the question re-opens and the room
watches its own mind change — "31% of the room changed their answer."

**What it is.** A guided flow built from parts that already exist:
- **Think → Pair → Share phases**: poll open with results hidden → timed
  peer-discussion interstitial (big countdown, prompt stays up) → automatic
  re-ask → reveal with the delta animation.
- **Instructor decision hint** (instructor screen only, never projected):
  after round 1, a quiet color band — under ~35% correct: "reteach with a
  different example"; 35–70%: "discuss and re-ask" (the sweet spot); over
  70%: "confirm and move on." This is Mazur's own decision rule.
- **Round-1 results hidden from students until after the revote** — the
  anti-bandwagon default (Vickrey et al. 2015; Perez et al.): showing the
  first histogram biases the revote toward the majority.
- **Three question modes**: *correct-answer* (quiz), *best-answer* (several
  defensible, one most defensible — the humanities PI mode, per Bruff and
  Butchart et al.'s philosophy PI work), *opinion* (no key; the distribution
  is the discussion object). Reveal behavior and the delta copy adapt.
- **Warm-call volunteer pool**: after answering, a student can tap "I'd say
  more about mine out loud." The instructor sees a count, not names —
  anonymity converts into voiced discussion instead of replacing it.

**Evidence.** The strongest in this entire document. Crouch & Mazur 2001
(ten years of data); Smith et al. 2009 in *Science* — revote gains transfer
to new isomorphic questions answered alone, so it's learning, not copying;
Smith et al. 2011 — discussion *plus* instructor explanation beats either;
Butchart et al. 2009 — it works in philosophy/critical thinking with
best-answer questions. The 35–70% band is from Mazur's published practice.

**Build sketch.** Mostly sequencing: a `flow` state machine in
present-page.js (phases drive existing hide/close/re-ask/timer primitives);
the interstitial is a new stage overlay; question `mode` is one enum in
question config + reveal logic in charts.js; the volunteer count rides the
existing response payload (a boolean, no identity). Medium effort, low risk.

**The argument against.** "The tool is bossing the teacher around. Real
instructors improvise; a wizard that walks you through phases is exactly the
kind of edtech that gets used twice." — Largely right, which is why this is
**hints, not rails**: every phase is also reachable by the existing single
keys; the decision band is a dismissible instructor-only whisper; the flow
is one optional button ("Run as discussion"), not the default question
experience. The version that survived the argument is 80% information
design, 20% automation. Also cut from the original idea: auto-advancing
phases on timer expiry (instructor always fires the transition).

---

## 2. The Confidence Rider

**Classroom moment.** Reading-check on *The Metamorphosis*. 71% answer
correctly — looks fine, move on? The confidence split says: half of those
right answers were guesses, and the wrong answers are *confident*. That's
not a move-on situation, and nothing else on the market would have told you.

**What it is.** An optional per-question toggle: after answering, students
tap "How sure are you?" (guessing / fairly sure / certain). The projector
gains a second read-out — the four-quadrant view: confident-right,
confident-wrong (the misconception signal), unsure-right, unsure-wrong. On
re-ask, the delta view also shows the confidence migration: did discussion
convert unsure-right into certain-right?

**Evidence.** Gardner-Medwin's certainty-based marking (UCL) — used
*diagnostically*; a 2019 BMC Medical Education trial found CBM improved
course experience but not exam scores, so the honest claim is diagnosis and
metacognition, not achievement. iClicker ships confidence ratings; Mazur's
own PI practice collects confidence with each vote. Novice writers are
systematically miscalibrated (Kruger & Dunning's grammar studies —
bottom-quartile performers estimating themselves at the 62nd percentile), and
calibration exercises reduce it. Anonymity is what makes the confession
honest — Stowell & Nelson 2007 showed public response formats produce
conformity, private ones honesty.

**Build sketch.** One optional field on the response payload (no identity
implications; it's per-response like everything else), a second small chart
strip under the bars, delta integration. Small-medium effort.

**The argument against.** "Two taps instead of one, on every question, on a
phone, forever — response friction is death for participation rates. And
won't students just always tap 'fairly sure'?" — The friction point is
real and changed the design: confidence is **off by default**, enabled per
question (you use it on the 3–4 conceptual checks, not the warm-up cloud),
and it's a second tap on the same screen, not a second screen. The
"everyone taps the middle" worry is contradicted by the CBM literature
(distributions spread when there are no grade stakes), and under SurveyAll's
anonymity there is no reason to posture. Kept, scoped down.

---

## 3. The Passage Heatmap (and its Toulmin mode)

**Classroom moment #1 (lit analysis).** You project a paragraph of *Animal
Farm*. Prompt: "Tap the sentence where Orwell's irony is doing the most
work." Thirty anonymous taps later the paragraph is a heat map, and the
class argues about why sentence 4 and sentence 7 split the room.

**Classroom moment #2 (Toulmin unit).** Same machinery, label mode: a short
argument on screen; each student tags the highlighted segments as **claim /
evidence / warrant / rebuttal**. The projector shows the disagreement per
segment. The fact that a third of the room tagged the warrant as evidence
*is the lesson* — warrants are the canonical FYC muddiest point.

**What it is.** A new question type: the deck holds a passage (plain text —
it fits the text deck format natively); phones render it sentence-by-sentence
tappable; the projector renders aggregate heat (opacity per sentence, spring
animated as taps land, like everything else). Two modes: *highlight* (tap
the sentence(s) that answer the prompt) and *classify* (each student assigns
labels from a fixed set to marked segments).

**Evidence.** This is the feature the practitioner research screams for:
social-annotation "confusion heatmaps" are established practice
(Hypothesis; BJET research on Perusall finds the value depends on the
instructor using the annotations in class — i.e., the live loop SurveyAll
owns); Pear Deck gates passage-highlighting behind its premium tier; live
Toulmin identification simply does not exist as a tool — it's practiced on
worksheets everywhere (Lumen, writing-center guides). Close reading is the
discipline's core method, and text is the one medium no polling tool treats
as a first-class interactive object.

**Build sketch.** The largest new build in this list: sentence segmentation
(rule-based on punctuation, with an editor preview to fix splits), a phone
control (tap targets = sentences, generous hit areas), a projector renderer
(the passage set in the display face with per-sentence heat + counts),
aggregation in logic.js (counts per segment per label — tests belong here),
classify-mode label palette. No new dependencies needed. Large effort —
and the flagship.

**The argument against.** "This is two features wearing a trenchcoat, and
the phone ergonomics will kill it: a 200-word passage on a 375px screen,
students fat-fingering sentence 3 when they meant 4. And auto-splitting
sentences will mangle dialogue and citations." — All three worries shaped
the spec: (a) passages are **capped short** (the editor warns past ~120
words; close reading is short-passage work anyway); (b) phones get a
tap-to-select-then-confirm interaction with the selected sentence enlarged,
not naked taps; (c) segmentation is previewed and hand-adjustable in the
editor (a `|` in the deck text splits; the parser only suggests). The
"two features" charge is answered by the build: classify mode *is*
highlight mode plus a label palette — one renderer, one aggregate shape.
The original version of this list had "Toulmin tagger" as its own feature;
it was merged here, and that merge is the single best thing the adversarial
pass did.

---

## 4. The Writing Showdown (anonymous sample vote)

**Classroom moment.** Peer-review day opener. Three thesis statements from
last night's drafts (used with their writers' consent, never labeled) sit
side by side on the projector. "Which would you rather read a paper about —
and one line: why?" Vote, reveal, then the rationales scroll: "B commits to
an argument, A just announces a topic."

**What it is.** A question type holding 2–3 short text samples rendered as
typographic cards; students vote and optionally give a one-line rationale.
Reveal shows the vote split plus a curated stream of rationales (instructor
holds/approves them — the existing Q&A moderation pattern). A "collect"
helper lets the instructor pull candidate samples from any previous
open-ended question's responses in two clicks.

**Evidence.** FYW instructors already do this by hand everywhere: UConn's
first-year writing pages describe projecting anonymous student intros and
paragraph pairs; Nearpod's writing blog documents thesis-statement voting as
a signature activity. Lundstrom & Baker 2009: *giving* evaluative feedback
improves the giver's writing more than receiving it — the vote+rationale IS
the training. Brammer & Rees 2007: peer review fails on trust and
infrequency; a two-minute live version every class normalizes evaluation.

**Build sketch.** Question config holds the samples; phone control = cards +
vote + one text line; projector = side-by-side cards with vote bars and the
rationale stream; "collect from previous responses" is a small editor
affordance. Medium effort.

**The argument against.** "Isn't this just multiple choice with long
options plus an open-ended stapled on? And the consent/identity problem:
'anonymous' samples in a 25-person class are sometimes recognizable — the
writer is sitting right there watching the room pick their thesis last." —
The first objection is technically true and pedagogically false: MC with
long options renders as unreadable bar labels; the entire value is the
typography (samples set as quotations at reading size) and the rationale
capture. The identity objection is the serious one and produced two hard
rules in the spec: the tool **never** auto-sources samples without the
instructor explicitly picking them, and the pick UI carries a standing
reminder to use volunteered work or lightly rewrite ("used with permission"
is an instructor-culture problem the tool should nudge, not pretend to
solve). Also considered and rejected: showing which sample "won" with
celebratory animation — a quiz-reveal treatment would make it a contest
between classmates; the reveal is deliberately quiet.

---

## 5. Rubric Calibration (norming mode)

**Classroom moment.** Before the first peer-review workshop: everyone rates
the same sample intro on the actual rubric's dimensions (thesis clarity,
evidence, organization — 1–5 each). Reveal: the class distribution per
dimension, with the instructor's own rating dropped on top as a marker.
"You gave this thesis a 4.1. I gave it a 2. Let's talk about what a 2
looks like." Re-rate a second sample; watch the spread tighten.

**What it is.** A mode on the existing scales question: the instructor
pre-rates (or live-rates) the sample; reveal overlays the anchor rating on
each distribution; a second round shows convergence (the delta engine
again). Self-assessment variant: students rate *their own draft* on the
rubric before submitting; next class you show class-self-rating vs
peer/instructor rating — the calibration gap, anonymously aggregated.

**Evidence.** Calibrated Peer Review (UCLA lineage): rating
instructor-calibrated samples before reviewing peers measurably tightens
reviewer agreement (deviation shrinks from calibration to review phase).
Black & Wiliam 1998: training students in self-assessment against
understood criteria is a *precondition* of formative assessment's 0.4–0.7
effect sizes. Novice miscalibration (Kruger & Dunning) is the disease;
this is the exercise the literature prescribes for it.

**Build sketch.** Small: scales question + an `anchor` config field + an
anchor marker in the scales renderer (a labeled tick — the marker/halo
machinery exists) + the existing re-ask delta. The self-assessment variant
needs nothing new at all — it's a use pattern to document.

**The argument against.** "Niche mode on a niche question type; peer-review
day is twice a semester. Does it earn a slot over, say, 'Other—please
specify'?" — The frequency argument underestimates how central peer review
is to FYC (every major essay has workshop days) and how bad unrated peer
review demonstrably is (Brammer & Rees). But the argument did win a scope
concession: this ships as **a config field + renderer overlay**, not a new
question type or a wizard. If it were more than ~150 lines it would not
deserve the slot.

---

## 6. The Loop (exit tickets that come back)

**Classroom moment.** Last three minutes: one-tap exit ticket — a concept
check, "muddiest point" open-ended, and a 1–5 "how solid do you feel"
scale. Next class opens with the *entrance view*: "Tuesday, 40% of you said
warrants were the muddy part — here's the 90-second version again," and the
muddiest-point cloud from Tuesday sits next to today's.

**What it is.** Three connected pieces: (a) a one-tap **end-of-class
template** (the Angelo & Cross wording, pre-built); (b) an **entrance
replay** — one click puts the previous session's exit results on the
projector as the opener; (c) a **semester strip**: the same recurring
question tracked across sessions (muddiest-point themes; the TFT key-terms
question — "define *warrant* in your own words" in week 2 vs week 10).

**Evidence.** The formative-assessment tradition (Black & Wiliam) is clear
that eliciting evidence is worthless unless the teacher *visibly acts on
it* — the loop-closure is where the value lives, and it's exactly the part
every polling tool omits (results die in the dashboard). Minute
paper/muddiest point: Chizmar & Ostrosky 1998 (n=256, positive gains);
Bangert-Drowns et al. 2004 meta-analysis — short, frequent, metacognitive
writing beats long and rare. Yancey/Robertson/Taczak's Teaching for
Transfer: repeated explicit engagement with key terms plus reflection is
what produced transfer in their comparative study — the semester strip is
that, made visible.

**Build sketch.** The template is trivial (deck-format snippet). The replay
needs "show results from a previous session" on the projector — a session
picker + the existing renderers pointed at archived rows (all data is
already kept). The strip needs question identity across sessions: match by
prompt (the plain-text deck format has no stable IDs — spec: normalized
prompt hash, with a manual "same question as…" link for edited prompts).
Medium effort, mostly plumbing that also unlocks feature 7.

**The argument against.** "Templates are not features, and semester
tracking is a dashboard — dashboards are where engagement features go to
die. Will anyone look at the strip after week 3?" — Half-conceded: the
*analytics dashboard* version of this idea was cut. What survived is
projector-first: the entrance replay is a **classroom move** (30 seconds,
in front of everyone, closing the loop publicly), not a private chart. The
strip exists only as a projected artifact for weeks 10/15 ("look at your
week-2 definitions") — a reveal, not a report. If it can't be shown to the
room, it didn't make the spec.

---

## 7. Time-Travel Compare (delta across sessions and sections)

**Classroom moment.** Section 1 met at 9am, Section 2 meets at 2pm — same
deck, and you can (privately) see whether 2pm's misconception profile
differs before you get there. Or the Hunter College move: the same word
cloud from week 1 ("what is literary theory?") animated against week 15 —
the semester's growth as one projected image.

**What it is.** The re-ask delta engine, generalized: the compare view can
take *any previous asking* of the same question (same session other round —
today; other session, other section, other semester — new) as its
"before." For clouds: a before/after cloud morph. For everything else: the
existing ghost-bar delta.

**Evidence.** Mentimeter's feature board shows the demand (segmentation and
cross-session comparison requests; the "ask question again or lose your
results" workaround is documented in their help pages). The Hunter College
semester-bookend cloud is a documented practice running on manual
screenshots today. Pedagogically this is pre/post assessment — the most
basic evidence-of-learning move there is — and TFT's reflection engine.

**Build sketch.** Rides feature 6's question-identity plumbing. The data
layer is trivial (rounds and sessions are already distinct rows); the work
is the picker UI ("compare with: [session list]") and a cloud-morph
renderer (the cloud already handles retargeting; feed it the old counts
then the new). Medium effort once 6 lands.

**The argument against.** "Feature 6 and 7 are the same feature and you're
padding the list." — They share plumbing, deliberately, but the classroom
moves are different (closing yesterday's loop vs. measuring change across
weeks/sections), and the honest structure is to build 6 first and get 7 at
~40% additional cost. The padding charge is accepted as a *sequencing*
note: if the list needed cutting to eight, 7 merges into 6. It stays
separate here because section-vs-section comparison has an instructor value
(prep intelligence) that "The Loop" doesn't cover.

---

## 8. Cloud Curation (merge and hold)

**Classroom moment.** The word cloud fills with "arguing," "argument,"
"argue" as three separate blobs; the actual consensus is invisible. You tap
two words on the presenter view, they merge (counts combined), the cloud
reflows — now the room can see it agrees. For spicier prompts, the cloud
runs in **hold mode**: responses queue on your screen, one tap approves,
the projector reveals in a satisfying cascade.

**What it is.** Presenter-side aggregate editing: tap-to-merge word pairs
(a merge map stored on the round, reversible), tap-to-hide a word; plus
hold-for-review as a per-question setting extending the exact moderation
pattern the Q&A drawer already uses — moderation of *content*, never of
people, so the anonymity architecture is untouched.

**Evidence.** The single most-requested pedagogical feature on Mentimeter's
public board (merge word-cloud responses — 121 votes, open for years);
Slido community threads asking for cloud/open-text pre-moderation have gone
unanswered across multiple years; the University of York publishes a whole
manual "safe anonymity" choreography (hide results while collecting, review
before revealing) that this automates. It also de-risks anonymity itself —
the known failure mode of anonymous tools in big rooms is the one juvenile
answer on the projector, and hold-mode deletes that failure mode on the
days you need it.

**Build sketch.** Merge map in the aggregate step (logic.js — testable),
presenter tap interactions on the cloud, hold queue reusing the Q&A drawer
UI pattern. Small-medium effort, disproportionate goodwill.

**The argument against.** "Curation is manipulation — you're letting the
instructor edit the room's voice while claiming to show 'what the room
said.' And hold-mode kills the liveness that makes clouds fun." — The
manipulation critique deserves teeth, and got them: merges are **visibly
marked on the projector** (a small "3 words merged" chip; tap shows what),
and hiding a word leaves an honest "1 hidden" count. Hold-mode is
per-question, not global, precisely so liveness stays the default and
review is a deliberate choice for sensitive prompts. The alternative —
auto-stemming/lemmatizing to merge "argue/arguing" algorithmically — was
considered and rejected: silent algorithmic merging is *more* opaque than
visible instructor merging, and it's a dependency (a stemmer) in a
zero-dependency app.

---

## 9. The Activity Library (pedagogy templates as deck snippets)

**Classroom moment.** Ten minutes before class you remember you want a
closer. Two clicks: "Exit Ticket (Minute Paper)" appends three pre-worded
questions to the deck. Before the research unit: "SIFT Source Check" adds
the lateral-reading round (source on screen → credible/not + "what did you
find?" → 90-second search timer → re-ask). Templates are named for the
pedagogy and cite their source in a one-line footnote the instructor sees.

**What it is.** A small curated library (8–12 entries, not a marketplace)
of one-tap deck snippets built on the plain-text deck format: Minute Paper
/ Muddiest Point (Angelo & Cross's canonical wording), Exit+Entrance pair,
SIFT source check (Wineburg & McGrew's lateral reading, poll-shaped),
They-Say-I-Say response stems (the open-ended box pre-seeded with "While
___ argues ___, I contend ___ because ___"), Four Corners opener,
Peer-Instruction concept check (pre-configured as feature 1's flow),
Reading temperature check. Each template is also a teaching artifact: its
description says *why* it works and links the source.

**Evidence.** Kay & LeSage 2009: instructor time-cost is the #1 documented
adoption barrier for response systems — the evidence-backed fix is removing
authoring friction for the practices that need routine (Angelo & Cross are
explicit that CATs work through *frequency*; Bangert-Drowns: short and
frequent beats long and rare). The SIFT template packages Wineburg &
McGrew's fact-checker findings and the Project CORA lesson that already
exists as a worksheet. Template stems-as-input-constraints is Graff &
Birkenstein's *They Say / I Say* move, transplanted.

**Build sketch.** Smallest build on this list: a JSON/deck-text template
registry + an "insert template" picker in the editor + a search timer
variant. It's content engineering more than software — which is exactly why
it's high-value: the content encodes the research.

**The argument against.** "Templates are the definition of bloat — a
dropdown of things nobody opens twice. And canned questions rot: your
students learn the wording." — The rot critique is fair and shaped it:
templates are *snippets that become editable questions*, not locked
activities, and the library is deliberately tiny and curated (an eleventh
template must evict one). The "nobody opens twice" critique is answered by
the evidence itself: the practices that need templating (exit tickets) are
precisely the ones whose value comes from *daily* use — friction is the
whole reason they lapse. If usage data ever showed the library unopened,
the correct response is deletion, and the spec says so.

---

## 10. The Opinion Spectrum (positions that move)

**Classroom moment.** Argument unit, day one: "School uniforms are a
justifiable infringement on expression — where do you stand?" Every phone
gets a slider; the projector fills with anonymous dots along the axis, a
living distribution. After the mini-debate: re-ask. The dots *migrate* —
and the class watches persuasion happen as motion. "What argument moved
you?" is the writing prompt that follows.

**What it is.** A question type: one statement, a continuous
agree↔disagree axis (or any two poles — "Gregor is victim ↔ Gregor is
complicit"), rendered as anonymous jittered dots (position-only, no
labels, springs on entry). Re-ask animates each dot drifting to its new
position — the room's mind changing as choreography. A four-corners
projector variant bins the axis for the classic protocol.

**Evidence.** Four Corners / opinion-spectrum protocols are standard
pre-writing scaffolds for persuasive essays (Facing History; TAMU writing
center); the migration re-ask is Peer Instruction's revote applied to
positions rather than answers (same Smith et al. logic — commitment before
discussion, movement after); Teichman's humanities-seminar polling shows
opinion distributions are what discussion-leaders reach for. Scales exist
in SurveyAll but aggregate to an average — the *distribution as
individuals* is what makes it a debate object ("three of you are way out
on the left alone — someone defend that flank").

**Build sketch.** Phone control = a slider (trivial); projector = a dot
field (springs on x-position; the leaderboard's name-keyed spring pattern,
keyed by pseudonym, renders anonymous dots); re-ask migration falls out of
spring retargeting; four-corners is a render mode. Medium effort, high
theater.

**The argument against.** "Per-student dots on a projector — doesn't that
violate the 'no per-student anything' invariant? And is this just the
scales question with confetti?" — The invariant question is the important
one: the dots are unlabeled, jittered on the y-axis, and never enumerable
back to a person (same anonymity class as the existing pin-free design;
the pseudonym key exists only so the *same* dot moves on re-ask, which is
the entire point, and is never displayed). On "just scales": scales asks
students to rate statements on a number line and reports averages —
built for instruments, not arguments. The spectrum is one statement, no
number, no average headline (an average opinion is a meaningless artifact
— the *shape* is the content). That distinction — distribution as object
vs number as summary — is what earns the slot. Conceded to the critique:
no leaderboard-style anything, no "most moved" callouts of individual dots.

---

## The cut list (ideas argued out of the ten)

- **Discussion-leader mode** (students author poll questions, instructor
  promotes — Teichman's model): charming, real evidence, but it adds a
  student-submission surface with moderation burden for a freshman course
  where the instructor drives; the Q&A drawer already carries student
  questions upward. Revisit if Q&A usage shows appetite.
- **Random spotlight / group random call**: evidence-backed in STEM
  (Knight et al.), but calling on a pseudonym on the projector invites the
  room to watch who flinches — it cuts against the anonymity contract that
  makes everything else work. Rejected on principle, not effort.
- **Identified process portfolios / in-class writing snapshots**: the
  MLA-CCCC AI-era logic is real, but per-student identified writing is
  structurally what SurveyAll promised never to hold. The FERPA-safe
  fraction of the value (anonymous in-class freewrites, process-reflection
  prompts) is already covered by open-ended questions and the Activity
  Library. Rejected as architecture, not as pedagogy.
- **Free-form live chat backchannel**: the research (Junco; Baron et al.)
  supports *structured, academically-focused* backchannels — which is the
  existing moderated Q&A. Unstructured chat shows no benefit and real
  distraction cost. Nothing to build.
- **Leaderboard expansion / more gamification**: James 2006 — grading
  pressure corrupts the honest histograms that make PI work; Black &
  Wiliam — grades wash out formative feedback. The existing pseudonymous
  quiz stays as-is; the one change worth making is a config default
  (score by correctness, not speed — the timer is Kahoot's documented
  anxiety driver), which lands in Small Wins.
- **AI-detection / integrity tooling of any kind**: the MLA-CCCC task
  force position and the product's soul both say no.

## Small wins (worth doing, not worth slots)

"Other — please specify" option on multiple choice (61 votes on
Mentimeter's board) · correctness-not-speed quiz scoring default + optional
generous/no timer · word-cloud multi-word entries surfaced better in the
hint copy · a "duplicate last question" key during a live session
(improvisation support, feeds the Kay & LeSage friction finding) ·
exit-ticket keyboard shortcut on the presenter.

## Suggested build order

1. **Discussion Engine** (highest evidence, mostly sequencing existing
   parts) — with the question-mode enum it needs.
2. **Cloud Curation** (small, huge goodwill, de-risks anonymity).
3. **Confidence Rider** (small, unique diagnostic).
4. **Activity Library** (small, content-led; ships the exit-ticket habit).
5. **The Loop** (needs question-identity plumbing) → **Time-Travel
   Compare** (rides it).
6. **Writing Showdown** and **Rubric Calibration** (peer-review pair;
   build before the first workshop week of a semester).
7. **Opinion Spectrum** (self-contained, high theater).
8. **Passage Heatmap** last — the flagship and the largest build; worth a
   dedicated session with the full verification rig.

Every feature above respects the standing invariants: vanilla JS with zero
dependencies, no runtime external requests, anonymity as architecture
(pseudonyms only, moderation of content not people), quantities on
critically damped springs, and `node tests/run-tests.mjs` green — new
aggregation logic (heatmap segments, merge maps, confidence splits,
spectrum positions) belongs in logic.js where the test suite can hold it.

---

## Implementation appendix (added after the build, 2026-08-16)

**⚠️ One deployment step before this works in production:** the D1
`questions` table has a CHECK constraint on `type` that predates the new
question types. Run the migration against the remote database once:

    npx wrangler d1 execute DB --remote --file=worker/migrations/0002-new-question-types.sql

(Already applied to the local dev database. Without it, creating a
spectrum / showdown / heatmap question 500s at the DB layer.)

**Where things live.** New/changed: `app/logic.js` (validation,
aggregation, riders, confidence quadrant, cloud merges, promptKey,
splitPassage — all under test; suite is now 125), `app/deck-format.js`
(text syntax for the three new types + settings, round-trip tested),
`app/charts.js` (renderSpectrum / renderShowdown / renderHeatmap,
confidence strip, best-answer reveal, calibration anchors, delta labels),
`app/join-page.js` (three phone controls, confidence row, hand-raise),
`app/present-page.js` (discussion engine, PI hint, hold strip, cloud
curation, compare picker, chart teardown fix), `app/templates.js` (the
library), `app/edit-page.js` + `edit.html` (type editors, anchors,
passage editor with split preview, template picker), `worker/index.js`
(`sanitiseQuestion` strips `anchors`), `worker/schema.sql` + the
migration, styles in `charts.css` / `join.css` / `present.css` /
`app.css`, and five new visual-check panels (20 views, audit green).

**v1 scope decisions** (deliberate, revisit on classroom feedback):
- *Hold-for-review* covers word clouds and open-ended; approvals are
  per-browser (localStorage) — reloading the presenter re-queues unshown
  answers, which fails safe. Showdown rationales are gated behind the
  reveal instead.
- *The pair phase* shows on the projector; phones show "voting is
  closed" during discussion rather than a bespoke discuss screen (no
  session field for phase; not worth a schema change yet).
- *The decision hint* lives in the transient ⋯ tray — on a single
  projected screen a truly instructor-only surface doesn't exist, so it
  is glanceable rather than secret.
- *Entrance replay* is the compare picker pointed at a previous session
  (the ghost-delta IS the replay); a dedicated full-frame replay mode
  wasn't needed.
- *Cross-deck compare* matches questions by normalized prompt
  (`promptKey`); an edited prompt breaks the link, visibly.

**Live verifications run** (real Worker + D1 + WebSockets + phone
payloads, CDP-driven): the full three-beat discussion flow (hint read
"50% · discuss & re-ask"; round-1 histogram never projected; delta
revealed "38% changed their answer"); hand-raise count on the footer;
confidence strip pre-reveal (counts only) and post-reveal (quadrant with
"certain & wrong" alarmed); cloud merge/hide with the honesty chip and
persisted config; hold queue (approve one, approve all); spectrum
round-2 dot migration; showdown reveal with rationale stream; classify
heatmap with legend and per-segment counts; anchor reveal on scales;
cross-session compare ("9am section" vs live session); template insert
(SIFT, 6 → 8 questions). One latent pre-existing bug found and fixed
along the way: any round change blanked the next results render because
the chart's keyed state outlived its DOM (`resetChart()` in
present-page.js).
