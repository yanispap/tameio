import { PLATFORMS } from './lib/normalize.js';
import { buildStats } from './lib/stats.js';
import { SENDERS, bookmarkletHref } from './lib/bookmarklet.js';
import { apiFetch, token } from './lib/api.js';
import { mountStores, openStoreByName, searchStores } from './stores.js';
import { I } from './lib/icons.js';
import { priceChanges, basketInflation } from './lib/prices.js';
import { mountWrapped, openWrapped } from './wrapped-ui.js';
import { mountCompare } from './compare-ui.js';

const $ = (id) => document.getElementById(id);
const KEYS = ['efood', 'wolt', 'box'];
const color = (p) => `var(--${p})`;
const eur = (c) => (c / 100).toLocaleString('el-GR', { style: 'currency', currency: 'EUR' });
// Whole euros, except under 10 € where rounding would turn 0,50 € into 1 €.
const eur0 = (c) => (c / 100).toLocaleString('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: Math.abs(c) < 1000 ? 2 : 0 });
const dateFmt = new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'short', year: 'numeric' });
const plural = (n, one, many) => `${n.toLocaleString('el-GR')} ${n === 1 ? one : many}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const logo = (p, size = 28) => `<span class="logo" style="--s:${size}px;--c:${color(p)}"><img src="/logos/${p}.png" alt="" width="${size}" height="${size}" data-drop><i>${PLATFORMS[p].name[0]}</i></span>`;
const TERMS = { efood: 'https://www.e-food.gr/page/tos', wolt: 'https://explore.wolt.com/el/grc/terms', box: 'https://box.gr/terms' };
// Small line icons, drawn in the text colour.
const ICON = {
  delivery: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M9 17.5h6M4 13h7l2-5h3l3 7M14 8V5h-3"/></svg>',
  service: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
  tip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  coupon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/></svg>',
};

const MADE_BY = `<p class="madeby">Είμαι ο Γιάννης και το έφτιαξα για να δω επιτέλους πόσα δίνω στο delivery. <a href="https://yannisdoes.dev" target="_blank" rel="noopener">yannisdoes.dev</a> · <a href="https://buymeacoffee.com/yannispap" target="_blank" rel="noopener" title="Κέρασέ με έναν καφέ" aria-label="Κέρασέ με έναν καφέ">☕</a></p>`;
const DISCLAIMER = `<div class="legal">
  <p lang="el"><b>Δεν έχουμε καμία σχέση με τις e-food, Wolt και Box</b> και δεν εγκρινόμαστε από αυτές. Το Tameio είναι ανεξάρτητο εργαλείο ανοιχτού κώδικα: διαβάζει μόνο το δικό σου ιστορικό, με τη δική σου σύνδεση, και όλα μένουν σε αυτόν τον υπολογιστή. Οι όροι χρήσης κάποιων υπηρεσιών περιορίζουν την αυτοματοποιημένη πρόσβαση. Για παράδειγμα, οι <a href="${TERMS.wolt}" target="_blank" rel="noopener">όροι του Wolt</a> (§12.6) απαγορεύουν ρομπότ και αυτοματοποιημένες μεθόδους, και το Wolt μπορεί να αφαιρέσει χρήστες (§12.7). Αν θα το χρησιμοποιήσεις στον λογαριασμό σου είναι δική σου απόφαση και ευθύνη. Όροι: <a href="${TERMS.efood}" target="_blank" rel="noopener">e-food</a> · <a href="${TERMS.wolt}" target="_blank" rel="noopener">Wolt</a> · <a href="${TERMS.box}" target="_blank" rel="noopener">Box</a>.</p>
  <p lang="el">Με ευχαριστίες στα <a href="https://github.com/eliac7/efood-analytics" target="_blank" rel="noopener">efood-analytics</a> (Ilias N. Thalassochoritis) και <a href="https://github.com/PolovinaD/wolt-insights" target="_blank" rel="noopener">wolt-insights</a> (Dušan Polovina), που άνοιξαν τον δρόμο.</p>
  <p lang="en"><b>Not affiliated with e-food, Wolt or Box</b>, and not endorsed by them. Tameio is an independent open-source tool: it reads only your own order history, from your own logged-in session, and everything stays on this computer. Some services' terms restrict automated access. Wolt's terms (§12.6), for example, prohibit robots and automated methods, and Wolt may remove users (§12.7). Whether to run it against your account is your call and your responsibility.</p>
