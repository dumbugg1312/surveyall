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

export function storedPseudonym(sessionId) {
  try {
    return window.sessionStorage.getItem(KEY(sessionId));
  } catch {
    return null; // private browsing with storage disabled
  }
}

export function storePseudonym(sessionId, pseudonym) {
  try {
    window.sessionStorage.setItem(KEY(sessionId), pseudonym);
  } catch {
    /* fall back to in-memory only; the caller keeps its own copy */
  }
  return pseudonym;
}

/**
 * Get the label for this session, asking the server for one if needed.
 * @param {(id: string) => Promise<string>} claim
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
