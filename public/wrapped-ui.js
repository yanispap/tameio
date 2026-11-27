// Tameio Wrapped: the picker page and the full-screen story.
import { PLATFORMS } from './lib/normalize.js';
import { buildWrapped, CATEGORIES } from './lib/wrapped.js';
import { I } from './lib/icons.js';

const eur = (c) => (c / 100).toLocaleString('el-GR', { style: 'currency', currency: 'EUR' });
// Whole euros, except under 10 € where rounding would turn 0,50 € into 1 €.
const eur0 = (c) => (c / 100).toLocaleString('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: Math.abs(c) < 1000 ? 2 : 0 });
const num = (n) => n.toLocaleString('el-GR');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const dateFmt = new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'long', year: 'numeric' });
const logo = (p, s = 40) => `<span class="logo" style="--s:${s}px;--c:var(--${p})"><img src="/logos/${p}.png" alt="${PLATFORMS[p].name}"><i>${PLATFORMS[p].name[0]}</i></span>`;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');

const pick = { platform: 'all' };
let story = null;

export function mountWrapped(root, orders) {
  const years = [...new Set(orders.map((o) => new Date(o.ts).getFullYear()))].sort((a, b) => b - a);
  const scoped = pick.platform === 'all' ? orders : orders.filter((o) => o.platform === pick.platform);
  const platforms = ['efood', 'wolt', 'box'].filter((p) => orders.some((o) => o.platform === p));
  const card = (year, i) => {
    const os = year === 'all' ? scoped : scoped.filter((o) => new Date(o.ts).getFullYear() === year);
    const w = buildWrapped(os);
    return `<button class="wr-card" style="--i:${i}" data-wrapped="${year}" ${w ? '' : 'disabled'}>
      <span class="wr-year">${year === 'all' ? 'Όλα τα χρόνια' : year}</span>
      <span class="wr-sub">${w ? `${num(w.count)} παραγγελίες · ${eur0(w.total)}` : 'Καμία παραγγελία'}</span>
      ${w ? `<span class="wr-persona">${esc(w.persona.title)}</span>` : ''}
      <span class="wr-play" aria-hidden="true">${I.play}</span></button>`;
  };
  root.innerHTML = `
    <div class="wr-bar"><div class="seg light" role="tablist" aria-label="Λογαριασμός">${[['all', 'Όλοι οι λογαριασμοί'], ...platforms.map((p) => [p, PLATFORMS[p].name])].map(([k, l]) => `<button data-wp="${k}" aria-selected="${pick.platform === k}">${l}</button>`).join('')}</div></div>
    <div class="wr-grid">${[...years, 'all'].map(card).join('')}</div>`;
}