</div>`;
// Which platform: its own small logo, not a coloured dot.
const NO_NAME = 'Χωρίς όνομα';
/** A shop name you can click, or plain text when the platform sent no name. */
const shopLink = (name, p) => (name?.trim() ? `<button class="shoplink" data-shop="${esc(name)}" data-shop-p="${p}" title="${esc(name)}">${esc(name)}</button>` : `<span class="noname">${NO_NAME}</span>`);
/** Days the per-week and per-month rates are averaged over: the whole window for "last N months", else first to last order shown. */
function rateDays(s) {
  if (!s.first) return 0;
  const ps = periodStart(state.period);
  if (!ps) return (s.last - s.first) / 864e5;
  const firstEver = KEYS.reduce((m, k) => state.data[k].reduce((mm, o) => Math.min(mm, o.ts), m), Infinity);
  return (Date.now() - Math.max(ps, firstEver)) / 864e5;
}
const dot = (p) => `<img class="pmark" src="/logos/${p}.png" alt="${PLATFORMS[p].name}" title="${PLATFORMS[p].name}" width="16" height="16">`;

const state = { period: 'all', priceMode: 'all', view: 'spend', data: { efood: [], wolt: [], box: [] }, meta: {}, platform: 'all', year: 'all', search: '', rows: 25, open: null, busy: {}, errors: {} };

// How each platform connects. The e-food password goes to the local server for one login and is not saved.
const CONNECT = {
  efood: {
    fields: [['email', 'Email', 'email', 'username'], ['password', 'Κωδικός', 'password', 'current-password']],
    help: 'Πηγαίνουν μόνο στο e-food, μέσω του server σε αυτόν τον υπολογιστή. Ο κωδικός δεν αποθηκεύεται. Κρατάμε μόνο τη σύνδεση (session) στον φάκελο <code>data/</code>, για να φέρνουμε τα μενού των μαγαζιών.',
  },
  wolt: { bookmarklet: 'wolt.com', note: '', auto: true },
  box: { bookmarklet: 'box.gr', note: ' Φέρνει τις παραγγελίες σου και τα μαγαζιά γύρω από τη διεύθυνση που έχεις διαλέξει στο box.gr.' },

};

// ---------- data ----------
async function api(path, opts = {}) {
  const r = await apiFetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error || `Σφάλμα ${r.status}`), { status: r.status });
  return body;
}
function apply(d) {
  if ('woltAuto' in d) state.woltAuto = d.woltAuto;
  if ('efoodSession' in d) state.efoodSession = d.efoodSession;
  // Orders saved by older versions may lack a date; they can't be placed on any chart.
  state.data = Object.fromEntries(KEYS.map((k) => [k, (d.orders?.[k] ?? []).filter((o) => Number.isFinite(o?.ts))]));
  state.meta = d.meta ?? {};
}

async function sync(p, form) {
  const creds = Object.fromEntries(new FormData(form));
  state.busy[p] = true; state.errors[p] = null; renderSources();
  try {
    apply(await api(`/api/sync/${p}`, { method: 'POST', body: JSON.stringify(creds) }));
    state.open = null;
  } catch (e) {
    state.errors[p] = e.message;
  }
  state.busy[p] = false;
  render();
}

async function importFile(file) {
  state.errors.import = null;
  try { apply(await api('/api/import', { method: 'POST', body: await file.text() })); }
  catch (e) { state.errors.import = e.message; }
  render();
}

// ---------- periods ----------
const PERIODS = [['1m', 'Μήνας', 1], ['3m', '3 μήνες', 3], ['6m', '6 μήνες', 6], ['12m', '12 μήνες', 12]];
function periodStart(p) {
  const row = PERIODS.find(([k]) => k === p);
  if (!row) return null;
  // Same day N months back, or that month's last day: on 31 March, a month ago is 28 February, not 3 March.
  const d = new Date(), day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() - row[2]);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d.getTime();
}
/** The period, as words that continue "σε 421 παραγγελίες από 202 μαγαζιά…". */
function periodPhrase(s) {
  const p = state.period;
  if (p === 'all') return !s.first ? '' : dateFmt.format(s.first) === dateFmt.format(s.last) ? `, στις ${dateFmt.format(s.first)}` : `, από ${dateFmt.format(s.first)} ως ${dateFmt.format(s.last)}`;
  if (typeof p === 'number') return ` το ${p}`;
  return { '1m': ' τον τελευταίο μήνα', '3m': ' τους τελευταίους 3 μήνες', '6m': ' τους τελευταίους 6 μήνες', '12m': ' τους τελευταίους 12 μήνες' }[p];
}

function periodLabel(p) {
  if (p === 'all') return null;
  if (typeof p === 'number') return `Το ${p}`;
  return { '1m': 'Τελευταίος μήνας', '3m': '3 μήνες', '6m': '6 μήνες', '12m': '12 μήνες' }[p];
}

// ---------- render ----------
function filtered() {
  let os = state.platform === 'all' ? KEYS.flatMap((k) => state.data[k]) : state.data[state.platform];
  const since = periodStart(state.period);
  if (since) os = os.filter((o) => o.ts >= since);
  else if (typeof state.period === 'number') os = os.filter((o) => new Date(o.ts).getFullYear() === state.period);
  return [...os].sort((a, b) => b.ts - a.ts);
}

function renderControls() {
  const counts = Object.fromEntries(KEYS.map((k) => [k, state.data[k].length]));
  $('platforms').innerHTML = [['all', 'Όλα'], ...KEYS.filter((k) => counts[k]).map((k) => [k, PLATFORMS[k].name])]
    .map(([k, label]) => `<button role="tab" data-p="${k}" class="p-${k}" aria-selected="${state.platform === k}">${label}</button>`)
    .join('');
  const empty = !KEYS.some((k) => counts[k]);
  $('platforms').hidden = empty;
  $('year').hidden = true;
  const years = [...new Set(KEYS.flatMap((k) => state.data[k]).map((o) => new Date(o.ts).getFullYear()))].sort((a, b) => b - a);
  const chip = (k, label) => `<button data-period="${k}" aria-pressed="${state.period === k}">${label}</button>`;
  // Quick ranges, then the last three years; older years live in a small menu.
  const recent = years.slice(0, 3), older = years.slice(3);
  const olderPicked = older.includes(state.period);
  $('periods').innerHTML = empty ? '' : `
    <div class="pseg" role="group" aria-label="Τελευταίοι μήνες">${PERIODS.map(([k, l]) => chip(k, l)).join('')}</div>
    <div class="pseg" role="group" aria-label="Χρονιά">${recent.map((y) => chip(y, y)).join('')}${older.length ? `
      <div class="older ${olderPicked ? 'picked' : ''}"><button class="older-btn" data-years aria-expanded="${!!state.showOldYears}" aria-haspopup="true">${olderPicked ? state.period : 'Παλιότερα'}${I.chevron}</button>
        ${state.showOldYears ? `<div class="older-menu" role="menu">${older.map((y) => chip(y, y)).join('')}</div>` : ''}</div>` : ''}${chip('all', 'Όλα')}</div>`;
  // The awning takes the colour of the platform you are looking at.
  document.body.dataset.platform = state.view === 'spend' ? state.platform : 'all';
}

function renderSources() {
  $('sources').innerHTML = KEYS.map((k) => {
    const m = state.meta[k];
    const c = CONNECT[k];
    const status = state.busy[k] ? 'Συγχρονισμός…'
      : m ? `${plural(m.count, 'παραγγελία', 'παραγγελίες')} · ${dateFmt.format(m.at)}${m.source === 'file' ? ' · από αρχείο' : m.source === 'auto' ? ' · αυτόματα' : ''}${m.error ? ` · ${esc(m.error)}` : ''}${k === 'box' && m.count === 100 ? ' · ίσως λείπουν παλιότερες' : ''}`
      : 'Δεν έχει συνδεθεί ακόμα';
    const form = state.open === k && c.bookmarklet ? `<div class="connect">
        <ol class="steps">
          <li>Σύρε αυτό το κουμπί στη μπάρα με τους σελιδοδείκτες: <a class="bm" href="${bookmarkletHref(location.origin)}" draggable="true">Tameio sync</a></li>
          <li>Άνοιξε το <b>${c.bookmarklet}</b> και συνδέσου, αν δεν είσαι ήδη.</li>
          <li>Πάτα <b>Tameio sync</b> στους σελιδοδείκτες. Οι παραγγελίες έρχονται εδώ μόνες τους.</li>
        </ol>
        <p class="help">Τρέχει μέσα στο ${c.bookmarklet}, με τη σύνδεση που ήδη έχεις. Δεν χρειάζεται να αντιγράψεις τίποτα και δεν κρατάμε κανένα token.${c.note}</p>
        ${c.auto ? (state.woltAuto ? `<div class="auto on"><b>Αυτόματος συγχρονισμός: ενεργός</b><small>Το Tameio ανανεώνει μόνο του τη σύνδεση και φέρνει νέες παραγγελίες κάθε φορά που το ανοίγεις.</small><button type="button" class="link" data-wolt-off>Απενεργοποίηση</button></div>`
          : `<details class="auto"><summary>Ή αυτόματος συγχρονισμός (μία φορά)</summary>
            <form class="connect" data-form="wolt">
              <label><span>Τιμή του cookie <code>__wtoken</code></span><input name="token" type="password" autocomplete="off" required></label>
              <p class="help">Στο wolt.com, συνδεδεμένος: DevTools, Application, Cookies, https://wolt.com, <code>__wtoken</code>: αντέγραψε όλη την τιμή. Το Tameio την κρατάει στο <code>data/</code> αυτού του υπολογιστή για να ανανεώνει τη σύνδεση. Το Wolt αλλάζει το κλειδί σε κάθε ανανέωση, οπότε μπορεί να χρειαστεί να ξανασυνδεθείς στο wolt.com.</p>
              <p class="help warn">Προσοχή: ο αυτόματος συγχρονισμός είναι ακριβώς η «αυτοματοποιημένη μέθοδος» που απαγορεύουν οι <a href="${TERMS.wolt}" target="_blank" rel="noopener">όροι του Wolt</a> (§12.6). Το ενεργοποιείς με δική σου ευθύνη.</p>
              <div class="row"><button class="btn primary" ${state.busy.wolt ? 'disabled' : ''}>${state.busy.wolt ? 'Συγχρονισμός…' : 'Ενεργοποίηση'}</button></div>
            </form></details>`) : ''}
        <div class="row"><button type="button" class="link" data-close>Κλείσιμο</button></div>
      </div>`
      : state.open === k ? `<form class="connect" data-form="${k}">
        ${c.fields.map(([name, label, type, ac]) => `<label>${label}<input name="${name}" type="${type}" autocomplete="${ac}" required></label>`).join('')}
        <p class="help">${c.help}</p>
        <div class="row"><button class="btn primary" ${state.busy[k] ? 'disabled' : ''}>${state.busy[k] ? 'Συγχρονισμός…' : 'Συγχρονισμός'}</button><button type="button" class="link" data-close>Άκυρο</button>${k === 'efood' && state.efoodSession ? '<button type="button" class="link" data-efood-off>Αποσύνδεση</button>' : ''}</div>
      </form>` : '';
    return `<div class="source"><div class="source-head">${logo(k, 40)}<div class="meta"><b>${PLATFORMS[k].name}</b><small>${status}</small></div>
      ${state.open === k ? '' : `<button class="btn" data-open="${k}">${m ? 'Ανανέωση' : 'Σύνδεση'}</button>`}</div>
      ${state.errors[k] ? `<span class="err" role="alert">${esc(state.errors[k])}</span>` : ''}${form}</div>`;
  }).join('') + `<label class="drop" id="drop"><input type="file" accept=".json,.txt,application/json" id="file" hidden>
    <b>Ή ανέβασε αρχείο JSON</b><small>Το αρχείο με τις παραγγελίες σου από e-food, Wolt ή Box (π.χ. από το Proxyman). Το Tameio καταλαβαίνει μόνο του από πού είναι.</small>
    ${state.errors.import ? `<span class="err" role="alert">${esc(state.errors.import)}</span>` : ''}</label>`;
}

/** Whole percentages that add up to exactly 100 (largest remainder), so the bill never reads 99% or 101%. */
function pcts(vals) {
  const t = vals.reduce((a, v) => a + v, 0);
  if (!t) return vals.map(() => 0);
  const raw = vals.map((v) => (v / t) * 100), out = raw.map(Math.floor);
  const left = 100 - out.reduce((a, v) => a + v, 0);
  raw.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0]).slice(0, left).forEach(([, i]) => out[i]++);
  return out;
}

function amountHTML(c) {
  const [whole, dec] = (c / 100).toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).split(',');
  return `${whole}<span class="cents">,${dec} €</span>`;
}

function renderHero(s) {
  const days = rateDays(s), months = Math.max(1, days / 30.44); // rates mean nothing over a few days
  // Biggest share first, in the bill and in its bar.
  const parts = KEYS.filter((k) => s.byPlatform[k].count).sort((a, b) => s.byPlatform[b].total - s.byPlatform[a].total);
  const share = pcts(parts.map((k) => s.byPlatform[k].total));
  const when = periodLabel(state.period) ?? (s.first ? `Από ${dateFmt.format(s.first)} ως ${dateFmt.format(s.last)}` : '');
  $('hero').innerHTML = `
    <div>
      <h1 class="amount${s.total >= 10_000_000 ? ' long' : ''}">${amountHTML(s.total)}</h1>
      <p class="lede">σε <b>${plural(s.count, 'παραγγελία', 'παραγγελίες')}</b> από <b>${plural(s.shops, 'μαγαζί', 'μαγαζιά')}</b>${periodPhrase(s)}.${days >= 28 ? ` Γύρω στα <b>${eur0(s.total / months)}</b> τον μήνα, σαν άλλος ένας λογαριασμός που πληρώνεις.` : ''}</p>
    </div>
    <aside class="bill" aria-label="Ανά πλατφόρμα">
      <h2>Ο λογαριασμός</h2>
      ${parts.map((k, i) => `<div class="bill-row">${logo(k, 22)}<span>${PLATFORMS[k].name}<span class="pct">${share[i]}%</span></span><b>${eur(s.byPlatform[k].total)}</b></div>`).join('')}
      <div class="bill-fees">
        ${[['delivery', 'Μεταφορικά', s.delivery], ['service', 'Χρέωση υπηρεσίας', s.service], ['tip', 'Φιλοδωρήματα', s.tip]].filter(([, , f]) => f.known).map(([k, l, f]) => `<div class="fee-row">${ICON[k]}<span>${l}</span><b>${eur(f.value)}</b></div>`).join('')}
        ${s.discount.value ? `<div class="fee-row saved">${ICON.coupon}<span>Γλίτωσες με κουπόνια</span><b>−${eur(s.discount.value)}</b></div>` : ''}
      </div>
      <div class="bill-total"><span>Σύνολο</span><span>${eur(s.total)}</span></div>
      ${parts.includes('wolt') && s.delivery.known < s.count ? '<p class="bill-note">Το ιστορικό του Wolt δεν γράφει μεταφορικά και χρεώσεις, οπότε εδώ μετράνε μόνο e-food και Box.</p>' : ''}
      <div class="bill-bar">${parts.map((k) => `<span style="flex:${s.byPlatform[k].total};background:${color(k)}"></span>`).join('')}</div>
    </aside>`;
}

function renderWelcome() {
  const blurbs = { efood: 'Με email και κωδικό', wolt: 'Με ένα κλικ στο wolt.com', box: 'Με ένα κλικ στο box.gr' };
  $('hero').innerHTML = `<div class="welcome">
    <h1 class="amount headline">Πόσα πάνε<br>στο delivery;</h1>
    <p class="lede">Διάλεξε από πού παραγγέλνεις. Τίποτα δεν φεύγει από τον υπολογιστή σου.</p>
    <div class="pick">${KEYS.map((k, i) => `<button class="pick-card" data-start="${k}" style="--c:${color(k)};--i:${i}">
      ${logo(k, 64)}<span class="pick-name">${PLATFORMS[k].name}</span><span class="pick-sub">${blurbs[k]}</span><span class="pick-go" aria-hidden="true">${I.arrow}</span></button>`).join('')}</div>
    <button class="link-on-awning" data-open-sources>ή ανέβασε ένα αρχείο JSON</button></div>`;
}

function renderKpis(s) {
  const busiest = s.months.reduce((m, r) => (!m || r.efood + r.wolt + r.box > m.efood + m.wolt + m.box ? r : m), null);
  const days = rateDays(s), perWeek = s.count / Math.max(1, days / 7);
  const fav = s.topShops[0];
  const stat = (k, v, sub = '', cls = '') => `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  $('kpis').innerHTML = [
    stat('Μέση παραγγελία', eur(s.avg), s.biggest ? `η πιο ακριβή: ${eur(s.biggest.total)}` : ''),
    days >= 28 ? stat('Παραγγελίες την εβδομάδα', perWeek.toLocaleString('el-GR', { maximumFractionDigits: 1 }), 'κατά μέσο όρο') : stat('Παραγγελίες την εβδομάδα', '—', 'θα φανεί μετά από έναν μήνα'),
    stat('Ο πιο ακριβός μήνας', busiest ? eur0(busiest.efood + busiest.wolt + busiest.box) : '—', busiest ? monthLabel(busiest.key, true) : ''),
    stat('Το στέκι σου', fav ? shopLink(fav.label, fav.platform) : '—', fav ? plural(fav.count, 'φορά', 'φορές') : '', 'name'),
  ].join('');
}

