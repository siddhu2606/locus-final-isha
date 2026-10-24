/* Node tests for Moving Beacons: node scripts/test_moving.js  (add --compare to also print the full fixed-vs-moving table) */
Object.assign(global, require('../src/engine.js'));
for (const f of ['config', 'motion', 'sim', 'estimator', 'compare']) Object.assign(global, require('../src/moving/' + f + '.js'));
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const near = (a, b, t) => Math.abs(a - b) <= t;
const cfg = () => JSON.parse(JSON.stringify(MB_CONFIG));

/* 1 displacement + bearing (y = north, bearing clockwise from north) */
{ const d = displacement([0, 0], [3, 4]); ok(near(d.dist, 5, 1e-12) && d.dist.toFixed(1) === '5.0', '(0,0) -> (3,4) is 5.0 m');
  ok(near(d.bearing, 36.8699, 1e-3) && d.compass === 'north-east' && d.dx === 3 && d.dy === 4, `(0,0) -> (3,4) bearing ${d.bearing.toFixed(2)}° north-east, dx +3 dy +4`);
  const cases = [[[0, 0], [0, 2], 0, 'north'], [[0, 0], [2, 0], 90, 'east'], [[0, 0], [0, -1], 180, 'south'], [[0, 0], [-1, 0], 270, 'west'], [[1, 1], [0, 0], 225, 'south-west'], [[2, 2], [3, 1], 135, 'south-east'], [[0, 0], [-1, 1], 315, 'north-west']];
  ok(cases.every(([a, b, br, c]) => near(displacement(a, b).bearing, br, 1e-9) && displacement(a, b).compass === c), 'N / E / S / W / SW / SE / NW bearings');
  const e = displacement([0, 0], [1.3, 1.2]); ok(Math.round(e.bearing) === 47 && e.compass === 'north-east' && e.dist.toFixed(1) === '1.8', 'mentor example: dx +1.3, dy +1.2 -> 1.8 m toward 47° north-east');
  const s = fmtMove('A2', displacement([0, 0], [3, 4])); ok(s === 'A2 moved 5.0 m toward 37° (north-east) · dx = +3.0 m, dy = +4.0 m', 'formatted text: ' + s);
  ok(displacement([1, 1], [1, 1]).dist === 0, 'zero move is 0 m'); }

