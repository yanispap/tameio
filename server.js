// Tameio: a local server. Listens on 127.0.0.1 (and on ::1, so no other program can take localhost).
// Every /api call needs this install's key, from data/token, which the terminal prints once in the address to open.
// The e-food password is used once to log in and never stored. The sessions it and Wolt give back are kept in data/ (mode 0600) for menus and auto-sync.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir, rm, rename, chmod } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBox, normalizeEfood, normalizeWolt, detectAndNormalize } from './public/lib/normalize.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const DATA = join(ROOT, 'data', 'orders.json');
// The spot the stores page searches around, kept here so it survives any browser or address you open Tameio from.
const LOC = join(ROOT, 'data', 'location.json');
const PORT = Number(process.env.PORT) || 4321;
// Says plainly what is asking. Tameio never poses as a browser or as the platforms' apps.
const UA = 'Tameio (+https://github.com/yanispap/tameio)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

async function getJson(url, headers, name) {
  const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA, ...headers } });
  if (r.status === 401 || r.status === 403) throw new UserError(`Το ${name} δεν δέχτηκε τη σύνδεση. Ξαναμπές και δοκίμασε πάλι.`, 401);
  if (r.status === 429) throw new UserError(`Το ${name} ζητάει να περιμένεις λίγο. Δοκίμασε σε μερικά λεπτά.`, 429);
  if (!r.ok) throw new UserError(`Το ${name} απάντησε ${r.status}.`, 502);
  return r.json();
}

// ---------- e-food ----------
async function efoodSession({ email, password, session }) {
  if (session) return String(session).trim();
  if (!email || !password) throw new UserError('Βάλε email και κωδικό του e-food.');
  const r = await fetch('https://www.e-food.gr/users/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ email: String(email).trim(), password: String(password) }),
  });
  const body = await r.json().catch(() => null);
  const id = body?.data?.session_id;
  if (!r.ok || body?.status === 'error' || typeof id !== 'string') {
    throw new UserError(typeof body?.message === 'string' ? body.message : 'Η σύνδεση στο e-food απέτυχε.', 401);
  }
  return id;
}

// The e-food session id is kept in data/efood-session.json (owner-only, git-ignored)
// so store pages can show e-food menus, which e-food only serves to signed-in users.
const EFOOD_SESSION = join(ROOT, 'data', 'efood-session.json');
async function efoodSaved() { try { return JSON.parse(await readFile(EFOOD_SESSION, 'utf8')).session; } catch { return null; } }

// With no email and password, Ανανέωση uses the saved session; if e-food no longer accepts it, it is dropped and the form asks again.
async function syncEfood(creds) {
  const saved = !creds.email && !creds.password && !creds.session ? await efoodSaved() : null;
  if (saved) {
    try { return await efoodHistory(saved); } catch (e) {
      if (e.status !== 401) throw e;
      await rm(EFOOD_SESSION, { force: true });
      throw new UserError('Η σύνδεση με το e-food έληξε. Βάλε ξανά email και κωδικό.', 401);
    }
  }
  const session = await efoodSession(creds);
  await mkdir(join(ROOT, 'data'), { recursive: true, mode: 0o700 });
  await writeFile(EFOOD_SESSION, JSON.stringify({ session }), { mode: 0o600 });
  return efoodHistory(session);
}

async function efoodHistory(session) {
  const all = [];
  for (let offset = 0, page = 0; page < 100; page++) {
    const u = new URL('https://api.e-food.gr/api/v1/user/orders/history');
    u.search = new URLSearchParams({ limit: '100', offset: String(offset), mode: 'extended' });
    const body = await getJson(u, { 'x-core-session-id': session }, 'e-food');
    if (body?.error_code === 'authentication_error') throw new UserError('Το e-food δεν δέχτηκε τη σύνδεση.', 401);
    const data = body?.data;
    if (!Array.isArray(data?.orders)) throw new UserError('Το e-food έστειλε απάντηση που δεν αναγνωρίζω.', 502);
    all.push(...data.orders);
    offset += data.orders.length;
    if (!data.hasNext || !data.orders.length) break;
    await sleep(400);
  }
  return normalizeEfood(all);
}