function monthLabel(key, withYear) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return withYear ? d.toLocaleDateString('el-GR', { month: 'long', year: 'numeric' }) : d.toLocaleDateString('el-GR', { month: 'short' }).replace('.', '');
}

function niceStep(max) {
  const raw = max / 4, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

function chartRows(s, os) {
  const empty = (key, label, long) => ({ key, label, long, efood: 0, wolt: 0, box: 0, count: 0 });
  const dayMs = 864e5;
  if (state.period === '1m' || state.period === '3m') {
    const weekly = state.period === '3m';
    const start = new Date(periodStart(state.period)); start.setHours(0, 0, 0, 0);
    if (weekly) start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
    const step = weekly ? 7 : 1, rows = [];
    // Step by calendar days, not 24h, so the clock change in March and October doesn't shift the bars.
    for (const d = new Date(start); d.getTime() <= Date.now(); d.setDate(d.getDate() + step)) {
      rows.push(empty(d.getTime(), weekly ? `${d.getDate()}/${d.getMonth() + 1}` : String(d.getDate()),
        weekly ? `Εβδομάδα από ${dateFmt.format(d)}` : dateFmt.format(d)));
    }
    for (const o of os) {
      const day = new Date(o.ts); day.setHours(0, 0, 0, 0);
      const r = rows[Math.floor(Math.round((day - start) / dayMs) / step)];
      if (r) { r[o.platform] += o.total; r.count++; }
    }
    return rows;
  }
  const rows = [];
  if (s.months.length) {
    const [y0, m0] = s.months[0].key.split('-').map(Number);
    const [y1, m1] = s.months.at(-1).key.split('-').map(Number);
    const byKey = new Map(s.months.map((r) => [r.key, r]));
    for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, m = 1) : m++) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      const r = byKey.get(key) ?? empty(key);
      rows.push({ ...r, label: `${monthLabel(key)}${m === 1 || rows.length === 0 ? ` ’${String(y).slice(2)}` : ''}`, long: monthLabel(key, true) });
    }
  }
  return rows;
}

