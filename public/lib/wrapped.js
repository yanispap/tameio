// Tameio Wrapped: a year (or all years) of your own orders, as fun facts. Pure; nothing leaves the page.
import { shopKey } from './stats.js';

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** What we count. Matched against your own item names; the first match wins. */
export const CATEGORIES = [
  { key: 'freddo', one: 'freddo', many: 'freddo', re: /freddo|φρεντο/ },
  { key: 'coffee', one: 'καφές', many: 'καφέδες', re: /espresso|cappuccino|καφε|latte|flat white|americano|φραπε|frappe|nescafe|filter coffee/ },
  { key: 'souvlaki', one: 'σουβλάκι', many: 'σουβλάκια', re: /καλαμακ|σουβλακ|γυρο|κεμπαπ|kebab|gyro|souvlak|μπιφτεκι (γεμιστο )?(με τυρι )?σε (πιτα|τορτιγια)/ },
  { key: 'pita', one: 'πίτα', many: 'πίτες', re: /τυροπιτ|κοτοπιτ|σπανακοπιτ|λουκανικοπιτ|ζαμπονοτυροπιτ|μπουγατσ|πιτα παραδοσιακη/ },
  { key: 'pizza', one: 'πίτσα', many: 'πίτσες', re: /pizza|πιτσα/ },
  { key: 'burger', one: 'burger', many: 'burgers', re: /burger|μπεργκερ/ },
  { key: 'pasta', one: 'μακαρονάδα', many: 'μακαρονάδες', re: /πεννες|penne|μακαρον|σπαγγετ|spaghetti|pasta|ταλιατελ|λιγκουιν|ριζοτ/ },
  { key: 'sushi', one: 'sushi', many: 'sushi', re: /sushi|σουσι|maki|nigiri|uramaki|sashimi/ },
  { key: 'home', one: 'μαγειρευτό', many: 'μαγειρευτά', re: /παστιτσ|μουσακ|γεμιστ|ντολμαδ|λεμονατ|κοκκινιστ|φασολακ|σουτζουκ|γιουβετσ/ },
  { key: 'bakery', one: 'αρτοσκεύασμα', many: 'αρτοσκευάσματα', re: /κρουασαν|croissant|κουλουρ|τοστ|μπαγκετ|sandwich|σαντουιτς|club/ },
  { key: 'fries', one: 'μερίδα πατάτες', many: 'μερίδες πατάτες', re: /πατατ|fries/ },
  { key: 'sweet', one: 'γλυκό', many: 'γλυκά', re: /παγωτ|ice cream|σοκολατ|donut|cookie|βαφλ|waffle|λουκουμαδ|κρεπα|crepe|cheesecake|τιραμισ|brownie|προφιτερολ/ },
  { key: 'drink', one: 'αναψυκτικό', many: 'αναψυκτικά', re: /coca|cola|πορτοκαλαδ|λεμοναδ|sprite|fanta|σοδα|χυμος|juice|νερο|water|μπυρ|beer/ },
];

export function categorize(name) {
  const n = norm(name);
  return CATEGORIES.find((c) => c.re.test(n))?.key ?? null;
}

const DAYS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];