// ---------- slides ----------
function slides(w, label, scope) {
  const out = [];
  const plats = w.platforms.map((x) => x.p);
  const top = CATEGORIES.map((c) => ({ ...c, n: w.counts[c.key] })).filter((c) => c.n > 0).sort((a, b) => b.n - a.n);
  const days = Math.max(1, Math.round((w.last - w.first) / 864e5));

  out.push({ bg: 'awning', html: `<div class="s-logos pop">${plats.map((p) => logo(p, 56)).join('')}</div>
    <p class="s-kicker pop">Tameio Wrapped</p><h2 class="s-huge pop">${esc(label)}</h2><p class="s-line pop">${scope}. Πάμε να δούμε τι έφαγες.</p>` });

  out.push({ bg: 'tomato', html: `<p class="s-kicker pop">Ξόδεψες</p><h2 class="s-huge pop" data-count="${w.total}" data-fmt="eur">${eur(w.total)}</h2>
    <p class="s-line pop">Φτάνουν για <b>${num(w.freddoEquivalent)} freddo</b>.${w.freddoEquivalent > 365 ? ' Ένα τη μέρα, για πάνω από έναν χρόνο.' : ''}</p>` });

  out.push({ bg: 'blue', html: `<p class="s-kicker pop">Παρήγγειλες</p><h2 class="s-huge pop" data-count="${w.count}">${num(w.count)}</h2><p class="s-big pop">φορές</p>
    <p class="s-line pop">Μία κάθε ${((n) => (n === 1 ? '<b>μέρα</b>' : `<b>${n} μέρες</b>`))(Math.max(1, Math.round(days / w.count)))}, με <b>${eur(w.avg)}</b> τη φορά.</p>` });

  const maxH = Math.max(...w.byHour, 1);
  out.push({ bg: 'ink', html: `<p class="s-kicker pop">Η ώρα της πείνας</p><h2 class="s-huge pop">${w.topDay}<br>${w.topHour}:00</h2>
    <div class="s-hours pop" aria-hidden="true">${w.byHour.map((v, h) => `<i style="--h:${(v / maxH) * 100}%;--d:${h * 25}ms" class="${h === w.topHour ? 'hot' : ''}"></i>`).join('')}</div>
    <p class="s-line pop">Τότε παραγγέλνεις πιο συχνά από κάθε άλλη στιγμή της εβδομάδας.</p>` });

  if (top.length) out.push({ bg: 'orange', html: `<p class="s-kicker pop">Η χρονιά σε αριθμούς</p>
    <div class="s-counts">${top.slice(0, 4).map((c, i) => `<div class="pop" style="--i:${i}"><b data-count="${c.n}">${num(c.n)}</b><span>${c.n === 1 ? c.one : c.many}</span></div>`).join('')}</div>
    ${w.counts.freddo >= 10 ? `<p class="s-line pop">Αν τα έβαζες στη σειρά, τα freddo σου θα έπιαναν <b>${num(Math.round(w.counts.freddo * 0.16))} μέτρα</b>.</p>` : w.counts.souvlaki >= 10 ? `<p class="s-line pop">Τα καλαμάκια σου, το ένα πίσω από το άλλο, κάνουν <b>${num(Math.round(w.counts.souvlaki * 0.25))} μέτρα</b>.</p>` : ''}` });

  if (w.topDish && w.topDish.qty > 1) out.push({ bg: 'cream', html: `<p class="s-kicker pop">Το πιάτο της χρονιάς</p><h2 class="s-title pop">${esc(w.topDish.name)}</h2>
    <p class="s-huge pop" data-count="${w.topDish.qty}" data-suffix="×">${num(w.topDish.qty)}×</p><p class="s-line pop">Και ακόμα δεν το βαρέθηκες.</p>` });

  out.push({ bg: 'awning', html: `<p class="s-kicker pop">Το στέκι σου</p><h2 class="s-title pop">${logo(w.loyal.platform, 44)} ${esc(w.loyal.name)}</h2>
    <p class="s-line pop"><b>${num(w.loyal.count)} παραγγελίες</b>, ${eur(w.loyal.total)}. Εκεί πια δεν χρειάζεται να πεις διεύθυνση.</p>
    <ol class="s-rank">${w.shops.slice(1, 5).map((s, i) => `<li class="pop" style="--i:${i}"><span>${i + 2}</span>${esc(s.name)}<em>${s.count}×</em></li>`).join('')}</ol>` });

  out.push({ bg: 'blue', html: `<p class="s-kicker pop">Δοκίμασες</p><h2 class="s-huge pop" data-count="${w.uniqueShops}">${num(w.uniqueShops)}</h2><p class="s-big pop">διαφορετικά μαγαζιά</p>
    <p class="s-line pop">${w.oneTimers ? `Τα <b>${num(w.oneTimers)}</b> τα δοκίμασες μία φορά και δεν ξαναγύρισες.` : 'Και από όλα ξαναπαρήγγειλες.'}</p>` });

  if (w.late) out.push({ bg: 'night', html: `<p class="s-kicker pop">Μετά τα μεσάνυχτα</p><h2 class="s-huge pop" data-count="${w.late}">${num(w.late)}</h2><p class="s-big pop">νυχτερινές παραγγελίες</p>
    <p class="s-line pop">Από τις 12 μέχρι τις 5 το πρωί. Ο ντελιβεράς σίγουρα τις θυμάται.</p>` });

  if (w.streak >= 2) out.push({ bg: 'tomato', html: `<p class="s-kicker pop">Σερί</p><h2 class="s-huge pop" data-count="${w.streak}">${num(w.streak)}</h2><p class="s-big pop">μέρες στη σειρά</p>
    <p class="s-line pop">Το σερί έληξε στις ${dateFmt.format(w.streakEnd)}. Η κουζίνα σου έμεινε κλειστή.</p>` });

  out.push({ bg: 'cream', html: `<p class="s-kicker pop">Η πιο ακριβή παραγγελία</p><h2 class="s-huge pop" data-count="${w.biggest.total}" data-fmt="eur">${eur(w.biggest.total)}</h2>
    <p class="s-line pop">Από ${esc(w.biggest.shop)}, στις ${dateFmt.format(w.biggest.ts)}. Ελπίζουμε να ήσασταν παρέα.</p>` });

  if (w.delivery || w.tips || w.saved) out.push({ bg: 'ink', html: `<p class="s-kicker pop">Τα έξτρα</p>
    <div class="s-counts">${[[w.delivery, 'μεταφορικά'], [w.service, 'χρεώσεις υπηρεσίας'], [w.tips, 'φιλοδωρήματα'], [w.saved, 'γλίτωσες με κουπόνια']].filter(([v]) => v).map(([v, l], i) => `<div class="pop" style="--i:${i}"><b data-count="${v}" data-fmt="eur">${eur(v)}</b><span>${l}</span></div>`).join('')}</div>` });

  out.push({ bg: 'orange', html: `<p class="s-kicker pop">Είσαι</p><h2 class="s-persona pop">${esc(w.persona.title)}</h2><p class="s-line pop">${esc(w.persona.line)}</p>` });

  out.push({ bg: 'awning', end: true, html: `<div class="s-summary pop"><p class="s-kicker">${esc(label)}</p>
    <dl><div><dt>Ξόδεψες</dt><dd>${eur0(w.total)}</dd></div><div><dt>Παραγγελίες</dt><dd>${num(w.count)}</dd></div>
    <div><dt>Στέκι</dt><dd>${esc(w.loyal.name)}</dd></div><div><dt>Ώρα</dt><dd>${w.topDay.slice(0, 3)} ${w.topHour}:00</dd></div>
    ${top[0] ? `<div><dt>${esc(top[0].many)}</dt><dd>${num(top[0].n)}</dd></div>` : ''}<div><dt>Είσαι</dt><dd>${esc(w.persona.title)}</dd></div></dl>
    <p class="s-foot">Tameio · από τις δικές σου παραγγελίες, μόνο στον υπολογιστή σου</p></div>
    <p class="s-made pop">Το έφτιαξε ο Γιάννης · <a href="https://yannisdoes.dev" target="_blank" rel="noopener">yannisdoes.dev</a></p>
    <div class="s-actions pop"><button class="s-btn" data-s-restart>Από την αρχή</button><button class="s-btn ghost" data-s-close>Κλείσιμο</button></div>` });
  return out;
}

