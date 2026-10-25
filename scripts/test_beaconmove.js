/* Carried beacons: steps + compass + beacon-to-beacon distances move the beacon on the map. node scripts/test_beaconmove.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console, Math, Float64Array, Uint8Array, Int32Array, JSON, Set, Map, Object, Array, Number, String, isFinite });
['engine.js', 'radio.js', 'beaconmove.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', f), 'utf8').replace(/if \(typeof module[^\n]*\n?/g, ''), ctx));
const E = s => vm.runInContext(s, ctx); let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
/* room 10 x 8 (open), 4 beacons; carry beacon 2 along a path, at walking speed, with pauses */
function run(path, seed, opts) {
  return E(`(() => {
    setRoom(10, 8, [], []); const A = [[1,1,2.4],[9,1,0.9],[9,7,2.4],[1,7,0.9]].map((p, i) => ({ id: 'A' + (i + 1), b: i + 1, x: p[0], y: p[1], z: p[2], tx: p[0], ty: p[1], mv: false, pause: 0 }));
    const M = new BeaconMover(), sim = {}, rng = rngMake(${seed}), dead = new Set(${JSON.stringify(opts && opts.dead || [])}), path = ${JSON.stringify(path)}, a = A[1]; let t = 0, k = 0, worst = 0, firstSeen = null;
    const tick = dt => { t += dt; BeaconMover.simulate(sim, A, t, rng, dead, wallsBetween); A.forEach(q => M.tele(q.b, t, ${opts && opts.noSteps ? '{ ...sim[q.b].out, steps: null, head: null }' : 'sim[q.b].out'})); M.step(A, t, 10, 8).forEach(u => { const q = A.find(z => z.b === u.b); q.x = u.x; q.y = u.y; if (firstSeen == null && u.b === 2) firstSeen = t; }); };
    for (let s = 0; s < 20; s++) tick(0.2);   /* settle */
    for (const goal of path) { a.mv = true; for (let n = 0; n < 400; n++) { const dx = goal[0] - a.tx, dy = goal[1] - a.ty, d = Math.hypot(dx, dy); if (d < 0.05) break; const st = Math.min(d, 0.6 * 0.2); a.tx += dx / d * st; a.ty += dy / d * st; tick(0.2); worst = Math.max(worst, Math.hypot(a.x - a.tx, a.y - a.ty)); } a.mv = false; for (let s = 0; s < 45; s++) tick(0.2); }
    return { err: Math.hypot(a.x - a.tx, a.y - a.ty), worst, others: Math.max(...A.filter(q => q !== a).map(q => Math.hypot(q.x - q.tx, q.y - q.ty))), link: M.link, d13: M.range(1, 3, t, 0), seen: firstSeen };
  })()`);
}
let r = run([[5, 3]], 3); ok(r.err < 0.8, `beacon 2 carried 5.1 m: ends ${r.err.toFixed(2)} m from where it really is (worst while walking ${r.worst.toFixed(2)} m)`);
ok(r.seen != null && r.seen < 6, 'its first move shows on the map (at its first step) ' + (r.seen - 4).toFixed(1) + ' s after it starts walking');
ok(r.others < 1e-9, 'beacons that did not move stay exactly where they are');
ok(r.link.pairs >= 3 && Math.abs(r.d13 - 10) < 1.5, `beacon-to-beacon radio model fitted from the still beacons (${r.link.pairs} pairs): beacons 1-3 read ${r.d13.toFixed(1)} m apart (really 10.0 m)`);
r = run([[6, 4], [2, 4], [3, 6.5]], 5); ok(r.err < 0.9, `three legs with pauses (11 m): ends ${r.err.toFixed(2)} m off (compasses off by up to 15°)`);
r = run([[5, 3]], 7, { noSteps: true }); ok(r.err < 1.0, `a phone without step / compass sensors: distances alone, ends ${r.err.toFixed(2)} m off`);
r = run([[5, 3]], 9, { dead: ['A4'] }); ok(r.err < 1.5, `beacon 4 dead, only 2 still beacons to measure against (less accurate): ends ${r.err.toFixed(2)} m off`);
console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);