let lastChart = null;
addEventListener('resize', () => { if (lastChart && state.view === 'spend') requestAnimationFrame(() => renderMonths(...lastChart, true)); });
// still: redrawn for a new width, so the bars don't grow in again.
function renderMonths(s, os, still = false) {
  $('chart-title').textContent = state.period === '1m' ? 'Ανά μέρα' : state.period === '3m' ? 'Ανά εβδομάδα' : 'Ανά μήνα';
  $('legend').innerHTML = KEYS.filter((k) => s.byPlatform[k].count).map((k) => `<span>${dot(k)}${PLATFORMS[k].name}</span>`).join('');
  const rows = chartRows(s, os);
  if (!rows.length) { $('months').innerHTML = ''; return; }
  lastChart = [s, os];
  const W = Math.max(280, Math.round($('months').clientWidth || 1000)), H = 260, padL = 48, padB = 26, top = 6;
  const max = Math.max(...rows.map((r) => r.efood + r.wolt + r.box), 1);
  const step = niceStep(max), yMax = Math.ceil(max / step) * step;
  const bw = (W - padL) / rows.length;
  const y = (v) => top + (H - padB - top) * (1 - v / yMax);
  let g = '';
  for (let v = 0; v <= yMax; v += step) g += `<line class="gridline" x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${padL - 10}" y="${y(v) + 4}" text-anchor="end">${(v / 100).toLocaleString('el-GR')} €</text>`;
  const every = Math.ceil(rows.length / Math.max(2, Math.min(12, Math.floor((W - padL) / 58))));
  rows.forEach((r, i) => {
    const w = Math.min(bw * 0.62, 34), x = padL + i * bw + (bw - w) / 2;
    let acc = 0, rects = '';
    const present = KEYS.filter((k) => r[k]);
    present.forEach((k, j) => {
      const h = (H - padB - top) * (r[k] / yMax);
      const rad = Math.min(5, w / 3, h);
      const yy = y(acc) - h;
      // Only the top segment of a stack gets rounded corners.
      rects += j === present.length - 1
        ? `<path class="seg-r" fill="${color(k)}" d="M${x},${yy + h} V${yy + rad} Q${x},${yy} ${x + rad},${yy} H${x + w - rad} Q${x + w},${yy} ${x + w},${yy + rad} V${yy + h} Z"/>`
        : `<rect class="seg-r" x="${x}" y="${yy}" width="${w}" height="${Math.max(h - 1.5, 0.5)}" fill="${color(k)}"/>`;
      acc += r[k];
    });
    const tip = `${r.long}|${present.map((k) => `${PLATFORMS[k].name}: ${eur(r[k])}`).join('|') || 'Καμία παραγγελία'}|${r.count ? plural(r.count, 'παραγγελία', 'παραγγελίες') : ''}`;
    g += `<g class="col" style="--d:${i * 35}ms" data-tip="${esc(tip)}"><rect x="${padL + i * bw}" y="${top}" width="${bw}" height="${H - padB - top}" fill="transparent"/>${rects}</g>`;
    if (i % every === 0) g += `<text class="axis" x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${r.label}</text>`;
  });
  $('months').innerHTML = `<svg class="${still ? 'still' : ''}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Έξοδα ανά μήνα">${g}</svg>`;
}

