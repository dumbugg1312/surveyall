/**
 * ============================================================
 *  Configuration — there is almost nothing to configure.
 * ============================================================
 *
 * SurveyAll runs as a single Cloudflare Worker that serves both this
 * site and its API, so the frontend talks to its own origin. There are
 * no keys to paste here and nothing secret in this file.
 *
 * Your instructor password is NOT here. It lives in Cloudflare's
 * encrypted secret store (`INSTRUCTOR_PASSWORD`), set from the dashboard
 * or `wrangler secret put`. Never put a password in this repository —
 * it is public.
 *
 * See docs/DEPLOYMENT.md.
 */

/**
 * Where the API lives. Leave empty for normal use: the site and the API
 * are the same Worker, so relative URLs are correct.
 *
 * Only set this if you are serving the static files from somewhere else
 * (e.g. opening them locally while pointing at a deployed Worker), in
 * which case use the full origin, e.g.
 *   'https://surveyall.your-name.workers.dev'
 */
export const API_BASE = '';

/**
 * Where students land when they scan the QR code.
 * Leave empty to detect it from the address bar — correct for everyone
 * except a split deployment.
 */
export const JOIN_BASE_URL = '';

/** Kept for compatibility with the page controllers. */
export function isConfigured() {
  return true;
}

/** Absolute URL for an API path. */
export function apiURL(path) {
  const base = API_BASE.replace(/\/+$/, '');
  const clean = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${clean}` : clean;
}

/** Base URL used to build join links and QR codes. */
export function joinBase() {
  if (JOIN_BASE_URL) return JOIN_BASE_URL.replace(/\/+$/, '');
  const { origin, pathname } = window.location;
  const dir = pathname.replace(/\/[^/]*$/, '');
  return `${origin}${dir}`.replace(/\/+$/, '');
}
