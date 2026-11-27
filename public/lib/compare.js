// Same store on two platforms: which one is cheaper for your basket, fees and subscriptions included.
// Pure functions, shared by the browser and the tests. Money in cents, distance in metres.

/** From the companies' own pages, read on 2026-11-25. Editable in Tameio; prices change. */
export const SUBSCRIPTIONS = {
  wolt: {
    name: 'Wolt+', monthly: 399, yearly: null, minBasket: 750, maxDistance: 4000,
    perks: '0 € κόστος διανομής σε συμμετέχοντα καταστήματα, έως 4 χλμ., καλάθι από 7,50 € (εστιατόρια).',
    source: 'https://explore.wolt.com/el/grc/wolt-plus',
  },
  efood: {
    name: 'efood pro', monthly: 399, yearly: 3499, minBasket: 750, maxDistance: null,
    perks: 'Δωρεάν delivery σε επιλεγμένα καταστήματα, καλάθι από 7,50 € (οι όροι αναφέρουν και 9 €), 10% όφελος στα «delivered by efood».',
    source: 'https://www.e-food.gr/blog/oroi-sundromitikes-uperesias-efood-pro/',
  },
  box: { name: 'Box', monthly: null, perks: 'Δεν βρήκαμε συνδρομή στο Box. Τα μεταφορικά κλιμακώνονται με το ποσό του καλαθιού.', source: 'https://box.gr/' },
};

const tokens = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\u0370-\u03ff]+/g, ' ').trim().split(' ').filter(Boolean);

/** Same shop on two platforms: close together and a matching name ("Dirty Buns" = "Dirty Buns Smash Burgers"). */
export function sameShop(a, b) {
  const d = distanceM(a, b);
  if (d == null || d > 400) return false;
  const ta = tokens(a.name), tb = tokens(b.name);
  if (!ta.length || !tb.length) return false;
  if (ta.join(' ') === tb.join(' ')) return true;
  if (d > 250) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.join(' ').length >= 5 && long.join(' ').startsWith(short.join(' '))) return true;
  const inter = short.filter((t) => long.includes(t)).length;
  return inter / new Set([...ta, ...tb]).size >= 0.6;
}

