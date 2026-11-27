// The same dish on two menus: "Πίτα γύρος χοιρινός" and "Γύρος χοιρινός σε πίτα" are one line.
// Unlike price history, here "μερίδα", sizes and counts matter: a skewer is not a portion of skewers.
const SMALL = new Set(['σε', 'με', 'και', 'το', 'τη', 'την', 'του', 'της', 'the', 'with', 'and']);
const norm = (name) => String(name ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/(\d+)\s?(ml|lt|l|gr|g|cl)\b/g, '$1$2').replace(/[^a-z0-9\u0370-\u03ff]+/g, ' ').trim();
const words = (name) => norm(name).split(' ').filter((w) => w && !SMALL.has(w));
const dishKey = (name) => words(name).join(' ');
// Two "same" dishes whose prices differ this much are almost always different sizes.
const plausible = (a, b) => Math.max(a, b) / Math.min(a, b) <= 1.8;

// A word that makes it a different product even when everything else matches.
const VARIANT = new Set(['zero', 'light', 'diet', 'decaf', 'χωρις', 'μεγαλη', 'μεγαλο', 'μικρη', 'μικρο', 'διπλο', 'double', 'mini', 'maxi', 'xl', 'vegan', 'μισο', 'ολοκληρο', 'οικογενειακη']);

function similarity(a, b) {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  for (const w of VARIANT) if (A.has(w) !== B.has(w)) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Best match for `name` in `menu` (items with name and price), or null under the threshold. */
export function findDish(name, menu, threshold = 0.7) {
  const key = dishKey(name);
  if (!key) return null; // a name of only small words or emoji would match every other one
  let best = null, score = 0;
  for (const it of menu) {
    const s = dishKey(it.name) === key ? 1 : similarity(name, it.name);
    if (s > score) { best = it; score = s; }
  }
  return score >= threshold ? { item: best, score } : null;
}

/**
 * Lines that appear on both menus, one per dish of `a`, each matched to its closest dish in `b`.
 * Offers and unavailable items are left out: they are not like-for-like.
 */
export function matchMenus(a, b, threshold = 0.7) {
  const usable = (m) => m.filter((x) => x.available !== false && x.category !== 'Προσφορές' && x.price > 0);
  const B = usable(b), used = new Set(), out = [];
  for (const it of usable(a)) {
    const m = findDish(it.name, B.filter((x) => !used.has(x)), threshold);
    if (!m || !plausible(it.price, m.item.price)) continue;
    used.add(m.item);
    out.push({ name: it.name, a: it.price, b: m.item.price, bName: m.item.name, score: m.score, diff: m.item.price - it.price });
  }
  return out;
}

/** Price a list of order items ({name, qty}) on a menu. Returns null when any item is missing. */
export function priceBasket(items, menu, threshold = 0.7) {
  let total = 0;
  const lines = [];
  for (const it of items) {
    if (!it.name || it.name === '—') continue;
    const m = findDish(it.name, menu.filter((x) => x.available !== false && x.price > 0), threshold);
    if (!m) return null;
    total += m.item.price * (it.qty || 1);
    lines.push({ name: it.name, qty: it.qty || 1, price: m.item.price, matched: m.item.name });
  }
  return lines.length ? { total, lines } : null;
}