/** @param {any[]} orders already filtered to the scope (year, platform) */
export function buildWrapped(orders) {
  const os = [...orders].sort((a, b) => a.ts - b.ts);
  const n = os.length;
  if (!n) return null;
  const total = os.reduce((a, o) => a + o.total, 0);

  // Food counters, by quantity.
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.key, 0]));
  const spentOn = Object.fromEntries(CATEGORIES.map((c) => [c.key, 0]));
  const pricedQty = Object.fromEntries(CATEGORIES.map((c) => [c.key, 0])); // Wolt items carry no price
  const dishes = new Map();
  for (const o of os) for (const it of o.items) {
    const k = categorize(it.name);
    if (k) { counts[k] += it.qty; spentOn[k] += it.price ?? 0; if (it.price != null) pricedQty[k] += it.qty; }
    if (it.name && it.name !== '—') {
      const key = norm(it.name).trim();
      const row = dishes.get(key) ?? { name: it.name.trim(), qty: 0 };
      row.qty += it.qty; dishes.set(key, row);
    }
  }
  const topDish = [...dishes.values()].sort((a, b) => b.qty - a.qty)[0] ?? null;

  // Shops.
  const shops = new Map();
  for (const o of os) {
    // Same shop on two platforms counts once, as on the Spending page; unnamed shops stay apart.
    const key = o.shop && o.shop !== '—' ? shopKey(o.shop) : o.shopId;
    const row = shops.get(key) ?? { name: o.shop, platform: o.platform, count: 0, total: 0 };
    row.count++; row.total += o.total; shops.set(key, row);
  }
  const shopList = [...shops.values()].sort((a, b) => b.count - a.count || b.total - a.total);

  // Time.
  const byDay = Array(7).fill(0), byHour = Array(24).fill(0);
  let late = 0, early = 0;
  for (const o of os) {
    const d = new Date(o.ts);
    byDay[d.getDay()]++; byHour[d.getHours()]++;
    if (d.getHours() < 5) late++;
    if (d.getHours() >= 5 && d.getHours() < 10) early++;
  }
  const topDay = byDay.indexOf(Math.max(...byDay));
  const topHour = byHour.indexOf(Math.max(...byHour));

  // Longest run of consecutive days with at least one order.
  const days = [...new Set(os.map((o) => new Date(o.ts).toDateString()))].map((s) => new Date(s).getTime()).sort((a, b) => a - b);
  let streak = 1, best = 1, bestEnd = days[0];
  for (let i = 1; i < days.length; i++) {
    streak = Math.round((days[i] - days[i - 1]) / 864e5) === 1 ? streak + 1 : 1;
    if (streak > best) { best = streak; bestEnd = days[i]; }
  }

  // Months.
  const months = new Map();
  for (const o of os) { const d = new Date(o.ts); const k = `${d.getFullYear()}-${d.getMonth()}`; months.set(k, (months.get(k) ?? 0) + o.total); }
  const [topMonthKey, topMonthTotal] = [...months].sort((a, b) => b[1] - a[1])[0];
  const [ty, tm] = topMonthKey.split('-').map(Number);

  const sum = (k) => os.reduce((a, o) => a + (o[k] ?? 0), 0);
  const freddoPrice = Math.round(spentOn.freddo / pricedQty.freddo) || 250;
  const biggest = os.reduce((m, o) => (o.total > m.total ? o : m));

  return {
    count: n, total, avg: Math.round(total / n),
    first: os[0].ts, last: os[n - 1].ts,
    counts, spentOn, topDish,
    shops: shopList, loyal: shopList[0], uniqueShops: shopList.length,
    oneTimers: shopList.filter((s) => s.count === 1).length,
    topDay: DAYS[topDay], topDayCount: byDay[topDay], topHour, byHour,
    late, early,
    streak: best, streakEnd: bestEnd,
    topMonth: new Date(ty, tm, 1), topMonthTotal,
    biggest,
    delivery: sum('delivery'), tips: sum('tip'), service: sum('service'), saved: sum('discount'),
    freddoEquivalent: Math.floor(total / Math.max(freddoPrice, 100)),
    platforms: ['efood', 'wolt', 'box'].map((p) => ({ p, count: os.filter((o) => o.platform === p).length })).filter((x) => x.count),
    persona: persona({ counts, late, early, n, loyal: shopList[0], oneTimers: shopList.filter((s) => s.count === 1).length, uniqueShops: shopList.length }),
  };
}

/** A playful title, decided only by your own numbers. */
export function persona({ counts, late, early, n, loyal, oneTimers, uniqueShops }) {
  const share = (x) => x / Math.max(n, 1);
  if (counts.freddo >= 20 && counts.freddo >= counts.souvlaki) return { title: 'Freddo-holic', line: 'Ο καφές σου έχει δικό του ντελιβερά.' };
  if (counts.souvlaki >= 15) return { title: 'Σουβλακοφάγος', line: 'Η πίτα σε ξέρει καλύτερα από τη μάνα σου.' };
  if (share(late) >= 0.15) return { title: 'Νυχτοπούλι', line: 'Η όρεξή σου ξυπνάει μετά τις 12.' };
  if (share(early) >= 0.2) return { title: 'Πρωινός τύπος', line: 'Στις 10 το πρωί έχεις ήδη παραγγείλει.' };
  if (loyal && share(loyal.count) >= 0.25) return { title: 'Ο Πιστός', line: `Στο ${loyal.name} σε ξέρουν με το όνομα.` };
  if (uniqueShops && oneTimers / uniqueShops >= 0.6) return { title: 'Εξερευνητής', line: 'Κάθε φορά άλλο μαγαζί. Κανένα δεν σε κράτησε.' };
  if (counts.pizza >= 10) return { title: 'Pizza person', line: 'Οκτώ κομμάτια, ένας άνθρωπος.' };
  return { title: 'Ο Ισορροπημένος', line: 'Λίγο απ’ όλα. Ο ντελιβεράς σε συμπαθεί.' };
}
