// Run: node test.mjs [path-to-box-userList.json]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeBox, normalizeEfood, normalizeWolt, woltTime } from './public/lib/normalize.js';
import { buildStats } from './public/lib/stats.js';

assert.equal(new Date(woltTime('07/08/2025, 13:05')).getMonth(), 7); // 7 Aug, not 8 Jul
const e = normalizeEfood([{ id: 1, submission_date: '2025-01-02T10:00:00Z', price: 8.25, status: 'completed', delivery_cost: 0.5, tip: 1, restaurant: { id: 9, name: 'A' }, products: [{ name: 'Pita', quantity: 2, unit_price: 3 }, { name: 'Coupon', is_coupon: true, quantity: 1, unit_price: -2 }] }, { price: 5, status: 'cancelled', restaurant: {} }]);
assert.equal(e.length, 1); assert.equal(e[0].total, 825); assert.equal(e[0].items.length, 1); assert.equal(e[0].items[0].price, 600);
const w = normalizeWolt([{ purchase_id: 'x', timestamp: '01/02/2025, 10:00', telemetry: { end_amount: 1234, order_status_type: 'DELIVERED' }, venue: { name: 'V', id: 'v' }, items: [{ name: 'Burger' }] }, { purchase_id: 'y', telemetry: { order_status_type: 'REJECTED' } }]);
assert.equal(w.length, 1); assert.equal(w[0].total, 1234);
const s = buildStats([...e, ...w]);
assert.equal(s.total, 825 + 1234); assert.equal(s.shops, 2); assert.equal(s.delivery.known, 1);

const f = process.argv[2];
if (f) {
  const b = normalizeBox(JSON.parse(readFileSync(f, 'utf8')).payload.orders);
  const st = buildStats(b);
  const lines = b.reduce((a, o) => a + o.items.reduce((x, i) => x + (i.price ?? 0), 0), 0);
  console.log('box orders', b.length, 'total €', st.total / 100, 'items sum €', lines / 100, 'top', st.topShops[0].label, st.topProducts[0]);
  assert.ok(b.every((o) => Number.isFinite(o.ts)));
}
console.log('ok');

// compare.js
import { woltCost, efoodCost, boxCost, distanceM, subscriptionValue } from './public/lib/compare.js';
{
  const pricing = { base_price: 0, price_ranges: [{ min: 0, max: 600, a: 640, b: -1 }, { min: 600, max: 800, a: 40, b: 0 }, { min: 800, max: 3380, a: 0, b: 0.05 }, { min: 3380, max: 0, a: 169, b: 0 }], distance_ranges: [{ min: 0, max: 1875, a: 0, b: 0 }, { min: 1875, max: 2000, a: 25, b: 0 }] };
  const fees = { pricing, withSubscription: null, minimum: 600 };
  assert.equal(woltCost(fees, 500, 100).total, 640);          // small basket topped up to 6,40 €
  assert.equal(woltCost(fees, 1000, 100).total, 1050);        // 5% service fee
  assert.equal(woltCost(fees, 1000, 1900).total, 1075);       // + distance band
  assert.equal(woltCost(fees, 5000, 100).total, 5169);        // capped service fee
  const sub = { ...fees, withSubscription: { base_price: 0, price_ranges: [{ min: 0, max: 0, a: 0, b: 0 }], distance_ranges: [] } };
  assert.equal(woltCost(sub, 1000, 1000, { wolt: true }).total, 1000);
  assert.equal(woltCost(sub, 1000, 5000, { wolt: true }).total, 1050); // beyond 4 km: no Wolt+
  assert.equal(woltCost(fees, 1000, 1900, { wolt: true }).total, 1050);     // unknown venue: delivery dropped, service stays
  assert.equal(woltCost(fees, 1000, 1900, { wolt: true }, false).total, 1075); // known non-Wolt+ venue
  const store = { deliveryCost: 200, minOrder: 600, freeDelivery: false };
  assert.equal(efoodCost(store, 1000).total, 1200);
  assert.equal(efoodCost(store, 1000, { efood: true }).total, 1000);
  assert.equal(efoodCost(store, 500).blocked, true);
  assert.equal(efoodCost(store, 1180, { pay: 'card' }).total, 1180 + 200 + 35); // 0,35 € like e-food's checkout
  assert.equal(efoodCost(store, 1180, { pay: 'cash' }).total, 1180 + 200);      // no service fee in cash
  assert.equal(efoodCost(store, 10000, { pay: 'card' }).parts[1].cents, 199);    // capped
  assert.equal(efoodCost({ ...store, ownDelivery: false }, 1000, { efood: true, pay: 'cash' }).total, 1000 - 100); // free delivery + 10%
  assert.equal(efoodCost({ ...store, ownDelivery: true }, 1000, { efood: true, pay: 'cash' }).total, 1000);       // own riders: no 10%
  assert.ok(Math.abs(distanceM({ lat: 38, lng: 23.7 }, { lat: 38.001, lng: 23.7 }) - 111) < 2);
  const now = Date.now();
  const hist = Array.from({ length: 6 }, (_, i) => ({ platform: 'efood', ts: now - i * 15 * 864e5, total: 1200, delivery: 200 }));
  assert.ok(subscriptionValue(hist, 'efood').feesPerMonth > 399);
}
{
  const { boxCost } = await import('./public/lib/compare.js');
  const shop = { deliveryTiers: [{ minCartPrice: 0, fee: 390 }, { minCartPrice: 1500, fee: 0 }], minOrder: 600 };
  assert.equal(boxCost(shop, 1000, 30).total, 1000 + 390 + 30);
  assert.equal(boxCost(shop, 1600, 30).total, 1600 + 30);
  assert.equal(boxCost(shop, 500).blocked, true);
}
console.log('compare ok');