// ---------- Wolt ----------
// With the user's consent, the Wolt session (from the __wtoken cookie) is kept in
// data/wolt-session.json (owner-only, git-ignored) so Tameio can refresh it and sync
// on its own. Wolt rotates refresh tokens, so every refresh saves the new pair.
const WOLT_SESSION = join(ROOT, 'data', 'wolt-session.json');

function parseWtoken(raw) {
  let v = String(raw ?? '').trim().replace(/^__wtoken=/, '');
  let obj = null;
  try { obj = JSON.parse(decodeURIComponent(v)); } catch {}
  if (!obj?.refreshToken || !obj?.accessToken) throw new UserError('Αυτό δεν μοιάζει με την τιμή του cookie __wtoken. Αντέγραψε όλη την τιμή του.');
  return { accessToken: obj.accessToken, refreshToken: obj.refreshToken, expiresAt: jwtExp(obj.accessToken) };
}
function jwtExp(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp * 1000; } catch { return 0; }
}
async function loadWoltSession() {
  try { return JSON.parse(await readFile(WOLT_SESSION, 'utf8')); } catch { return null; }
}
async function saveWoltSession(sess) {
  await mkdir(join(ROOT, 'data'), { recursive: true, mode: 0o700 });
  await writeFile(WOLT_SESSION, JSON.stringify(sess), { mode: 0o600 });
}
let refreshing = null;
async function woltAccess() {
  const sess = await loadWoltSession();
  if (!sess) return null;
  if (sess.expiresAt - Date.now() > 60e3) return sess.accessToken;
  // One refresh at a time: a second concurrent refresh would burn the rotated token.
  refreshing ??= (async () => {
    const r = await fetch('https://authentication.wolt.com/v1/wauth2/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': UA },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: sess.refreshToken }),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body?.access_token) {
      // Only a rejected token ends the session; an outage or rate limit keeps it for the next try.
      if (r.status !== 400 && r.status !== 401) throw new UserError('Το Wolt δεν απαντάει αυτή τη στιγμή. Δοκίμασε σε λίγο.', 503);
      await rm(WOLT_SESSION, { force: true });
      throw new UserError('Η σύνδεση με το Wolt έληξε. Βάλε ξανά το cookie __wtoken.', 401);
    }
    const next = { accessToken: body.access_token, refreshToken: body.refresh_token ?? sess.refreshToken, expiresAt: Date.now() + (body.expires_in ?? 1800) * 1000 };
    await saveWoltSession(next);
    return next.accessToken;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function syncWolt({ token } = {}) {
  if (token) await saveWoltSession(parseWtoken(token));
  const access = await woltAccess();
  if (!access) throw new UserError('Βάλε την τιμή του cookie __wtoken από το wolt.com.');
  const auth = { Authorization: `Bearer ${access}` };
  const all = [];
  let next = null;
  for (let page = 0; page < 200; page++) {
    const u = new URL('https://consumer-api.wolt.com/order-xp/web/v1/pages/orders');
    if (next) u.searchParams.set('page_token', next);
    const body = await getJson(u, auth, 'Wolt');
    all.push(...(body?.orders ?? []));
    next = body?.next_page_token ?? null;
    if (!next || !body?.orders?.length) break;
    await sleep(600);
  }
  return normalizeWolt(all);
}

// ---------- Box ----------
// Box answers only its own app and website (anything else gets HTTP 418), so there is no
// server-side Box sync: the bookmarklet hands over what box.gr itself loaded (see /api/import).

const SYNC = { efood: syncEfood, wolt: syncWolt };

// ---------- stores and menus (public data, no login) ----------
const cache = new Map();
async function cached(key, ms, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value); // bounded: oldest entry goes first
  return value;
}
// Coordinates sent to e-food and Wolt are rounded to 3 decimals, about 100 m: enough for shops and fees, not a doorstep.
const r3 = (x) => Math.round(x * 1000) / 1000;
const centsOrNull = (e) => (typeof e === 'number' && Number.isFinite(e) ? Math.round(e * 100) : null);