/* 2 movement tracker */
const D = () => ({ ...MB_CONFIG.display });
{ const T = new MoveTracker(D()); T.update('A1', 0, 0, 0, true); const seg = T.update('A1', 3, 4, 0.1, true);
  ok(seg && seg.live && seg.dist.toFixed(1) === '5.0' && Math.round(seg.bearing) === 37 && T.log.length === 1, 'exact jump (0,0)->(3,4): live log entry at once, 5.0 m toward 37°');
  for (let t = 0.2; t < 3; t += 0.1) T.update('A1', 3, 4, t, true);
  const st = T.stats('A1', 3); ok(!T.log[0].live && T.log[0].dist.toFixed(1) === '5.0' && near(st.total, 5, 1e-9) && near(st.recent, 5, 1e-9) && st.speed === 0, 'settles: one finished entry, total 5.0 m, last-10 s 5.0 m, speed 0');
  for (let t = 3; t < 12; t += 0.1) T.update('A1', 3, 4, t, true); ok(T.stats('A1', 12).recent === 0 && T.stats('A1', 12).total === 5, 'distance in last 10 s drops to 0 after 10 s, total stays'); }
{ const T = new MoveTracker(D()), r = rngMake(5); T.update('A1', 5, 5, 0, false); for (let t = 0.1; t < 120; t += 0.1) T.update('A1', 5 + 0.03 * r.g(), 5 + 0.03 * r.g(), t, false);
  ok(T.log.length === 0, `120 s of 3 cm jitter (threshold ${MB_CONFIG.display.threshold} m): ${T.log.length} log entries`); }
{ const T = new MoveTracker(D()); T.update('A1', 0, 0, 0, true); T.update('A1', 0.05, 0, 0.1, true); for (let t = 0.2; t < 2; t += 0.1) T.update('A1', 0.05, 0, t, true);
  ok(T.log.length === 0, '0.05 m move is below the 0.1 m threshold: not logged');
  T.update('A1', 0.2, 0, 2.1, true); ok(T.log.length === 1 && T.log[0].dist.toFixed(2) === '0.20', '0.2 m move is logged as 0.20 m'); }
{ const T = new MoveTracker(D()); let t = 0, x = 1; T.update('B', 1, 1, 0, false); let vmax = 0;
  while (x < 4) { t += 0.1; x = Math.min(4, x + 0.06); T.update('B', x, 1, t, false); vmax = Math.max(vmax, T.stats('B', t).speed); }
  for (let k = 0; k < 30; k++) { t += 0.1; T.update('B', 4, 1, t, false); }
  const m = T.log[0]; ok(T.log.length === 1 && near(m.dist, 3, 0.05) && near(m.bearing, 90, 1) && !m.live, `walk 3 m east at 0.6 m/s: one entry ${m && m.dist.toFixed(2)} m toward ${m && m.bearing.toFixed(0)}°`);
  ok(near(vmax, 0.6, 0.05), `speed while walking ${vmax.toFixed(2)} m/s`); ok(near(T.stats('B', t).total, 3, 0.15), 'total travelled ~3 m: ' + T.stats('B', t).total.toFixed(2)); }
{ const T = new MoveTracker(D()); let t = 0, p = [1, 1]; T.update('C', 1, 1, 0, true);
  for (let k = 0; k < 40; k++) { t += 0.1; p = [p[0] + 0.05, p[1]]; T.update('C', p[0], p[1], t, true); }
  for (let k = 0; k < 40; k++) { t += 0.1; p = [p[0], p[1] + 0.05]; T.update('C', p[0], p[1], t, true); }
  for (let k = 0; k < 20; k++) { t += 0.1; T.update('C', p[0], p[1], t, true); }
  const L = T.log.slice().reverse(); ok(L.length === 2 && near(L[0].bearing, 90, 3) && near(L[1].bearing, 0, 3) && near(L[0].dist + L[1].dist, 4, 0.2), `east then north without stopping: ${L.length} entries ${L.map(q => q.dist.toFixed(1) + ' m @ ' + q.bearing.toFixed(0) + '°').join(', ')}`); }

/* 3 engine: moveAnchor + position uncertainty */
{ setRoom(10, 8, []); const A = [{ id: 'A1', x: 1, y: 1 }, { id: 'A2', x: 9, y: 1 }, { id: 'A3', x: 5, y: 7 }], L = new Locus(A, { N: 300, rng: rngMake(3) }), truth = [4, 3], r = rngMake(9);
  const meas = () => A.map(a => ({ r: Math.hypot(truth[0] - a.x, truth[1] - a.y) + 0.2 * r.g() }));
  for (let k = 0; k < 50; k++) L.step(meas(), 0.1);
  L.moveAnchor(0, 2, 6, 0.1); ok(A[0].x === 2 && A[0].y === 6 && A[0].sd === 0.1 && L.last[0] === null, 'Locus.moveAnchor: new position + sd stored, jump history reset');
  let o; for (let k = 0; k < 50; k++) o = L.step(meas(), 0.1); ok(Math.hypot(o.pos[0] - 4, o.pos[1] - 3) < 0.6 && o.trust[0] > 0.5, `engine keeps tracking after the anchor moved: error ${Math.hypot(o.pos[0] - 4, o.pos[1] - 3).toFixed(2)} m, trust ${o.trust[0].toFixed(2)}`); }