// wrapped.js
import { buildWrapped, categorize } from './public/lib/wrapped.js';
{
  assert.equal(categorize('Freddo Espresso'), 'freddo');
  assert.equal(categorize('Καλαμάκι κοτόπουλο σε πίτα'), 'souvlaki');
  assert.equal(categorize('Γύρος χοιρινός σε πίτα'), 'souvlaki');
  assert.equal(categorize('Ζαμπονοτυρόπιτα'), 'pita');
  assert.equal(categorize('Cappuccino'), 'coffee');
  assert.equal(categorize('Πατάτες τηγανητές'), 'fries');
  const day = (d, h) => new Date(2025, 0, d, h).getTime();
  const mk = (d, h, items, total = 1000) => ({ platform: 'box', shop: 'A', shopId: 'a', ts: day(d, h), total, delivery: 100, tip: 0, items });
  const w = buildWrapped([mk(1, 13, [{ name: 'Freddo espresso', qty: 2, price: 500 }]), mk(2, 1, [{ name: 'Γύρος σε πίτα', qty: 1, price: 400 }]), mk(3, 14, [])]);
  assert.equal(w.counts.freddo, 2); assert.equal(w.counts.souvlaki, 1);
  assert.equal(w.streak, 3); assert.equal(w.late, 1); assert.equal(w.delivery, 300);
  assert.equal(w.freddoEquivalent, Math.floor(3000 / 250));
  assert.equal(buildWrapped([]), null);
}
console.log('wrapped ok');

// prices.js
import { priceChanges, dishKey } from './public/lib/prices.js';
{
  assert.equal(dishKey('Καλαμάκι κοτόπουλο σε πίτα'), dishKey('καλαμακι  ΚΟΤΟΠΟΥΛΟ σε πιτα!'));
  assert.equal(dishKey('Coca-Cola Zero 330ml'), 'coca cola zero');
  const o = (y, shop, price, qty = 1) => ({ ts: new Date(y, 5, 1).getTime(), shop, shopId: shop, platform: 'efood', items: [{ name: 'Freddo Espresso', qty, price }] });
  const rows = priceChanges([o(2020, 'A', 150), o(2020, 'B', 170), o(2024, 'C', 440, 2), o(2024, 'A', 240)]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].first.price, 160); assert.equal(rows[0].last.price, 230); // medians per year, per unit
  assert.equal(rows[0].shops, 3);
  assert.equal(priceChanges([o(2020, 'A', 150), o(2024, 'A', 240), o(2024, 'B', 200)], { sameShop: true }).length, 0); // A has 2 points only
}
console.log('prices ok');

