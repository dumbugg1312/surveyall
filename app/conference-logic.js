/**
 * SurveyAll — conference board rules.
 *
 * A conference board is the one part of SurveyAll that knows who a
 * student is: its whole job is telling the instructor which person to
 * call to the front. Everything else in the app is anonymous by
 * construction, so this feature is walled off from it on purpose —
 *
 *   • names and topics never reach D1. They live in the board's own
 *     Durable Object (worker/conference-room.js) for as long as the
 *     board runs, and are erased when the instructor ends it or twelve
 *     hours after it started, whichever comes first;
 *   • the only copy that outlives the board is the log the instructor
 *     downloads to their own computer.
 *
 * This file is the pure half: what a card may hold, what order the line
 * is in, and which quiet students the instructor should look at. It is
 * imported by BOTH the Durable Object (so a phone's "you're 3rd in line"
 * is computed by the same rule that orders the instructor's queue) and
 * the instructor's board page, and it touches no DOM and no network, so
 * tests/run-tests.mjs can exercise it directly.
 *
 * The phone is deliberately quiet. It never announces a call-up, a place
 * in line, or anything else a student would wait on: the instructor calls
 * names aloud, and the point of asking on a phone is to get back to work.
 *
 * THE PEDAGOGY, briefly — docs/conferences.md has the long version.
 *
 *   1. A student cannot join the line without naming what they want to
 *      talk about. Conferences go better when the student sets the agenda
 *      (Walker & Elias 1987: students rated teacher-dominated conferences
 *      less successful than student-led ones), and naming the question in
 *      advance is the preparation the "not ready for their conference"
 *      student skipped.
 *   2. Asking is not the only signal. The students who most need help
 *      are the least likely to ask for it (Ryan, Pintrich & Midgley 2001),
 *      and a private, low-stakes channel is less threatening than raising
 *      a hand (Kitsantas & Chow 2007). So the start-of-class check-in
 *      carries a one-tap "how's it going", and the board surfaces what it
 *      says — stuck, or no topic yet — in its own lane, so covering the
 *      room does not depend on who volunteers.
 *   3. First visits go ahead of second visits. With twenty-five students
 *      and seventy-five minutes, "everyone who wants help gets help"
 *      means the student who has not been seen yet should not wait behind
 *      one who has. Each group is still first come, first served.
 *   4. The student writes their own next step when the conference ends.
 *      A takeaway the student generates is one they have processed; the
 *      instructor sees it on the board, and it stays on the phone.
 */

/** Where a research essay can be. Instructor-editable per board. */
export const DEFAULT_STAGES = [
  'Choosing a topic',
  'Finding sources',
  'Reading & taking notes',
  'Outlining',
  'Drafting',
  'Revising',
];

/** What a student can ask to talk about. Instructor-editable per board. */
export const DEFAULT_TOPICS = [
  'My topic or research question',
  'Finding sources',
  'Understanding a source',
  'Citing sources (MLA)',
  'Thesis & organization',
  'Something else',
];

/**
 * The low-stakes signal. Three steps, not five: a phone answer somebody
 * has to think about stops being low-stakes.
 */
export const MOODS = [
  { id: 'good', label: 'Going well' },
  { id: 'okay', label: 'Getting there' },
  { id: 'stuck', label: 'Stuck' },
];
const MOOD_IDS = new Set(MOODS.map((m) => m.id));

/**
 * Size limits. Each one is the longest thing a person would really type
 * into that box, and together they keep a full board of students well
 * inside a single Durable Object's storage.
 */
export const LIMITS = {
  name: 40,
  topic: 160,
  note: 280,
  step: 280,
  title: 80,
  listItem: 60,
  listMax: 10,
  seats: 80,
};

/** How long a board may live before its room erases itself. */
export const BOARD_LIFETIME_MS = 12 * 60 * 60 * 1000;

/** Default conference length the timer on the instructor's board aims at. */
export const DEFAULT_TARGET_MIN = 5;