function renderRank(el, rows, valueOf, label, sub) {
  const top = rows.slice(0, 7);
  const max = Math.max(...top.map(valueOf), 1);
  $(el).innerHTML = top.map((r, i) => `<li style="--d:${i * 60}ms"><span class="n">${i + 1}</span><span class="name">${(r.platforms ?? [r.platform]).map(dot).join('')}${el === 'shops' ? shopLink(r.label, r.platform) : `<span class="lbl" title="${esc(r.label)}">${esc(r.label)}</span>`}</span><span class="val">${label(r)}</span>
    <span class="s">${sub(r)}</span><span class="meter"><i style="width:${(valueOf(r) / max) * 100}%;background:${color(r.platform)}"></i></span></li>`).join('')
    || '<li class="empty">Τίποτα ακόμα.</li>';
}

// When you order: in words first, then meals of the day and days of the week. heat is 7x24, Monday first.
const MEALS = [
  ['Πρωί', 6, 11], ['Μεσημέρι', 11, 16], ['Απόγευμα', 16, 19], ['Βράδυ', 19, 23], ['Νύχτα', 23, 30],
];
function renderHeat(s) {
  const days = ['Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο', 'Κυριακή'];
  const short = ['Δε', 'Τρ', 'Τε', 'Πε', 'Πα', 'Σα', 'Κυ'];
  const byDay = s.heat.map((row) => row.reduce((a, b) => a + b, 0));
  const byHour = Array.from({ length: 24 }, (_, h) => s.heat.reduce((a, row) => a + row[h], 0));
  const total = byDay.reduce((a, b) => a + b, 0) || 1;
  const meals = MEALS.map(([label, from, to]) => {
    let n = 0;
    for (let h = from; h < to; h++) n += byHour[h % 24];
    return { label, n, range: `${String(from % 24).padStart(2, '0')}–${String(to % 24).padStart(2, '0')}` };
  });
  const topMeal = meals.reduce((m, x) => (x.n > m.n ? x : m));
  const topDay = byDay.indexOf(Math.max(...byDay));
  const maxDay = Math.max(...byDay, 1), maxMeal = Math.max(...meals.map((m) => m.n), 1);
  const pct = (n) => `${Math.round((n / total) * 100)}%`;
  $('heat').innerHTML = `
    <p class="when-lede">Συνήθως παραγγέλνεις<br><b>${days[topDay]} ${topMeal.label === 'Νύχτα' ? 'αργά το βράδυ' : topMeal.label.toLowerCase()}</b></p>
    <div class="meals">${meals.map((m, i) => `<div class="meal ${m === topMeal ? 'top' : ''}" style="--d:${i * 70}ms">
      <span class="meal-name">${m.label}<small>${m.range}</small></span>
      <span class="meal-bar"><i style="width:${(m.n / maxMeal) * 100}%"></i></span>
      <span class="meal-pct">${pct(m.n)}</span></div>`).join('')}</div>
    <div class="days" role="img" aria-label="Παραγγελίες ανά μέρα">${byDay.map((n, d) => `<div class="day ${d === topDay ? 'top' : ''}" style="--d:${d * 50}ms" title="${days[d]}: ${n}">
      <span class="day-bar"><i style="height:${Math.max(4, (n / maxDay) * 100)}%"></i></span><span class="day-name">${short[d]}</span></div>`).join('')}</div>`;
}