/* 4 estimator with moving beacons */
{ const C = cfg(), w = new World(C, 2, { mode: 'moving' }), est = new MovingEstimator(C, 5); let e = 0, n = 0, posOk = true, o;
  for (let k = 0; k < 600; k++) { w.step(0.1); const bel = {}; w.beacons.forEach(b => bel[b.id] = { x: b.believed[0], y: b.believed[1], sd: b.sd }); o = est.step(w.t, w.measure(), bel, 0.1);
    est.anchors.forEach(a => { const b = w.get(a.id); if (a.x !== b.believed[0] || a.y !== b.believed[1] || a.sd !== b.sd) posOk = false; });
    if (o && w.t > 5) { e += Math.hypot(o.pos[0] - w.obj.pos[0], o.pos[1] - w.obj.pos[1]); n++; } }
  ok(posOk, 'every step the estimator uses each beacon\'s newest believed position and its uncertainty');
  ok(e / n < 1.6, `tracks with 4 moving beacons: mean error ${(e / n).toFixed(2)} m`);
  const xs = est.win.filter(q => q.id === 'A1').map(q => q.x); ok(o.window > 50 && Math.max(...xs) - Math.min(...xs) > 0.3, `window holds ${o.window} readings; A1's come from positions spread over ${(Math.max(...xs) - Math.min(...xs)).toFixed(2)} m`);
  ok(w.beacons.every(b => Math.hypot(b.truth[0] - b.believed[0], b.truth[1] - b.believed[1]) < 0.6) && w.beacons.some(b => b.truth[0] !== b.believed[0]), 'true and believed positions are kept separate (differ by noise + drift)');
  /* dead beacon handling unchanged */
  w.get('A1').dead = true; for (let k = 0; k < 50; k++) { w.step(0.1); const bel = {}; w.beacons.forEach(b => bel[b.id] = { x: b.believed[0], y: b.believed[1], sd: b.sd }); o = est.step(w.t, w.measure(), bel, 0.1); }
  const i = o.ids.indexOf('A1'); ok(o.trust[i] < 0.05 && /No packets/.test(o.reasons[i]) && o.perBeacon.A1 === 0, `killed A1: trust ${o.trust[i].toFixed(2)}, "${o.reasons[i]}", 0 readings in window after ${C.estimator.windowSec} s`); }

/* 5 external updates + add / remove */
{ const C = cfg(), w = new World(C, 1); const b = w.externalUpdate('A9', 2, 3, 1234); ok(b && b.id === 'A9' && b.mode === 'external' && b.believed[0] === 2 && b.truth[1] === 3 && b.extTs === 1234, 'update_beacon_position on an unknown id adds it as an external beacon');
  w.externalUpdate('A2', 5, 5); ok(w.get('A2').mode === 'external' && w.get('A2').believed[0] === 5, 'update on an existing beacon moves it and switches it to external');
  ok(w.removeBeacon('A9') && !w.get('A9') && w.beacons.length === 4, 'remove beacon');
  const est = new MovingEstimator(C, 1); const bel = {}; w.beacons.forEach(q => bel[q.id] = { x: q.believed[0], y: q.believed[1], sd: q.sd }); for (let k = 0; k < 20; k++) { w.step(0.1); est.step(w.t, w.measure(), bel, 0.1); }
  w.addBeacon(6, 4, 'fixed'); const bel2 = {}; w.beacons.forEach(q => bel2[q.id] = { x: q.believed[0], y: q.believed[1], sd: q.sd }); w.step(0.1); const o = est.step(w.t, w.measure(), bel2, 0.1); ok(o && o.ids.length === 5, 'estimator picks up an added beacon without restarting'); }

/* 6 comparison: deterministic, and moving helps where the fixed geometry is weak */
{ const C = cfg(); C.compare.seconds = 40; const a = runScenario(C, 3, true), b = runScenario(C, 3, true); ok(a.length > 300 && a.every((v, i) => v === b[i]), 'comparison runs are deterministic (same seed, same errors)');
  const f1 = runScenario(C, 3, false), m1 = runScenario(C, 3, true); ok(f1.length === m1.length, 'fixed and moving runs cover the same time steps'); }
(async () => {
  if (process.argv.includes('--compare')) {
    const t0 = Date.now(), rows = await compareFixedMoving(MB_CONFIG), noWin = await compareFixedMoving(MB_CONFIG, null, { windowSec: 0 });
    console.log(`\nFixed vs moving (${MB_CONFIG.compare.seeds.length} seeds x ${MB_CONFIG.compare.seconds} s, ${(Date.now() - t0) / 1000 | 0} s):`);
    rows.forEach((r, i) => console.log(`  ${r.layout.padEnd(14)} fixed mean ${r.fixed.mean.toFixed(2)} worst ${r.fixed.worst.toFixed(2)} | moving mean ${r.moving.mean.toFixed(2)} worst ${r.moving.worst.toFixed(2)} | change ${((r.moving.mean / r.fixed.mean - 1) * 100).toFixed(0)}% | no window: fixed ${noWin[i].fixed.mean.toFixed(2)} moving ${noWin[i].moving.mean.toFixed(2)}`));
    const two = rows.find(r => r.layout === '2 beacons'); ok(two.moving.mean < two.fixed.mean * 0.9, '2-beacon layout: moving beacons lower the mean error by >10%');
  }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
