// "Σύγκριση": every shop that is on both e-food and Wolt near you, and where your usual order comes out cheaper.
import { PLATFORMS } from './lib/normalize.js';
import { SUBSCRIPTIONS, distanceM, sameShop, woltCost, efoodCost, boxCost, avgServiceFee } from './lib/compare.js';
import { storesFor, norm, chip } from './stores.js';
import { matchMenus, priceBasket } from './lib/dishmatch.js';
import { apiFetch } from './lib/api.js';

const eur = (c) => (c / 100).toLocaleString('el-GR', { style: 'currency', currency: 'EUR' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const logo = (p, s = 22) => `<span class="logo" style="--s:${s}px;--c:var(--${p})"><img src="/logos/${p}.png" alt="${PLATFORMS[p].name}"><i>${PLATFORMS[p].name[0]}</i></span>`;

function subs() { let x = {}; try { x = JSON.parse(localStorage.getItem('subs')) ?? {}; } catch {} return { pay: 'card', ...x }; }
function setSub(k, v) { const x = subs(); x[k] = v; try { localStorage.setItem('subs', JSON.stringify(x)); } catch {} }

const cs = { menus: {}, pairs: null, fees: {}, loading: false, error: null, mineOnly: false, shown: 30, sort: 'save', root: null, orders: [], loc: null };

/** Same name, under 400 m apart: the same shop on two or three platforms. */
function findPairs(stores) {
  // Index by first word of the name so we do not compare every shop with every other.
  const first = (x) => norm(x.name).split(' ')[0];
  const idx = new Map();
  for (const x of stores) idx.set(first(x), [...(idx.get(first(x)) ?? []), x]);
  const used = new Set(), groups = [];
  for (const anchor of stores) {
    if (used.has(anchor)) continue;
    const g = { key: norm(anchor.name), [anchor.platform]: anchor };
    for (const p of ['efood', 'wolt', 'box']) {
      if (g[p]) continue;
      const best = (idx.get(first(anchor)) ?? []).filter((x) => x.platform === p && !used.has(x) && sameShop(anchor, x))
        .sort((a, b) => distanceM(anchor, a) - distanceM(anchor, b))[0];
      if (best) g[p] = best;
    }
    if (['efood', 'wolt', 'box'].filter((p) => g[p]).length >= 2) { ['efood', 'wolt', 'box'].forEach((p) => g[p] && used.add(g[p])); groups.push(g); }
  }
  return groups;
}

function mine(orders) {
  const m = new Map();
  for (const o of orders) {
    const k = norm(o.shop);
    const row = m.get(k) ?? { orders: [], total: 0 };
    row.orders.push(o); row.total += o.total; m.set(k, row);
  }
  return m;
}

function basketOf(row) {
  if (!row) return 1200;
  const food = row.orders.map((o) => o.total - (o.delivery ?? 0) - (o.service ?? 0) - (o.tip ?? 0));
  return Math.max(300, Math.round(food.reduce((a, b) => a + b, 0) / food.length / 10) * 10);
}

const SIDES = ['efood', 'wolt', 'box'];

// Menus of the shops you order from, so their rows use what your dishes really cost on each side.
const menuKey = (s) => (s.platform === 'wolt' ? `/api/menu/wolt/${s.slug}` : `/api/menu/efood/${s.id.split(':')[1]}`);
async function loadMenus(pairs, m) {
  const want = pairs.filter((g) => g.efood && g.wolt && m.has(g.key)).flatMap((g) => [g.efood, g.wolt]).map(menuKey).filter((u) => !(u in cs.menus));
  for (let i = 0; i < want.length; i += 4) {
    await Promise.all(want.slice(i, i + 4).map(async (u) => {
      cs.menus[u] = await apiFetch(u).then(async (r) => (r.ok ? (await r.json()).items : null)).catch(() => null);
    }));
    await new Promise((r) => setTimeout(r, 500)); // a pause between groups, not a burst
  }
}

/** Your last order at this shop, priced on each menu, plus how the two menus compare dish by dish. */
function menuInfo(pair, row) {
  if (!pair.efood || !pair.wolt) return null;
  const e = cs.menus[menuKey(pair.efood)], w = cs.menus[menuKey(pair.wolt)];
  if (!e || !w) return null;
  const dishes = matchMenus(e, w);
  const last = row?.orders.filter((o) => o.items.some((i) => i.name !== '—')).sort((a, b) => b.ts - a.ts)[0];
  const pe = last && priceBasket(last.items, e), pw = last && priceBasket(last.items, w);
  return {
    dishes: dishes.length,
    avgPct: dishes.length ? dishes.reduce((a, d) => a + d.diff / d.a, 0) / dishes.length : 0,
    baskets: pe && pw ? { efood: pe.total, wolt: pw.total } : null,
  };
}

function costs(pair, basket, sub, baskets = null) {
  const r = {};
  const b = (p) => baskets?.[p] ?? basket;
  if (pair.efood) r.efood = efoodCost(pair.efood, b('efood'), sub, avgServiceFee(cs.orders, 'efood'));
  if (pair.wolt) { const f = cs.fees[pair.wolt.slug]; r.wolt = f ? woltCost(f, b('wolt'), distanceM(cs.loc, pair.wolt), sub, pair.wolt.woltPlus) : null; }
  if (pair.box) r.box = boxCost(pair.box, b('box'), avgServiceFee(cs.orders, 'box'));
  const ok = SIDES.filter((p) => r[p] && !r[p].blocked && !r[p].unknownDelivery).sort((a, b) => r[a].total - r[b].total);
  const best = ok[0] ?? null;
  const diff = ok.length > 1 ? r[ok.at(-1)].total - r[best].total : 0;
  return { r, best, diff };
}

export async function mountCompare(root, orders) {
  cs.root = root; cs.orders = orders;
  if (!cs.pairs && !cs.loading) {
    cs.loading = true; draw();
    try {
      const { stores, loc } = await storesFor(orders);
      cs.loc = loc;
      cs.pairs = findPairs(stores);
      await loadFees(prioritised().slice(0, cs.shown));
      loadMenus(prioritised().slice(0, cs.shown), mine(orders)).then(() => draw());
    } catch (e) { cs.error = e.message; }
    cs.loading = false;
  }
  draw(true);
}

function prioritised() {
  const m = mine(cs.orders);
  const name = (g) => (g.efood ?? g.wolt ?? g.box);
  const sides = (g) => ['efood', 'wolt', 'box'].filter((p) => g[p]).length;
  // Shops you use first, then the ones on all three platforms, then by rating.
  return [...(cs.pairs ?? [])].sort((a, b) => (m.get(b.key)?.orders.length ?? 0) - (m.get(a.key)?.orders.length ?? 0) || sides(b) - sides(a) || (name(b).rating ?? 0) - (name(a).rating ?? 0));
}

async function loadFees(pairs) {
  const slugs = pairs.filter((p) => p.wolt).map((p) => p.wolt.slug).filter((s) => !(s in cs.fees));
  for (let i = 0; i < slugs.length; i += 30) {
    const r = await apiFetch('/api/fees/wolt-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slugs: slugs.slice(i, i + 30), lat: cs.loc.lat, lng: cs.loc.lng }) });
    if (r.ok) Object.assign(cs.fees, (await r.json()).fees);
  }
}

/** What you would have saved in the last 12 months by always picking the cheaper side, at today's fees. */
function yearlySavings(m, sub, service) {
  const since = Date.now() - 365 * 864e5;
  let saved = 0, n = 0, wrong = 0;
  for (const pair of cs.pairs ?? []) {
    const row = m.get(pair.key);
    if (!row) continue;
    for (const o of row.orders) {
      if (o.ts < since || !pair[o.platform]) continue;
      const basket = Math.max(300, o.total - (o.delivery ?? 0) - (o.service ?? 0) - (o.tip ?? 0));
      const c = costs(pair, basket, sub);
      const mineCost = c.r[o.platform];
      if (!c.best || !mineCost || mineCost.blocked) continue;
      n++;
      if (c.best !== o.platform) { wrong++; saved += mineCost.total - c.r[c.best].total; }
    }
  }
  return { saved, n, wrong };
}

function sideDetail(r, k, pair, basket, sub) {
  const bits = r.parts.map((x) => `${x.label.replace(/ \(.*\)/, '')} ${x.unknown ? ';' : x.cents < 0 ? `−${eur(-x.cents)}` : x.cents ? eur(x.cents) : '0 €'}`);
  if (r.minOrder) bits.push(`ελάχ. ${eur(r.minOrder)}`);
  // Without the subscription, say what it would change.
  if (!sub[k] && (k === 'efood' || (k === 'wolt' && pair.wolt))) {
    const alt = k === 'efood' ? efoodCost(pair.efood, basket, { ...sub, efood: true }, avgServiceFee(cs.orders, 'efood'))
      : cs.fees[pair.wolt.slug] && woltCost(cs.fees[pair.wolt.slug], basket, distanceM(cs.loc, pair.wolt), { ...sub, wolt: true }, pair.wolt.woltPlus);
    if (alt && alt.total < r.total) bits.push(`με ${SUBSCRIPTIONS[k].name}: ${eur(alt.total)}`);
  }
  return bits.join(' · ');
}

function draw(entered) {
  const { root } = cs;
  if (!root) return;
  if (cs.loading) { root.innerHTML = `<div class="cmp-page"><div class="store-grid">${Array.from({ length: 6 }, () => '<div class="store skeleton"></div>').join('')}</div></div>`; return; }
  if (cs.error) { root.innerHTML = `<p class="muted">${esc(cs.error)}</p>`; return; }
  const sub = subs();
  const m = mine(cs.orders);
  const service = avgServiceFee(cs.orders, 'efood');
  const rows = prioritised().slice(0, cs.shown)
    .filter((p) => !cs.mineOnly || m.has(p.key))
    .map((p) => { const row = m.get(p.key); const basket = basketOf(row); const mi = menuInfo(p, row); return { p, row, basket, mi, c: costs(p, basket, sub, mi?.baskets) }; });
  const nSides = (p) => ['efood', 'wolt', 'box'].filter((k) => p[k]).length;
  if (cs.sort === 'save') rows.sort((a, b) => (b.row ? 1 : 0) - (a.row ? 1 : 0) || nSides(b.p) - nSides(a.p) || b.c.diff - a.c.diff);
  const ys = yearlySavings(m, sub, service);
  const wins = Object.fromEntries(SIDES.map((k) => [k, rows.filter((r) => r.c.best === k).length]));
  const total = cs.pairs?.length ?? 0;

  root.innerHTML = `<div class="cmp-page ${entered ? 'enter' : ''}">
    <section class="cmp-summary">
      <div class="cmp-big">
        <p class="k">Τους τελευταίους 12 μήνες</p>
        ${ys.n ? `<h2>${ys.saved > 0 ? `Θα γλίτωνες <b>${eur(ys.saved)}</b>` : 'Διάλεγες ήδη το πιο φθηνό'}</h2>
        <p>${ys.saved > 0 ? `αν σε ${ys.wrong} από τις ${ys.n} παραγγελίες σου είχες παραγγείλει από την άλλη πλατφόρμα.` : `Σε ${ys.n} παραγγελίες από μαγαζιά που υπάρχουν και αλλού.`} Με τις σημερινές χρεώσεις.</p>`
        : `<h2>${total} μαγαζιά είναι σε πάνω από μία πλατφόρμα</h2><p>Τον τελευταίο χρόνο δεν έχεις παραγγείλει από κανένα, οπότε δείχνουμε τα πιο δημοφιλή.</p>`}
      </div>
      <div class="cmp-score">
        <p class="k">Από τα ${rows.length} που φαίνονται</p>
        ${SIDES.filter((k) => cs.pairs?.some((g) => g[k])).map((k) => `<div>${logo(k, 36)}<b>${wins[k]}</b><span>φθηνότερα στο ${PLATFORMS[k].name}</span></div>`).join('')}
      </div>
    </section>

    <div class="stores-bar">
      <div class="ctl"><span class="ctl-k">Συνδρομές</span><div class="switches">${['efood', 'wolt'].map((k) => `<label class="switch"><input type="checkbox" role="switch" data-csub="${k}" ${sub[k] ? 'checked' : ''}><span class="track" aria-hidden="true"></span><img src="/logos/${k}.png" alt="">${SUBSCRIPTIONS[k].name}<small>${eur(SUBSCRIPTIONS[k].monthly)}/μήνα</small></label>`).join('')}</div></div>
<div class="ctl"><span class="ctl-k">Πληρωμή</span><div class="seg light" role="radiogroup" aria-label="Πληρωμή">${[['card', 'Κάρτα'], ['cash', 'Μετρητά']].map(([k, l]) => `<button data-pay="${k}" aria-selected="${sub.pay === k}">${l}</button>`).join('')}</div></div>
      ${chip('cmp-mine', cs.mineOnly, 'Μόνο όσα έχω παραγγείλει')}
      <select id="cmp-sort" aria-label="Ταξινόμηση"><option value="save">Γλιτώνεις περισσότερα</option><option value="pop">Δημοφιλή</option></select>
    </div>

    <ol class="cmp-list">${rows.map(({ p, row, basket, mi, c }, i) => `<li style="--i:${i % 14}" class="${c.best ?? ''}">
      <div class="cl-shop"><button class="shoplink" data-shop="${esc((p.efood ?? p.wolt ?? p.box).name)}" data-shop-p="${(p.efood ?? p.wolt ?? p.box).platform}"><b>${esc((p.efood ?? p.wolt ?? p.box).name)}</b></button><small>${row ? `Έχεις παραγγείλει ${row.orders.length}×${mi?.baskets ? ' · η τελευταία σου παραγγελία με τιμές μενού' : ` · συνήθως ${eur(basket)}`}` : `Καλάθι ${eur(basket)}`}</small>
        ${mi?.dishes ? `<small class="cl-dishes">${mi.dishes} ίδια πιάτα · ${Math.abs(mi.avgPct) < 0.01 ? 'ίδιες τιμές' : `${mi.avgPct > 0 ? 'e-food' : 'Wolt'} −${Math.round(Math.abs(mi.avgPct) * 100)}% στα πιάτα`}</small>` : ''}</div>
      <div class="cl-sides n${SIDES.filter((k) => p[k]).length}">${SIDES.filter((k) => p[k]).map((k) => { const r = c.r[k]; return `<a class="cl-side ${c.best === k ? 'win' : ''}" href="${esc(p[k].url)}" target="_blank" rel="noopener">${logo(k)}<span class="cl-total">${r ? (r.blocked ? 'κάτω από το ελάχιστο' : eur(r.total) + (r.unknownService ? '<sup title="χωρίς τη χρέωση υπηρεσίας">+;</sup>' : '')) : '…'}</span><small>${r ? sideDetail(r, k, p, mi?.baskets?.[k] ?? basket, sub) : 'χωρίς στοιχεία'}</small></a>`; }).join('')}</div>
      <div class="cl-verdict">${c.best ? (c.diff > 0 ? `<span style="--c:var(--${c.best})">${PLATFORMS[c.best].name}</span><b>−${eur(c.diff)}</b>` : '<span>Ίδια τιμή</span>') : ''}</div>
    </li>`).join('') || '<p class="muted">Τίποτα με αυτά τα φίλτρα.</p>'}</ol>
    ${total > cs.shown ? `<button class="more" id="cmp-more">Δείξε άλλα ${Math.min(30, total - cs.shown)} (από ${total})</button>` : ''}
    <p class="price-note">Ίδιο μαγαζί θεωρούμε όσα έχουν το ίδιο όνομα και απέχουν έως 400 μ. Για τα μαγαζιά που παραγγέλνεις, η τελευταία σου παραγγελία κοστολογείται με το μενού του e-food και του Wolt. Στα υπόλοιπα το καλάθι θεωρείται ίδιο. Μετράνε επίσης διανομή, χρεώσεις και συνδρομές. Το Box δεν έχει μενού εδώ. Είναι εκτίμηση: η τελική τιμή φαίνεται στο ταμείο.</p>
  </div>`;
  root.querySelector('#cmp-sort').value = cs.sort;
}

document.addEventListener('tameio:stores-changed', () => { cs.pairs = null; cs.fees = {}; });

document.addEventListener('change', (e) => {
  if (!cs.root?.isConnected || cs.root.hidden) return;
  if (e.target.dataset?.csub) { setSub(e.target.dataset.csub, e.target.checked); draw(); }
  if (e.target.id === 'cmp-mine') { cs.mineOnly = e.target.checked; draw(true); }
  if (e.target.id === 'cmp-sort') { cs.sort = e.target.value; draw(true); }
});
document.addEventListener('click', async (e) => {
  const pay = e.target.closest('[data-pay]');
  if (pay) { setSub('pay', pay.dataset.pay); draw(); document.dispatchEvent(new CustomEvent('tameio:pay')); return; }
  if (e.target.id === 'cmp-more') {
    e.target.disabled = true; e.target.textContent = 'Φορτώνει…';
    cs.shown += 30;
    await loadFees(prioritised().slice(0, cs.shown));
    draw();
    loadMenus(prioritised().slice(0, cs.shown), mine(cs.orders)).then(() => draw());
  }
});