// Box shop (shape box.gr's own /api/shops returns, seen 2026-11-26)
{
  const src = (await import('node:fs')).readFileSync('./server.js', 'utf8');
  const code = src.slice(src.indexOf('const boxImage'), src.indexOf('async function boxStores')).replace('export function', 'function');
  const normalizeBoxShop = new Function(`${code}; return normalizeBoxShop;`)();
  const s = normalizeBoxShop({ _id: 'x', name: 'SAMPLE CAFE', locationKey: 'sample-area', vanity_url: 'sample-cafe',
    webImage: { path: 'https://images.box.gr/resized/shops/web/', name: 'hero', ext: 'jpg' }, ratingOverall: 4.5, ratingCounter: 100,
    deliveryFees: [{ fee: 0, minCartPrice: 0 }], minimumAllowedDeliveryOrderTotalPrice: 170, offerStickers: ['1+1'], cuisines: 'Σνακ, Ροφήματα',
    available: true, delivery: true, address: { latitude: 37.98, longitude: 23.73 } });
  assert.equal(s.url, 'https://box.gr/delivery/sample-area/sample-cafe');
  assert.equal(s.image, 'https://images.box.gr/resized/shops/web/hero.jpg');
  assert.equal(s.minOrder, 170); assert.equal(s.freeDelivery, true); assert.deepEqual(s.cuisines, ['Σνακ', 'Ροφήματα']);
}
console.log('box shop ok');
{
  const { sameShop } = await import('./public/lib/compare.js');
  const at = (name, dLat = 0) => ({ name, lat: 38 + dLat, lng: 23.7 });
  assert.ok(sameShop(at('Dirty Buns'), at('Dirty Buns Smash Burgers', 0.0005)));
  assert.ok(sameShop(at('Santa Pita'), at('SANTA PITA!', 0.003)));
  assert.ok(!sameShop(at('Santa Pita'), at('Santa Pita', 0.01)));       // > 400 m: another branch
  assert.ok(!sameShop(at('Coffee Island'), at('Coffee Lab', 0.0005)));
}
console.log('same shop ok');
{
  const { findDish, matchMenus, priceBasket } = await import('./public/lib/dishmatch.js');
  const ef = [{ name: 'Γύρος χοιρινός σε πίτα', price: 380 }, { name: 'Freddo Espresso', price: 250 }, { name: 'Πατάτες τηγανητές', price: 300 }, { name: 'Coca-Cola 330ml', price: 160 }];
  const wo = [{ name: 'Πίτα γύρος χοιρινός', price: 400 }, { name: 'Freddo espresso', price: 240 }, { name: 'Κοτόπουλο μερίδα', price: 900 }, { name: 'Coca-Cola Zero 330ml', price: 170 }];
  assert.equal(findDish('Γύρος χοιρινός σε πίτα', wo).item.price, 400);
  assert.equal(findDish('Κοτόπουλο', ef), null);
  const m = matchMenus(ef, wo);
  assert.equal(m.find((x) => x.name === 'Freddo Espresso').diff, -10);
  assert.ok(!m.some((x) => x.name === 'Πατάτες τηγανητές'));
  assert.ok(!m.some((x) => x.name === 'Coca-Cola 330ml'));                  // Zero is another product
  assert.equal(priceBasket([{ name: 'Freddo espresso', qty: 2 }], wo).total, 480);
  assert.equal(priceBasket([{ name: 'Σουβλάκι', qty: 1 }], wo), null);
}
{
  const { matchMenus } = await import('./public/lib/dishmatch.js');
  const m = matchMenus([{ name: 'Καλαμάκι χοιρινό', price: 250 }], [{ name: 'Καλαμάκι χοιρινό μερίδα', price: 750 }]);
  assert.equal(m.length, 0); // one skewer is not a portion
  const n = matchMenus([{ name: 'Παϊδάκια αρνίσια μερίδα', price: 1500 }], [{ name: 'Παϊδάκια αρνίσια μερίδα', price: 3800 }]);
  assert.equal(n.length, 0); // same name, 2.5x the price: a different size
}
console.log('dish match ok');

