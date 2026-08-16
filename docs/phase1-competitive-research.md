# Phase 1 — Competitive Research: Mentimeter, Slido, Poll Everywhere

**Project:** SurveyAll (working name) — free, FERPA-safe classroom response system
**Date:** August 14, 2026 · **Method:** Web research against live official pricing/help pages plus recent (2023–2026) reviews and forums. Every claim carries a source link. Items that could not be verified against a primary source are flagged `[unverified]`.

---

## 0. Executive summary

**The premise of this project checks out.** As of August 2026, none of the three incumbents' free tiers survives one normal college class, and what gets paywalled is precisely what an instructor needs — capacity and data export:

- **Mentimeter Free:** 50 participants **per month, total, across all presentations** — one 60-student session exceeds the monthly allowance ([plans](https://www.mentimeter.com/plans)). No file export of results.
- **Slido Free:** 100 participants per event, but only **3 polls per event** ([pricing](https://www.slido.com/pricing)). No export.
- **Poll Everywhere Free:** **40 responses per poll**, and responses beyond the cap are silently not accepted ([official FAQ](https://www.polleverywhere.com/product/faq)). No CSV.
- Cheapest workable paid plans (the honest buy-instead-of-build benchmarks): **Slido Engage EDU $84/yr** (500 participants), **Mentimeter Education Basic ~$108/yr**, **Poll Everywhere Lecture $108/yr**.

**Table stakes a replacement must not regress** (§5.4): zero-install QR/browser join, dead-simple authoring, anonymity, instant animated results on the projector.

**Where all three fail users** (§5): data held hostage behind paywalls; deck reuse across semesters/sections; PowerPoint add-in fragility; the anonymity-vs-structure tension (trolling vs. shy-student participation); latecomer join friction; accessibility; zero network resilience.

**Proposals** (§6): five improvements grounded in those gaps — one-tap re-ask with an animated delta view; anonymous-but-stable session pseudonyms (FERPA-safe leaderboards); plain-text portable decks; a permanent corner QR with zero-step late join; and never-hostage data (free CSV + permanent session archive).

---

## 1. Mentimeter — complete feature inventory

### 1.1 Pricing tiers and participant limits

| Plan | Price (USD, per presenter) | Participant limit |
|---|---|---|
| Free | $0 | **50 participants/month** (total across all presentations) |
| Basic | $11.99/mo billed yearly (~$144/yr); only plan with a monthly option | Unlimited |
| Pro | $24.99/mo billed yearly (~$300/yr); no monthly billing | Unlimited |
| Enterprise | Custom contract | Unlimited |
| **Education Basic** | $8.99/mo billed yearly (~$108/yr) | Unlimited |
| **Education Pro** | $14.99/mo billed yearly (~$180/yr) | Unlimited |
| Conference (one-off) | $350 (Small) / $750 (Large) for 30 days | Unlimited |

Sources: [mentimeter.com/plans](https://www.mentimeter.com/plans), [mentimeter.com/pricing](https://www.mentimeter.com/pricing), [plans/education](https://www.mentimeter.com/plans/education), [plans/conference](https://www.mentimeter.com/plans/conference)

How the free limit actually works (matters for us — this is the wall instructors hit):

- The 50/month cap is a **monthly total across all presentations**, resetting on the account-anniversary date. Exceed it and you cannot set further presentations live until reset ([plans](https://www.mentimeter.com/plans), [help: free account](https://help.mentimeter.com/en/articles/1258367-what-is-included-in-the-free-account)).
- Within one live session the cap is soft: participants are never kicked; the presenter can continue that presentation for 8 hours ([help: free account](https://help.mentimeter.com/en/articles/1258367-what-is-included-in-the-free-account)).
- Free tier now includes **unlimited presentations and unlimited question/quiz slides** (the old "2 questions per presentation" cap is gone — many older reviews still cite it). Free gets 23 of the slide types; Quick Form and embed slides are Pro. Hard cap of 200 slides per presentation on all plans ([help: free account](https://help.mentimeter.com/en/articles/1258367-what-is-included-in-the-free-account), [help: which plan](https://help.mentimeter.com/en/articles/5938993-which-plan-is-right-for-you)).
- Free-tier caveat worth knowing: Mentimeter reserves the right to anonymize free users' questions and reuse them as inspiration content ([help: free account](https://help.mentimeter.com/en/articles/1258367-what-is-included-in-the-free-account)).
- Paid plans: up to 10,000 participants per presentation (2,000 for quizzes) ([help: which plan](https://help.mentimeter.com/en/articles/5938993-which-plan-is-right-for-you)).

### 1.2 Tier-gating master table

| Feature | Free | Basic | Pro | Enterprise |
|---|---|---|---|---|
| Participants/month | 50 | Unlimited | Unlimited | Unlimited |
| Slide types | 23 | All | All (+ Quick Form, embeds) | All |
| Menti AI (builder, grouping, takeaways) | ✓ | ✓ | ✓ | ✓ (admin opt-out) |
| Audience Q&A | ✓ | ✓ | ✓ | ✓ |
| Q&A moderation (pre-approve questions) | — | — | ✓ | ✓ |
| Import PPT/Keynote/PDF | — | ✓ | ✓ | ✓ |
| Private presentations, join settings | — | ✓ | ✓ | ✓ |
| **Export results (Excel/PDF/image)** | — | ✓ | ✓ | ✓ |
| Segmentation of results | — | ✓ | ✓ | ✓ |
| Custom themes / colors / logo | — | — | ✓ | ✓ |
| Co-editing, shared templates, workspace | — | — | ✓ | ✓ |
| Mentimote phone remote | — | — | ✓ | ✓ |
| Quick Forms; multiple answers per device | — | — | ✓ | ✓ |
| Participant names | — | — | ✓ | ✓ |
| SSO/SCIM, verified participants | — | — | — | ✓ |
| LMS integration (Canvas/Moodle/Blackboard/D2L) | — | — | — | ✓ |
| Custom data retention, org default theme | — | — | — | ✓ |

Sources: [plans](https://www.mentimeter.com/plans), [pricing](https://www.mentimeter.com/pricing), [help: which plan](https://help.mentimeter.com/en/articles/5938993-which-plan-is-right-for-you)

**Note the two paywalls that hurt instructors most:** results export is Basic+, and the 50-participants/month cap makes Free unusable for even one 60-student section run twice a month.

### 1.3 Question/slide types (what it does · tier · presenter view · participant view)

Current catalog confirmed from [help: create an interactive Menti](https://help.mentimeter.com/en/articles/375437-create-an-interactive-menti). All types below are available on Free except where noted.

- **Multiple Choice** — predefined options, optional per-option images, "select multiple" toggle, reference-only correct-answer marking (no scoring). *Presenter:* animated live chart, switchable bar/pie/donut/dots, percent-vs-count toggle, Enter reveals marked correct answers. *Participant:* radio buttons or checkboxes. ([help](https://help.mentimeter.com/en/articles/410459-how-to-use-multiple-choice-slides))
- **Word Cloud** — short free text (best ≤25 chars), 1–10 responses per participant, max 400 unique words displayed, lowercase-normalized, profanity filter available. *Presenter:* cloud grows/reflows in real time, frequency = size. *Participant:* one or more short text fields. ([help](https://help.mentimeter.com/en/articles/410469-how-to-use-the-word-cloud-slide))
- **Open Ended** — free text ≤200 chars, multiple submissions on by default, optional peer voting on submissions. *Presenter:* Speech Bubbles (manual scroll) or Flowing Grid (auto-scroll) layouts, switchable live; presenter can delete entries; AI Grouping clusters responses into themes live. *Participant:* multi-line text box, repeat submits. ([help](https://help.mentimeter.com/en/articles/410470-how-to-use-open-ended-slides), [changelog](https://mentimeter.canny.io/changelog))
- **Scales** — rate up to 8 statements on a numeric range (custom endpoints, skippable statements, Likert presets). *Presenter:* animated sliders glide to positions; distribution graph per statement; circled weighted average. *Participant:* drag a pointer per statement. ([help](https://help.mentimeter.com/en/articles/410471-how-to-use-scales-slides))
- **Ranking** — audience orders items; aggregate uses Borda count. *Presenter:* items live-rearrange into aggregate order. *Participant:* select items, reorder with up/down arrows. ([help](https://help.mentimeter.com/en/articles/2780579-how-to-use-ranking-slides))
- **100 Points** — allocate a 100-point budget across items. *Presenter:* items rearrange by points. *Participant:* −10/+10 buttons until budget spent. ([help](https://help.mentimeter.com/en/articles/410475-how-to-use-100-points-slides))
- **2×2 Grid** — rate items on two axes (impact/effort etc.), custom axes. *Presenter:* dots animate to each item's weighted-average coordinate; hover for individuals (disabled ≥50 respondents). *Participant:* coordinate/slider input per item. ([help](https://help.mentimeter.com/en/articles/410474-how-to-use-2-by-2-grid-slides))
- **Pin on Image** — tap to drop a pin on an uploaded image; optional hidden "correct area" reveal. *Presenter:* all pins overlaid (reads as a heat pattern). *Participant:* tap image to place pin. Officially flagged as inaccessible to visually-impaired participants. ([help](https://help.mentimeter.com/en/articles/4582546-how-to-use-pin-on-image-slides))
- **Guess the Number** — numeric guess between presenter-set limits, correct answer with error margin; results show distribution/average. ([digi-ed catalog, updated Jul 2026](https://digi-ed.uk/support/article/content-types-in-mentimeter/))
- **Quick Form** *(Pro+)* — structured form (Short Text, Email, Pick One/Many, Date); built for collecting names/emails — the anti-anonymous slide type. ([help](https://help.mentimeter.com/en/articles/1840520-collect-email-addresses-and-other-information-from-your-audience-with-quick-form-slides), [help: which plan](https://help.mentimeter.com/en/articles/5938993-which-plan-is-right-for-you))
- **Q&A slide** — see §1.5.
- **Quiz Competition (Select Answer / Type Answer)** — see §1.6.
- **Novelty/engagement types** (This or That, Traffic Light, Spin the Wheel, Timeline, Arrows, Loop; Truth or Lie) — shipped 2022 via template/slide library; current 2026 availability partially `[unverified]` ([UWE digital learning](https://digitallearning.uwe.ac.uk/whats-new-in-mentimeter/)).
- **Content slides** — Text, Image (≤15 MB), Video (upload/YouTube), Instructions slide (shows join code + QR); audience emoji reactions on content slides; **Compare slide** (Jul 2026) shows two slides' results side-by-side for before/after; embeds of PowerPoint Web/Google Slides/Miro are Pro. ([help](https://help.mentimeter.com/en/articles/410480-content-slides-in-mentimeter), [changelog](https://mentimeter.canny.io/changelog))

### 1.4 Live visualization, moderation, pacing

- **Animation:** every interactive slide updates live — bars grow, clouds reflow, sliders glide, 2×2 dots migrate (per-type help articles above).
- **Presenter controls:** Hide/show results (hotkey H, per-slide), close voting (C), percent toggle, on-demand segmentation ("Show Segmentation," Basic+), countdown timers started from toolbar or number keys ([help: hide/show](https://help.mentimeter.com/en/articles/422266-hide-or-show-results), [help: segmentation](https://help.mentimeter.com/en/articles/697797-segmentation-of-responses), [help: timer](https://help.mentimeter.com/en/articles/6951340-add-a-timer-to-your-slides))
- **Profanity filter** (all plans): per-language word lists; masked words still visible on the results page; extended to quiz inputs May 2026 ([help](https://help.mentimeter.com/en/articles/1649840-mentimeter-s-profanity-filter), [changelog](https://mentimeter.canny.io/changelog)).
- **Pacing:** *Presenter pace* — participant phones show only the current slide; early finishers see a wait screen; advancing mid-vote notifies laggards. *Audience pace (Survey mode)* — participants self-advance through all questions; quiz slides excluded. ([help: presentation mode](https://help.mentimeter.com/en/articles/410899-how-the-presentation-mode-affects-your-menti))
- **Reset/reuse:** "Reset results" zeroes the live view; prior data is archived as a **session** on the History page; "Show trends" graphs change across sessions but **only for Scales and Multiple Choice** ([help: sessions & trends](https://help.mentimeter.com/en/articles/410577-see-historical-data-with-sessions-and-trends)).

### 1.5 Q&A

Free and up: participants open Q&A from their device, submit unlimited questions (anonymous by default; host can disable anonymity), upvote others' questions. Presenter: Q&A overlay (hotkey Q), answered/unanswered lists, Enter marks answered, Excel export gets a Q&A tab. **Moderation (approve before display) is Pro+.** ([help: gather questions](https://help.mentimeter.com/en/articles/1501502-gather-questions-from-your-audience), [help: audience perspective](https://help.mentimeter.com/en/articles/1501608-questions-from-audience-the-audience-perspective), [help: moderation](https://help.mentimeter.com/en/articles/1840522-moderate-your-q-a-session-to-ensure-a-great-experience), [features: Q&A](https://www.mentimeter.com/features/live-questions-and-answers))

### 1.6 Quiz Competition

- Two question forms: **Select Answer** (pick one) and **Type Answer** (free-typed, case-insensitive, alternate accepted spellings; presenter can flip a wrong answer to correct live). ([help](https://help.mentimeter.com/en/articles/410463-how-to-create-a-quiz-competition), [help: type answer](https://help.mentimeter.com/en/articles/2939169-type-answer-quiz-competition-slide))
- **Scoring:** time-based (1000 down to 500 by speed) or fixed (1000 flat). **Leaderboard:** insertable anywhere, top-10 cumulative; presenter can reset inappropriate nicknames. **Lobby:** avatars + self-chosen nicknames; countdown music toggle. Max 2,000 quiz players; presenter-paced only. ([help: create](https://help.mentimeter.com/en/articles/410463-how-to-create-a-quiz-competition), [help: host](https://help.mentimeter.com/en/articles/4305015-how-to-host-the-quiz-competition))
- On Free (unlimited quiz slides) ([help: free account](https://help.mentimeter.com/en/articles/1258367-what-is-included-in-the-free-account)).

### 1.7 Themes and branding

Built-in themes + quick layouts on all plans (6 refreshed defaults Oct 2025). **Custom themes (logo, background, colors, fonts) are Pro+**; logo replaces the Mentimeter logo in presentations. Enterprise can set an org-wide default theme. OpenDyslexic font option since Apr 2026. ([plans](https://www.mentimeter.com/plans), [help: themes](https://help.mentimeter.com/en/articles/410484-create-your-own-themes), [changelog](https://mentimeter.canny.io/changelog))

### 1.8 Import, export, persistence

- **Import (Basic+):** PPT/PDF/Keynote import **as static background images** ([help: integrations](https://help.mentimeter.com/en/articles/11469974-mentimeter-integrations-and-compatibility)).
- **Export (Basic+):** PDF (screen-reader-accessible since Apr 2026), image, **Excel** (all responses; one tab per session; Q&A tab). **Free tier can view the results page but cannot export files. CSV is not offered — Excel only.** ([plans](https://www.mentimeter.com/plans), [help: analyze results](https://help.mentimeter.com/en/articles/11163908-how-to-analyze-the-results-of-your-menti))
- **Results page:** per-slide summaries, participation stats, AI grouping, sessions history, trends, AI "key takeaways" (Jul 2026) ([help: analyze results](https://help.mentimeter.com/en/articles/11163908-how-to-analyze-the-results-of-your-menti), [changelog](https://mentimeter.canny.io/changelog)).

### 1.9 Collaboration, AI, integrations

- Sharing (view/comment) on all plans; **co-editing and shared templates Pro+**; workspace roles Basic+; groups/insights/SCIM Enterprise ([plans](https://www.mentimeter.com/plans)).
- **AI on all plans** (opt-out for Enterprise admins): AI Menti Builder (prompt → full deck; OpenAI-backed), PDF-as-source (Mar 2026), question rephrasing/suggestions, AI grouping of open text, AI takeaways ([help: AI FAQ](https://help.mentimeter.com/en/articles/9159074-ai-menti-builder-faq), [changelog](https://mentimeter.canny.io/changelog)).
- **Integrations:** PowerPoint desktop add-in (live slides inside PPT, all plans; no PPT Online; one Menti per file), Teams app, Zoom app, Webex, Canva, Miro embeds (Pro), **LMS embeds for Canvas/Moodle/Blackboard/D2L — Enterprise only, launched Mar 2026** ([help: PPT add-in](https://help.mentimeter.com/en/articles/1720503-add-and-present-mentimeter-slides-in-the-powerpoint-add-in), [help: integrations](https://help.mentimeter.com/en/articles/11469974-mentimeter-integrations-and-compatibility), [changelog](https://mentimeter.canny.io/changelog)).

### 1.10 Join flow, identity, privacy (FERPA-relevant)

- **Join:** menti.com + numeric code, QR scan, or direct link; browser-only, no app, no account. Numeric codes expire after ~48h idle (extendable to 14 days); **QR and share link never expire** ([help: participate](https://help.mentimeter.com/en/articles/410537-how-to-participate-in-a-mentimeter-presentation), [help: code validity](https://help.mentimeter.com/en/articles/2780681-how-long-is-my-join-code-valid), [help: QR](https://help.mentimeter.com/en/articles/422271-share-the-qr-code)).
- **Anonymous by default:** no voting IDs, no login ([help: identify participants](https://help.mentimeter.com/en/articles/410525-how-to-identify-participants)).
- But identity features exist on paid tiers: **Participant names (Pro+)** prompts every participant for a name and lets the presenter follow individuals across questions in the export; **Verified participants (Enterprise)** forces SSO login with IdP-supplied name/email stored with responses ([help: identify participants](https://help.mentimeter.com/en/articles/410525-how-to-identify-participants), [help: verified participants](https://help.mentimeter.com/en/articles/10205259-joining-a-menti-as-a-logged-in-user-verified-participants)).
- **Compliance posture:** GDPR-compliant, EU data residency by default (US optional for Enterprise), instant account/presentation deletion, Enterprise custom retention. **No FERPA statement on official privacy/trust/education pages** — an independent Common Sense privacy report exists ([trust/privacy](https://www.mentimeter.com/trust/privacy), [Common Sense report](https://privacy.commonsense.org/privacy-report/Mentimeter)).
- Quiz nicknames are self-chosen (pseudonymous), but nothing prevents students typing real names; profanity filter + presenter nickname-reset are the only guards ([help: host quiz](https://help.mentimeter.com/en/articles/4305015-how-to-host-the-quiz-competition)).

### 1.11 Operational notes

- **No offline mode**; official advice is wired LAN for the presenter at large events ([help: requirements](https://help.mentimeter.com/en/articles/410951-requirements-for-running-mentimeter)).
- Participant mobile apps discontinued (2023) — browser participation only; desktop app sunset 2025; **Mentimote** phone remote (Pro+) controls slides, Q&A, timers, hide/show ([help: Mentimote](https://help.mentimeter.com/en/articles/2233579-mentimote-our-presentation-remote), [changelog](https://mentimeter.canny.io/changelog)).
- UI languages: EN/DE/ES/PT-BR; LaTeX math in titles/choices since Oct 2025 ([changelog](https://mentimeter.canny.io/changelog)).

---

## 2. Slido — condensed inventory

Cisco-owned; positioned as Q&A + polls *inside* meetings and slide decks rather than a standalone presentation builder.

### 2.1 Pricing and limits

Participant limits count **cumulative joined devices per event ("slido")**, not concurrent ([pricing](https://www.slido.com/pricing)). No monthly billing exists — annual plans (which do not auto-renew) or one-time single-event plans (7 days: Engage $60, Professional $240, Premium $1,000) ([pricing](https://www.slido.com/pricing), [one-time](https://www.slido.com/pricing?plan=one-time)).

| Tier (annual) | Price | Participants/event | Key gates |
|---|---|---|---|
| Basic (free) | $0 | 100 | **3 polls per event**; basic Q&A; no export |
| Engage | $210/yr | 200 | Unlimited polls/quizzes, surveys, exports |
| Professional | $900/yr | 1,000 | + Q&A moderation, branding, advanced privacy |
| Enterprise | $2,400/yr | 5,000 | + SSO (incl. participant SSO) |
| **Engage EDU** | **$84/yr** | **500** | Same as Engage; verified academic email |
| Professional EDU | $144/yr | 1,000 | Same as Professional |
| Institution EDU | $960/yr | 5,000 | 5 members, SSO |

([pricing](https://www.slido.com/pricing), [EDU pricing](https://www.slido.com/pricing?plan=edu), [EDU eligibility](https://community.slido.com/pricing-plan-options-235/slido-for-education-527)). For a 30–60-student class, free Basic covers headcount but the 3-poll cap cripples it; Engage EDU at $84/yr is the cheapest real option among all three tools.

### 2.2 Question types and live behavior

Current catalog: multiple choice, word cloud, rating (1–10), open text (up to 10,000 chars; emoji + sorting added Jan 2026), ranking, "Ideas" (upvoted brainstorm), quiz, survey (paid, self-paced bundle) ([all about live polls](https://community.slido.com/poll-creation-editing-211/all-about-live-polls-400), [open text](https://community.slido.com/live-polls-quizzes-and-surveys-55/create-and-run-an-open-text-poll-885), [Jan 2026 news](https://community.slido.com/product-news-announcements-108/what-s-new-in-slido-january-2026-7498)). Images in polls require a paid plan. AI poll generation rolled out 2025–26 ([news](https://community.slido.com/product-news-announcements-108/what-s-new-in-slido-january-2026-7498)).

- **Pacing:** presenter activates one poll at a time (green play button); controls: lock voting, hide results while voting, reset, view-as-participant ([all about live polls](https://community.slido.com/poll-creation-editing-211/all-about-live-polls-400)). In PowerPoint/Google Slides embeds, the poll auto-activates when its slide appears ([PPT guide](https://community.slido.com/powerpoint-244/how-to-use-slido-for-powerpoint-546)).
- **Quiz:** multiple-choice only; per-question timer (default 20 s); scoring = correctness + speed; leaderboard shows top 5 on the projector while each phone privately shows its own rank; full leaderboard download is paid; **no self-paced quizzes**; **quizzes always collect participant names regardless of anonymity settings** ([quiz guide](https://community.slido.com/interactive-poll-types-210/create-and-run-a-quiz-538), [no self-paced](https://community.slido.com/community-q-a-7/can-i-run-a-quiz-so-that-people-can-go-through-questions-at-their-own-pace-615)).
- **Q&A (the crown jewel):** on all plans; submit + upvote; anonymous questions are truly anonymous (admins can't unmask) ([anonymity](https://community.slido.com/community-questions-7/is-my-slido-question-actually-anonymous-800)); **moderation is Professional+**: questions sit "in review" until approved, with labels, public/private replies ([moderation](https://community.slido.com/q-a-settings-222/use-moderation-and-manage-audience-questions-477)).

### 2.3 Branding, export, integrations, identity

- Custom logo/colors need Professional+; the Slido logo can never be fully removed ([branding](https://community.slido.com/customizations-and-branding-225/add-branding-and-custom-colors-to-your-slido-454)).
- **Exports are paid-only** (any paid tier): XLS, PDF, Google Sheets; capped at 5,000 participants / 1,000 poll responses per direct download ([exports](https://community.slido.com/analytics-data-exports-230/export-your-poll-results-and-q-a-questions-532)).
- Integrations: PowerPoint (Windows + macOS since Sept 2025), Google Slides add-on, Teams, Zoom, Webex ([PPT](https://community.slido.com/powerpoint-244/how-to-use-slido-for-powerpoint-546), [Google Slides](https://community.slido.com/google-slides-245/how-to-use-slido-for-google-slides-513), [Teams](https://community.slido.com/microsoft-teams-249/how-to-use-slido-for-microsoft-teams-487), [Zoom](https://community.slido.com/slido-for-zoom-119/how-to-use-slido-for-zoom-meetings-2952)).
- Join: slido.com + event code or QR; **mobile apps sunset March 30, 2026 — browser-only going forward**; no SMS option ([news](https://community.slido.com/product-news-announcements-108)).
- Identity: four per-event privacy modes (Anonymous by default / Always anonymous / Named by default / Always require name) settable on all plans; names are self-entered unless Enterprise participant-SSO; no FERPA statement found in official materials ([privacy modes](https://community.slido.com/security-privacy-essentials-224/participant-privacy-choose-anonymous-or-named-participation-1609)).

### 2.4 Slido vs Mentimeter

Better: Q&A depth (moderation/labels/replies/true anonymity), meeting-platform integrations, the $84/yr EDU tier, one-time event licenses, 100-participant free tier. Worse: not a presentation builder (needs PPT/Slides/meeting host), fewer question types and plainer visuals, 3-poll free cap, no self-paced quizzes, no monthly billing. ([pricing](https://www.slido.com/pricing), [comparison](https://www.softwareadvice.com/polling/mentimeter-profile/vs/slido/), [comparison](https://presengage.com/blog/slido-vs-mentimeter/))

---

## 3. Poll Everywhere — condensed inventory

**Platform-split warning:** Poll Everywhere is mid-transition. "PE 2.0" (opt-in rebuild, launched Aug 2025, Google Gemini AI) runs alongside classic 1.0 with different join flows and feature sets — 2.0 currently lacks SMS, ranking, surveys, competitions, and most non-Canvas LMS depth ([What is 2.0](https://support.polleverywhere.com/hc/en-us/articles/39332329183771-What-is-Poll-Everywhere-2-0), [FAQ](https://www.polleverywhere.com/product/faq), [2.0 integrations](https://support.polleverywhere.com/hc/en-us/articles/39414897782939-Integrations-with-Poll-Everywhere-2-0)).

### 3.1 Pricing and limits

Limits count **responses a single poll can receive at one time; over-limit responses are silently not accepted** ([FAQ](https://www.polleverywhere.com/product/faq)).

| Education plan | Price | Responses/poll | Key gates |
|---|---|---|---|
| Free | $0 | 40 | 10 AI prompts/mo |
| Lecture | $9/mo ($108/yr) | 700 | Reporting |
| Educator | $16/mo ($192/yr) | 700 | + attendance/geolocation, branding, archived results |
| Educator+ | $27/mo ($324/yr) | 2,000 | + phone support |
| Campus-wide | Custom | Custom | LMS integration, SAML SSO |

Business track: Intro free (40), Present $120/yr (700), Engage $588/yr, Teams $999/yr ([plans](https://www.polleverywhere.com/plans), [education plans](https://www.polleverywhere.com/plans/education)). Note: some 2025–26 reviews cite a 25-response free cap and an old "$349/semester" instructor plan — not on the current official pages; official figures used here ([wooclap breakdown, third-party](https://www.wooclap.com/en/blog/poll-everywhere-pricing/)).

### 3.2 Activity types and live behavior

Classic catalog: multiple choice (2.0 adds donut/Likert/radar renderings), word cloud, open-ended (Text Wall / Word Cloud / Spotlight display modes), clickable image (tap a region; responses plot on the image), ranking, Q&A with upvote, survey (self-paced — PE's async option), competition ([activity types](https://support.polleverywhere.com/hc/en-us/sections/1260801304350-Activity-types), [2.0 visualizations](https://support.polleverywhere.com/hc/en-us/articles/39487594770331-Visualization-and-Response-Options), [open-ended](https://support.polleverywhere.com/hc/en-us/articles/1260801546510-Open-ended-question)).

- **Pacing:** presenter activates one activity at a time; countdown timer 5–180 s auto-locks at zero ([timer](https://support.polleverywhere.com/hc/en-us/articles/1260801551729-Countdown-timer)). The **Live App** watches the presenter's screen for embedded PE QR codes and auto-activates polls over any slideware (Google Slides/Keynote/Canva) ([Live App](https://support.polleverywhere.com/hc/en-us/articles/46042587174683-Poll-Everywhere-Live-App-Presenting-with-Slides)); PowerPoint has native (1.0) and M365 (2.0) add-ins ([FAQ](https://www.polleverywhere.com/product/faq)).
- **Competitions:** timed MC series; correct = 1,000 pts, decaying with elapsed time when timed; leaderboard after each question on the projector; **participants see only the final leaderboard on their devices** ([competition](https://support.polleverywhere.com/hc/en-us/articles/1260801546490-Competition), [presenting](https://support.polleverywhere.com/hc/en-us/articles/17583158782363-Presenting-Competitions)).
- Moderation (approve responses before display) and profanity filter are premium features ([moderation](https://support.polleverywhere.com/hc/en-us/articles/1260804687470-Moderation), [profanity](https://support.polleverywhere.com/hc/en-us/articles/1260804262990-What-is-the-profanity-filter)).

### 3.3 Reports, LMS, join, identity

- **Reports** (the deepest of the three): Executive summary (the only one compatible with anonymous activities), Pivot table, Participant response history, **Gradebook** (per-student correctness + attendance %); CSV export is paid ([report types](https://support.polleverywhere.com/hc/en-us/articles/1260801545530-Report-types), [gradebook](https://support.polleverywhere.com/hc/en-us/articles/1260801550469-Gradebook-report), [FAQ](https://www.polleverywhere.com/product/faq)).
- **LMS:** LTI Advantage 1.3 for Canvas/Moodle/Blackboard/D2L with roster import, embedded activities, and grade passback — premium/Campus-wide; the 2.0 deep workflow is Canvas-first ([LMS](https://www.polleverywhere.com/features/lms-integration)).
- **Join:** 1.0 = pollev.com/username + SMS text-in for some types (MC, open-ended only); **2.0 = pe.app + code/QR, and "SMS response is not supported"** ([SMS](https://support.polleverywhere.com/hc/en-us/articles/1260801546910-SMS-Text-messaging), [FAQ](https://www.polleverywhere.com/product/faq)).
- **Identity:** 2.0 defaults to anonymous, no login; "registered participants" (premium) restricts activities to logged-in students for graded attendance — the mechanism behind the notorious "Unregistered student" gradebook failures (§5) ([audience restriction](https://support.polleverywhere.com/hc/en-us/articles/7869823534747-Audience-restriction-identity), [What is 2.0](https://support.polleverywhere.com/hc/en-us/articles/39332329183771-What-is-Poll-Everywhere-2-0)).
- **Compliance:** the official FAQ states FERPA and COPPA compliance, WCAG 2.2 AA, AES-256/TLS 1.2, AWS hosting — the only one of the three with a published FERPA commitment ([FAQ](https://www.polleverywhere.com/product/faq), [K-12 page](https://www.polleverywhere.com/k12-student-response-system)).

### 3.4 Poll Everywhere vs Mentimeter

Better: PowerPoint-native workflow, real LMS/gradebook integration, deepest reporting, SMS (1.0 only), published FERPA/security certifications (SOC 2, ISO 27001). Worse: 40-response free cap, dated visuals needing manual design effort, not a standalone deck builder, and 1.0/2.0 split confusion. ([vendor comparison](https://www.polleverywhere.com/use-cases/vs/poll-everywhere-vs-mentimeter), [wooclap comparison, third-party](https://www.wooclap.com/en/blog/poll-everywhere-vs-mentimeter/))

---

## 4. Cross-tool comparison

| | Mentimeter | Slido | Poll Everywhere |
|---|---|---|---|
| Free tier vs one 60-student class | ✗ (50/month total) | ✗ (headcount OK; 3 polls/event) | ✗ (40 responses/poll) |
| Cheapest education paid | ~$108/yr (Edu Basic) | **$84/yr** (Engage EDU, 500) | $108/yr (Lecture, 700) |
| Standalone deck authoring | ✓ best-in-class | ✗ companion tool | Partial (Live App overlay) |
| Interactive question types | ~13+ | 8 | 8 (fewer in 2.0) |
| Quiz + leaderboard | ✓ 2 scoring modes, music | ✓ MC-only; names forced | ✓ decaying points |
| Q&A moderation | Pro (~$300/yr) | Professional ($144/yr EDU) | Premium tiers |
| Export on free tier | ✗ | ✗ | ✗ |
| Anonymity model | Default anon; Pro can require names | 4 modes; quizzes always named | 2.0 default anon; registered mode paid |
| LMS integration | Enterprise only (new Mar 2026) | ✗ | ✓ deepest (LTI 1.3 + grades) |
| SMS voting | ✗ | ✗ | 1.0 only; dropped in 2.0 |
| Offline/degraded-network mode | ✗ | ✗ | ✗ |
| Published FERPA statement | ✗ | ✗ | ✓ |

All cells are sourced in §1–§3.

---

## 5. Gap analysis — what reviews and forums actually say

### 5.1 Recurring complaints (with receipts)

**Pricing and the free-tier collapse (the loudest theme, 6+ independent sources per tool).** Mentimeter's May 2024 free-plan change (50 participants/month, presenting blocked until the monthly reset once exceeded) prompted the University of Reading's teaching-enhancement team to publicly warn staff and recommend already-licensed Microsoft/Blackboard tools instead ([Reading TEL blog](https://blogs.reading.ac.uk/telblog/2024/05/07/menti-changes-to-the-free-plan-2024-and-recommended-alternatives/)). Institutions are dropping Poll Everywhere over cost: Georgia Gwinnett College discontinued it citing cost, low usage, and security ([GGC IT](https://itservices.ggc.edu/blog/2023/03/13/poll-everywhere-to-be-discontinued/)); Toronto Metropolitan University ended its university-wide license in June 2024, auto-downgrading every presenter account ([TMU](https://www.torontomu.ca/courses/knowledge-hub/retired-tech/polleverywhere/)). Individual instructors paying out of pocket call PE's semester pricing steep ([r/Professors](https://www.reddit.com/r/Professors/comments/1jql1py/looking_for_a_better_polling_tool_for_powerpoint/)); reviewers resent annual-only billing at Mentimeter and Slido for one-semester needs ([Capterra Mentimeter](https://www.capterra.com/p/160936/Mentimeter/reviews/), [G2 Slido](https://www.g2.com/products/slido/reviews?qs=pros-and-cons)).

**Exports paywalled everywhere.** Mentimeter free: view-only results ([GetApp](https://www.getapp.com/collaboration-software/a/mentimeter/reviews/)); Slido free: no export at all ([Purdue teaching hub](https://onlineteachinghub.education.purdue.edu//slido)); PE: CSV is paid and reports confuse reviewers ([Capterra PE](https://www.capterra.com/p/127096/Poll-Everywhere/reviews/)). Instructors' own class data is hostage to the subscription.

**PowerPoint add-in fragility (recurring for all three).** A Capterra reviewer called Mentimeter's plug-in "outdated and never updated" and crash-prone ([Capterra](https://www.capterra.com/p/160936/Mentimeter/reviews/)); there's an open office-js bug for the add-in's load failure ([GitHub](https://github.com/OfficeDev/office-js/issues/2921)). One professor's Slido update left their PowerPoint file quarantined by IT as malware, costing 2 hours (single vivid report; [r/Professors](https://www.reddit.com/r/Professors/comments/1jql1py/looking_for_a_better_polling_tool_for_powerpoint/)). G2 reviewers report PE's add-in crashing mid-lecture ([G2 PE](https://www.g2.com/products/poll-everywhere/reviews?qs=pros-and-cons)).

**Reuse and persistence friction (structural for instructors).** Slido events expire and duplicating questions regenerates the QR code, breaking printed materials ([Capterra Slido](https://www.capterra.com/p/154051/Slido/reviews/)); PE reuse means tediously clearing old responses, and polls deactivate between sessions ([r/Professors](https://www.reddit.com/r/Professors/comments/1hybnpr/live_polling_options/), [Capterra PE](https://www.capterra.com/p/127096/Poll-Everywhere/reviews/)); Mentimeter users keep filing requests to compile/compare data across presentations ([Canny](https://mentimeter.canny.io/feature-requests?search=compare)).

**Anonymity vs. accountability — a structural tension nobody resolves.** Anonymity drives the shy-student participation that teaching centers cite as the core value ([Georgetown CNDLS](https://cndls.georgetown.edu/resources/classroom-response-systems/), [Carleton](https://www.carleton.edu/its/blog/engage-students-with-poll-everywhere/)) — but invites junk in big halls (Warwick case study noted questions turning "a bit silly" ([Warwick](https://warwick.ac.uk/fac/cross_fac/academic-development/app/tel/ldcu/digitalpedagogylibrary/mentimeter)); inappropriate Slido posts in large lectures ([r/Professors](https://www.reddit.com/r/Professors/comments/1jql1py/looking_for_a_better_polling_tool_for_powerpoint/))), and when polls double as attendance, absent students answer remotely ([r/Professors](https://www.reddit.com/r/Professors/comments/1guy4fy/what_would_you_do/)). PE's identified mode produces the "Unregistered student" gradebook mess universities write troubleshooting guides for ([UNC](https://edtech.unc.edu/service/poll-everywhere/attendance/)).

**Accessibility gaps, institutionally documented.** Imperial College's statement records screen-reader-incompatible status messages and word-cloud results read in random order ([Imperial](https://www.imperial.ac.uk/admin-services/ict/self-service/digital-education-services/digital-education-platforms/mentimeter/mentimeter-accessibility-statement/)); Glasgow maintains a similar statement ([Glasgow](https://www.gla.ac.uk/legal/accessibility/statements/mentimeter/)); UTS publishes a 12-item workaround guide ([UTS](https://educationexpress.uts.edu.au/blog/2021/08/18/12-tips-mentimeter-presentation-accessible/)); reading-order is an open request on Mentimeter's own board ([Canny](https://mentimeter.canny.io/feature-requests/p/accessibility-of-reading-order-for-screen-reader-users)).

**Join friction and network dependence.** Mentimeter codes expire by design ([help](https://help.mentimeter.com/en/articles/2780681-how-long-is-my-join-code-valid)); a presenter reported an audience that never managed to join ([r/Professors](https://www.reddit.com/r/Professors/comments/d3z55d/need_a_polling_app_with_likert_scale_to_use/)); all three are dead without internet — a Show HN project (PresenterKit) exists specifically to run polls on a local network where campus internet is unreliable ([HN](https://news.ycombinator.com/item?id=41147309)).

### 5.2 Features users request that none deliver well

From Mentimeter's public request board (vote counts as of Aug 2026, [Canny top requests](https://mentimeter.canny.io/feature-requests?sort=top)) and forums:

- Native Google Slides embedding — 272 votes, the #1 request.
- Merging word-cloud variants ("zombie"/"zombies") post-hoc — 121 votes; AI thematic clustering of open responses ([r/edtech](https://www.reddit.com/r/edtech/comments/16q0hdg/generative_ai_tool_suggestion/)).
- Photo/image submissions (76) and images as quiz answers (63).
- "Other — please specify" hybrid option — 61 votes.
- **Participants seeing results on their own devices — 72 votes.**
- **Compiling/comparing data across presentations/sessions — 26 votes** ([Canny](https://mentimeter.canny.io/feature-requests?search=compare)).
- Math-expression input for STEM polling ([r/Professors](https://www.reddit.com/r/Professors/comments/ky3o9m/polls_where_you_can_enter_math_expressions/)).
- Hide-results-until-close as a reliable default — an instructor went tool-shopping specifically for this ([r/Professors](https://www.reddit.com/r/Professors/comments/171r85a/free_polling_application_that_wont_let_you_see/)).
- Importing/converting existing slide questions instead of re-authoring by hand ([r/Professors](https://www.reddit.com/r/Professors/comments/1hybnpr/live_polling_options/)).

### 5.3 What the switchers reveal

- **Vevox** became the *institutional* pick at Leeds, Newcastle, Kent, Aberystwyth — site-license economics, support quality, Microsoft-stack fit ([Leeds](https://desystemshelp.leeds.ac.uk/news-and-updates/vevox-is-our-new-mobile-voting-and-polling-tool/), [Newcastle](https://www.ncl.ac.uk/learning-and-teaching/digital-technologies/vevox/), [Kent](https://www.kent.ac.uk/education/elearning/additional-tools/vevox), [Aberystwyth](https://faqs.aber.ac.uk/index.php?id=764)).
- **AhaSlides** is the r/Professors "actually usable free tier" pick: ~50 participants **per event** (not per month) with downloadable reports ([r/Professors](https://www.reddit.com/r/Professors/comments/171r85a/free_polling_application_that_wont_let_you_see/)).
- **ClassPoint** wins by living *inside* PowerPoint with gamification — authoring where the deck already lives.
- **Microsoft/Google Forms** win on "already paid for" and login-based troll suppression ([Reading](https://blogs.reading.ac.uk/telblog/2024/05/07/menti-changes-to-the-free-plan-2024-and-recommended-alternatives/), [r/Professors](https://www.reddit.com/r/Professors/comments/1jql1py/looking_for_a_better_polling_tool_for_powerpoint/)).
- **Open-source/self-hosted** (Claper, Particify, PresenterKit) exists because "there is no solid open-source alternative," per its author — privacy review and offline resilience are unmet ([HN Claper](https://news.ycombinator.com/item?id=37349044), [AlternativeTo](https://alternativeto.net/software/poll-everywhere/), [HN PresenterKit](https://news.ycombinator.com/item?id=41147309)).

### 5.4 Table stakes (praised everywhere; must not regress)

Zero-install QR/browser join · dead-simple authoring (all three score ~4.5/5 ease-of-use) · anonymity that activates quiet students · instant animated projector results, word clouds especially · working inside the presenter's flow · trust artifacts (privacy statements, accessibility statements). (Sources: [Purdue](https://onlineteachinghub.education.purdue.edu//slido), [Georgetown](https://cndls.georgetown.edu/resources/classroom-response-systems/), [Capterra Slido](https://www.capterra.com/p/154051/Slido/reviews/), [r/Professors](https://www.reddit.com/r/Professors/comments/1goagit/final_exam_review_activities_for_large_classes/).)

---

## 6. Proposed novel improvements (grounded in §5)

**P1 — One-tap Re-ask with an animated delta view.** Any live question can be re-asked with a single keystroke; the projector then shows both rounds side by side with per-option change animated (arrows, +/− percentages). *Rationale:* the demand is visible from three directions — Mentimeter users' standing requests to compare results across sessions ([Canny, 26 votes](https://mentimeter.canny.io/feature-requests?search=compare)); Mentimeter itself validating the direction by shipping only a *static* side-by-side Compare slide in July 2026 ([changelog](https://mentimeter.canny.io/changelog)); and the pedagogy it serves — poll → peer discussion → re-poll is the canonical concept-check loop teaching centers describe ([Georgetown](https://cndls.georgetown.edu/resources/classroom-response-systems/)). In all three incumbents a re-ask means hand-duplicating a slide, and none animates what changed. For peer instruction, the delta *is* the lesson.

**P2 — Anonymous-but-stable session pseudonyms.** Each device gets a server-assigned codename per session ("Amber Falcon"); that enables leaderboards, per-respondent rows in the CSV, and duplicate-vote control — with no name field anywhere. *Rationale:* incumbents force a choice between anonymity and structure: Slido quizzes always collect names even in anonymous mode ([Slido docs](https://community.slido.com/interactive-poll-types-210/create-and-run-a-quiz-538)); Mentimeter quiz nicknames are free-typed, so students can enter real names (a FERPA leak vector) or junk ([help](https://help.mentimeter.com/en/articles/4305015-how-to-host-the-quiz-competition)); PE requires registered accounts for any per-person view, producing the "Unregistered" gradebook mess ([UNC](https://edtech.unc.edu/service/poll-everywhere/attendance/)). Complaints show both horns: anonymity invites junk ([Warwick](https://warwick.ac.uk/fac/cross_fac/academic-development/app/tel/ldcu/digitalpedagogylibrary/mentimeter)) while identification suppresses the participation that is the whole point ([Georgetown](https://cndls.georgetown.edu/resources/classroom-response-systems/)). Assigned pseudonyms give competition and analysis with literally nothing for FERPA to touch — no names, no logins, no cross-session identifiers.

**P3 — Decks as plain text.** Question decks are authored in (and exportable to) a human-readable text format — one file per deck; duplicate per section instantly; keep in git or Drive; share with colleagues without an account. *Rationale:* the most repeated workflow complaint is re-authoring and reuse — professors describe hours converting existing questions ([r/Professors](https://www.reddit.com/r/Professors/comments/1hybnpr/live_polling_options/)); Slido events expire and duplication churns QR codes ([Capterra](https://www.capterra.com/p/154051/Slido/reviews/)); PE reuse means clearing responses activity by activity ([r/Professors](https://www.reddit.com/r/Professors/comments/1hybnpr/live_polling_options/)). A portable text format makes decks durable beyond any vendor — the exact fear the TMU/Reading institutional withdrawals realized ([TMU](https://www.torontomu.ca/courses/knowledge-hub/retired-tech/polleverywhere/), [Reading](https://blogs.reading.ac.uk/telblog/2024/05/07/menti-changes-to-the-free-plan-2024-and-recommended-alternatives/)) — and none of the three offers any portable authoring format.

**P4 — Permanent corner QR + zero-step late join.** The join QR stays in a corner of every projected slide (toggleable), and a latecomer who scans lands directly on the currently live question — no code entry, no lobby. *Rationale:* join friction recurs disproportionately in complaints: Mentimeter codes expire by design ([help](https://help.mentimeter.com/en/articles/2780681-how-long-is-my-join-code-valid)) and one presenter reported an audience that never got in ([r/Professors](https://www.reddit.com/r/Professors/comments/d3z55d/need_a_polling_app_with_likert_scale_to_use/)); incumbents treat joining as a one-time event at session start (Mentimeter parks the QR on a dedicated Instructions slide, and only in June 2026 let participants re-share it ([changelog](https://mentimeter.canny.io/changelog))). Real classes have students arriving for ten minutes. Keeping the door permanently open costs one corner of the screen and deletes the most common live failure mode.

**P5 — Results are never hostage: free CSV + permanent session archive.** Every session's results are viewable online per session and downloadable as CSV, forever, free. *Rationale:* this is the one "feature" all three deliberately withhold — Mentimeter free is view-only ([plans](https://www.mentimeter.com/plans)), Slido free exports nothing ([Purdue](https://onlineteachinghub.education.purdue.edu//slido)), PE gates CSV and archived results by tier ([plans](https://www.polleverywhere.com/plans/education)) — and it's where institutional cancellations hurt most: when TMU ended its license, every account auto-downgraded and archive access went with it ([TMU](https://www.torontomu.ca/courses/knowledge-hub/retired-tech/polleverywhere/)). Because SurveyAll has no paid tier, data ownership can be structural rather than promised: session archive + one-click CSV + plain-text decks (P3) means the instructor can walk away with everything at any time. Not novel as engineering — novel as a guarantee no incumbent's business model lets them match.

*Considered and dropped (no filler):* an ambient "confusion meter" backchannel — appealing, but the complaint mining surfaced no meaningful demand signal for it, and it fails the grounded-in-evidence test.

---

## 7. Clone / skip / adapt recommendations for Phase 2

**Clone (v1 core):** multiple choice, word cloud, scales, open ended, ranking (the five types covering nearly all classroom use); quiz competition with time-decay scoring and pseudonymous leaderboard (P2); presenter pacing with hide/show results, close voting, countdown timer; reset-with-archive (sessions); QR + short-code join; mobile-first participant UI; free CSV export (P5); a few clean themes + high-contrast projector mode.

**Adapt:**
- *Q&A with upvoting* — clone the mechanic, but make hide-until-approved moderation **free** (it's Pro/Professional/premium at all three incumbents — cheap to build, high classroom value).
- *Profanity filter* — simple wordlist + presenter tap-to-delete, not Mentimeter's per-language list system.
- *Audience-paced survey mode* — cheap to add later (ungated navigation); not v1. Live pacing is the core.
- *Segmentation/trends* — skip in-app; P1's delta view plus CSV covers the real use.

**Skip, with reasons:**
- **PowerPoint/Google Slides add-ins** — the single biggest fragility complaint across all three (§5.1), a huge maintenance surface, and unnecessary for a standalone browser deck. This is the deliberate architectural bet: browser-first instead of add-in.
- **Quick Form / participant names / verified participants / registered rosters** — they exist to collect PII; violates FERPA-safe-by-design. Explicitly out, permanently.
- **AI builder/grouping/takeaways** — recurring API costs on a free tool, new privacy surface, marginal value for a 20-question classroom deck.
- **SMS voting** — real per-message cost, and PE itself dropped it in 2.0; college students have browsers.
- **LMS/LTI + gradebook sync** — enterprise-grade complexity that requires identity (conflicts with anonymity); async LMS use is served by pasting a session link into Canvas.
- **100 Points, 2×2 Grid, Pin on Image** — workshop-oriented, low classroom demand; Pin on Image is officially inaccessible to visually-impaired users.
- **Novelty types (This or That, Spin the Wheel…), quiz music, Mentimote remote, custom branding, Teams/Zoom apps, video slides** — filler for this use case.

---

*Next step: on your approval of this report (or amendments), Phase 2 begins with the architecture proposal — free-tier hosting options sized against 30–60 concurrent students, then code, then the deployment guide.*
