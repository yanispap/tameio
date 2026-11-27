// "Μαγαζιά": every store around you on e-food and Wolt, with offers, and Wolt menus with prices.
import { PLATFORMS } from './lib/normalize.js';
import { I } from './lib/icons.js';
import { apiFetch } from './lib/api.js';
import { matchMenus, priceBasket } from './lib/dishmatch.js';
import { dishKey } from './lib/prices.js';
import { SUBSCRIPTIONS, distanceM, sameShop, woltCost, efoodCost, boxCost, avgServiceFee } from './lib/compare.js';

/** A filter chip: a real checkbox drawn as a pill, with + when off and ✓ when on. */
export const chip = (id, on, label) => `<label class="chip"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="chip-ic" aria-hidden="true">${I.plus}${I.check}</span>${label}</label>`;

const eur = (c) => (c / 100).toLocaleString('el-GR', { style: 'currency', currency: 'EUR' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// "Coco House", "COCO HOUSE!" and "Cocó House" are the same shop.
export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9Ͱ-Ͽ]+/g, ' ').trim();

const ATHENS = { lat: 37.9838, lng: 23.7275 };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** Where you order to: Box delivery addresses first, then the middle of the shops you use. */
export function homeFrom(orders) {
  const to = orders.map((o) => o.to).filter(Boolean);
  const pts = to.length ? to : orders.filter((o) => o.lat && o.lng).map((o) => ({ lat: o.lat, lng: o.lng }));
  if (!pts.length) return null;
  const zip = to.map((p) => p.zip).filter(Boolean).sort((a, b) => to.filter((x) => x.zip === b).length - to.filter((x) => x.zip === a).length)[0] ?? null;
  return { lat: median(pts.map((p) => p.lat)), lng: median(pts.map((p) => p.lng)), zip };
}

function subs() { let x = {}; try { x = JSON.parse(localStorage.getItem('subs')) ?? {}; } catch {} return { pay: 'card', ...x }; }
function setSub(k, v) { const x = subs(); x[k] = v; try { localStorage.setItem('subs', JSON.stringify(x)); } catch {} }

/** The same shop on the other platform: same name, within 400 m. */
function twinsOf(s) {
  const out = [];
  for (const p of ['efood', 'wolt', 'box']) {
    if (p === s.platform) continue;
    const best = st.stores.filter((t) => t.platform === p && sameShop(s, t)).sort((a, b) => distanceM(s, a) - distanceM(s, b))[0];
    if (best) out.push(best);
  }
  return out;
}

const st = { loc: null, stores: [], errors: {}, loading: false, q: '', platform: 'all', offers: false, free: false, fresh: false, sort: 'smart', shown: 48, menu: null };
let ctx = null; // { orders, root, onLoc }

/** Shared with the comparison page: same location, same cached store list. */
export async function storesFor(orders) {
  await initLoc(orders);
  if (!st.stores.length) {
    const r = await apiFetch(`/api/stores?lat=${st.loc.lat}&lng=${st.loc.lng}${st.loc.zip ? `&zip=${st.loc.zip}` : ''}`);
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || r.status);
    st.stores = body.stores; st.errors = body.errors ?? {};
  }
  return { stores: st.stores, loc: st.loc, locSource: st.locSource };
}

const saveLoc = (loc) => apiFetch('/api/location', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loc) }).catch(() => {});

let locReady = null;
function initLoc(orders) {
  return locReady ??= (async () => {
    let saved = await apiFetch('/api/location').then((r) => r.json()).then((b) => b.loc).catch(() => null);
    if (!saved) {
      // Older versions kept it in this browser only; move it to the server once.
      try { saved = JSON.parse(localStorage.getItem('loc')); } catch {}
      if (saved) saveLoc(saved);
    }
    st.loc = saved ?? homeFrom(orders) ?? ATHENS;
    st.locSource = saved ? 'saved' : homeFrom(orders) ? 'orders' : 'default';
  })();
}

export async function mountStores(root, orders) {
  ctx = { root, orders };
  await initLoc(orders);
  if (!st.stores.length && !st.loading) load();
  draw();
}

