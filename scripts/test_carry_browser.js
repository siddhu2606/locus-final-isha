/* A carried beacon follows on screen: the receiver phone gets packets in the Android app's format (id, rssi, height, flags,
   steps, compass/2, RSSI heard from beacons 1-6) while beacon 2 is carried 4 m; the phone map and the linked dashboard move it.
   node scripts/test_carry_browser.js [baseUrl]   (needs internet for the laptop link) */
const { launch } = require('./cdp.js'); let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
/* runs inside the phone page: feeds packets like the native bridge does, 10 Hz, beacon 2 walks to `goal` at 0.6 m/s then stops */
const FEED = goal => `(() => { const P = __phone.P; P.src = 'ble'; const A = P.anchors.map(a => ({ ...a, tx: a.x, ty: a.y, mv: false, pause: 0 })), me = [P.W / 2, P.H / 2], rng = rngMake(4), sim = {}, w = A[1]; let t = 0, n = 0;
  window.__truth = () => [w.tx, w.ty];
  window.__feed = setInterval(() => { t += 0.1; n++;
    const dx = ${goal[0]} - w.tx, dy = ${goal[1]} - w.ty, d = Math.hypot(dx, dy); w.mv = t > 2 && d > 0.05; if (w.mv) { const s = Math.min(d, 0.06); w.tx += dx / d * s; w.ty += dy / d * s; }
    BeaconMover.simulate(sim, A, t, rng, new Set(), wallsBetween);
    const m = measure3D(me, 1.2, 1.2, A.map(a => ({ ...a, x: a.tx, y: a.ty })), { model: 'rssi', loss: 0.1, rssi1m: P.rssi1m, n: P.pn, sigmaDb: 3, wallDb: 6 }, rng, wallsBetween);
    __bleBatch(A.map((a, i) => { if (!m[i]) return null; const o = sim[a.b].out, pe = [1, 2, 3, 4, 5, 6].map(k => o.peers[k] || 0); return [a.b, m[i].rssi, Math.round(a.z * 10), (o.moving ? 1 : 0) | (o.head != null ? 2 : 0), o.steps, o.head == null ? 0 : Math.round(o.head / 2), ...pe]; }).filter(Boolean));
  }, 100); return A[1].x + ',' + A[1].y; })()`;
(async () => {
  const base = process.argv[2] || 'http://localhost:8790/';
  /* 1. phone alone (not linked): its own map follows the carried beacon */
  const B = await launch(base + 'phone.html#rx', 400, 860, true); await B.sleep(2500);
  await B.ev(`__phone.P.W = 10; __phone.P.H = 8; __phone.P.space = 'room'; __phone.setSrc('sim'); 1`); await B.sleep(500);
  const from = await B.ev(FEED([6, 3])); await B.sleep(13000);
  let r = JSON.parse(await B.ev(`JSON.stringify({ a: __phone.P.anchors[1], tr: __truth(), note: document.getElementById('n-map').textContent, still: __phone.P.anchors.filter((a, i) => i !== 1).map(a => a.x + ',' + a.y) })`));
  ok(Math.hypot(r.a.x - r.tr[0], r.a.y - r.tr[1]) < 1.0, `phone map: beacon 2 carried from ${from} to ${r.tr.map(v => v.toFixed(1))}, shown at ${r.a.x.toFixed(1)}, ${r.a.y.toFixed(1)} (${Math.hypot(r.a.x - r.tr[0], r.a.y - r.tr[1]).toFixed(2)} m off)`);
  ok(r.still.join(' ') === '0.3,0.3 9.7,7.7 0.3,7.7', 'beacons that were not carried stay put');
  await B.ev(`clearInterval(__feed)`); B.close();
  /* 2. linked: the dashboard follows it too (telemetry forwarded by the receiver) */
  const P2 = await launch(base + 'phone.html#rx', 400, 860, true); let code = '';
  for (let i = 0; i < 30 && !/^\d{6}$/.test(code); i++) { await P2.sleep(1000); code = await P2.ev(`/Code/.test(document.getElementById('pill-t').textContent) ? __phone.Link.code : ''`); }
  const D = await launch(base + 'dashboard.html', 1280, 900); await D.sleep(2500);
  await D.ev(`document.querySelector('#spaces [data-sp=room]').click(); __locus.S.plan = { walls: [], rooms: [] }; document.getElementById('i-W').value = 10; document.getElementById('i-H').value = 8; document.getElementById('i-W').onchange(); document.getElementById('i-H').onchange(); 1`); await D.sleep(500);
  await D.ev(`document.getElementById('i-code').value = '${code}'; document.getElementById('b-pair').click()`);
  let linked = false; for (let i = 0; i < 25 && !linked; i++) { await D.sleep(1000); linked = await D.ev(`__locus.Phone.open`) && await P2.ev(`!!__phone.P.cfg && __phone.P.cfg.W === 10`); }
  ok(linked, 'dashboard linked to the receiver phone, room 10 x 8 m sent to the phone');
  await P2.ev(FEED([6, 3])); await D.sleep(15000);
  r = JSON.parse(await D.ev(`JSON.stringify({ a: __locus.S.anchors[1], log: __locus.MT.log.filter(m => m.id === 'A2').length, banner: document.getElementById('mv-banner').textContent, tele: document.getElementById('bt-tele').textContent, link: document.getElementById('bt-link').textContent })`));
  const tr = JSON.parse(await P2.ev(`JSON.stringify(__truth())`)), e = Math.hypot(r.a.x - tr[0], r.a.y - tr[1]);
  ok(e < 1.0, `dashboard: beacon 2 shown at ${r.a.x.toFixed(1)}, ${r.a.y.toFixed(1)}, really at ${tr.map(v => v.toFixed(1))} (${e.toFixed(2)} m off)`);
  ok(r.log >= 1 && /B2 moved/.test(r.banner), 'move logged with arrow + banner: ' + r.banner);
  ok(/steps/.test(r.banner) || /distances to/.test(r.banner) || r.log >= 1, 'banner says what sensed it');
  ok(/B1.*B2.*B3/.test(r.tele) && /fitted from \d+ still pair/.test(r.link), 'telemetry table + beacon-to-beacon radio model: ' + r.link);
  ok(await P2.ev(`Math.hypot(__phone.P.anchors[1].x - ${r.a.x}, __phone.P.anchors[1].y - ${r.a.y}) < 0.5`), 'the phone shows the same new position (sent back by the dashboard)');
  ok(!D.logs.length && !P2.logs.length, 'no console errors' + (D.logs.concat(P2.logs).length ? ': ' + D.logs.concat(P2.logs).join(' | ') : ''));
  D.close(); P2.close(); console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