async function efoodStores(lat, lng) {
  const u = new URL('https://api.e-food.gr/api/v1/restaurants');
  u.search = new URLSearchParams({ latitude: lat, longitude: lng });
  const body = await getJson(u, {}, 'e-food');
  return (body?.data?.restaurants ?? []).map((r) => ({
    platform: 'efood',
    id: `efood:${r.id}`,
    name: r.title,
    url: r.slug ? `https://www.e-food.gr/delivery${r.slug}` : 'https://www.e-food.gr/',
    image: r.cover || r.logo || null,
    logo: r.logo || null,
    rating: typeof r.average_rating === 'number' ? r.average_rating : null, // out of 5
    ratingCount: Number(r.num_ratings) || 0,
    eta: r.delivery_eta ?? null,
    deliveryCost: centsOrNull(r.delivery_cost),
    minOrder: centsOrNull(r.minimum_order),
    freeDelivery: !!r.has_free_delivery,
    offers: [...new Set([...(r.offers ?? []).map((o) => o.title), ...(r.discount_tags ?? []), ...(r.offer_tags ?? [])].filter(Boolean))].slice(0, 6),
    cuisines: [...new Set([r.basic_cuisine, ...(r.cuisines ?? [])].map((c) => (typeof c === 'string' ? c : c?.name)).filter(Boolean))],
    open: r.is_open !== false,
    distance: typeof r.distance === 'number' ? r.distance : null,
    lat: r.address?.latitude ?? null,
    lng: r.address?.longitude ?? null,
    ownDelivery: !!r.has_own_delivery,
  }));
}

async function woltStores(lat, lng) {
  const u = new URL('https://restaurant-api.wolt.com/v1/pages/restaurants');
  u.search = new URLSearchParams({ lat, lon: lng });
  const body = await getJson(u, {}, 'Wolt');
  const city = body?.city_data?.slug ?? 'athens';
  const seen = new Set();
  return (body?.sections ?? []).flatMap((s) => s.items ?? []).filter((i) => i.venue?.slug && !seen.has(i.venue.slug) && seen.add(i.venue.slug)).map((i) => {
    const v = i.venue;
    return {
      platform: 'wolt',
      id: `wolt:${v.id}`,
      slug: v.slug,
      name: v.name,
      url: `https://wolt.com/el/grc/${city}/${v.product_line === 'restaurant' || !v.product_line ? 'restaurant' : 'venue'}/${v.slug}`,
      image: i.image?.url ?? null,
      logo: null,
      rating: typeof v.rating?.score === 'number' ? v.rating.score / 2 : null, // Wolt scores out of 10
      ratingCount: v.rating?.volume ?? 0,
      eta: v.estimate_range || (v.estimate ? `${v.estimate}'` : null),
      deliveryCost: null,
      minOrder: null,
      freeDelivery: false,
      offers: (v.promotions ?? []).map((p) => p.text ?? p.title).filter(Boolean),
      cuisines: v.tags ?? [],
      open: v.online !== false,
      distance: null,
      description: v.short_description ?? null,
      hasMenu: true,
      lat: Array.isArray(v.location) ? v.location[1] : null,
      lng: Array.isArray(v.location) ? v.location[0] : null,
      // The anonymous feed never says which venues take Wolt+; null means unknown.
      woltPlus: v.show_wolt_plus ? true : null,
    };
  });
}

// Wolt publishes each venue's fee formula: a basket-size part (small-order fee,
// then a % service fee with a cap) plus a distance part. We return it as is.
const boxImg = (x) => { const p = x?.path ?? x; return typeof p === 'string' && p ? (p.startsWith('http') ? p : `https://images.box.gr/${p.replace(/^\//, '')}`) : null; };
const firstNum = (o, keys) => { for (const k of keys) { const v = k.split('.').reduce((a, b) => a?.[b], o); if (typeof v === 'number' && Number.isFinite(v)) return v; } return null; };
let boxShapeLogged = false;

// Box only answers its own web and mobile clients (others get HTTP 418), so Tameio never calls it.
// The bookmarklet hands over the shop list box.gr itself loaded; we keep it in data/box-shops.json.
const BOX_SHOPS = join(ROOT, 'data', 'box-shops.json');
const boxImage = (x) => (x?.path && x?.name ? `${x.path}${x.name}.${x.ext ?? 'png'}` : null);