function renderFees(s) {
  const fee = (k, f, cls = '') => `<div class="fee ${cls}"><span class="k">${k}</span><span class="v">${f.known ? eur(f.value) : '—'}</span>${f.known && f.known < s.count ? `<span class="s">από ${plural(f.known, 'παραγγελία', 'παραγγελίες')} που δίνουν αυτό το στοιχείο</span>` : ''}</div>`;
  $('fees').innerHTML = fee('Έξοδα αποστολής', s.delivery) + fee('Χρέωση υπηρεσίας', s.service) + fee('Φιλοδωρήματα', s.tip) + fee('Γλίτωσες με κουπόνια', s.discount, 'saved');
}

function spark(series) {
  const W = 120, H = 32, ps = series.map((p) => p.price);
  const min = Math.min(...ps), max = Math.max(...ps), span = Math.max(1, max - min);
  const pts = series.map((p, i) => `${(i / Math.max(1, series.length - 1)) * W},${H - 4 - ((p.price - min) / span) * (H - 8)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function renderPrices() {
  // Prices over the whole history, whatever the period filter: change needs years.
  const all = KEYS.flatMap((k) => state.data[k]).filter((o) => state.platform === 'all' || o.platform === state.platform);
  const rows = priceChanges(all, { sameShop: state.priceMode === 'shop' });
  document.querySelectorAll('[data-pm]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.pm === state.priceMode)));
  const infl = basketInflation(rows);
  const pct = (x) => `${x > 0 ? '+' : ''}${(x * 100).toLocaleString('el-GR', { maximumFractionDigits: 0 })}%`;
  $('prices').innerHTML = rows.length ? `
    ${infl != null ? `<p class="price-lede">Αυτά που παίρνεις συνήθως ακρίβυναν κατά μέσο όρο <b>${(infl * 100).toLocaleString('el-GR', { maximumFractionDigits: 1 })}% τον χρόνο</b>.</p>` : ''}
    <ol class="price-list">${rows.slice(0, 10).map((r, i) => `<li style="--d:${i * 50}ms" class="${r.pct > 0.02 ? 'up' : r.pct < -0.02 ? 'down' : ''}">
      <div class="pl-name">${dot(r.platform)}<b>${esc(r.name)}</b><small>${r.shop ? esc(r.shop) : `${r.shops} ${r.shops === 1 ? 'μαγαζί' : 'μαγαζιά'}`} · ${r.count} φορές</small></div>
      ${spark(r.series)}
      <div class="pl-vals"><span>${eur(r.first.price)} <small>${r.first.year}</small></span><span class="arrow">${I.arrow}</span><span><b>${eur(r.last.price)}</b> <small>${r.last.year}</small></span></div>
      <span class="pl-pct">${pct(r.pct)}</span></li>`).join('')}</ol>
    <p class="price-note">Η τιμή είναι ανά τεμάχιο, η διάμεση κάθε χρονιάς, από τις παραγγελίες σου σε e-food και Box. Το ιστορικό του Wolt δεν γράφει τιμές πιάτων.${state.priceMode === 'all' ? ' Στα «όλα τα μαγαζιά» μια πτώση μπορεί απλώς να σημαίνει ότι άλλαξες σε φθηνότερο μαγαζί.' : ''}</p>`
    : '<p class="muted">Για να φανεί αλλαγή, πρέπει να έχεις πάρει το ίδιο πιάτο τουλάχιστον 3 φορές, σε δύο διαφορετικές χρονιές.</p>';
}

function renderOrders(os) {
  const q = state.search.trim().toLowerCase();
  const list = q ? os.filter((o) => (o.shop ?? '').toLowerCase().includes(q) || o.items.some((i) => i.name.toLowerCase().includes(q))) : os;
  $('orders').tBodies[0].innerHTML = list.slice(0, state.rows).map((o) => `<tr>
    <td><span class="date">${dateFmt.format(o.ts)}</span></td>
    <td><span class="who">${dot(o.platform)}${shopLink(o.shop, o.platform)}</span></td>
    <td class="items">${esc(o.items.map((i) => (i.qty > 1 ? `${i.qty}× ${i.name}` : i.name)).join(', ') || '—')}</td>
    <td class="r">${eur(o.total)}</td></tr>`).join('');
  document.querySelector('.more')?.remove();
  if (list.length > state.rows) {
    const b = document.createElement('button');
    b.className = 'more'; b.textContent = `Δείξε άλλες ${Math.min(50, list.length - state.rows)}`;
    b.onclick = () => { state.rows += 50; renderOrders(os); };
    $('orders').closest('.panel').append(b);
  }
}

function renderStoresHero() {
  $('hero').innerHTML = `<div class="welcome stores-hero">
    <h1 class="amount headline">Τι υπάρχει<br>γύρω σου.</h1>
    <p class="lede">Όλα τα μαγαζιά της γειτονιάς σου, με τις προσφορές τους. Πάτα ένα για να δεις μενού και τιμές.</p></div>`;
}

function render() {
  renderControls();
  renderSources();
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
  const stores = state.view === 'stores';
  const wrapped = state.view === 'wrapped';
  const compare = state.view === 'compare';
  $('stores-view').hidden = !stores;
  $('wrapped-view').hidden = !wrapped;
  $('compare-view').hidden = !compare;
  $('periods').hidden = stores || wrapped || compare;
  $('platforms').parentElement.classList.toggle('spend-only', stores || wrapped || compare);
  if (compare) {
    $('main').hidden = true;
    $('hero').innerHTML = `<div class="welcome stores-hero">
      <h1 class="amount headline">Ίδιο μαγαζί,<br>άλλη τιμή.</h1>
      <p class="lede">Μαγαζιά που υπάρχουν σε πάνω από μία πλατφόρμα. Τα κοστολογούμε με ό,τι παραγγέλνεις συνήθως, τα μεταφορικά για τη διεύθυνσή σου και τις συνδρομές σου.</p></div>`;
    mountCompare($('compare-view'), KEYS.flatMap((k) => state.data[k]));
    document.body.classList.remove('play'); void document.body.offsetWidth; document.body.classList.add('play');
    return;
  }
  if (wrapped) {
    $('main').hidden = true;
    $('hero').innerHTML = `<div class="welcome stores-hero">
      <h1 class="amount headline">Η χρονιά σου<br>σε μπουκιές.</h1>
      <p class="lede">Πόσα freddo, πόσα σουβλάκια, ποιο είναι το στέκι σου και τι ώρα πεινάς. Βγαίνει από τις δικές σου παραγγελίες και δεν φεύγει από τον υπολογιστή σου.</p></div>`;
    mountWrapped($('wrapped-view'), KEYS.flatMap((k) => state.data[k]));
    document.body.classList.remove('play'); void document.body.offsetWidth; document.body.classList.add('play');
    return;
  }
  if (stores) {
    $('main').hidden = true;
    renderStoresHero();
    mountStores($('stores-view'), KEYS.flatMap((k) => state.data[k]));
    document.body.classList.remove('play'); void document.body.offsetWidth; document.body.classList.add('play');
    return;
  }
  const any = KEYS.some((k) => state.data[k].length);
  $('main').hidden = !any;
  if (!any) { renderWelcome(); document.body.classList.remove('play'); void document.body.offsetWidth; document.body.classList.add('play'); return; }
  const os = filtered();
  const s = buildStats(os);
  renderHero(s);
  renderKpis(s);
  renderMonths(s, os);
  renderRank('shops', s.topShops, (r) => r.total, (r) => eur(r.total), (r) => `${plural(r.count, 'παραγγελία', 'παραγγελίες')} · τελευταία ${dateFmt.format(r.last)}`);
  renderRank('products', s.topProducts, (r) => r.count, (r) => `${esc(r.count)}×`, (r) => (r.priced ? `${eur(r.total)} συνολικά` : PLATFORMS[r.platform].name));
  renderPrices();
  renderHeat(s);
  renderOrders(os);
  play(s.total);
}

// ---------- motion ----------
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const io = new IntersectionObserver((entries) => entries.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}), { rootMargin: '0px 0px -10% 0px' });

// The big entrance plays once per visit to the page. Changing a filter is something you do
// many times in a row, so it only retargets the number quickly from where it is.
let entered = false, shownTotal = 0, countRaf = 0;
function play(total) {
  const el = document.querySelector('.hero .amount');
  const first = !entered;
  if (first) {
    entered = true;
    document.body.classList.remove('play');
    void document.body.offsetWidth; // restart CSS animations
    document.body.classList.add('play');
    document.querySelectorAll('.panel, .strip').forEach((p) => { p.classList.remove('in'); io.observe(p); });
  } else {
    document.body.classList.remove('play');
  }
  if (!el || reduce.matches) { shownTotal = total; return; }
  cancelAnimationFrame(countRaf);
  const from = first ? 0 : shownTotal, t0 = performance.now(), dur = first ? 1300 : 380;
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(2, -10 * k); // ease-out expo
    shownTotal = k === 1 ? total : Math.round(from + (total - from) * eased);
    el.innerHTML = amountHTML(shownTotal);
    if (k < 1) countRaf = requestAnimationFrame(tick);
  };
  el.innerHTML = amountHTML(from);
  countRaf = requestAnimationFrame(tick);
}

// Cards tilt toward the pointer.
document.addEventListener('pointermove', (e) => {
  const card = e.target.closest?.('.pick-card');
  if (!card || reduce.matches) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty('--rx', `${((e.clientY - r.top) / r.height - 0.5) * -10}deg`);
  card.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 12}deg`);
});
document.addEventListener('pointerout', (e) => {
  const card = e.target.closest?.('.pick-card');
  if (card && !card.contains(e.relatedTarget)) { card.style.removeProperty('--rx'); card.style.removeProperty('--ry'); }
});

