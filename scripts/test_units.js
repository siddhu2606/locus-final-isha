/* Unit tests (no browser): radio calibration, access gates, ISHA, moving maths, fused trust. node scripts/test_units.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console, Math, Float64Array, Uint8Array, JSON, Set, Map, Object, Array, Number, String, isFinite, Date });
['engine.js', 'trust_model.js', 'room_core.js', 'radio.js', 'assets.js', 'access.js', 'isha.js', 'moving/motion.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', f), 'utf8').replace(/if \(typeof module[^\n]*\n?/g, ''), ctx));
const E = s => vm.runInContext(s, ctx);
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

/* --- radio: the 13 cm -> 3.2 m bug, and calibration fixing it --- */
ok(Math.abs(E('rangeFrom(-70, -59, 2.2)') - 3.16) < 0.02, 'uncalibrated: a phone reading -70 dBm is called ' + E('rangeFrom(-70, -59, 2.2)').toFixed(2) + ' m (the bug)');
const truthP1 = -89.5, rs = d => truthP1 - 10 * 2.2 * Math.log10(d);   /* a weak phone: -70 dBm at 13 cm */
E(`var f1 = fitCal([{ d: 1, rssi: ${rs(1)} }], 2.2)`);
ok(Math.abs(E('rangeFrom(' + rs(0.13) + ', f1.p1, f1.n)') - 0.13) < 0.01, 'after a 1 m calibration the same reading is ' + (E('rangeFrom(' + rs(0.13) + ', f1.p1, f1.n)') * 100).toFixed(0) + ' cm');
E(`var f2 = fitCal([{ d: 0.1, rssi: ${rs(0.1) + 0.4} }, { d: 1, rssi: ${rs(1) - 0.3} }], 2.2)`);
ok(Math.abs(E('f2.n') - 2.2) < 0.1 && Math.abs(E('f2.p1') - truthP1) < 1, `two-point calibration fits p1 ${E('f2.p1')} dBm, n ${E('f2.n')} (true -89.5, 2.2)`);
const n3 = 3.0, rs3 = d => -65 - 10 * n3 * Math.log10(d); E(`var f3 = fitCal([{ d: 0.5, rssi: ${rs3(0.5)} }, { d: 2, rssi: ${rs3(2)} }], 2.2)`);
ok(Math.abs(E('f3.n') - 3) < 0.05 && Math.abs(E('rangeFrom(' + rs3(4) + ', f3.p1, f3.n)') - 4) < 0.05, 'fits a steeper fade (n = 3): 4 m reads ' + E('rangeFrom(' + rs3(4) + ', f3.p1, f3.n)').toFixed(2) + ' m');
ok(E('fmtDist(0.13)') === '13 cm' && E('fmtDist(3.164)') === '3.16 m', 'distances under 1 m are shown in cm');
ok(E('rssiLevel([-60, -61, -90, -59, -60])') === -60, 'one faded packet does not move the median');

/* --- access gates --- */
const D = q => E('gateDecide(' + JSON.stringify(q) + ')');
ok(D({ role: 'nurseB', device: 'reg', inside: true, poc: true }).level === 'room', 'Ward B nurse, registered, inside, POC -> room');
ok(D({ role: 'nurseB', device: 'reg', inside: true, poc: false }).level === 'building', 'not POC -> "in building" only');
ok(D({ role: 'nurseI', device: 'reg', inside: true, poc: true }).reason === 'not your ward', 'ICU nurse -> denied, not your ward');
ok(D({ role: 'guard', device: 'reg', inside: true, poc: true }).reason === 'guards see exits only', 'guard -> denied at gate 1');
ok(D({ role: 'admin', device: 'own', inside: true, poc: true }).deniedAt === 1, 'personal phone -> denied at gate 2');
ok(D({ role: 'admin', device: 'reg', inside: false, poc: true }).reason === 'phone is off-site', 'off-site -> denied at gate 2');
E('var au = new Audit(); au.add({ who: "Guard G-011", allowed: false, reason: "x" }); var r2 = au.add({ who: "Guard G-011", allowed: false, reason: "x" });');
ok(/flagged to admin/.test(E('r2.result')), 'second denial in a row is flagged to admin');