export function normalizeBoxShop(x) {
  const tiers = Array.isArray(x.deliveryFees) ? x.deliveryFees.filter((t) => t && typeof t === 'object' && Number.isFinite(t.minCartPrice) && Number.isFinite(t.fee)).sort((a, b) => a.minCartPrice - b.minCartPrice) : [];
  return {
    platform: 'box',
    id: `box:${x._id}`,
    name: x.name,
    url: x.locationKey && x.vanity_url ? `https://box.gr/delivery/${x.locationKey}/${x.vanity_url}` : 'https://box.gr/',
    image: boxImage(x.webImage) ?? boxImage(x.mobileImage) ?? boxImage(x.logo),
    logo: boxImage(x.logo),
    rating: typeof x.ratingOverall === 'number' ? x.ratingOverall : null,
    ratingCount: Number(x.ratingCounter) || 0,
    eta: x.deliveryEstimationTime ?? null,
    deliveryCost: tiers[0]?.fee ?? null,          // cents, for the smallest basket
    deliveryTiers: tiers,                          // [{ minCartPrice, fee }] in cents
    minOrder: x.minimumAllowedDeliveryOrderTotalPrice ?? null,
    freeDelivery: tiers.length > 0 && tiers.every((t) => t.fee === 0),
    offers: [...(x.offerStickers ?? [])].filter((o) => typeof o === 'string'),
    cuisines: typeof x.cuisines === 'string' ? x.cuisines.split(',').map((c) => c.trim()).filter(Boolean) : [],
    open: x.available !== false && x.delivery !== false,
    lat: Number(x.address?.latitude) || null,
    lng: Number(x.address?.longitude) || null,
  };
}

async function boxStores() {
  let saved = null;
  try { saved = JSON.parse(await readFile(BOX_SHOPS, 'utf8')); } catch {}
  if (!saved?.shops?.length) throw new UserError('Πάτα «Tameio sync» στο box.gr για να εμφανίζονται και τα μαγαζιά του Box.', 404);
  return saved.shops.filter((x) => x?.name).map(normalizeBoxShop);
}

async function woltFees(slug, lat, lng) {
  const u = new URL(`https://consumer-api.wolt.com/order-xp/web/v1/venue/slug/${encodeURIComponent(slug)}/dynamic/`);
  u.search = new URLSearchParams({ lat, lon: lng });
  // Signed in, Wolt answers with your own prices (Wolt+ included); otherwise the public ones.
  const access = await woltAccess().catch(() => null);
  const body = await getJson(u, access ? { Authorization: `Bearer ${access}` } : {}, 'Wolt');
  const ds = body?.venue_raw?.delivery_specs ?? {};
  return {
    pricing: ds.delivery_pricing ?? null,
    withSubscription: ds.delivery_pricing_with_subscription ?? null,
    subscription: ds.delivery_pricing?.meta ?? null,
    minimum: ds.order_minimum_possible ?? 0,             // below this Wolt refuses the order
    noSurcharge: ds.order_minimum_no_surcharge ?? body?.order_minimum ?? 0, // below this a small-order fee is added
    personal: !!access,
    hasWoltPlus: ds.subscription?.active_plan_id != null ? true : access ? false : null,
    deliveryDiscounts: (body?.venue_raw?.discounts ?? []).filter((d) => d.effects?.delivery_discount && !d.conditions?.has_wolt_plus).map((d) => d.description?.title).filter(Boolean),
  };
}

// Finds menu items in whatever shape the response has: objects with a name and a price.
export function extractItems(json) {
  const out = [];
  const seen = new Set();
  const walk = (o, category) => {
    if (Array.isArray(o)) return o.forEach((x) => walk(x, category));
    if (!o || typeof o !== 'object') return;
    const name = typeof o.name === 'string' ? o.name : typeof o.title === 'string' ? o.title : null;
    const price = [o.price, o.unit_price, o.final_price, o.full_price].find((v) => typeof v === 'number' && v > 0);
    if (name && price != null && !seen.has(name + price)) {
      seen.add(name + price);
      const orig = [o.full_price, o.original_price, o.price_before_discount].find((v) => typeof v === 'number' && v > price);
      out.push({ name, price: Math.round(price * 100), originalPrice: orig ? Math.round(orig * 100) : null, category: category ?? null,
        description: typeof o.description === 'string' ? o.description.slice(0, 160) : null, image: typeof o.image === 'string' ? o.image : o.images?.[0] ?? null, available: o.is_available !== false });
    }
    const nextCat = Array.isArray(o.products ?? o.items) && name && price == null ? name : category;
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, nextCat);
  };
  walk(json);
  return out;
}