// ---------- events ----------
const dialog = $('sources-dialog');
const openSources = () => { renderSources(); dialog.showModal(); };
$('open-sources').addEventListener('click', openSources);
// Images from the platforms that fail to load just go (no inline onerror, which the page's CSP forbids).
document.addEventListener('error', (e) => { if (e.target instanceof HTMLImageElement && e.target.hasAttribute('data-drop')) e.target.remove(); }, true);
// The Tameio sync button is for dragging to the bookmarks bar, not for clicking here.
document.addEventListener('click', (e) => { if (e.target.closest('a.bm')) e.preventDefault(); });
$('close-sources').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

document.addEventListener('click', (e) => {
  const shop = e.target.closest('[data-shop]');
  if (shop) {
    e.preventDefault();
    const all = KEYS.flatMap((k) => state.data[k]);
    shop.classList.add('loading');
    openStoreByName(shop.dataset.shop, shop.dataset.shopP, all).then((found) => {
      shop.classList.remove('loading');
      if (!found) { searchStores(shop.dataset.shop); state.view = 'stores'; render(); scrollTo({ top: 0 }); }
    });
    return;
  }
  if (e.target.closest('[data-years]')) { state.showOldYears = !(state.showOldYears || false); renderControls(); return; }
  const per = e.target.closest('[data-period]');
  if (per) { const v = per.dataset.period; state.period = /^\d{4}$/.test(v) ? +v : v; state.rows = 25; state.showOldYears = false; render(); }
  else if (state.showOldYears && !e.target.closest('.older')) { state.showOldYears = false; renderControls(); }
  const pm = e.target.closest('[data-pm]');
  if (pm) { state.priceMode = pm.dataset.pm; renderPrices(); }
  const view = e.target.closest('[data-view]');
  if (view) { if (view.dataset.view !== state.view) entered = false; state.view = view.dataset.view; render(); scrollTo({ top: 0 }); }
  const chip = e.target.closest('[data-p]');
  if (chip) { state.platform = chip.dataset.p; state.rows = 25; render(); }
  if (e.target.closest('[data-open-sources]')) openSources();
  const start = e.target.closest('[data-start]');
  if (start) { state.open = start.dataset.start; openSources(); dialog.querySelector('[data-form] input')?.focus(); }
  const open = e.target.closest('[data-open]');
  if (open) { state.open = open.dataset.open; renderSources(); dialog.querySelector('[data-form] input')?.focus(); }
  if (e.target.closest('[data-close]')) { state.open = null; renderSources(); }
  if (e.target.closest('[data-efood-off]')) { api('/api/efood/session', { method: 'DELETE' }).then(() => { state.efoodSession = false; renderSources(); }); }
  if (e.target.closest('[data-wolt-off]')) { api('/api/wolt/session', { method: 'DELETE' }).then(() => { state.woltAuto = false; renderSources(); }); }
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-form]');
  if (f) { e.preventDefault(); sync(f.dataset.form, f); }
});
document.addEventListener('change', (e) => { if (e.target.id === 'file' && e.target.files[0]) importFile(e.target.files[0]); });
document.addEventListener('dragover', (e) => { const d = e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
document.addEventListener('dragleave', (e) => e.target.closest('#drop')?.classList.remove('over'));
document.addEventListener('drop', (e) => {
  if (!e.target.closest('#drop')) return;
  e.preventDefault();
  if (e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0]);
});

$('search').addEventListener('input', (e) => { state.search = e.target.value; state.rows = 25; renderOrders(filtered()); });
$('theme').addEventListener('click', () => {
  const root = document.documentElement;
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch {}
});

const tip = document.createElement('div');
tip.className = 'tip'; tip.hidden = true; document.body.append(tip);
$('months').addEventListener('pointermove', (e) => {
  const g = e.target.closest('[data-tip]');
  if (!g) { tip.hidden = true; return; }
  const [head, ...rest] = g.dataset.tip.split('|').filter(Boolean);
  tip.innerHTML = `<b>${esc(head)}</b><br>${rest.map(esc).join('<br>')}`;
  tip.hidden = false;
  tip.style.left = `${Math.min(e.clientX + 14, innerWidth - 220)}px`;
  tip.style.top = `${e.clientY + 14}px`;
});
$('months').addEventListener('pointerleave', () => { tip.hidden = true; });

// ---------- receive from the bookmarklet ----------
// Started on load, and again when an already-open Tameio window is pointed at #receive
// (the bookmarklet reuses the window named "tameio", which only changes the hash).
let receiving = false;
function startReceive() {
  if (receiving) return;
  receiving = true;
  let done = false;
  const onMsg = async (e) => {
    if (done || !SENDERS.includes(e.origin) || !e.data?.tameio) return;
    done = true;
    removeEventListener('message', onMsg);
    try {
      apply(await api('/api/import?source=bookmarklet', { method: 'POST', body: JSON.stringify(e.data.tameio) }));
      state.toast = e.data.tameio.tameio === 'box'
        ? `Box: ${e.data.tameio.shops?.length ?? 0} μαγαζιά${e.data.tameio.orders?.payload?.orders?.length ? ` και ${e.data.tameio.orders.payload.orders.length} παραγγελίες` : ''}.`
        : 'Οι παραγγελίες ήρθαν.';
      // A fresh shop list means fresh stores and comparisons.
      document.dispatchEvent(new CustomEvent('tameio:stores-changed'));
    } catch (err) {
      state.errors.import = err.message; state.toast = null;
    }
    history.replaceState(null, '', '/');
    receiving = false;
    render();
    toast(state.toast || state.errors.import);
  };
  addEventListener('message', onMsg);
  const ping = setInterval(() => { if (done || !window.opener) return clearInterval(ping); for (const o of SENDERS) window.opener.postMessage('tameio-ready', o); }, 400);
  setTimeout(() => { clearInterval(ping); if (!done) { removeEventListener('message', onMsg); receiving = false; } }, 120000);
}
if (location.hash === '#receive') startReceive();
addEventListener('hashchange', () => { if (location.hash === '#receive') startReceive(); });

function toast(text) {
  if (!text) return;
  const t = document.createElement('div');
  t.className = 'toast'; t.role = 'status'; t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3600);
}

$('foot').innerHTML = MADE_BY + DISCLAIMER;
document.addEventListener('tameio:render', () => render());
document.addEventListener('tameio:wrapped', (e) => openWrapped(KEYS.flatMap((k) => state.data[k]), e.detail));

try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
const first = await api('/api/orders').catch((e) => e);
apply(first instanceof Error ? {} : first);
render();
// Without this install's key the server answers nothing, so say how to get it instead of showing an empty Tameio.
if (!token() || first?.status === 401) $('hero').innerHTML = `<div class="welcome"><h1 class="amount headline">Άνοιξε το Tameio<br>από το τερματικό.</h1>
  <p class="lede">Όταν τρέχεις <code>npm start</code>, το τερματικό γράφει μια διεύθυνση σαν <code>${esc(location.origin)}/#token=…</code>. Άνοιξέ την μία φορά σε αυτόν τον browser και μετά το Tameio θα ανοίγει κανονικά.</p></div>`;
// The server may be refreshing Wolt in the background; pick the result up once.
if (state.woltAuto) setTimeout(async () => {
  const before = state.meta.wolt?.at;
  const d = await api('/api/orders').catch(() => null);
  if (d && d.meta?.wolt?.at !== before) { apply(d); render(); }
}, 15000);