// ------------------------------------------------------------- cleaning

/**
 * One line of text a person typed: control characters out, runs of
 * whitespace collapsed, trimmed, capped. Never throws, whatever it is
 * handed — this runs on input from any phone in the room.
 */
export function cleanLine(raw, max) {
  if (raw == null) return '';
  // eslint-disable-next-line no-control-regex
  return String(raw).replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

/** An instructor's list (stages, topics): cleaned, de-duplicated, capped. */
export function cleanList(raw, fallback) {
  const items = Array.isArray(raw) ? raw : String(raw || '').split('\n');
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const line = cleanLine(item, LIMITS.listItem);
    const key = line.toLowerCase();
    if (!line || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= LIMITS.listMax) break;
  }
  return out.length ? out : [...fallback];
}

/** Board settings as stored: everything instructor-supplied, cleaned. */
export function cleanSettings(raw = {}) {
  const target = Math.round(Number(raw.target));
  return {
    stages: cleanList(raw.stages, DEFAULT_STAGES),
    topics: cleanList(raw.topics, DEFAULT_TOPICS),
    target: Number.isFinite(target) && target >= 1 && target <= 30 ? target : DEFAULT_TARGET_MIN,
  };
}

/**
 * The fields a student may set on their own card. Anything else in the
 * patch — a status, somebody else's seat, a conference record — is
 * dropped here, so the only way those change is an instructor action.
 */
export function cleanStudentPatch(patch = {}, stageCount = DEFAULT_STAGES.length) {
  const out = {};
  if (patch.name !== undefined) out.name = cleanLine(patch.name, LIMITS.name);
  if (patch.topic !== undefined) out.topic = cleanLine(patch.topic, LIMITS.topic);
  if (patch.stage !== undefined) {
    const s = Number(patch.stage);
    if (Number.isInteger(s) && s >= 0 && s < stageCount) out.stage = s;
  }
  if (patch.mood !== undefined) {
    out.mood = MOOD_IDS.has(patch.mood) ? patch.mood : '';
  }
  return out;
}

/** A card as first created. `seat` is the server's random id for a phone. */
export function newCard(seat, now) {
  return {
    seat,
    name: '',
    topic: '',
    stage: 0,
    mood: '',
    moodAt: 0,
    joinedAt: now,
    updatedAt: now,
    ask: null,          // { about, note, at } while in line
    call: '',           // '' | 'with' (at the front now)
    callAt: 0,
    conferences: [],    // [{ start, end, about, note }]
    step: '',
    stepPending: false, // true between "done" and the student writing a step
  };
}

// ---------------------------------------------------------------- state

/** Has this student had at least one conference on this board? */
export const hasBeenSeen = (card) => (card.conferences?.length || 0) > 0;

/**
 * One word for where a student is, from the instructor's side.
 * Order matters: someone at the front with you is "with", even if they
 * were also in line a moment ago.
 */
export function statusOf(card) {
  if (card.call === 'with') return 'with';
  if (card.ask) return 'waiting';
  if (hasBeenSeen(card)) return 'seen';
  return 'working';
}

/**
 * The line, in the order the instructor should take it: first visits,
 * first come first served, then return visits the same way. Students
 * currently at the front are not in the line.
 *
 * The order is the instructor's alone. A phone is told it is on the list
 * and nothing more — no position, no "you're next" — so a student who
 * has asked goes back to their essay instead of watching a counter.
 * The instructor calls names aloud.
 */
export function queueOrder(cards) {
  const inLine = cards.filter((c) => c.ask && c.call !== 'with');
  const rank = (c) => (hasBeenSeen(c) ? 1 : 0);
  return inLine.sort((a, b) => rank(a) - rank(b)
    || a.ask.at - b.ask.at
    || String(a.seat).localeCompare(String(b.seat)));
}

