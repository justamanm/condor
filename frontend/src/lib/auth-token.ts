// Single source of truth for the JWT auth surface: storage key, header builder
// and a low-level authenticated fetch. Anything that talks to the API should go
// through `apiFetch` (lib/api.ts) for JSON; use `authFetch` for FormData uploads
// or binary/blob responses where forcing `Content-Type: application/json` is wrong.

export const TOKEN_KEY = "condor_token";
export const USER_KEY = "condor_user";
export const SESSION_REFRESHED_EVENT = "condor:session-refreshed";

let localRefreshPromise: Promise<boolean> | null = null;

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/** Authorization header for the current JWT, or `{}` if not logged in. */
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function refreshLocalSession(): Promise<boolean> {
  if (localRefreshPromise) return localRefreshPromise;

  localRefreshPromise = (async () => {
    const modeResponse = await fetch("/api/v1/auth/mode");
    if (!modeResponse.ok) return false;
    const mode = await modeResponse.json().catch(() => ({}));
    if (mode?.mode !== "local") return false;

    const loginResponse = await fetch("/api/v1/auth/local-login", {
      method: "POST",
    });
    if (!loginResponse.ok) return false;
    const session = await loginResponse.json().catch(() => null);
    if (!session?.token || !session?.user) return false;

    localStorage.setItem(TOKEN_KEY, session.token);
    localStorage.setItem(USER_KEY, JSON.stringify(session.user));
    window.dispatchEvent(
      new CustomEvent(SESSION_REFRESHED_EVENT, { detail: session }),
    );
    return true;
  })().catch(() => false).finally(() => {
    localRefreshPromise = null;
  });

  return localRefreshPromise;
}

function fetchWithCurrentToken(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  else headers.delete("Authorization");
  return fetch(path, { ...init, headers });
}

/**
 * Low-level fetch that injects the auth header without forcing a Content-Type.
 * Use for FormData uploads (transcribe) or blob responses (authenticated images).
 */
export async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const tokenUsed = getToken();
  const response = await fetchWithCurrentToken(path, init);
  if (response.status !== 401) return response;

  // Another request may already have renewed the session while this one was
  // in flight. In that case retry directly with the new token.
  if (getToken() !== tokenUsed) return fetchWithCurrentToken(path, init);

  // Local mode has no login step, so an expired 24-hour JWT should be renewed
  // invisibly. Telegram mode deliberately remains a real login boundary.
  if (await refreshLocalSession()) return fetchWithCurrentToken(path, init);
  return response;
}