// Where to price the menu for: the spot you chose on the stores page (to about 100 m), else the centre of Athens.
// Never your Box delivery addresses: those stay on this computer.
async function efoodLoc() {
  const loc = await readFile(LOC, 'utf8').then(JSON.parse).catch(() => null);
  return Number.isFinite(loc?.lat) && Number.isFinite(loc?.lng) ? { lat: r3(loc.lat), lng: r3(loc.lng) } : { lat: 37.984, lng: 23.728 };
}

// The shape of e-food's /v3/shops/catalog: menu.categories[].items[] (and nested categories), plus menu.offers[].
function parseEfoodCatalog(data) {
  const out = [];
  const cents = (v) => (typeof v === 'number' && v > 0 ? Math.round(v * 100) : null);
  const fromText = (t) => { const m = String(t ?? '').match(/(\d+)[,.](\d{2})/); return m ? +m[1] * 100 + +m[2] : null; };
  for (const o of data?.menu?.offers ?? []) {
    const price = fromText(o.calculated_price);
    if (o.title && price) out.push({ name: o.title, price, originalPrice: null, category: 'Προσφορές', description: o.description || null, image: o.images?.menu ?? null, available: o.is_available !== false });
  }
  const walk = (cat) => {
    for (const it of cat.items ?? []) {
      const price = cents(it.price);
      if (!it.name || price == null) continue;
      const orig = cents(it.original_price);
      out.push({ name: it.name, price, originalPrice: orig && orig > price ? orig : null, category: cat.name ?? null,
        description: it.description ? String(it.description).slice(0, 160) : null, image: it.images?.menu ?? null, available: it.is_available !== false });
    }
    (cat.categories ?? []).forEach(walk);
  };
  (data?.menu?.categories ?? []).forEach(walk);
  return out;
}

async function efoodMenu(id) {
  const session = await efoodSaved();
  if (!session) throw new UserError('Σύνδεσε ξανά το e-food στις Πηγές για να εμφανίζεται το μενού.', 401);
  const headers = { 'x-core-session-id': session };
  // The endpoint e-food's own shop page uses (seen in its network traffic, 2026-11-26).
  const loc = await efoodLoc();
  const tried = [];
  const urls = [
    `v3/shops/catalog?${new URLSearchParams({ shop_id: id, ...(loc ? { latitude: loc.lat, longitude: loc.lng } : {}) })}`,
  ];
  for (const path of urls) {
    const r = await fetch(`https://api.e-food.gr/${path}`, { headers: { Accept: 'application/json', 'User-Agent': UA, ...headers } });
    const body = await r.json().catch(() => null);
    tried.push(`${path.split('?')[0]}: ${r.status} ${body?.error_code ?? ''}`.trim());
    if (body?.error_code === 'authentication_error') throw new UserError('Η σύνδεση με το e-food έληξε. Σύνδεσε ξανά το e-food στις Πηγές.', 401);
    const items = parseEfoodCatalog(body?.data);
    if (items.length) return items;
  }
  console.log('e-food menu not found:', tried.join(' | '));
  throw new UserError('Δεν βρέθηκε το μενού στο e-food.', 404);
}

async function woltMenu(slug, access = null) {
  // With your Wolt session (auto-sync on) Wolt answers as it does for you, Wolt+ prices included.
  const body = await getJson(`https://consumer-api.wolt.com/consumer-api/consumer-assortment/v1/venues/slug/${encodeURIComponent(slug)}/assortment`, access ? { Authorization: `Bearer ${access}` } : {}, 'Wolt');
  const cats = new Map();
  const walk = (c) => { for (const id of c.item_ids ?? []) cats.set(id, c.name); (c.subcategories ?? []).forEach(walk); };
  (body?.categories ?? []).forEach(walk);
  return (body?.items ?? []).filter((i) => i?.name && i.price != null).map((i) => ({
    name: i.name,
    price: i.price,
    originalPrice: i.original_price ?? null, // only set while the item is marked down
    category: cats.get(i.id) ?? null,
    description: i.description ? String(i.description).slice(0, 160) : null,
    image: i.images?.[0]?.url ?? null,
    available: i.disabled_info == null,
  }));
}

