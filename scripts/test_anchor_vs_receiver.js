/* The receiver stands still (its sensor says so) while a beacon phone is carried across the room.
   The receiver must stay put and the beacon must move. Run with an old beacon app (no motion data in its packet) and the new one.
   node scripts/test_anchor_vs_receiver.js [baseUrl] */
const { launch } = require('./cdp.js'); let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const FEED = (goal, tele) => `(() => { const P = __phone.P; P.src = 'ble'; const A = P.anchors.map(a => ({ ...a, tx: a.x, ty: a.y, mv: false, pause: 0 })), me = [5, 4], rng = rngMake(8), sim = {}, w = A[1]; let t = 0;
  window.__truth = () => [w.tx, w.ty];
  window.__feed = setInterval(() => { t += 0.1; __nativeEvent({ type: 'self', moving: false, steps: 0, head: 0 });   /* receiver: still */
    const dx = ${goal[0]} - w.tx, dy = ${goal[1]} - w.ty, d = Math.hypot(dx, dy); w.mv = t > 12 && d > 0.05; if (w.mv) { const s = Math.min(d, 0.06); w.tx += dx / d * s; w.ty += dy / d * s; }
    BeaconMover.simulate(sim, A, t, rng, new Set(), wallsBetween);
    const m = measure3D(me, 1.2, 1.2, A.map(a => ({ ...a, x: a.tx, y: a.ty })), { model: 'rssi', loss: 0.1, rssi1m: P.rssi1m, n: P.pn, sigmaDb: 3, wallDb: 6 }, rng, wallsBetween);
    __bleBatch(A.map((a, i) => { if (!m[i]) return null; const o = sim[a.b].out, pe = [1, 2, 3, 4, 5, 6].map(k => o.peers[k] || 0);
      return ${tele ? "[a.b, m[i].rssi, Math.round(a.z * 10), (o.moving ? 1 : 0) | (o.head != null ? 2 : 0), o.steps, o.head == null ? 0 : Math.round(o.head / 2), ...pe]" : "[a.b, m[i].rssi, Math.round(a.z * 10)]"}; }).filter(Boolean));
  }, 100); return 1; })()`;
(async () => {
  const base = process.argv[2] || 'http://localhost:8790/';
  for (const tele of [false, true]) {
    const B = await launch(base + 'phone.html#rx', 400, 860, true); await B.sleep(2500);
    await B.ev(`__phone.P.W = 10; __phone.P.H = 8; __phone.P.space = 'room'; __phone.setSrc('sim'); 1`); await B.sleep(300);
    await B.ev(FEED([6.5, 2.5], tele)); await B.sleep(12000);
    let worst = 0; for (let k = 0; k < 36; k++) { await B.sleep(500); const p = JSON.parse(await B.ev(`JSON.stringify(__phone.P.out.pos)`)); worst = Math.max(worst, Math.hypot(p[0] - 5, p[1] - 4)); }
    const r = JSON.parse(await B.ev(`JSON.stringify({ rx: __phone.P.out.pos, still: __phone.P.rxStill, b2: [__phone.P.anchors[1].x, __phone.P.anchors[1].y], tr: __truth(), others: __phone.P.anchors.filter((a, i) => i !== 1).map(a => a.x.toFixed(1) + ',' + a.y.toFixed(1)).join(' ') })`));
    const rxMoved = worst, bErr = Math.hypot(r.b2[0] - r.tr[0], r.b2[1] - r.tr[1]), bMoved = Math.hypot(r.b2[0] - 9.7, r.b2[1] - 0.3), lbl = tele ? 'new beacon app' : 'old beacon app (no motion data)';
    ok(r.still && rxMoved < 0.8, `${lbl}: still receiver stays put while beacon 2 is carried 4.5 m: at most ${rxMoved.toFixed(2)} m from its true spot the whole time, ${Math.hypot(r.rx[0] - 5, r.rx[1] - 4).toFixed(2)} m at the end`);
    ok(tele ? bMoved > 2.5 && bErr < 1.0 : bMoved > 1.5 && bErr < 2.0, `${lbl}: beacon 2 moved ${bMoved.toFixed(1)} m on the map, ends ${bErr.toFixed(2)} m from where it really is${tele ? '' : ' (approximate: only its distance to the receiver is known)'}`);
    ok(r.others === '0.3,0.3 9.7,7.7 0.3,7.7', `${lbl}: the other beacons stay put`);
    ok(!B.logs.length, 'no console errors' + (B.logs.length ? ': ' + B.logs.join(' | ') : ''));
    await B.ev(`clearInterval(__feed)`); B.close();
  }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
