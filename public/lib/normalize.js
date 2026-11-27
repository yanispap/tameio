// Turns each platform's raw order data into one shape. Pure, shared by server and browser.
// Order: {platform,id,ts,shop,shopId,total,delivery,service,tip,discount,items:[{name,qty,price}],lat,lng,cuisine}
// All money in cents.

export const PLATFORMS = {
  efood: { name: 'e-food' },
  wolt: { name: 'Wolt' },
  box: { name: 'Box' },
};

const cents = (euros) => (typeof euros === 'number' && Number.isFinite(euros) ? Math.round(euros * 100) : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const VOID = /cancel|reject|refund|fail|declin/i;
// Imported files and platform replies are untrusted: names become text, quantities numbers, lists arrays.
const text = (v) => (v == null || v === '' ? '—' : String(v));
const qty = (v) => (num(v) > 0 ? v : 1);
const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
// An order needs a real date (from 2000 to tomorrow) to be charted; anything else is a broken or hostile record.
const valid = (o) => Number.isFinite(o.ts) && o.ts > 946684800000 && o.ts < Date.now() + 864e5;
// A coordinate as a number in range, or null. Box sends some as text.
const coord = (v, max) => { const n = typeof v === 'string' && v.trim() ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max ? n : null; };

export function normalizeBox(orders) {
  return list(orders)
    .filter((o) => !VOID.test(o.shopResponse?.status ?? ''))
    .map((o) => ({
      platform: 'box',
      id: `box:${o._id ?? `${o.createdAt}:${o.shop?.name}`}`,
      ts: Date.parse(o.createdAt),
      shop: text(o.shop?.name),
      shopId: `box:${o.shop?._id ?? o.shop?.name}`,
      total: num(o.totalPrice) ?? 0,
      delivery: num(o.deliveryFee),
      service: num(o.serviceFee),
      tip: num(o.tip),
      discount: num(o.totalDiscountPrice),
      items: list(o.products).map((p) => ({ name: text(p.name), qty: qty(p.quantity), price: num(p.finalPrice) })),
      lat: coord(o.shop?.address?.latitude, 90),
      lng: coord(o.shop?.address?.longitude, 180),
      cuisine: o.mainCuisine?.name == null ? null : String(o.mainCuisine.name),
      to: coord(o.address?.latitude, 90) != null && coord(o.address?.longitude, 180) != null
        ? { lat: coord(o.address.latitude, 90), lng: coord(o.address.longitude, 180), zip: o.address.postalCode == null ? null : String(o.address.postalCode) } : null,
    }))
    .filter(valid);
}

export function normalizeEfood(orders) {
  return list(orders)
    .filter((o) => !VOID.test(o.status ?? ''))
    .map((o, i) => ({
      platform: 'efood',
      id: `efood:${o.id ?? `${o.submission_date}:${i}`}`,
      ts: Date.parse(o.submission_date),
      shop: text(o.restaurant?.name),
      shopId: `efood:${o.restaurant?.id ?? o.restaurant?.name}`,
      total: cents(o.price) ?? 0,
      delivery: cents(o.delivery_cost),
      service: cents(o.service_fee ?? o.service_fees?.total),
      tip: cents(o.tip),
      discount: o.coupon ? cents(o.coupon.amount) : null,
      items: list(o.products)
        .filter((p) => !p.is_coupon && !p.is_delivery_fee_discount)
        .map((p) => ({ name: text(p.name || p.offer_title), qty: qty(p.quantity), price: cents((num(p.unit_price) ?? 0) * qty(p.quantity)) })),
      lat: coord(o.restaurant?.latitude, 90),
      lng: coord(o.restaurant?.longitude, 180),
      cuisine: null,
    }))
    .filter(valid);
}

// Wolt's list gives "DD/MM/YYYY, HH:MM", which Date.parse reads month-first.
export function woltTime(v) {
  if (typeof v === 'number') return v;
  const m = String(v ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})(?:,\s*(\d{2}):(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0)).getTime();
  return Date.parse(v);
}

export function normalizeWolt(orders) {
  return list(orders)
    .filter((o) => !VOID.test(String(o.telemetry?.order_status_type ?? o.status?.value ?? '')))
    .map((o) => ({
      platform: 'wolt',
      id: `wolt:${o.purchase_id ?? o.timestamp}`,
      ts: woltTime(o.timestamp),
      shop: text(o.venue?.name),
      shopId: `wolt:${o.venue?.id ?? o.venue?.name}`,
      total: num(o.telemetry?.end_amount) ?? 0,
      // Wolt's order list carries no fee breakdown.
      delivery: null, service: null, tip: null, discount: null,
      items: list(o.items).filter((i) => i.name).map((i) => ({ name: String(i.name), qty: qty(i.count ?? i.quantity), price: null })),
      lat: null, lng: null,
      cuisine: null,
    }))
    .filter(valid);
}

/** Recognises an exported JSON file from any of the three platforms. */
export function detectAndNormalize(json) {
  if (Array.isArray(json?.payload?.orders)) return { platform: 'box', orders: normalizeBox(json.payload.orders) };
  if (Array.isArray(json?.data?.orders)) return { platform: 'efood', orders: normalizeEfood(json.data.orders) };
  if (Array.isArray(json?.orders) && json.orders[0]?.purchase_id) return { platform: 'wolt', orders: normalizeWolt(json.orders) };
  if (Array.isArray(json) && json[0]?.submission_date) return { platform: 'efood', orders: normalizeEfood(json) };
  throw new Error('Δεν αναγνωρίζω αυτό το αρχείο. Χρειάζεται την απάντηση JSON του e-food, του Wolt ή του Box.');
}
