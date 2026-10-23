// The sign-in token (a JWT from /api/auth/login) lives in localStorage, so it survives restarts
// and is shared by every window of the app (the quick-capture window included).
const KEY = 'peblo-token';

export function getToken() {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

export function setToken(token) {
  try { localStorage.setItem(KEY, token); } catch { /* storage blocked: stay signed in for this session only */ }
}

export function clearToken() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Headers for requests that don't go through axios (fetch streams, downloads). */
export function authHeaders(extra = {}) {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

/** For fetch() calls: a 401 means the token was rejected, so sign out like an axios call would. */
export function signOutIfRejected(res) {
  if (res && res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event('peblo:signed-out'));
  }
  return res;
}