/**
 * Why the instructor might want to check on a student who has not asked.
 * Returns a short reason, or '' when nothing stands out.
 *
 * Only what the student SAID, never how long it has been. Students fill
 * the card in once at the start of class and come back only to ask, so a
 * card that hasn't changed in forty minutes means nothing — a rule like
 * "still on stage one after 25 minutes" would flag every student who is
 * quietly getting on with it. What they told the room at check-in is
 * real, though: a student who says they're stuck, or who has no topic in
 * the week topics are due, is worth a look straight away.
 *
 * Only for students who are neither in line nor at the front. A student
 * already seen is flagged again only if they report being stuck AFTER
 * their conference — the thing it was meant to fix.
 */
export function attentionReason(card) {
  if (card.ask || card.call) return '';
  const lastEnd = hasBeenSeen(card) ? card.conferences[card.conferences.length - 1].end : 0;
  if (card.mood === 'stuck' && card.moodAt > lastEnd) return 'Says they’re stuck';
  if (lastEnd) return '';
  if (!card.topic) return 'No topic yet';
  return '';
}

/**
 * The instructor's board, sorted into the lanes it draws.
 *
 *   withYou  — at the front now
 *   asked    — the line (queueOrder)
 *   flagged  — hasn't asked, but something says look: [{ card, reason }]
 *   working  — everyone else who hasn't been seen
 *   seen     — had a conference, newest first
 *
 * Cards with no name yet are left out entirely: a phone that has opened
 * the page but not said who it is gives the instructor nothing to act on.
 */
export function lanes(cards) {
  const named = cards.filter((c) => c.name);
  const out = { withYou: [], asked: queueOrder(named), flagged: [], working: [], seen: [] };
  for (const c of named) {
    if (c.call === 'with') { out.withYou.push(c); continue; }
    if (c.ask) continue;
    const reason = attentionReason(c);
    if (reason) out.flagged.push({ card: c, reason });
    else if (hasBeenSeen(c)) out.seen.push(c);
    else out.working.push(c);
  }
  out.withYou.sort((a, b) => a.callAt - b.callAt);
  out.flagged.sort((a, b) => a.card.joinedAt - b.card.joinedAt);
  out.working.sort((a, b) => a.name.localeCompare(b.name));
  const lastEnd = (c) => c.conferences[c.conferences.length - 1].end;
  out.seen.sort((a, b) => lastEnd(b) - lastEnd(a));
  return out;
}

/** The numbers across the top of the board. */
export function coverage(cards) {
  const named = cards.filter((c) => c.name);
  return {
    joined: named.length,
    talked: named.filter(hasBeenSeen).length,
    waiting: named.filter((c) => c.ask && c.call !== 'with').length,
  };
}

/**
 * The log, one row per student, in the shape the instructor downloads.
 * Plain objects of strings and numbers — the page turns them into CSV
 * with app/logic.js's buildCSV, which also neutralises spreadsheet
 * formulas a student might have typed into a free-text box.
 */
export const LOG_HEADERS = [
  'Name', 'Topic', 'Stage', 'How it was going', 'Conferences',
  'Minutes in conference', 'Talked about', 'Their note', 'Next step (theirs)', 'Still in line',
];

export function logRows(cards, board) {
  const stages = board?.stages || DEFAULT_STAGES;
  const moodLabel = Object.fromEntries(MOODS.map((m) => [m.id, m.label]));
  return cards
    .filter((c) => c.name)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => {
      const confs = c.conferences || [];
      const minutes = confs.reduce((sum, x) => sum + Math.max(0, x.end - x.start), 0) / 60000;
      return {
        Name: c.name,
        Topic: c.topic,
        Stage: stages[c.stage] || '',
        'How it was going': moodLabel[c.mood] || '',
        Conferences: confs.length,
        'Minutes in conference': confs.length ? Math.max(1, Math.round(minutes)) : 0,
        'Talked about': confs.map((x) => x.about).filter(Boolean).join('; '),
        'Their note': confs.map((x) => x.note).filter(Boolean).join('; '),
        'Next step (theirs)': c.step,
        'Still in line': c.ask ? 'yes' : '',
      };
    });
}
