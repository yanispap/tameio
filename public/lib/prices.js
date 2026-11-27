// How the price of the things you order changed over the years, from your own orders only.
// A dish is matched across shops by its name, so "Freddo Espresso" at three cafés is one line.
// Wolt's order list carries no item prices, so only e-food and Box orders count here.

const STOP = new Set(['σε', 'με', 'και', 'το', 'τη', 'την', 'του', 'της', 'μεριδα', 'μερ', 'the', 'with', 'and']);

/** "Καλαμάκι κοτόπουλο σε πίτα" and "καλαμακι κοτοπουλο σε πιτα!" are one dish. */
export function dishKey(name) {
  return String(name ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\d+\s?(ml|gr|g|lt|l|cl|τεμ)\b/g, ' ')
    .replace(/[^a-z0-9Ͱ-Ͽ]+/g, ' ').split(' ').filter((w) => w && !STOP.has(w)).join(' ');
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

/**
 * @param {any[]} orders normalised orders
 * @param {{ sameShop?: boolean, minPoints?: number }} [opts]
 */
export function priceChanges(orders, { sameShop = false, minPoints = 3 } = {}) {
  const groups = new Map();
  for (const o of orders) for (const it of o.items) {
    if (it.price == null || !it.qty || it.price <= 0) continue;
    const key = dishKey(it.name);
    if (!key) continue;
    const id = sameShop ? `${o.shopId}|${key}` : key;
    const g = groups.get(id) ?? { name: it.name.trim(), shop: sameShop ? o.shop : null, platform: o.platform, points: [], shops: new Set() };
    g.points.push({ ts: o.ts, unit: Math.round(it.price / it.qty), shop: o.shop });
    g.shops.add(String(o.shop ?? '').trim().toLowerCase()); // by name, like "your shops": one café on two platforms is one shop
    groups.set(id, g);
  }
  const rows = [];
  for (const g of groups.values()) {
    if (g.points.length < minPoints) continue;
    g.points.sort((a, b) => a.ts - b.ts);
    const byYear = new Map();
    for (const p of g.points) { const y = new Date(p.ts).getFullYear(); byYear.set(y, [...(byYear.get(y) ?? []), p.unit]); }
    const years = [...byYear.keys()].sort();
    if (years.length < 2) continue; // one year tells us nothing about change
    const series = years.map((y) => ({ year: y, price: median(byYear.get(y)), n: byYear.get(y).length }));
    const first = series[0], last = series.at(-1);
    rows.push({
      name: g.name, shop: g.shop, platform: g.platform, shops: g.shops.size, count: g.points.length,
      series, first, last,
      change: last.price - first.price,
      pct: first.price ? (last.price - first.price) / first.price : 0,
      perYear: first.price ? Math.pow(last.price / first.price, 1 / (last.year - first.year)) - 1 : 0,
    });
  }
  return rows.sort((a, b) => b.count - a.count);
}

/** One number for "how much more expensive did your usual order get": count-weighted average change. */
export function basketInflation(rows) {
  const w = rows.reduce((a, r) => a + r.count, 0);
  if (!w) return null;
  return rows.reduce((a, r) => a + r.perYear * r.count, 0) / w;
}