// The same shop on two platforms is one row in "your shops", coloured by where you order it most.
{
  const o = (platform, shop, total) => ({ platform, shop, shopId: `${platform}-${shop}`, ts: 1, total, items: [], delivery: null, service: null, tip: null, discount: null });
  const s = buildStats([o('efood', 'Pizza Fresca', 1000), o('wolt', 'PIZZA FRESCA ', 500), o('wolt', 'Pizza Fresca', 500), o('box', '', 300)]);
  assert.equal(s.topShops.length, 2); assert.equal(s.shops, 2);
  assert.equal(s.topShops[0].total, 2000); assert.equal(s.topShops[0].platform, 'wolt');
  assert.deepEqual(s.topShops[0].platforms, ['wolt', 'efood']);
}
console.log('shop merge ok');

// Untrusted imports: quantities become numbers, names text, and undated or empty records are dropped.
{
  const bad = normalizeEfood([null, { id: 5, price: 3 }, { id: 6, submission_date: '2025-03-01T10:00:00Z', price: 4, restaurant: { name: 7 }, products: [{ name: 'X', quantity: '<img src=x onerror=alert(1)>', unit_price: 2 }, null] }]);
  assert.equal(bad.length, 1); assert.equal(bad[0].items.length, 1);
  assert.equal(bad[0].items[0].qty, 1); assert.equal(bad[0].shop, '7');
  const nob = normalizeBox([{ createdAt: '2025-03-01T10:00:00Z', totalPrice: 100, shop: { name: 'S' } }, { createdAt: '2025-03-02T10:00:00Z', totalPrice: 100, shop: { name: 'S' } }]);
  assert.notEqual(nob[0].id, nob[1].id); // no _id: still two distinct orders when merged by id
  // A huge Wolt timestamp or a text coordinate cannot break the page: the record goes, the coordinate becomes null.
  assert.equal(normalizeWolt([{ purchase_id: 'a', timestamp: 1e300, venue: { name: 'V' } }]).length, 0);
  const box = normalizeBox([{ createdAt: '2025-03-01T10:00:00Z', totalPrice: 1, shop: { name: 'S', address: { latitude: '37.9', longitude: 'abc' } }, address: { latitude: 37.9, longitude: 'x' } }]);
  assert.equal(box[0].lat, 37.9); assert.equal(box[0].lng, null); assert.equal(box[0].to, null);
}
console.log('untrusted import ok');

// Wrapped: unpriced (Wolt) freddos don't drag the average to zero, and a shop on two platforms is one shop.
{
  const o = (platform, shop, items, total = 1000) => ({ platform, shop, shopId: `${platform}:${shop}`, ts: Date.UTC(2025, 4, 1, 10), total, items, delivery: null, service: null, tip: null, discount: null });
  const wr = buildWrapped([o('efood', 'Καφέ', [{ name: 'Freddo espresso', qty: 1, price: 250 }]), o('wolt', 'ΚΑΦΕ', [{ name: 'Freddo espresso', qty: 3, price: null }])]);
  assert.equal(wr.freddoEquivalent, Math.floor(2000 / 250));
  assert.equal(wr.loyal.count, 2);
}
console.log('wrapped ok');

// Compare: an unknown delivery cost is shown as unknown, not as free.
{
  const ef = efoodCost({ deliveryCost: null }, 1000, {}, 50);
  assert.equal(ef.unknownDelivery, true); assert.equal(ef.parts[0].unknown, true);
  const bx = boxCost({ deliveryTiers: [] }, 1000, 0);
  assert.equal(bx.unknownDelivery, true); assert.notEqual(bx.parts[0].label, 'Διανομή (δωρεάν)');
  const { findDish } = await import('./public/lib/dishmatch.js');
  assert.equal(findDish('🍕', [{ name: 'Με', price: 100 }]), null);
}
console.log('compare ok');
