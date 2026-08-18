/**
 * SurveyAll — participant-side state.
 *
 * FERPA note, because this is the file where it would be easiest to get
 * wrong: the pseudonym lives in `sessionStorage`, keyed by session id.
 *
 *  • sessionStorage is per-tab and is destroyed when the tab closes.
 *  • The key includes the session id, so a student in Tuesday's class and
 *    the same student in Thursday's class hold two unrelated labels with
 *    nothing linking them.
 *  • Nothing here is ever sent to an analytics service, and no cookie is
 *    set. The label is the only thing stored, and it is a random pair of
 *    words with no relationship to the person.
 *
 * Deliberately NOT done: persisting a device id in localStorage. That
 * would let results be correlated across sessions, which is precisely the
 * step that would turn anonymous data back into an education record.
 */

const KEY = (sessionId) => `surveyall:pseudonym:${sessionId}`;
const ANSWER_KEY = (sessionId, questionId, round) =>
  `surveyall:answered:${sessionId}:${questionId}:${round}`;
const UPVOTE_KEY = (sessionId) => `surveyall:upvoted:${sessionId}`;
const SLOT_KEY = (sessionId, questionId, round) =>
  `surveyall:slot:${sessionId}:${questionId}:${round}`;

/**
 * The stored value is `{ pseudonym, token }`. The token is the server's
 * signature over the label, replayed on every answer so the server can tell
 * this device apart from anyone else sending the same label. It is not an
 * identity: it says "this label was issued here", nothing about who holds it.
 *
 * Values written before the token existed are plain strings. Those are
 * treated as missing so the device re-claims and gets a signed label,
 * rather than silently failing every submit with a 403.
 */
export function storedPseudonym(sessionId) {
  try {
    const raw = window.sessionStorage.getItem(KEY(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.pseudonym && parsed.token) return parsed;
    return null;
  } catch {
    return null; // private browsing, or a legacy plain-string value
  }
}

export function storePseudonym(sessionId, entry) {
  try {
    window.sessionStorage.setItem(KEY(sessionId), JSON.stringify(entry));
  } catch {
    /* fall back to in-memory only; the caller keeps its own copy */
  }
  return entry;
}

/**
 * Get the signed label for this session, asking the server for one if needed.
 * @param {(id: string) => Promise<{pseudonym: string, token: string}>} claim
 * @returns {Promise<{pseudonym: string, token: string}>}
 */
export async function ensurePseudonym(sessionId, claim) {
  const existing = storedPseudonym(sessionId);
  if (existing) return existing;
  const fresh = await claim(sessionId);
  return storePseudonym(sessionId, fresh);
}

/** Remember what this device answered, so re-opening restores the choice. */
export function rememberAnswer(sessionId, questionId, round, payload) {
  try {
    window.sessionStorage.setItem(
      ANSWER_KEY(sessionId, questionId, round), JSON.stringify(payload));
  } catch { /* ignore */ }
}

export function recallAnswer(sessionId, questionId, round) {
  try {
    const raw = window.sessionStorage.getItem(ANSWER_KEY(sessionId, questionId, round));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function forgetAnswer(sessionId, questionId, round) {
  try {
    window.sessionStorage.removeItem(ANSWER_KEY(sessionId, questionId, round));
  } catch { /* ignore */ }
}

/**
 * How many answers this device has already sent to a multi-submit question.
 *
 * This has to live next to the pseudonym or it is worse than useless. The
 * server's row key is (session, question, round, pseudonym, slot), and the
 * pseudonym survives a reload because it is in sessionStorage. The slot
 * counter used to live only in a page variable, so a word-cloud student who
 * sent "curious" (slot 0) and "tired" (slot 1), then reloaded, was put back
 * on slot 0 — and their third word silently overwrote their first. Nothing
 * on screen said so; the word simply stopped being in the cloud.
 *
 * Keyed by question and round, which is also why nothing has to remember to
 * reset it: moving to the next question is a different key, already at 0.
 */
export function rememberSlot(sessionId, questionId, round, slot) {
  try {
    window.sessionStorage.setItem(SLOT_KEY(sessionId, questionId, round), String(slot));
  } catch { /* ignore */ }
}

export function recallSlot(sessionId, questionId, round) {
  try {
    const raw = window.sessionStorage.getItem(SLOT_KEY(sessionId, questionId, round));
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Local-only guard so one phone doesn't upvote the same question twice. */
export function upvotedIds(sessionId) {
  try {
    const raw = window.sessionStorage.getItem(UPVOTE_KEY(sessionId));
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

export function markUpvoted(sessionId, id) {
  const set = upvotedIds(sessionId);
  set.add(id);
  try {
    window.sessionStorage.setItem(UPVOTE_KEY(sessionId), JSON.stringify([...set]));
  } catch { /* ignore */ }
  return set;
}

/** Read a join code from '#ABC123' or '?code=ABC123'. */
export function codeFromLocation(loc = window.location) {
  const hash = (loc.hash || '').replace(/^#/, '').trim();
  if (hash) return decodeURIComponent(hash).toUpperCase();
  const params = new URLSearchParams(loc.search || '');
  const q = params.get('code') || params.get('c');
  return q ? q.trim().toUpperCase() : '';
}