async function load() {
  st.loading = true; draw();
  try {
    const r = await apiFetch(`/api/stores?lat=${st.loc.lat}&lng=${st.loc.lng}${st.loc.zip ? `&zip=${st.loc.zip}` : ''}`);
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || r.status);
    st.stores = body.stores; st.errors = body.errors ?? {};
  } catch (e) {
    st.errors = { all: e.message };
  }
  st.loading = false; draw(true);
}

function known() {
  const m = new Map();
  for (const o of ctx.orders) {
    const k = norm(o.shop);
    const row = m.get(k) ?? { count: 0, total: 0, last: 0 };
    row.count++; row.total += o.total; row.last = Math.max(row.last, o.ts);
    m.set(k, row);
  }
  return m;
}

function score(s, mine) {
  // Offers and places you already like float up; ratings with few votes count less.
  const r = s.rating ? s.rating * Math.min(1, s.ratingCount / 50) : 2.5;
  return r + (s.offers.length ? 1.2 : 0) + (s.freeDelivery ? 0.4 : 0) + (mine.has(norm(s.name)) ? 2 : 0) + (s.open ? 0 : -5);
}

function filtered(mine) {
  const q = norm(st.q);
  let xs = st.stores.filter((s) =>
    (st.platform === 'all' || s.platform === st.platform) &&
    (!st.offers || s.offers.length) && (!st.free || s.freeDelivery) &&
    (!st.fresh || !mine.has(norm(s.name))) &&
    (!q || norm(s.name).includes(q) || s.cuisines.some((c) => norm(c).includes(q))));
  const by = {
    smart: (a, b) => score(b, mine) - score(a, mine),
    rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.ratingCount - a.ratingCount,
    offers: (a, b) => b.offers.length - a.offers.length,
  }[st.sort];
  return xs.sort(by);
}

function badge(p) {
  return `<span class="pbadge" style="--c:var(--${p})"><img src="/logos/${p}.png" alt="">${PLATFORMS[p].name}</span>`;
}