/* --- ISHA --- */
E(`var A = [{ id: 'WC-01', type: 'wheelchair', name: 'Wheelchair', pos: [4, 20], zone: 'Reception', conf: 0.9, online: true },
  { id: 'WC-02', type: 'wheelchair', name: 'Wheelchair', pos: [17, 6.5], zone: 'Ward B', conf: 0.8, online: true },
  { id: 'O2-01', type: 'oxygen', name: 'Oxygen cylinder', pos: [22, 3], zone: 'ICU', conf: 1, online: true },
  { id: 'P-112', type: 'patient', name: 'Patient P-112', pos: [13, 4], zone: 'Ward B', conf: 0.87, online: true }];
  var C = { assets: A, me: { pos: [15, 12], zone: 'Corridor' }, alerts: [], beacons: [{ b: 1, z: 2.6, ok: true, trust: 0.9, range: 3.2 }, { b: 3, z: 0.9, ok: false, trust: 0, why: 'No packets for 4 s' }], person: id => ({ text: 'gated ' + id }) };`);
const Q = q => E('ishaAsk(' + JSON.stringify(q) + ', C)');
let r = Q('Where is the nearest wheelchair?'); ok(/WC-02, in Ward B, about 6 m north of you/.test(r.text) && r.focus === 'WC-02', 'nearest wheelchair: ' + r.text);
r = Q('wheelchair kahan hai'); ok(/WC-02/.test(r.text), 'Hinglish: ' + r.text);
r = Q('where is O2-01'); ok(/O2-01 \(Oxygen cylinder\) is in ICU/.test(r.text), 'by tag id: ' + r.text);
r = Q('oxygen'); ok(/O2-01/.test(r.text), 'one word: ' + r.text);
r = Q('is beacon 3 working'); ok(/Beacon 3 \(0\.9 m high\) is NOT heard: No packets/.test(r.text), 'beacon health: ' + r.text);
r = Q('where is patient P-112'); ok(r.text === 'gated P-112', 'patients go through the access gates');
r = Q('where am i'); ok(/Corridor/.test(r.text), 'where am I: ' + r.text);
r = Q('how many wheelchairs'); ok(/^2 wheelchairs/.test(r.text), 'count: ' + r.text);
r = Q('blah'); ok(/did not understand/.test(r.text), 'unknown question gets a helpful answer');

/* --- direction on the floor map (north = up = -y) --- */
ok(E('dirFrom([0, 0], [3, -4]).name') === 'north-east' && Math.abs(E('dirFrom([0, 0], [3, -4]).d') - 5) < 1e-9, '(0,0) -> (3,4 north): 5 m north-east');

/* --- engine: fused trust keeps both scores; a dead beacon drops to 0 in about 1.2 s --- */
E(`setRoom(8, 6, [{ id: 'A1', x: .3, y: .3 }, { id: 'A2', x: 7.7, y: .3 }, { id: 'A3', x: 7.7, y: 5.7 }, { id: 'A4', x: .3, y: 5.7 }], []);
  var AN = [{ id: 'A1', x: .3, y: .3 }, { id: 'A2', x: 7.7, y: .3 }, { id: 'A3', x: 7.7, y: 5.7 }, { id: 'A4', x: .3, y: 5.7 }], L = new Locus(AN, { N: 300, sigma: 0.5, rng: rngMake(3), scorer: trustPredict, mode: 'fused' }), rg = rngMake(9), o = null, t0 = null;
  for (var k = 0; k < 80; k++) { var p = [4, 3]; var m = AN.map((a, i) => (k > 40 && i === 2) ? null : { r: Math.hypot(p[0] - a.x, p[1] - a.y) + rg.g() * 0.3 }); o = L.step(m, 0.1); if (k > 40 && t0 == null && o.trust[2] < 0.05) t0 = (k - 40) * 0.1; }`);
ok(E('o.tRule.length === 4 && o.tML.length === 4 && o.mode === "fused"'), 'engine reports rules and ML trust side by side');
ok(E('t0') != null && E('t0') <= 1.5, 'dead beacon ignored after ' + E('t0').toFixed(1) + ' s');
ok(E('Math.hypot(o.pos[0] - 4, o.pos[1] - 3)') < 0.8, 'still locates with 3 beacons: error ' + E('Math.hypot(o.pos[0] - 4, o.pos[1] - 3)').toFixed(2) + ' m');
/* moving beacon: the engine takes its new believed position */
E('L.moveAnchor(0, 2, 0.3, 0.05)'); ok(E('L.anchors[0].x === 2 && L.anchors[0].sd === 0.05'), 'moveAnchor updates position and uncertainty');

console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);
