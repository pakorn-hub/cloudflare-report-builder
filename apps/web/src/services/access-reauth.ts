/**
 * Cloudflare Access session-expiry handling.
 *
 * When this app is deployed behind Cloudflare Access (see README → Security)
 * and the browser's Access session cookie is missing or expired, every /api/*
 * request is redirected at the edge to the Access login page. A fetch() can
 * NEVER complete that login — the login page lives on a cross-origin host
 * (cloudflareaccess.com) that sends no CORS headers, so the browser blocks the
 * redirected response and the fetch rejects with a bare TypeError. In the
 * console this reads as a confusing CORS error; in the UI it reads as a
 * generic network failure. Neither tells the user what to actually do.
 *
 * apiFetch() in services/api.ts therefore issues API requests with
 * redirect: "manual", which surfaces the redirect as an *observable*
 * opaque-redirect response instead of an opaque network failure. When that
 * is detected we call noteAccessRedirect(), which:
 *
 *   1. Navigates the page to a never-before-seen URL (cache-busted with a
 *      timestamp query param) exactly once per expiry *episode*. A top-level
 *      navigation is the only way to complete an Access login — Access shows
 *      its login page (or transparently re-authenticates a WARP-enrolled
 *      device) and returns the user via redirect_url. The cache-bust matters:
 *      a plain location.reload() can be served from the browser's HTTP cache,
 *      which would render the SPA shell again WITHOUT hitting the edge, so
 *      the login would never happen and the app would loop in a dead state.
 *      A URL the browser has never seen cannot come from cache.
 *
 *   2. Resets the guard as soon as any API call succeeds (see
 *      clearAccessReauthFlag() in apiFetch) — proving the session is valid
 *      again and re-arming the automatic reload for the NEXT expiry. Without
 *      this, only the first expiry in a tab's lifetime would self-heal.
 *
 *   3. If the session is still invalid after that one attempt (e.g. the
 *      Access policy rejected the login, or the document was served from
 *      cache anyway), does NOT navigate again — instead it dispatches
 *      ACCESS_EXPIRED_EVENT so App.tsx can show a blocking "Log in again"
 *      overlay whose button calls reauthenticateNow(). The sessionStorage
 *      guard makes an automatic reload loop impossible.
 */

const REAUTH_FLAG = "cf-access-reauth-attempted";
const REAUTH_PARAM = "_reauth";

/** Window event fired when the manual-recovery state is reached (the
 *  automatic reload was already spent for this expiry episode). */
export const ACCESS_EXPIRED_EVENT = "cf-access-session-expired";

export class AccessSessionExpiredError extends Error {
  constructor(reloading: boolean) {
    super(
      reloading
        ? "Your Cloudflare Access session has expired — reloading the page to re-authenticate…"
        : "Your Cloudflare Access session has expired — use the “Log in again” button to re-authenticate."
    );
    this.name = "AccessSessionExpiredError";
  }
}

export function isAccessSessionError(e: unknown): boolean {
  return e instanceof AccessSessionExpiredError;
}

/** Top-level navigation to a URL that cannot exist in the HTTP cache, so the
 *  request always reaches the edge and Access can run its login flow. */
function navigateForLogin(): void {
  window.location.replace(
    `${window.location.pathname}?${REAUTH_PARAM}=${Date.now()}${window.location.hash}`
  );
}

/**
 * Called when an API fetch came back as an opaque redirect — i.e. something at
 * the edge (in this deployment: Cloudflare Access) tried to send the request
 * to a login page instead of the API. Returns the error the caller should
 * throw, after arranging the re-login navigation if this is the first
 * detection of the current expiry episode.
 */
export function noteAccessRedirect(): AccessSessionExpiredError {
  let reloading = false;
  try {
    if (!sessionStorage.getItem(REAUTH_FLAG)) {
      sessionStorage.setItem(REAUTH_FLAG, "1");
      reloading = true;
      // Brief delay so the current render can show the "reloading…" message
      // before navigation, in case the navigation is slow or fails.
      window.setTimeout(navigateForLogin, 100);
    } else {
      // Guard already spent for this episode and the session is still dead —
      // surface the manual-recovery overlay instead of navigating again.
      window.dispatchEvent(new Event(ACCESS_EXPIRED_EVENT));
    }
  } catch {
    // sessionStorage unavailable (hardened privacy modes). We refuse to
    // auto-navigate without a loop guard — surface the overlay instead.
    window.dispatchEvent(new Event(ACCESS_EXPIRED_EVENT));
  }
  return new AccessSessionExpiredError(reloading);
}

/**
 * Called by apiFetch() after any NON-redirected API response — reaching the
 * app at all proves the request passed the edge, i.e. the Access session is
 * valid. Re-arms the automatic re-login for the next expiry episode and
 * strips the _reauth cache-bust param from the URL once it has served its
 * purpose.
 */
export function clearAccessReauthFlag(): void {
  try {
    sessionStorage.removeItem(REAUTH_FLAG);
    const u = new URL(window.location.href);
    if (u.searchParams.has(REAUTH_PARAM)) {
      u.searchParams.delete(REAUTH_PARAM);
      history.replaceState(null, "", u.pathname + u.search + u.hash);
    }
  } catch {
    // Best-effort only.
  }
}

/** Manual recovery action (the overlay's "Log in again" button): clear the
 *  once-per-episode guard and navigate through the Access login again. */
export function reauthenticateNow(): void {
  try {
    sessionStorage.removeItem(REAUTH_FLAG);
  } catch {
    // Even without storage, a manual action may safely navigate.
  }
  navigateForLogin();
}
