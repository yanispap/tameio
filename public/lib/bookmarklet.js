// The "Tameio sync" bookmarklet for Wolt and Box. Clicked on wolt.com or box.gr, it fetches your
// orders inside that page (with the login you already have there), opens Tameio
// and hands them over with postMessage. No token ever leaves the site's page.

// Origins Tameio accepts orders from. Checked on the receiving side.
export const SENDERS = ['https://wolt.com', 'https://www.wolt.com', 'https://box.gr', 'https://www.box.gr'];

/** Runs on the delivery site. Stringified into the bookmarklet, so it must be self-contained. */
function tameioSync(P) {
  // Open the window first, while the click still counts as a user gesture.
  const w = window.open(P + '/#receive', 'tameio');
  const h = location.hostname;
  (async () => {
    let raw;
    if (/(^|\.)box\.gr$/.test(h)) {
      // Box only answers its own client, so we do not call its API. We load box.gr's own pages in a
      // hidden frame (fresh, so it really fetches) and keep the answers it receives.
      const grab = (path, re) => new Promise((resolve) => {
        const f = document.createElement('iframe');
        f.style.cssText = 'position:fixed;left:-9999px;width:1200px;height:900px;';
        f.src = path;
        document.body.append(f);
        let hooked = null, out = null;
        const t0 = Date.now();
        const iv = setInterval(() => {
          try {
            const w = f.contentWindow;
            if (w && w.location.href !== 'about:blank' && w.XMLHttpRequest && hooked !== w) {
              hooked = w;
              const P = w.XMLHttpRequest.prototype, O = P.open, S = P.send;
              P.open = function (m, u) { this.__u = String(u); return O.apply(this, arguments); };
              P.send = function () { this.addEventListener('load', () => { if (re.test(this.__u)) { try { out = JSON.parse(this.responseText); } catch (e) {} } }); return S.apply(this, arguments); };
            }
          } catch (e) {}
          if (out || Date.now() - t0 > 15000) { clearInterval(iv); f.remove(); resolve(out); }
        }, 5);
      });
      const cap = { shops: await grab('/home', /\/api\/shops\?/), orders: await grab('/account/history', /orders\/get\/userlist/i) };
      if (!cap.orders && !cap.shops) throw 'Συνδέσου πρώτα στο box.gr και διάλεξε διεύθυνση.';
      raw = { tameio: 'box', orders: cap.orders ?? null, shops: cap.shops?.payload?.shops ?? null };
    } else if (/(^|\.)wolt\.com$/.test(h)) {
      const c = document.cookie.split('; ').find((x) => x.startsWith('__wtoken='));
      let t = null;
      try { t = c && JSON.parse(decodeURIComponent(c.slice(9))).accessToken; } catch (e) {}
      if (!t) throw 'Συνδέσου πρώτα στο wolt.com.';
      const orders = [];
      let next = null;
      for (let i = 0; i < 200; i++) {
        const u = new URL('https://consumer-api.wolt.com/order-xp/web/v1/pages/orders');
        if (next) u.searchParams.set('page_token', next);
        const r = await fetch(u, { headers: { Authorization: 'Bearer ' + t } });
        if (!r.ok) throw 'Το Wolt απάντησε ' + r.status + '.';
        const b = await r.json();
        orders.push(...(b.orders || []));
        next = b.next_page_token;
        if (!next || !(b.orders || []).length) break;
        await new Promise((s) => setTimeout(s, 500));
      }
      raw = { orders };
    } else {
      throw 'Άνοιξε το wolt.com ή το box.gr, συνδέσου, και πάτα ξανά.';
    }
    // Tameio keeps saying "ready" until it has the data, so timing does not matter.
    const onMsg = (e) => {
      if (e.origin === P && e.data === 'tameio-ready') { w.postMessage({ tameio: raw }, P); removeEventListener('message', onMsg); }
    };
    addEventListener('message', onMsg);
  })().catch((e) => { try { w.close(); } catch (x) {} alert('Tameio: ' + e); });
}

export function bookmarkletHref(origin) {
  return 'javascript:' + encodeURIComponent(`(${tameioSync.toString()})(${JSON.stringify(origin)});void 0`);
}