// ---------- story player ----------
const DURATION = 6500;

export function openWrapped(orders, year) {
  const scoped = (pick.platform === 'all' ? orders : orders.filter((o) => o.platform === pick.platform))
    .filter((o) => year === 'all' || new Date(o.ts).getFullYear() === +year);
  const w = buildWrapped(scoped);
  if (!w) return;
  const label = year === 'all' ? 'Όλα τα χρόνια' : `Το ${year} σου`;
  const scope = pick.platform === 'all' ? 'Όλοι οι λογαριασμοί' : PLATFORMS[pick.platform].name;
  const list = slides(w, label, scope);
  const el = document.createElement('div');
  el.className = 'story';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `Tameio Wrapped, ${label}`);
  el.setAttribute('aria-modal', 'true'); el.tabIndex = -1;
  el.innerHTML = `<div class="story-frame"><div class="story-bars">${list.map(() => '<i><b></b></i>').join('')}</div>
    <button class="story-x" data-s-close aria-label="Κλείσιμο">${I.close}</button><div class="story-stage" aria-live="polite"></div>
    <div class="story-shapes" aria-hidden="true"><span></span><span></span><span></span></div></div>`;
  document.body.append(el);
  document.body.style.overflow = 'hidden';
  story = { el, list, i: -1, t0: 0, paused: false, raf: 0, elapsed: 0, back: document.activeElement };
  go(0);
  story.raf = requestAnimationFrame(tick);
  el.focus();
}