export function distanceM(a, b) {
  if (![a?.lat, a?.lng, b?.lat, b?.lng].every(Number.isFinite)) return null;
  const R = 6371e3, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** Wolt's range formula: the range containing x contributes a + b·x. */
function rangePart(ranges, x) {
  const r = (ranges ?? []).find((r) => x >= r.min && (r.max === 0 || r.max == null || x < r.max));
  return r ? r.a + r.b * x : 0;
}

/** Fee on top of the basket for a Wolt venue. `pricing` comes from /api/fees/wolt. */
export function woltCost(fees, basket, dist, subs = {}, venueWoltPlus = null) {
  const sub = SUBSCRIPTIONS.wolt;
  const meta = fees?.subscription ?? {};
  const eligible = subs.wolt && basket >= (meta.subscription_minimum_basket ?? sub.minBasket)
    && (dist == null || dist <= (meta.subscription_max_distance ?? sub.maxDistance));
  const useSub = eligible && !!fees?.withSubscription;
  // Public prices carry no Wolt+ table; for a Wolt+ venue the delivery part goes to 0, the rest stays.
  // Unknown (null) is treated as taking part, and the note says it is an assumption.
  const plusFallback = eligible && !useSub && venueWoltPlus !== false;
  const p = useSub ? fees.withSubscription : fees?.pricing;
  if (!p) return null;
  const basketPart = Math.max(0, Math.round(rangePart(p.price_ranges, basket)));
  const distPart = dist == null ? 0 : Math.max(0, Math.round(rangePart(p.distance_ranges, dist)));
  const delivery = plusFallback ? 0 : Math.max(0, Math.round(p.base_price ?? 0)) + distPart;
  const parts = [{ label: useSub || plusFallback ? 'Διανομή (Wolt+)' : 'Διανομή', cents: delivery }];
  // Below the small-order threshold the basket part is a top-up, above it a service fee.
  const threshold = fees.noSurcharge || p.price_ranges?.[0]?.max || 0;
  const small = !!threshold && basket < threshold;
  parts.push({ label: small ? 'Μικρή παραγγελία + υπηρεσία' : 'Χρέωση υπηρεσίας', cents: basketPart });
  const blocked = !!(fees.minimum && basket < fees.minimum);
  return {
    total: basket + delivery + basketPart,
    parts,
    minOrder: fees.minimum || 0,
    noSurcharge: fees.noSurcharge || 0,
    blocked,
    notes: [blocked ? `Ελάχιστη παραγγελία ${(fees.minimum / 100).toLocaleString('el-GR')} €.` : null,
      small && !blocked ? `Κάτω από ${(threshold / 100).toLocaleString('el-GR', { minimumFractionDigits: 2 })} € μπαίνει χρέωση μικρής παραγγελίας.` : null,
      dist == null ? 'Δεν ξέρουμε την απόσταση, οπότε η χρέωση απόστασης δεν μετράει.' : null,
      useSub ? 'Με Wolt+: χωρίς κόστος διανομής.' : plusFallback ? 'Με Wolt+: χωρίς κόστος διανομής, αν το μαγαζί συμμετέχει (το Wolt δεν το λέει δημόσια).' : subs.wolt && venueWoltPlus === false ? 'Το μαγαζί δεν συμμετέχει στο Wolt+.' : subs.wolt && !eligible ? `Το Wolt+ ισχύει από ${(sub.minBasket / 100).toLocaleString('el-GR')} € και έως 4 χλμ.` : null].filter(Boolean),
    exact: dist != null,
  };
}

/** e-food: delivery cost from the store list, service fee estimated from your own past orders. */
export function efoodCost(store, basket, subs = {}, service = null) {
  const sub = SUBSCRIPTIONS.efood;
  const proFree = subs.efood && basket >= sub.minBasket;
  // An unknown delivery cost stays unknown: counting it as 0 € would crown the wrong platform.
  const delivery = store.freeDelivery || proFree ? 0 : store.deliveryCost ?? null;
  const parts = [{ label: store.freeDelivery ? 'Διανομή (δωρεάν από το μαγαζί)' : proFree ? 'Διανομή (efood pro)' : 'Διανομή', cents: delivery, unknown: delivery == null }];
  // efood pro's "10% benefit" applies at shops e-food's own riders deliver for (not own-delivery shops).
  const proBenefit = subs.efood && store.ownDelivery === false ? Math.round(basket * 0.1) : 0;
  if (proBenefit) parts.push({ label: 'Όφελος efood pro (10%)', cents: -proBenefit });
  // Card or cash decides it: e-food only charges a service fee on card payments.
  const svc = subs.pay ? efoodServiceFee(basket, subs.pay) : typeof service === 'number' ? { cents: service, source: 'history' } : service;
  const svcLabel = { cash: 'Χρέωση υπηρεσίας (μετρητά: καμία)', estimate: 'Χρέωση υπηρεσίας (κάρτα, ~3%)', last: 'Χρέωση υπηρεσίας (τελευταία γνωστή)', history: 'Χρέωση υπηρεσίας (από το ιστορικό σου)' };
  parts.push(svc ? { label: svcLabel[svc.source], cents: svc.cents } : { label: 'Χρέωση υπηρεσίας', cents: null, unknown: true });
  const notes = [];
  if (store.minOrder && basket < store.minOrder) notes.push(`Ελάχιστη παραγγελία ${(store.minOrder / 100).toLocaleString('el-GR')} €.`);
  if (proFree && !store.freeDelivery) notes.push('Με efood pro: χωρίς κόστος διανομής, αν το μαγαζί συμμετέχει.');
  if (subs.efood && !proFree && !store.freeDelivery) notes.push(`Το efood pro ισχύει από ${(sub.minBasket / 100).toLocaleString('el-GR')} €.`);
  if (!svc) notes.push('Τη χρέωση υπηρεσίας του e-food τη βλέπεις μόνο στο ταμείο.');
  if (svc?.source === 'estimate') notes.push('Με κάρτα, το e-food χρεώνει υπηρεσία έως 1,99 €, ανάλογα με το καλάθι, την ώρα και το μαγαζί.');
  if (proBenefit) notes.push('Το 10% του efood pro αφαιρείται στο ταμείο, στα μαγαζιά που παραδίδει το e-food.');
  return { total: basket + (delivery ?? 0) + (svc?.cents ?? 0) - proBenefit, parts, notes, exact: false, unknownService: !svc, unknownDelivery: delivery == null, minOrder: store.minOrder || 0, blocked: !!(store.minOrder && basket < store.minOrder) };
}

/**
 * e-food's service fee, from what its checkout says (read on 2026-11-26):
 * charged only when paying by card, never with cash; it depends on basket value, time and shop type,
 * and is capped at 1,99 €. Observed: 0,15 € on a 4,85 € basket, 0,35 € on 11,80 € (≈3%).
 */
export function efoodServiceFee(basket, pay = 'card') {
  if (pay === 'cash') return { cents: 0, source: 'cash' };
  return { cents: Math.min(199, Math.round(basket * 0.03)), source: 'estimate' };
}

/** Service fee: recent average, else the last one you paid, else null. Never a made-up zero. */
export function avgServiceFee(orders, platform) {
  const recent = recentServiceFee(orders, platform);
  if (recent != null) return { cents: recent, source: 'history' };
  const last = orders.filter((o) => o.platform === platform && o.service > 0).sort((a, b) => b.ts - a.ts)[0];
  return last ? { cents: last.service, source: 'last', at: last.ts } : null;
}

function recentServiceFee(orders, platform) {
  // Recent orders only: service fees were introduced recently and old orders would drag the average to zero.
  const since = Date.now() - 180 * 864e5;
  const xs = orders.filter((o) => o.platform === platform && o.service != null && o.ts >= since);
  return xs.length ? Math.round(xs.reduce((a, o) => a + o.service, 0) / xs.length) : null;
}

/** What a subscription would have saved you, from the delivery fees you actually paid. */
export function subscriptionValue(orders, platform) {
  const sub = SUBSCRIPTIONS[platform];
  if (!sub?.monthly) return null;
  const xs = orders.filter((o) => o.platform === platform && o.delivery != null);
  if (xs.length < 3) return null;
  const first = Math.min(...xs.map((o) => o.ts)), last = Math.max(...xs.map((o) => o.ts));
  const months = Math.max(1, (last - first) / (30.44 * 864e5));
  const eligible = xs.filter((o) => o.total >= sub.minBasket);
  const feesPerMonth = eligible.reduce((a, o) => a + o.delivery, 0) / months;
  return { months, feesPerMonth: Math.round(feesPerMonth), price: sub.monthly, net: Math.round(feesPerMonth - sub.monthly), orders: xs.length };
}

/** Box: delivery fee from the shop's own basket tiers, service fee from your Box history. No subscription. */
export function boxCost(store, basket, service = null) {
  const tier = (store.deliveryTiers ?? []).filter((t) => basket >= t.minCartPrice).at(-1);
  const delivery = tier ? tier.fee : store.deliveryCost ?? null;
  const svc = typeof service === 'number' ? { cents: service, source: 'history' } : service;
  const parts = [{ label: delivery === 0 ? 'Διανομή (δωρεάν)' : 'Διανομή', cents: delivery, unknown: delivery == null }];
  parts.push(svc ? { label: svc.source === 'last' ? 'Χρέωση υπηρεσίας (τελευταία γνωστή)' : 'Χρέωση υπηρεσίας (από το ιστορικό σου)', cents: svc.cents } : { label: 'Χρέωση υπηρεσίας', cents: null, unknown: true });
  const next = delivery == null ? null : (store.deliveryTiers ?? []).find((t) => t.minCartPrice > basket && t.fee < delivery);
  const notes = [];
  const blocked = !!(store.minOrder && basket < store.minOrder);
  if (blocked) notes.push(`Ελάχιστη παραγγελία ${(store.minOrder / 100).toLocaleString('el-GR')} €.`);
  if (next) notes.push(`Από ${(next.minCartPrice / 100).toLocaleString('el-GR')} € η διανομή πέφτει στα ${(next.fee / 100).toLocaleString('el-GR', { minimumFractionDigits: 2 })} €.`);
  return { total: basket + (delivery ?? 0) + (svc?.cents ?? 0), parts, notes, exact: false, unknownService: !svc, unknownDelivery: delivery == null, minOrder: store.minOrder || 0, blocked };
}
