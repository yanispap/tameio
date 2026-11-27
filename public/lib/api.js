// This install's key. The server wants it on every /api call; it arrives once, in the
// address the terminal prints (http://127.0.0.1:4321/#token=...), and is kept in this browser.
const KEY = 'tameio-token';
let mem = new URLSearchParams(location.hash.slice(1)).get('token');
if (mem) {
  try { localStorage.setItem(KEY, mem); } catch {}
  history.replaceState(null, '', location.pathname + location.search); // off the address bar and history
}
// Pasting the address into a Tameio tab that is already open only changes the hash: reload to read the key.
addEventListener('hashchange', () => { if (new URLSearchParams(location.hash.slice(1)).get('token')) location.reload(); });

export function token() {
  try { return localStorage.getItem(KEY) ?? mem; } catch { return mem; }
}

/** fetch for Tameio's own /api: the same, plus the key. */
export function apiFetch(url, opts = {}) {
  return fetch(url, { ...opts, headers: { ...opts.headers, 'X-Tameio-Token': token() ?? '' } });
}