function go(i) {
  const s = story;
  if (!s) return;
  if (i < 0) i = 0;
  if (i >= s.list.length) i = s.list.length - 1;
  s.i = i; s.elapsed = 0; s.t0 = performance.now();
  const sl = s.list[i];
  s.el.dataset.bg = sl.bg;
  const stage = s.el.querySelector('.story-stage');
  stage.innerHTML = `<section class="slide">${sl.html}</section>`;
  s.el.querySelectorAll('.story-bars i').forEach((bar, k) => bar.style.setProperty('--p', k < i ? 1 : 0));
  // Fit to the final value, which is the widest the count-up will show.
  stage.querySelectorAll('.s-huge, .s-counts b').forEach(fit);
  stage.querySelectorAll('[data-count]').forEach(countUp);
}

// Shrinks a big number until it fits the card, so "1.244,72 €" never runs off the edge.
function fit(node) {
  let size = parseFloat(getComputedStyle(node).fontSize);
  while (node.scrollWidth > node.clientWidth + 1 && size > 16) node.style.fontSize = `${(size -= 2)}px`;
}

function countUp(node) {
  if (reduce.matches) return;
  const to = +node.dataset.count, eurFmt = node.dataset.fmt === 'eur', suffix = node.dataset.suffix ?? '';
  const t0 = performance.now(), dur = 1100;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur), v = Math.round(to * (1 - Math.pow(2, -10 * k)));
    node.textContent = (eurFmt ? eur(k === 1 ? to : v) : num(k === 1 ? to : v)) + suffix;
    if (k < 1 && node.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function tick(now) {
  const s = story;
  if (!s) return;
  if (!s.paused) {
    s.elapsed = now - s.t0;
    const p = Math.min(1, s.elapsed / DURATION);
    s.el.querySelectorAll('.story-bars i')[s.i]?.style.setProperty('--p', p);
    if (p >= 1 && !s.list[s.i].end) go(s.i + 1);
  } else {
    s.t0 = now - s.elapsed;
  }
  s.raf = requestAnimationFrame(tick);
}

function close() {
  if (!story) return;
  cancelAnimationFrame(story.raf);
  story.el.classList.add('out');
  const el = story.el, back = story.back;
  story = null;
  back?.focus?.(); // keyboard users land back on the card they opened
  document.body.style.overflow = '';
  setTimeout(() => el.remove(), 250);
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  const wp = e.target.closest('[data-wp]');
  if (wp) { pick.platform = wp.dataset.wp; document.dispatchEvent(new CustomEvent('tameio:render')); }
  const card = e.target.closest('[data-wrapped]');
  if (card) document.dispatchEvent(new CustomEvent('tameio:wrapped', { detail: card.dataset.wrapped }));
  if (!story) return;
  if (e.target.closest('[data-s-close]')) return close();
  if (e.target.closest('[data-s-restart]')) return go(0);
  if (e.target.closest('.story-frame') && !e.target.closest('button')) {
    const r = story.el.querySelector('.story-frame').getBoundingClientRect();
    go(e.clientX < r.left + r.width * 0.33 ? story.i - 1 : story.i + 1);
  }
});
document.addEventListener('keydown', (e) => {
  if (!story) return;
  if (e.key === 'Escape') close();
  // Keep Tab inside the story, like a modal dialog.
  if (e.key === 'Tab') {
    const f = [...story.el.querySelectorAll('button, a[href]')];
    const i = f.indexOf(document.activeElement);
    e.preventDefault();
    f.at(e.shiftKey ? (i <= 0 ? -1 : i - 1) : (i + 1) % f.length)?.focus();
  }
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(story.i + 1); }
  if (e.key === 'ArrowLeft') go(story.i - 1);
});
// Hold to pause, like stories everywhere.
document.addEventListener('pointerdown', (e) => { if (story && e.target.closest('.story-stage')) story.paused = true; });
document.addEventListener('pointerup', () => { if (story) story.paused = false; });
