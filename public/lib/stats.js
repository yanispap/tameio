// Pure aggregation over normalised orders (money in cents).

const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) ?? 0), 0);

// Same shop, any platform: "Pizza Fresca" on e-food and on Wolt is one place you order from.
export const shopKey = (name) => String(name ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\u0370-\u03ff]+/g, ' ').trim();

function topShops(orders) {
  const m = new Map();
  for (const o of orders) {
    const k = shopKey(o.shop);
    const row = m.get(k) ?? { label: (o.shop ?? '').trim(), byPlatform: {}, count: 0, total: 0, last: 0 };
    row.count++; row.total += o.total; row.last = Math.max(row.last, o.ts);
    row.byPlatform[o.platform] = (row.byPlatform[o.platform] ?? 0) + 1;
    m.set(k, row);
  }
  for (const row of m.values()) {
    row.platforms = Object.keys(row.byPlatform).sort((a, b) => row.byPlatform[b] - row.byPlatform[a]);
    row.platform = row.platforms[0]; // where you order it most: its colour, and where a click opens it
  }
  return [...m.values()].sort((a, b) => b.total - a.total || b.count - a.count);
}

export function buildStats(orders) {
  const n = orders.length;
  const total = sum(orders, (o) => o.total);
  const known = (k) => orders.filter((o) => o[k] != null);

  const months = new Map();
  for (const o of orders) {
    const d = new Date(o.ts);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const row = months.get(key) ?? { key, efood: 0, wolt: 0, box: 0, count: 0 };
    row[o.platform] += o.total; row.count++;
    months.set(key, row);
  }

  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const o of orders) {
    const d = new Date(o.ts);
    heat[(d.getDay() + 6) % 7][d.getHours()]++; // Monday first
  }

  const products = new Map();
  for (const o of orders) for (const it of o.items) {
    const k = `${o.platform}|${it.name.trim().toLowerCase()}`;
    const row = products.get(k) ?? { label: it.name.trim(), platform: o.platform, count: 0, total: 0, priced: true };
    row.count += it.qty;
    if (it.price == null) row.priced = false; else row.total += it.price;
    products.set(k, row);
  }

  const byPlatform = {};
  for (const p of ['efood', 'wolt', 'box']) {
    const os = orders.filter((o) => o.platform === p);
    byPlatform[p] = { count: os.length, total: sum(os, (o) => o.total) };
  }

  return {
    count: n,
    total,
    avg: n ? Math.round(total / n) : 0,
    shops: new Set(orders.map((o) => shopKey(o.shop))).size,
    delivery: { value: sum(orders, (o) => o.delivery), known: known('delivery').length },
    service: { value: sum(orders, (o) => o.service), known: known('service').length },
    tip: { value: sum(orders, (o) => o.tip), known: known('tip').length },
    discount: { value: sum(orders, (o) => o.discount), known: known('discount').length },
    months: [...months.values()].sort((a, b) => a.key.localeCompare(b.key)),
    heat,
    topShops: topShops(orders),
    topProducts: [...products.values()].sort((a, b) => b.count - a.count),
    byPlatform,
    biggest: orders.reduce((m, o) => (!m || o.total > m.total ? o : m), null),
    first: n ? Math.min(...orders.map((o) => o.ts)) : null,
    last: n ? Math.max(...orders.map((o) => o.ts)) : null,
  };
}