// ---------- automatic Wolt sync ----------
// One run at a time, and at most one attempt per half hour, even when it fails.
let autoRun = null, autoTried = 0;
function autoSyncWolt() {
  return (autoRun ??= (async () => {
    if (!(await loadWoltSession())) return;
    const d = await loadData();
    if (Date.now() - Math.max(autoTried, d.meta.wolt?.at ?? 0) < 30 * 60e3) return;
    autoTried = Date.now();
    try {
      await store('wolt', await syncWolt(), 'auto');
      console.log('Wolt: αυτόματος συγχρονισμός OK');
    } catch (e) {
      await withData((d2) => { d2.meta.wolt = { ...(d2.meta.wolt ?? {}), error: e.message }; });
    }
  })().finally(() => { autoRun = null; }));
}
setInterval(() => autoSyncWolt().catch(() => {}), 6 * 3600e3).unref();

// ---------- storage ----------
const EMPTY = () => ({ orders: { efood: [], wolt: [], box: [] }, meta: {} });
async function loadData() {
  let raw;
  try { raw = await readFile(DATA, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return EMPTY(); throw e; }
  // A damaged file is never treated as empty: the next save would wipe every platform.
  try { return JSON.parse(raw); } catch { throw new UserError('Το αρχείο data/orders.json είναι χαλασμένο. Μετακίνησέ το αλλού (ή σβήσε το) και ξανασυνδέσου.', 500); }
}
async function saveData(d) {
  await mkdir(join(ROOT, 'data'), { recursive: true, mode: 0o700 });
  // Write a new file and swap it in, so a crash mid-write leaves the old one intact.
  const tmp = `${DATA}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(d), { mode: 0o600 });
  await rename(tmp, DATA);
}
// Every read-change-write of orders.json goes through this queue, so two syncs at once never lose one.
let queue = Promise.resolve();
function withData(change) {
  const run = queue.then(async () => { const d = await loadData(); await change(d); await saveData(d); return d; });
  queue = run.catch(() => {});
  return run;
}
// New orders are merged into the ones we have, by id, so a short list (Box keeps only the last 100) never drops older ones.
function store(platform, orders, source) {
  return withData((d) => {
    const byId = new Map((d.orders[platform] ?? []).map((o) => [o.id, o]));
    for (const o of orders) byId.set(o.id, o);
    d.orders[platform] = [...byId.values()].sort((a, b) => b.ts - a.ts);
    d.meta[platform] = { at: Date.now(), count: d.orders[platform].length, source };
  });
}

// ---------- this install's key ----------
// Made once, kept in data/token (owner-only). The page gets it from the address the terminal prints.
const TOKEN_FILE = join(ROOT, 'data', 'token');
async function installToken() {
  await mkdir(join(ROOT, 'data'), { recursive: true, mode: 0o700 });
  const saved = await readFile(TOKEN_FILE, 'utf8').then((t) => t.trim()).catch(() => '');
  if (saved.length >= 32) return saved;
  const t = randomBytes(24).toString('base64url');
  await writeFile(TOKEN_FILE, t, { mode: 0o600 });
  return t;
}
const TOKEN = Buffer.from(await installToken());
const tokenOk = (v) => { const b = Buffer.from(String(v ?? '')); return b.length === TOKEN.length && timingSafeEqual(b, TOKEN); };
const HOME = `http://127.0.0.1:${PORT}`;

// ---------- http ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

async function readBody(req, limit) {
  let size = 0; const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new UserError('Το αρχείο είναι πολύ μεγάλο.', 413);
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new UserError('Μη έγκυρο JSON.'); }
}

// No other site may show Tameio in a frame; scripts, styles and fonts come only from Tameio itself.
const SECURITY = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
};
const send = (res, status, body) => {
  res.writeHead(status, { ...SECURITY, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, HOME);
    const isApi = url.pathname.startsWith('/api/');
    // One address only. localhost and [::1] are sent to it, so the bookmarklet and the browser never learn another one.
    if ([`localhost:${PORT}`, `[::1]:${PORT}`].includes(req.headers.host) && !isApi && req.method === 'GET') {
      res.writeHead(302, { Location: HOME + url.pathname + url.search }); return res.end();
    }
    // Reject other hostnames (DNS rebinding).
    if (req.headers.host !== `127.0.0.1:${PORT}`) throw new UserError('Forbidden', 403);
    // Requests that other websites trigger (even <img src>) are refused, so a site cannot tell Tameio is running.
    // The one exception is opening the page itself, which the bookmarklet does from wolt.com or box.gr.
    const opening = req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document' && !isApi;
    if (['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']) && !opening) throw new UserError('Forbidden', 403);
    if (isApi && req.method !== 'GET' && req.headers.origin && req.headers.origin !== HOME) throw new UserError('Forbidden', 403);
    // Any program on this computer can reach 127.0.0.1, so the API also wants this install's key.
    if (isApi && !tokenOk(req.headers['x-tameio-token'])) throw new UserError('Άνοιξε το Tameio από τη διεύθυνση που έγραψε το τερματικό όταν το ξεκίνησες.', 401);

    if (url.pathname === '/api/orders' && req.method === 'GET') {
      const d = await loadData();
      d.woltAuto = !!(await loadWoltSession());
      d.efoodSession = !!(await efoodSaved());
      autoSyncWolt().catch(() => {}); // refreshes in the background; the page polls for the result
      return send(res, 200, d);
    }

    if (url.pathname === '/api/location' && req.method === 'GET') {
      const loc = await readFile(LOC, 'utf8').then(JSON.parse).catch(() => null);
      return send(res, 200, { loc });
    }

    if (url.pathname === '/api/location' && req.method === 'PUT') {
      const { lat, lng } = await readBody(req, 1_000);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new UserError('Λάθος τοποθεσία.');
      await mkdir(join(ROOT, 'data'), { recursive: true, mode: 0o700 });
      await writeFile(LOC, JSON.stringify({ lat, lng }), { mode: 0o600 });
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/api/efood/session' && req.method === 'DELETE') {
      await rm(EFOOD_SESSION, { force: true });
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/api/wolt/session' && req.method === 'DELETE') {
      await rm(WOLT_SESSION, { force: true });
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/api/stores' && req.method === 'GET') {
      const lat = r3(Number(url.searchParams.get('lat'))), lng = r3(Number(url.searchParams.get('lng')));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new UserError('Λείπει η τοποθεσία.');
      const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
      const zip = (url.searchParams.get('zip') ?? '').replace(/\D/g, '').slice(0, 5) || null;
      const [efood, wolt, box] = await Promise.allSettled([
        cached(`ef:${key}`, 30 * 60e3, () => efoodStores(lat, lng)),
        cached(`wo:${key}`, 30 * 60e3, () => woltStores(lat, lng)),
        boxStores(),
      ]);
      return send(res, 200, {
        stores: [...(efood.value ?? []), ...(wolt.value ?? []), ...(box.value ?? [])],
        errors: { efood: efood.reason?.message ?? null, wolt: wolt.reason?.message ?? null, box: box.reason?.message ?? null },
      });
    }

    const fees = url.pathname.match(/^\/api\/fees\/wolt\/([a-z0-9-]+)$/);
    if (fees && req.method === 'GET') {
      const lat = r3(Number(url.searchParams.get('lat'))), lng = r3(Number(url.searchParams.get('lng')));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new UserError('Λείπει η τοποθεσία.');
      return send(res, 200, await cached(`fees:${fees[1]}:${lat.toFixed(3)},${lng.toFixed(3)}`, 30 * 60e3, () => woltFees(fees[1], lat, lng)));
    }

    if (url.pathname === '/api/fees/wolt-batch' && req.method === 'POST') {
      const body = await readBody(req, 20_000);
      const { slugs } = body, lat = r3(body.lat), lng = r3(body.lng);
      if (!Array.isArray(slugs) || !Number.isFinite(lat) || !Number.isFinite(lng)) throw new UserError('Λάθος αίτημα.');
      const list = [...new Set(slugs.filter((x) => typeof x === 'string' && /^[a-z0-9-]+$/.test(x)))].slice(0, 60);
      const out = {};
      // A few at a time, so Wolt sees a person browsing rather than a burst.
      for (let i = 0; i < list.length; i += 4) {
        await Promise.all(list.slice(i, i + 4).map(async (slug) => {
          out[slug] = await cached(`fees:${slug}:${lat.toFixed(3)},${lng.toFixed(3)}`, 30 * 60e3, () => woltFees(slug, lat, lng)).catch(() => null);
        }));
        await sleep(500);
      }
      return send(res, 200, { fees: out });
    }

    const efm = url.pathname.match(/^\/api\/menu\/efood\/(\d+)$/);
    if (efm && req.method === 'GET') return send(res, 200, { items: await cached(`efmenu:${efm[1]}`, 30 * 60e3, () => efoodMenu(efm[1])) });

    const menu = url.pathname.match(/^\/api\/menu\/wolt\/([a-z0-9-]+)$/);
    if (menu && req.method === 'GET') {
      const access = await woltAccess().catch(() => null);
      const items = await cached(`menu:${menu[1]}:${access ? 'me' : 'public'}`, 30 * 60e3, () => woltMenu(menu[1], access));
      // Signed in, also say whether any price differs from the public menu (Wolt+ or member prices).
      let personalDiffs = null;
      if (access && url.searchParams.get('check') === '1') {
        const pub = await cached(`menu:${menu[1]}:public`, 30 * 60e3, () => woltMenu(menu[1]));
        const byName = new Map(pub.map((x) => [x.name, x.price]));
        personalDiffs = items.filter((x) => byName.has(x.name) && byName.get(x.name) !== x.price).map((x) => ({ name: x.name, public: byName.get(x.name), yours: x.price }));
      }
      return send(res, 200, { items, personal: !!access, personalDiffs });
    }

    const sync = url.pathname.match(/^\/api\/sync\/(efood|wolt)$/);
    if (sync && req.method === 'POST') {
      const creds = await readBody(req, 10_000);
      const orders = await SYNC[sync[1]](creds);
      return send(res, 200, await store(sync[1], orders, 'sync'));
    }

    if (url.pathname === '/api/import' && req.method === 'POST') {
      const body = await readBody(req, 50_000_000);
      if (body?.tameio === 'box') {
        if (Array.isArray(body.shops)) {
          await mkdir(join(ROOT, 'data'), { recursive: true, mode: 0o700 });
          await writeFile(BOX_SHOPS, JSON.stringify({ at: Date.now(), shops: body.shops }), { mode: 0o600 });
        }
        const incoming = body.orders?.payload?.orders;
        // An empty list (e.g. a different Box account in this browser) never wipes orders we already have.
        const have = (await loadData()).orders.box?.length ?? 0;
        if (Array.isArray(incoming) && (incoming.length || !have)) return send(res, 200, await store('box', normalizeBox(incoming), 'bookmarklet'));
        return send(res, 200, await loadData());
      }
      const { platform, orders } = detectAndNormalize(body);
      return send(res, 200, await store(platform, orders, url.searchParams.get('source') === 'bookmarklet' ? 'bookmarklet' : 'file'));
    }

    const del = url.pathname.match(/^\/api\/orders\/(efood|wolt|box)$/);
    if (del && req.method === 'DELETE') {
      return send(res, 200, await withData((d) => { d.orders[del[1]] = []; delete d.meta[del[1]]; }));
    }

    if (req.method !== 'GET') throw new UserError('Not found', 404);
    const file = normalize(join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC)) throw new UserError('Not found', 404);
    const content = await readFile(file).catch(() => null);
    if (!content) throw new UserError('Not found', 404);
    res.writeHead(200, { ...SECURITY, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(content);
  } catch (e) {
    const status = e instanceof UserError ? e.status : 500;
    if (status === 500) console.error(e);
    send(res, status, { error: e instanceof UserError ? e.message : 'Κάτι πήγε στραβά. Δες το τερματικό.' });
  }
});

// Orders and sessions are yours alone, also on a shared computer (folders made by older versions were world-readable).
chmod(join(ROOT, 'data'), 0o700).catch(() => {});
server.listen(PORT, '127.0.0.1', () => console.log(`Tameio: ${HOME}/#token=${TOKEN}`));
// Also hold [::1], so no other program can answer at http://localhost:PORT and pose as Tameio.
const v6 = createServer((req, res) => server.emit('request', req, res));
v6.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.warn(`Προσοχή: κάποιο άλλο πρόγραμμα ακούει στο [::1]:${PORT}. Άνοιγε το Tameio μόνο από το ${HOME}.`);
});
v6.listen(PORT, '::1');