function card(s, mine, twins, i) {
  const k = mine.get(norm(s.name));
  const other = (twins.get(norm(s.name)) ?? []).filter((t) => t.platform !== s.platform && (distanceM(s, t) ?? 0) <= 400);
  return `<article class="store ${s.open ? '' : 'closed'}" style="--i:${i % 12}" data-store="${esc(s.id)}">
    <div class="store-img">${s.image ? `<img src="${esc(s.image)}" alt="" loading="lazy" data-drop>` : ''}${badge(s.platform)}${s.open ? '' : '<span class="shut">Κλειστό</span>'}</div>
    <div class="store-body">
      <h3>${esc(s.name)}</h3>
      <div class="store-meta">${s.rating ? `<span class="rate">${I.star}${s.rating.toLocaleString('el-GR', { maximumFractionDigits: 1 })}</span>` : ''}${s.eta ? `<span>${esc(String(s.eta)).replace(/'$/, '')}${/\d$/.test(String(s.eta)) ? '′' : ''}</span>` : ''}${s.freeDelivery ? '<span class="free">Δωρεάν αποστολή</span>' : s.deliveryCost ? `<span>Αποστολή ${eur(s.deliveryCost)}</span>` : ''}${s.minOrder ? `<span>Ελάχ. ${eur(s.minOrder)}</span>` : ''}</div>
      <div class="store-cuis">${esc(s.cuisines.slice(0, 3).join(' · '))}</div>
      ${s.offers.length ? `<div class="chips">${s.offers.slice(0, 2).map((o) => `<span class="chip">${esc(o)}</span>`).join('')}${s.offers.length > 2 ? `<span class="chip more-chip">+${s.offers.length - 2}</span>` : ''}</div>` : ''}
      ${k ? `<div class="mine">Έχεις παραγγείλει ${k.count}× · ${eur(k.total)}</div>` : ''}
      ${other.length ? `<div class="twin">${I.swap}Και στο ${other.map((t) => PLATFORMS[t.platform].name).join(', ')}</div>` : ''}
    </div>
  </article>`;
}

function draw(entered) {
  const { root } = ctx;
  const mine = known();
  const twins = new Map();
  for (const s of st.stores) { const k = norm(s.name); twins.set(k, [...(twins.get(k) ?? []), s]); }
  const list = filtered(mine);
  const counts = { efood: st.stores.filter((s) => s.platform === 'efood').length, wolt: st.stores.filter((s) => s.platform === 'wolt').length, box: st.stores.filter((s) => s.platform === 'box').length };
  const known_ = st.stores.filter((s) => mine.has(norm(s.name)) && s.offers.length);
  root.innerHTML = `
    <div class="stores-bar">
      <div class="sb-row">
        <label class="sb-search">${I.search}<input type="search" id="st-q" placeholder="Μαγαζί ή κουζίνα" value="${esc(st.q)}" aria-label="Αναζήτηση μαγαζιών"></label>
        <div class="seg light" role="tablist" aria-label="Πλατφόρμα">${[['all', 'Όλα', st.stores.length], ['efood', 'e-food', counts.efood], ['wolt', 'Wolt', counts.wolt], ...(counts.box ? [['box', 'Box', counts.box]] : [])].map(([k, l, n]) => `<button data-sp="${k}" aria-selected="${st.platform === k}">${l}<small>${n.toLocaleString('el-GR')}</small></button>`).join('')}</div>
      </div>
      <div class="sb-row">
        <div class="chips" role="group" aria-label="Φίλτρα">${[['st-offers', st.offers, 'Με προσφορά'], ['st-free', st.free, 'Δωρεάν αποστολή'], ['st-fresh', st.fresh, 'Καινούργια για μένα']].map(([id, on, l]) => chip(id, on, l)).join('')}</div>
        <label class="sb-sort"><span class="ctl-k">Ταξινόμηση</span><span class="sb-select"><select id="st-sort"><option value="smart">Για σένα</option><option value="rating">Βαθμολογία</option><option value="offers">Περισσότερες προσφορές</option></select>${I.chevron}</span></label>
      </div>
    </div>
    <p class="stores-loc">Γύρω από ${st.locSource === 'orders' ? 'τη διεύθυνση των παραγγελιών σου' : st.locSource === 'here' || st.locSource === 'saved' ? 'την τοποθεσία σου' : 'το κέντρο της Αθήνας'} · <button class="linkish" id="st-here">Χρήση της τοποθεσίας μου</button>
      ${st.errors.efood ? ` · <span class="err-inline">e-food: ${esc(st.errors.efood)}</span>` : ''}${st.errors.wolt ? ` · <span class="err-inline">Wolt: ${esc(st.errors.wolt)}</span>` : ''}${st.errors.box ? ` · <span class="muted">Box: ${esc(st.errors.box)}</span>` : ''}${st.errors.all ? ` · <span class="err-inline">${esc(st.errors.all)}</span>` : ''}</p>
    ${st.loading ? `<div class="store-grid">${Array.from({ length: 8 }, () => '<div class="store skeleton"></div>').join('')}</div>` : `
    ${known_.length && st.platform === 'all' && !st.q ? `<h2 class="sect">Προσφορές σε μαγαζιά που ξέρεις</h2><div class="store-grid">${known_.slice(0, 8).map((s, i) => card(s, mine, twins, i)).join('')}</div><h2 class="sect">Όλα τα μαγαζιά</h2>` : ''}
    <div class="store-grid">${list.slice(0, st.shown).map((s, i) => card(s, mine, twins, i)).join('') || '<p class="muted">Τίποτα με αυτά τα φίλτρα.</p>'}</div>
    ${list.length > st.shown ? `<button class="more" id="st-more">Δείξε άλλα ${Math.min(48, list.length - st.shown)} (από ${list.length})</button>` : ''}`}`;
  root.querySelector('#st-sort').value = st.sort;
  root.classList.toggle('enter', !!entered);
}

// ---------- menu sheet ----------
async function openStore(id) {
  const s = st.stores.find((x) => x.id === id);
  if (!s) return;
  const dlg = document.getElementById('store-dialog');
  const body = dlg.querySelector('.store-sheet');
  const head = `<div class="ss-head">${s.image ? `<img class="ss-cover" src="${esc(s.image)}" alt="" data-drop>` : ''}<div class="ss-title">${badge(s.platform)}<h2>${esc(s.name)}</h2>
    <p>${esc(s.cuisines.slice(0, 4).join(' · '))}${s.rating ? ` · ${s.rating.toLocaleString('el-GR', { maximumFractionDigits: 1 })} / 5 (${esc(s.ratingCount)})` : ''}</p></div>
    <button class="pill icon close-x" data-close-store aria-label="Κλείσιμο">${I.close}</button></div>
    ${s.offers.length ? `<div class="ss-offers">${s.offers.map((o) => `<span class="chip">${esc(o)}</span>`).join('')}</div>` : ''}
    <a class="btn primary ss-link" href="${esc(s.url)}" target="_blank" rel="noopener">Άνοιξέ το στο ${PLATFORMS[s.platform].name}${I.external}</a>`;
  const twin = twinsOf(s)[0];
  const cmp = '<section class="cmp" id="cmp"><p class="muted">Υπολογίζουμε…</p></section>';
  const menuPath = s.platform === 'wolt' ? `/api/menu/wolt/${s.slug}` : s.platform === 'efood' ? `/api/menu/efood/${s.id.split(':')[1]}` : null;
  body.innerHTML = head + cmp + (menuPath ? '<div class="ss-menu"><p class="muted">Φέρνουμε το μενού…</p></div>' : '');
  dlg.showModal();
  cmpState = { group: [s, ...twinsOf(s)], basket: typicalBasket(s), fees: null }; drawCompare();
  if (!menuPath) return;
  try {
    const items = await menuOf(s);
    if (!items) throw new Error('Δεν βρέθηκε μενού.');
    const meta = menuMeta.get(menuUrl(s)) ?? {};
    const personalNote = s.platform === 'wolt'
      ? meta.personal
        ? `<p class="menu-note">Τιμές όπως τις βλέπεις εσύ στο Wolt${meta.personalDiffs?.length ? `: ${meta.personalDiffs.length} ${meta.personalDiffs.length === 1 ? 'πιάτο έχει' : 'πιάτα έχουν'} άλλη τιμή από το δημόσιο μενού (${meta.personalDiffs.slice(0, 3).map((d) => `${esc(d.name)} ${eur(d.yours)} αντί ${eur(d.public)}`).join(', ')})` : ', ίδιες με το δημόσιο μενού'}.</p>`
        : '<p class="menu-note">Αυτό είναι το δημόσιο μενού του Wolt. Με τον αυτόματο συγχρονισμό θα βλέπεις τις τιμές του δικού σου λογαριασμού (π.χ. με Wolt+).</p>'
      : '';
    const mineItems = new Set(ctx.orders.filter((o) => norm(o.shop) === norm(s.name)).flatMap((o) => o.items.map((i) => norm(i.name))));
    const down = items.filter((i) => i.originalPrice && i.originalPrice > i.price);
    const groups = new Map();
    for (const it of items) { const c = it.category ?? 'Άλλα'; groups.set(c, [...(groups.get(c) ?? []), it]); }
    const row = (i) => `<li class="${i.available ? '' : 'na'}">${i.image ? `<img src="${esc(i.image)}" alt="" loading="lazy" data-drop>` : '<span class="noimg"></span>'}
      <div><b>${esc(i.name)}</b>${mineItems.has(norm(i.name)) ? '<span class="had">το έχεις πάρει</span>' : ''}${i.description ? `<small>${esc(i.description)}</small>` : ''}</div>
      <span class="price">${i.originalPrice && i.originalPrice > i.price ? `<s>${eur(i.originalPrice)}</s>` : ''}${eur(i.price)}</span></li>`;
    body.querySelector('.ss-menu').innerHTML = personalNote +
      (down.length ? `<h3 class="ss-h">Σε έκπτωση τώρα · ${down.length}</h3><ul class="menu-list">${down.map(row).join('')}</ul>` : '') +
      [...groups].map(([c, xs]) => `<h3 class="ss-h">${esc(c)}</h3><ul class="menu-list">${xs.map(row).join('')}</ul>`).join('');
  } catch (e) {
    body.querySelector('.ss-menu').innerHTML = `<p class="muted">${esc(e.message || 'Δεν βρέθηκε μενού.')}</p>`;
  }
}

/** Opens the store sheet for a shop you know only by name (from your orders). Returns false if it is not around. */
export async function openStoreByName(name, platform, orders) {
  ctx = ctx ?? { root: null, orders };
  ctx.orders = orders;
  await storesFor(orders);
  const k = norm(name);
  const hits = st.stores.filter((x) => norm(x.name) === k);
  const pick = hits.find((x) => x.platform === platform) ?? hits[0];
  if (!pick) { openHistorySheet(name, platform, orders); return true; }
  await openStore(pick.id);
  return true;
}

function openHistorySheet(name, platform, orders) {
  const mine = orders.filter((o) => norm(o.shop) === norm(name)).sort((a, b) => b.ts - a.ts);
  const total = mine.reduce((a, o) => a + o.total, 0);
  const items = new Map();
  for (const o of mine) for (const it of o.items) if (it.name !== '—') items.set(it.name, (items.get(it.name) ?? 0) + it.qty);
  const top = [...items].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const fmt = new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'short', year: 'numeric' });
  const dlg = document.getElementById('store-dialog');
  dlg.querySelector('.store-sheet').innerHTML = `<div class="ss-head"><div class="ss-title">${badge(platform)}<h2>${esc(name)}</h2>
    <p>${mine.length} παραγγελίες · ${eur(total)} · τελευταία ${mine[0] ? fmt.format(mine[0].ts) : '—'}</p></div>
    <button class="pill icon close-x" data-close-store aria-label="Κλείσιμο">${I.close}</button></div>
    <p class="muted ss-note">Αυτή τη στιγμή δεν παραδίδει στην περιοχή σου, οπότε δεν έχουμε μενού για σύγκριση. Αυτά βγαίνουν από τις δικές σου παραγγελίες.</p>
    ${top.length ? `<div class="ss-menu"><h3 class="ss-h">Αυτά παίρνεις εκεί</h3><ul class="menu-list">${top.map(([n, q]) => `<li><span class="noimg"></span><div><b>${esc(n)}</b></div><span class="price">${esc(q)}×</span></li>`).join('')}</ul></div>` : ''}`;
  dlg.showModal();
}

export function searchStores(q) { st.q = q; st.shown = 48; }

document.addEventListener('tameio:stores-changed', () => { st.stores = []; if (ctx?.root && !ctx.root.hidden) load(); });

// ---------- menus (shared by the menu list and the dish comparison) ----------
const menus = new Map();
function menuUrl(s) {
  return s.platform === 'wolt' ? `/api/menu/wolt/${s.slug}?check=1` : s.platform === 'efood' ? `/api/menu/efood/${s.id.split(':')[1]}` : null;
}
const menuMeta = new Map();
async function menuOf(s) {
  const url = menuUrl(s);
  if (!url) return null;
  if (!menus.has(url)) menus.set(url, apiFetch(url).then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error); menuMeta.set(url, b); return b.items; }).catch(() => null));
  return menus.get(url);
}

// ---------- comparison ----------
let cmpState = null;

function typicalBasket(s) {
  const xs = ctx.orders.filter((o) => norm(o.shop) === norm(s.name));
  if (!xs.length) return 1200;
  const food = xs.map((o) => o.total - (o.delivery ?? 0) - (o.service ?? 0) - (o.tip ?? 0));
  return Math.max(300, Math.round(food.reduce((a, b) => a + b, 0) / xs.length / 10) * 10);
}

async function drawCompare() {
  const el = document.getElementById('cmp');
  if (!el || !cmpState) return;
  const { group } = cmpState;
  const wolt = group.find((x) => x.platform === 'wolt');
  const efood = group.find((x) => x.platform === 'efood');
  const box = group.find((x) => x.platform === 'box');
  // Menus with prices (e-food and Wolt), so the comparison can use what dishes actually cost.
  if (!cmpState.menus) {
    cmpState.menus = {};
    await Promise.all([efood, wolt].filter(Boolean).map(async (x) => { cmpState.menus[x.platform] = await menuOf(x); }));
  }
  // Your usual basket: the dishes of your last order here, priced on each menu.
  const last = ctx.orders.filter((o) => group.some((g) => norm(g.name) === norm(o.shop)) && o.items.some((i) => i.name !== '—')).sort((a, b) => b.ts - a.ts)[0];
  const priced = {};
  if (last) for (const p of ['efood', 'wolt']) if (cmpState.menus[p]) priced[p] = priceBasket(last.items, cmpState.menus[p]);
  const menuMode = cmpState.useMenu !== false && Object.values(priced).filter(Boolean).length >= Math.min(2, Object.keys(cmpState.menus).length) && Object.values(priced).some(Boolean);
  const basketFor = (p) => (menuMode && priced[p] ? priced[p].total : cmpState.basket);
  const basket = cmpState.basket;
  if (wolt && !cmpState.fees) {
    try {
      const r = await apiFetch(`/api/fees/wolt/${wolt.slug}?lat=${st.loc.lat}&lng=${st.loc.lng}`);
      cmpState.fees = r.ok ? await r.json() : { error: true };
    } catch { cmpState.fees = { error: true }; }
  }
  const sub = subs();
  const home = st.loc;
  const rows = [];
  if (efood) rows.push({ p: 'efood', store: efood, basket: basketFor('efood'), r: efoodCost(efood, basketFor('efood'), sub, avgServiceFee(ctx.orders, 'efood')) });
  if (wolt) rows.push({ p: 'wolt', store: wolt, basket: basketFor('wolt'), r: cmpState.fees?.error ? null : woltCost(cmpState.fees, basketFor('wolt'), distanceM(home, wolt), sub, wolt.woltPlus) });
  if (box) rows.push({ p: 'box', store: box, basket: basketFor('box'), r: boxCost(box, basketFor('box'), avgServiceFee(ctx.orders, 'box')) });
  // Dish by dish, where both menus have it. Yours first.
  const mineKeys = new Set(ctx.orders.filter((o) => group.some((g) => norm(g.name) === norm(o.shop))).flatMap((o) => o.items.map((i) => dishKey(i.name))));
  const dishes = cmpState.menus.efood && cmpState.menus.wolt ? matchMenus(cmpState.menus.efood, cmpState.menus.wolt)
    .map((d) => ({ ...d, mine: mineKeys.has(dishKey(d.name)) }))
    .sort((a, b) => (b.mine - a.mine) || Math.abs(b.diff) - Math.abs(a.diff)) : [];
  const avgPct = dishes.length ? dishes.reduce((a, d) => a + d.diff / d.a, 0) / dishes.length : 0;
  const valid = rows.filter((x) => x.r && !x.r.blocked && !x.r.unknownDelivery);
  // Note: an unknown e-food service fee is left out of its total, and the card says so.
  const best = valid.length > 1 ? valid.reduce((m, x) => (x.r.total < m.r.total ? x : m)) : null;
  const diff = best ? Math.max(...valid.map((x) => x.r.total)) - best.r.total : 0;
  el.innerHTML = `
    <div class="cmp-head"><h3>${group.length > 1 ? 'Πού βγαίνει φθηνότερα' : 'Τι θα πληρώσεις'}</h3>
      ${menuMode ? `<button class="linkish" id="cmp-own-basket">Βάλε δικό σου ποσό</button>` : `<label class="basket">Καλάθι <input type="number" id="cmp-basket" min="1" step="0.5" value="${(basket / 100).toFixed(2)}"> €</label>`}</div>
    <div class="cmp-controls">
      <div class="ctl"><span class="ctl-k">Πληρωμή</span><div class="seg light" role="radiogroup" aria-label="Πληρωμή">${[['card', 'Κάρτα'], ['cash', 'Μετρητά']].map(([k, l]) => `<button data-pay="${k}" aria-selected="${sub.pay === k}">${l}</button>`).join('')}</div></div>
      <div class="ctl"><span class="ctl-k">Συνδρομές</span><div class="switches">${['efood', 'wolt'].map((k) => `<label class="switch"><input type="checkbox" role="switch" data-sub="${k}" ${sub[k] ? 'checked' : ''}><span class="track" aria-hidden="true"></span><img src="/logos/${k}.png" alt="">${SUBSCRIPTIONS[k].name}<small>${eur(SUBSCRIPTIONS[k].monthly)}/μήνα</small></label>`).join('')}</div></div>
    </div>
    ${menuMode ? `<p class="cmp-basket-line">Η τελευταία σου παραγγελία εδώ, με τις τιμές κάθε μενού: ${esc(last.items.filter((i) => i.name !== '—').map((i) => (i.qty > 1 ? `${i.qty}× ${i.name}` : i.name)).join(', '))}</p>` : ''}
    ${best && diff > 0 ? `<p class="verdict" style="--c:var(--${best.p})">${badge(best.p)}<span>Φθηνότερα κατά <b>${eur(diff)}</b></span></p>` : best ? '<p class="verdict">Βγαίνει το ίδιο.</p>' : ''}
    <div class="cmp-cols">${rows.map((x) => `<div class="cmp-col ${best && x === best && diff > 0 ? 'win' : ''}">
      <div class="cmp-top">${badge(x.p)}<a href="${esc(x.store.url)}" target="_blank" rel="noopener">άνοιξε${I.external}</a></div>
      ${x.r ? `<div class="cmp-total">${x.r.blocked ? 'κάτω από την ελάχιστη' : eur(x.r.total)}${x.r.unknownDelivery ? '<small> + διανομή</small>' : x.r.unknownService ? '<small> + υπηρεσία</small>' : ''}</div>
      <ul><li><span>${menuMode && priced[x.p] ? 'Πιάτα (τιμές μενού)' : 'Καλάθι'}</span><span>${eur(x.basket)}</span></li>${x.r.parts.map((p) => `<li><span>${p.label}</span><span>${p.unknown ? 'άγνωστη' : p.cents < 0 ? `−${eur(-p.cents)}` : p.cents ? eur(p.cents) : '0 €'}</span></li>`).join('')}${x.r.minOrder ? `<li><span>Ελάχιστη παραγγελία</span><span>${eur(x.r.minOrder)}</span></li>` : ''}</ul>
      ${x.r.notes.length ? `<p class="cmp-note">${x.r.notes.map(esc).join(' ')}</p>` : ''}` : '<p class="muted">Δεν βρήκαμε τις χρεώσεις.</p>'}
    </div>`).join('')}</div>
    ${dishes.length ? `<div class="dish-cmp">
      <div class="dish-head"><h4>Τιμές πιάτων</h4><span>${dishes.length} ίδια πιάτα · ${Math.abs(avgPct) < 0.01 ? 'ίδιες τιμές κατά μέσο όρο' : `στο ${avgPct > 0 ? 'e-food' : 'Wolt'} φθηνότερα κατά ${Math.round(Math.abs(avgPct) * 100)}% κατά μέσο όρο`}</span></div>
      <table><thead><tr><th>Πιάτο</th><th class="r">${badge('efood')}</th><th class="r">${badge('wolt')}</th><th class="r">Διαφορά</th></tr></thead><tbody>
      ${dishes.slice(0, cmpState.allDishes ? dishes.length : 10).map((d) => `<tr class="${d.mine ? 'mine-row' : ''}"><td>${esc(d.name)}${d.mine ? '<span class="had">το παίρνεις</span>' : ''}</td>
        <td class="r ${d.diff > 0 ? 'cheap' : ''}">${eur(d.a)}</td><td class="r ${d.diff < 0 ? 'cheap' : ''}">${eur(d.b)}</td>
        <td class="r diffc">${d.diff === 0 ? 'ίδια' : `${d.diff > 0 ? 'e-food' : 'Wolt'} −${eur(Math.abs(d.diff))}`}</td></tr>`).join('')}
      </tbody></table>
      ${dishes.length > 10 && !cmpState.allDishes ? `<button class="linkish" id="cmp-all-dishes">Δείξε και τα υπόλοιπα ${dishes.length - 10}</button>` : ''}
    </div>` : efood && wolt ? '<p class="cmp-note">Δεν βρήκαμε ίδια πιάτα στα δύο μενού (ή κάποιο μενού δεν φόρτωσε).</p>' : ''}
    ${group.length < 2 ? `<p class="cmp-note">Δεν το βρήκαμε σε άλλη πλατφόρμα κοντά σου, οπότε δείχνουμε μόνο τι θα πληρώσεις εδώ.${st.stores.some((x) => x.platform === 'box') ? '' : ' Τα μαγαζιά του Box μπαίνουν με το «Tameio sync» στο box.gr.'}</p>` : ''}
    <details class="how"><summary>Πώς υπολογίστηκε</summary><p class="cmp-note">Το e-food χρεώνει υπηρεσία μόνο με κάρτα (έως 1,99 €). ${menuMode ? 'Τα πιάτα μετράνε με τις τιμές του μενού κάθε πλατφόρμας.' : 'Το καλάθι μετράει το ίδιο σε όλες τις πλατφόρμες.'}${box ? ' Το μενού του Box δεν το έχουμε, οπότε εκεί μετράει το ποσό του καλαθιού.' : ''} Είναι εκτίμηση: την τελική τιμή τη βλέπεις στο ταμείο.</p></details>`;
}

document.addEventListener('tameio:pay', () => drawCompare());
document.addEventListener('click', (e) => {
  if (!cmpState) return;
  if (e.target.id === 'cmp-own-basket') { cmpState.useMenu = false; drawCompare(); }
  if (e.target.id === 'cmp-all-dishes') { cmpState.allDishes = true; drawCompare(); }
});
document.addEventListener('click', (e) => { const pay = e.target.closest('.cmp [data-pay]'); if (pay) { setSub('pay', pay.dataset.pay); drawCompare(); } });

// ---------- events ----------
document.addEventListener('input', (e) => { if (e.target.id === 'st-q') { st.q = e.target.value; st.shown = 48; const pos = e.target.selectionStart; draw(); const el = document.getElementById('st-q'); el.focus(); el.setSelectionRange(pos, pos); } });
document.addEventListener('change', (e) => {
  const map = { 'st-offers': 'offers', 'st-free': 'free', 'st-fresh': 'fresh' };
  if (map[e.target.id]) { st[map[e.target.id]] = e.target.checked; st.shown = 48; draw(true); }
  if (e.target.id === 'st-sort') { st.sort = e.target.value; draw(true); }
  if (e.target.dataset?.sub) { setSub(e.target.dataset.sub, e.target.checked); drawCompare(); }
  if (e.target.id === 'cmp-basket' && cmpState) { cmpState.useMenu = false; }
  if (e.target.id === 'cmp-basket' && cmpState) { const v = Math.round(parseFloat(e.target.value) * 100); if (v > 0) { cmpState.basket = v; drawCompare(); } }
});
document.addEventListener('click', (e) => {
  const sp = e.target.closest('[data-sp]');
  if (sp) { st.platform = sp.dataset.sp; st.shown = 48; draw(true); }
  if (e.target.id === 'st-more') { st.shown += 48; draw(); }
  if (e.target.id === 'st-here') {
    navigator.geolocation?.getCurrentPosition((p) => {
      st.loc = { lat: +p.coords.latitude.toFixed(4), lng: +p.coords.longitude.toFixed(4) }; st.locSource = 'here';
      saveLoc(st.loc);
      st.stores = []; load();
    }, () => alert('Ο browser δεν έδωσε πρόσβαση στην τοποθεσία σου.'));
  }
  const card = e.target.closest('[data-store]');
  if (card) openStore(card.dataset.store);
  if (e.target.closest('[data-close-store]')) document.getElementById('store-dialog').close();
  if (e.target.id === 'store-dialog') e.target.close();
});
