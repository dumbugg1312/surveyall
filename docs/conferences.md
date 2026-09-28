# Conference boards

1-on-1 writing conferences during class, without conferencing all
twenty-five students in seventy-five minutes.

Students open the board on their phone at the start of class (same join
box as every poll) and leave it open. They give a first name and last initial ("Maya R.", so two
Mayas are told apart), a one-line
topic, where they are in the process and how it's going. When they want a
conference they tap a button and **must say what they want to talk about**
before they're added. The instructor's laptop shows the room in lanes and
the instructor calls names aloud.

## The design decisions, and why

**The phone never announces anything.** No "you're up", no place in line,
no vibration. The instructor asked for this explicitly: a student who has
asked should go back to writing, not watch a counter. The server strips the
call-up state from the phone's payload, so no future version of the page
can turn into an alert by accident (tested in `tests/run-worker-tests.mjs`).

**No request without an agenda.** Asking requires picking a topic ("Finding
sources", "Citing (MLA)", …) plus an optional note. Conferences go better
when the student sets the agenda. Walker & Elias (1987, *Research in the
Teaching of English* 21(2)) found students rated teacher-dominated
conferences less successful than student-led ones. Naming the question in
advance is also the preparation the "wasn't ready for the conference"
student skipped.

**A lane for the students who won't ask.** The students who most need
help are the least likely to seek it (Ryan, Pintrich & Midgley 2001,
*Educational Psychology Review* 13(2)), and a private, low-stakes channel
feels less threatening than raising a hand (Kitsantas & Chow 2007,
*Computers & Education* 48(3)). So the start-of-class check-in carries a
one-tap "how's it going" (going well / getting there / stuck), and **Might
need you** surfaces students who haven't asked but said they're stuck or
left their topic blank. Covering the room no longer depends on who
volunteers.

The flags come only from what a student entered, never from elapsed time.
Students fill the card in once at the start of class and come back only to
ask, so an unchanged card means nothing. An earlier version flagged "no
topic after 10 minutes" and "still on stage 1 after 25 minutes"; both were
removed because they would flag every student quietly getting on with it.

**First visits before return visits.** With limited time, "everyone who
wants help gets help" means a student not yet seen shouldn't wait behind
one who has. First come, first served within each group.

**The student writes their own next step.** Pressing Done prompts the
phone for "what's your next step?", in the student's words. It shows on
the board, lands in the log, and stays on the phone (locally) after the
board is erased.

**Roving conferences count.** "Talked" records a conference from any lane
without a call-up, for check-ins at a student's desk.

## Privacy

Names are the one student identifier anywhere in SurveyAll, so they are
kept out of D1 entirely. `conference_boards` holds code, title and the
instructor's lists; cards live in the `ConferenceRoom` Durable Object and
are erased on End (`storage.deleteAll()`) or by an alarm twelve hours after
start. Ending downloads a CSV log to the instructor's computer first. That
download is the only copy that survives. A test in
`tests/run-worker-tests.mjs` dumps every D1 table after a full board
lifecycle and fails if a student's name or topic appears.

## Deploying

1. Run the migration against production D1 **before** deploying the code:

       npx wrangler d1 execute DB --remote --file=worker/migrations/0007-conference-boards.sql

2. Deploy as usual. `wrangler.jsonc` declares the new Durable Object class
   (`ConferenceRoom`, migration tag `v2`, SQLite-backed as the free plan
   requires). Cloudflare applies it on deploy.
