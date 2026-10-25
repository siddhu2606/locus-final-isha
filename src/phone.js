/* ===== LOCUS ISHA phone app: one page, two roles.
   BEACON   : advertises a BLE packet (manufacturer 0xFFFF, bytes 'L','C', id, height in dm). Needs the Android app.
   RECEIVER : hears the beacons (real Bluetooth in the Android app, or a simulation anywhere), runs the LOCUS engine
              itself, streams the raw packets to the laptop dashboard over a 6-digit code, and is the staff app with ISHA.
   The Android app loads this same page and exposes window.LocusNative (BLE advertise / scan, speech in and out). ===== */
const $ = id => document.getElementById(id);
const NATIVE = window.LocusNative || null;
const LSK = 'locus.isha.phone.v1', LSget = () => { try { return JSON.parse(localStorage.getItem(LSK) || '{}'); } catch (e) { return {}; } }, LSset = o => { try { localStorage.setItem(LSK, JSON.stringify(Object.assign(LSget(), o))); } catch (e) { } };
const P = {
  scr: 'home', role: null, src: NATIVE ? 'ble' : 'sim', bId: 1, bH: 0.9, adv: false,
  space: 'hospital', W: 40, H: 24, Z: 3, model: 'add', sigDb: 4, sigM: 0.8, loss: 0.1, rssi1m: -59, pn: 2.2, scorer: 'fused', zDev: 1.2,
  anchors: [], cal: LSget().cal || {}, samples: [], heard: {}, out: null, meas: [], me: null, truth: null, tgt: null, wi: 0, calib: null,
  linked: false, dash: null, dashT: 0, assets: null, focus: null, staff: Object.assign({ role: 'nurseB', reg: true, poc: true }, LSget().staff || {}), voice: true, ftype: 'wheelchair',
};
let eng = null, rng = rngMake(5), asim = null;
/* carried beacons: each beacon phone's own telemetry (moving, steps, compass, what it hears) arrives inside its packet */
const BMV = new BeaconMover(), TELE = {}, RFP = {}, RXM = { tele: null, pend: 0, last: null }; let clock = 0;
/* this receiver's own motion: still -> hold and average; walking -> steps + compass move the estimate (sensors in the Android app; the simulation uses its true path) */
function rxMotion() { return rxMotion0(); }   /* the receiver's own sensors decide: still means still */
const RBP = {};
function rxWatch() {   /* receiver still: a beacon whose distance keeps changing is the one moving */
  if (!P.rxStill) { Object.keys(RBP).forEach(k => delete RBP[k]); return; }
  P.anchors.forEach((a, j) => { const m = P.meas[j]; if (!m) return; const B = RBP[a.b] || (RBP[a.b] = { base: m.r3, n: 0, t0: clock });
    if (clock - B.t0 < 2) { B.base += 0.2 * (m.r3 - B.base); return; }
    if (BMV.active(a.b, clock)) { B.base = m.r3; B.n = 0; return; }
    const ch = Math.abs(m.r3 - B.base) > Math.max(0.6, 0.25 * B.base); B.n = ch ? B.n + 0.1 : Math.max(0, B.n - 0.05); if (B.n > 1.2) { BMV.flag(a.b, clock); B.n = 0; }
  });
}
function rxMotion0() {
  if (P.src === 'sim') { const l = RXM.last; RXM.last = P.truth.slice(); if (!l) return { still: true }; const dx = P.truth[0] - l[0], dy = P.truth[1] - l[1]; if (Math.hypot(dx, dy) < 0.004) return { still: true }; const sc = 1 + 0.05 * rng.g(), an = 0.09 * rng.g(); return { d: [(dx * Math.cos(an) - dy * Math.sin(an)) * sc, (dx * Math.sin(an) + dy * Math.cos(an)) * sc] }; }
  const m = RXM.tele; if (!m || clock - m.t > 3) return null;
  if (!m.moving) { RXM.pend = 0; return { still: true }; }
  if (RXM.pend > 0 && m.head != null) { const d = RXM.pend * 0.65, br = (m.head - (P.mapUp || 0)) * Math.PI / 180; RXM.pend = 0; return { d: [d * Math.sin(br), -d * Math.cos(br)] }; }
  return null;
}
/* ---------- space + beacons ---------- */
function defaultAnchors() {
  if (P.space === 'warehouse') return ANCHORS.map((a, i) => [i + 1, a.x, a.y, i % 2 ? 0.9 : 2.6]);
  if (P.space === 'hospital') return [[1, 1.5, 13.5, 2.6], [2, 15, 1.5, 0.9], [3, 25, 10.5, 2.6], [4, 38.5, 13.5, 0.9], [5, 28, 22.5, 2.6], [6, 7, 22.5, 0.9]];
  const W = P.W, H = P.H; return [[1, .3, .3, .4], [2, W - .3, .3, 2.35], [3, W - .3, H - .3, .4], [4, .3, H - .3, 2.35]];
}
function setupSpace(c) {
  if (c) { Object.assign(P, { space: c.space, W: c.W, H: c.H, Z: c.Z, model: c.model, sigDb: c.sigDb, sigM: c.sigM, loss: c.loss, rssi1m: c.rssi1m, pn: c.pn, scorer: c.scorer }); }
  const site = P.space === 'hospital' || P.space === 'warehouse';
  if (site) { setSite(P.space); P.W = FLOOR.w; P.H = FLOOR.h; } else setRoom(P.W, P.H, [], (c && c.walls) || [], c && c.rooms && c.rooms.length ? c.rooms : null);
  const list = c ? c.anchors : defaultAnchors();
  P.anchors = list.map(q => ({ id: 'A' + q[0], b: q[0], x: q[1], y: q[2], z: q[3], p1: q[4] != null ? q[4] : null, n: q[5] || null, tx: q[6] != null ? q[6] : q[1], ty: q[7] != null ? q[7] : q[2] }));
  P.anchors.forEach(a => { const k = P.cal[a.b]; if (a.p1 == null && k) { a.p1 = k.p1; a.n = k.n; } });
  BMV.reset(); Object.keys(RFP).forEach(k => delete RFP[k]);
  eng = new Locus(P.anchors, { N: 300, sigma: P.space === 'hospital' ? 0.6 : 0.5, rng: rngMake(11), inflate: 2.0, scorer: typeof trustPredict === 'function' ? trustPredict : null, mode: P.scorer });
  asim = new AssetSim(P.space, P.W, P.H, 77);
  if (!P.truth || P.truth[0] > P.W || P.truth[1] > P.H) P.truth = P.space === 'hospital' ? [3, 12] : [P.W / 2, P.H / 2];
  renderBeacons();
}
const SIGKEY = () => P.anchors.map(a => [a.b, a.x, a.y, a.z, a.p1, a.n].join(',')).join('|') + P.space + P.W + P.H;
/* ---------- radio input ---------- */
window.__bleBatch = arr => { const now = performance.now(); (typeof arr === 'string' ? JSON.parse(arr) : arr).forEach(q => { if (q.length >= 12) { const pe = {}; for (let k = 0; k < 6; k++) if (q[6 + k]) pe[k + 1] = q[6 + k]; TELE[q[0]] = { moving: !!(q[3] & 1), steps: q[4], head: q[3] & 2 ? q[5] * 2 : null, peers: pe, f: q[3], raw: q[5], t: clock }; } P.samples.push({ b: q[0], rssi: q[1], t: now, h: q[2] }); P.heard[q[0]] = now; Link.queue(q[0], q[1], q[2]); }); };
window.__nativeEvent = e => { e = typeof e === 'string' ? JSON.parse(e) : e; if (e.type === 'self' && P.role === 'rx') { const o = RXM.tele; if (o && o.steps != null && e.moving) { const k = (e.steps - o.steps + 256) % 256; if (k > 0 && k <= 6) RXM.pend += k; } RXM.tele = { moving: !!e.moving, steps: e.steps, head: e.head == null ? null : e.head, t: clock }; } else if (e.type === 'self') selfStatus(e); else if (e.type === 'speech') onSpeech(e.text); else if (e.type === 'speechEnd') micOff(); else if (e.type === 'status') status(e.text); else if (e.type === 'adv') { P.adv = !!e.on; $('bstat').textContent = e.text; $('bpulse').classList.toggle('on', P.adv); } };
function simRadio(dt) {   /* this phone walks the floor; every beacon's RSSI is simulated from its true position (10 packets/s) */
  const W = P.W, H = P.H, path = P.space === 'warehouse' ? WAYPOINTS : P.space === 'hospital' ? [[3, 12], [15, 12], [15, 4], [15, 12], [25, 12], [25, 4], [25, 12], [36, 12], [36, 19.5], [36, 12], [27, 12], [27, 19.5], [27, 12], [6, 12], [6, 19.5], [6, 12]] : [[.8, .8], [W - .8, .8], [W - .8, H - .8], [.8, H - .8]];
  if (P.wait > 0 && !P.calib && !P.tgt) { P.wait -= dt; return simPackets(P.zDev); }
  let goal = P.tgt, zT = P.zDev;
  if (P.calib) { const a = P.anchors.find(q => q.b === P.calib.b), cx = W / 2 - a.x, cy = H / 2 - a.y, L = Math.hypot(cx, cy) || 1; P.truth = [a.x + cx / L * P.calib.d, a.y + cy / L * P.calib.d]; zT = a.z; goal = null; }
  else if (!P.tgt && P.space !== 'hospital' && P.space !== 'warehouse' && WALLS.length > 4) {   /* room with walls: zone to zone through the doors */
    if (!P.route || !P.route.length) { const zs = ROOMS.filter(r => r.r[2] > r.r[0]).map(r => [(r.r[0] + r.r[2]) / 2, (r.r[1] + r.r[3]) / 2]), pts = zs.length ? zs : path; P.route = gridRoute(P.truth, pts[P.wi++ % pts.length], W, H); }
    const tg = P.route[0], dx = tg[0] - P.truth[0], dy = tg[1] - P.truth[1], d = Math.hypot(dx, dy), sp = 0.8 * dt; if (d <= sp) { P.truth = tg.slice(); P.route.shift(); } else P.truth = [P.truth[0] + dx / d * sp, P.truth[1] + dy / d * sp];
  }
  else { if (P.tgt && P.space !== 'hospital' && P.space !== 'warehouse' && WALLS.length > 4 && !P.troute) P.troute = gridRoute(P.truth, P.tgt, W, H); if (P.troute && P.troute.length) goal = P.troute[0]; if (!goal) goal = path[P.wi % path.length]; const dx = goal[0] - P.truth[0], dy = goal[1] - P.truth[1], d = Math.hypot(dx, dy), sp = (P.space === 'hospital' ? 1.3 : 0.8) * dt;
    if (d <= sp) { P.wait = 3 + 2 * rng(); P.truth = goal.slice(); if (P.troute && P.troute.length) { P.troute.shift(); if (!P.troute.length) { P.troute = null; P.tgt = null; } } else if (P.tgt) P.tgt = null; else P.wi++; } else if (!crossesWall(P.truth[0], P.truth[1], P.truth[0] + dx / d * sp, P.truth[1] + dy / d * sp)) { P.truth = [P.truth[0] + dx / d * sp, P.truth[1] + dy / d * sp]; } else { P.tgt = null; P.wi++; } }
  simPackets(zT);
}
function simPackets(zT) {
  const cfg = { model: P.model, loss: P.loss, rssi1m: P.rssi1m, n: P.pn, sigma: P.model === 'add' ? P.sigM : 0.6, sigmaDb: P.sigDb, wallDb: 6, obstructDb: 12, driftDb: 6, burst: 0.002, wallBias: P.space === 'hospital' ? 1.8 : 1.2, obstructBias: 2, driftBias: 1.2 };
  const now = performance.now(), real = P.anchors.map(a => a.tx === a.x && a.ty === a.y ? a : { ...a, x: a.tx, y: a.ty }), m = measure3D(P.truth, zT, zT, real, cfg, rng, wallsBetween);   /* beacons that walk: the radio uses where they really are */
  m.forEach((q, i) => { if (!q) return; const b = P.anchors[i].b; P.samples.push({ b, rssi: q.rssi, t: now }); P.heard[b] = now; Link.queue(b, q.rssi, null); });
}
function liveMeas() {
  const now = performance.now(), maxR = Math.hypot(P.W, P.H, P.Z) * 1.2;
  return P.anchors.map(a => {   /* every packet through the beacon's steady-range filter (averages while both phones are still) */
    const f = RFP[a.b] || (RFP[a.b] = new RangeFilter()), tm = TELE[a.b], still = P.rxStill && !(tm && clock - tm.t < 3 && tm.moving);
    const fresh = P.samples.filter(m => m.b === a.b && m.t > (f.lastT || 0)).sort((x, y) => x.t - y.t); fresh.forEach(m => f.push(m.rssi, m.t / 1000, still)); if (fresh.length) f.lastT = fresh[fresh.length - 1].t;
    if (f.x == null || now - (f.lastT || 0) > 2000) return null;
    const rr = f.range(a.p1 != null ? a.p1 : P.rssi1m, a.n || P.pn, maxR), r3 = rr.r, dz = a.z - P.zDev;
    return { r: Math.sqrt(Math.max(0.0025, r3 * r3 - dz * dz)), r3, shown: rr.shown, sd: rr.sd, rssi: Math.round(f.x) };
  });
}
/* ---------- 10 Hz loop ---------- */
let accT = 0, lastT = performance.now(), frame = 0;
function tick() {
  const dt = 0.1; if (P.src === 'sim') simRadio(dt);
  const now = performance.now(); P.samples = P.samples.filter(m => m.t > now - 6000);
  /* beacon heights advertised in the packet (real beacons): adopt them */
  P.samples.slice(-30).forEach(m => { if (m.h > 0) { const a = P.anchors.find(q => q.b === m.b); if (a && Math.abs(a.z - m.h / 10) > 0.05 && !P.linked) a.z = m.h / 10; } });
  clock += dt;
  if (!P.linked) {   /* standalone: move carried beacons here (when linked, the dashboard does it and sends the new positions) */
    Object.keys(TELE).forEach(b => { const m = TELE[b]; if (clock - m.t < 4) BMV.tele(+b, clock, m); });
    const rxRef = P.rxStill && P.out && P.out.ell.a < 1.5 && P.meas.length === P.anchors.length ? b => { const j = P.anchors.findIndex(a => a.b === b), m = j >= 0 && P.meas[j]; return m ? [{ x: P.out.pos[0], y: P.out.pos[1], r: m.r, b: 'R' }] : []; } : null;
    BMV.step(P.anchors.map(a => ({ b: a.b, x: a.x, y: a.y, z: a.z })), clock, P.W, P.H, wallsBetween, rxRef).forEach(u => { const i = P.anchors.findIndex(a => a.b === u.b); if (i < 0) return; eng.moveAnchor(i, u.x, u.y, u.sd); P.anchors[i].tx = u.x; P.anchors[i].ty = u.y; P.anchors[i].why = u.why; P.anchors[i].whyT = clock; });
  }
  const mot = rxMotion(); P.rxStill = !!(mot && mot.still); eng.motion = mot;
  P.meas = liveMeas(); rxWatch(); eng.mode = P.scorer; P.out = eng.step(P.linked ? P.meas : P.meas.map((m, j) => m && BMV.active(P.anchors[j].b, clock) ? null : m), dt);
  P.me = P.out && P.meas.some(Boolean) ? { pos: P.out.pos, zone: zoneOf(P.space, P.out.pos[0], P.out.pos[1], P.W, P.H) } : null;
  asim.step(dt, P.anchors, { model: P.model, loss: P.loss, rssi1m: P.rssi1m, n: P.pn, sigma: P.model === 'add' ? P.sigM : 0.6, sigmaDb: P.sigDb, wallDb: 6, wallBias: 1.8 }, null);
  Link.pump(now);
}
function assets() { return P.linked && P.dash && performance.now() - P.dashT < 3000 ? P.dash.assets : asim.list(); }
function alerts() {
  if (P.linked && P.dash && performance.now() - P.dashT < 3000) return P.dash.alerts || [];
  const now = performance.now(), heardAny = P.anchors.some(a => now - (P.heard[a.b] || 0) < 1500);
  return P.anchors.filter(a => heardAny && now - (P.heard[a.b] || 0) > 3000).map(a => 'Beacon ' + a.b + ' silent for ' + Math.round((now - (P.heard[a.b] || now)) / 1000) + ' s: check its battery / app.').concat(heardAny || P.src === 'sim' ? [] : ['No beacons heard. Are the beacon phones on and close?']);
}

/* ---------- link to the laptop: this phone hosts, the laptop joins with the code ---------- */
const Link = (() => {
  let relay = null, code = null, buf = [], sendT = 0, btT = 0, meT = 0, lastRx = 0, helloT = 0;
  const live = () => !!relay && relay.on && performance.now() - lastRx < 6000;
  function start() {
    if (relay) return; code = LSget().code || String(100000 + Math.floor(Math.random() * 900000)); LSset({ code }); $('code').textContent = code.slice(0, 3) + ' ' + code.slice(3);
    relay = new MultiLink(code, 'phone', onData, s => { if (s === 'online') { if (!P.linked) pill('warn', 'Code ' + code); } else if (s === 'connecting' && !relay.on) pill('warn', 'Connecting…'); else if (s === 'offline') pill('warn', 'No internet'); });
    relay.connect();
  }
  function stop() { if (relay) relay.close(); relay = null; P.linked = false; }
  function onData(d) {
    lastRx = performance.now();
    if (!P.linked) { P.linked = true; pill('ok', 'Laptop linked'); helloT = 0; send({ t: 'want' }); }
    if (d.t === 'cfg') { const c = d.c, sig = SIGKEY(), same = P.cfg && eng && c.space === P.space && c.W === P.W && c.H === P.H && JSON.stringify(c.walls || []) === JSON.stringify(P.cfg.walls || []) && JSON.stringify(c.rooms || []) === JSON.stringify(P.cfg.rooms || []) && c.anchors.length === P.anchors.length && c.anchors.every((q, i) => q[0] === P.anchors[i].b && q[3] === P.anchors[i].z && q[4] === P.anchors[i].p1);
      P.cfg = c; if (same) { c.anchors.forEach((q, i) => { const a = P.anchors[i]; a.tx = q[6] != null ? q[6] : q[1]; a.ty = q[7] != null ? q[7] : q[2]; eng.moveAnchor(i, q[1], q[2]); }); } else { setupSpace(c); if (SIGKEY() !== sig) P.tgt = null; } }
    else if (d.t === 'st') { P.dash = d; P.dashT = performance.now(); }
    else if (d.t === 'ans') { const f = pend[d.id]; if (f) { delete pend[d.id]; f(d); } }
  }
  const pend = {}; let rid = 0;
  function request(q) { return new Promise(res => { if (!live()) return res(null); const id = ++rid; pend[id] = res; send({ t: 'req', id, ...q }); setTimeout(() => { if (pend[id]) { delete pend[id]; res(null); } }, 6000); }); }
  function send(m) { return relay ? relay.send(m) : false; }
  function queue(b, rssi, h) { if (live()) buf.push([b, rssi, 0, h || null]); }
  function pump(now) {
    if (!relay) return;
    if (P.linked && !live()) { P.linked = false; P.cfg = null; pill('warn', 'Code ' + code); }
    if (!live()) { buf = []; return; }
    if (now - helloT > 3000) { helloT = now; send({ t: 'hello', device: NATIVE ? (NATIVE.deviceName ? NATIVE.deviceName() : 'Android') : (navigator.userAgent.match(/\(([^;)]+)/) || [0, 'browser'])[1], src: P.src }); }
    if (P.src === 'ble' && RXM.tele && now - meT >= 250) { meT = now; send({ t: 'me', m: RXM.tele.moving ? 1 : 0, s: RXM.tele.steps, h: RXM.tele.head }); }
    if (now - btT >= 500) { btT = now; const b = {}; Object.keys(TELE).forEach(k => { const m = TELE[k]; if (clock - m.t < 3) b[k] = [m.f, m.steps, m.raw, m.peers]; }); if (Object.keys(b).length) send({ t: 'bt', b }); }
    if (now - sendT >= 200) { sendT = now; if (buf.length) { send({ t: 's', s: buf, src: P.src }); buf = []; } if (P.src === 'sim' && !P.calib) send({ t: 'truth', p: P.truth }); }
  }
  return { start, stop, send, queue, pump, request, get code() { return code; } };
})();
function pill(cls, t) { $('pill').className = 'pill ' + cls; $('pill-t').textContent = t; }
function status(t) { $('n-src').textContent = t; }

/* ---------- screens ---------- */
function show(s) {
  P.scr = s; document.querySelectorAll('.scr').forEach(e => e.classList.toggle('on', e.id === 's-' + s));
  $('b-back').style.display = s === 'home' ? 'none' : 'block'; $('tabs').classList.toggle('on', ['radar', 'staff', 'isha'].includes(s));
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.s === s)); $('h-sub').textContent = s === 'beacon' ? 'Beacon' : s === 'home' ? 'ISHA' : 'Receiver';
  window.scrollTo(0, 0); if (s === 'radar') requestAnimationFrame(drawMap);
}
function goReceiver() { P.role = 'rx'; show('radar'); setSrc(P.src); Link.start(); }
function setSrc(s) {
  if (s === 'ble' && !NATIVE) { status('Real Bluetooth needs the Android app (browsers cannot scan for beacons). Using the simulation.'); s = 'sim'; }
  P.src = s; document.querySelectorAll('#srcs button').forEach(b => b.classList.toggle('on', b.dataset.s === s));
  if (NATIVE) { if (s === 'ble') NATIVE.startScan(); else NATIVE.stopScan(); }
  if (s === 'sim') status('Simulation: this phone walks the floor and the beacons\' signals are simulated. Tap the map to walk somewhere.' + (NATIVE ? '' : ' Install the Android app for real Bluetooth.'));
  else status('Listening for real beacons…');
  P.samples = []; setupSpace(P.cfg);
}
/* ---------- radar: map + beacon table + calibration ---------- */
const cv = $('map'), g = cv.getContext('2d'); let MS = { s: 1, ox: 0, oy: 0 };
function drawMap() {
  const r = cv.getBoundingClientRect(); if (!r.width) return; const d = devicePixelRatio || 1, w = r.width, h = Math.round(w * Math.min(0.8, P.H / P.W + 0.08)); if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = w * d; cv.height = h * d; cv.style.height = h + 'px'; }
  g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h); const s = Math.min((w - 20) / P.W, (h - 20) / P.H), ox = (w - P.W * s) / 2, oy = (h - P.H * s) / 2; MS = { s, ox, oy }; const X = x => ox + x * s, Y = y => oy + y * s;
  g.fillStyle = '#fff'; g.fillRect(X(0), Y(0), P.W * s, P.H * s);
  if (ROOMS.length > 1) ROOMS.forEach(rm => { const [a, b, c, e] = rm.r; if (c <= a) return; g.fillStyle = rm.id === 'corr' ? 'rgba(34,195,230,.06)' : 'rgba(16,185,129,.04)'; g.fillRect(X(a), Y(b), (c - a) * s, (e - b) * s); g.fillStyle = '#9AB3BC'; g.font = '600 10px system-ui'; g.textAlign = 'center'; g.fillText(rm.name, X((a + c) / 2), Y((b + e) / 2) + 3); });
  g.strokeStyle = '#0E9DBE'; g.lineWidth = 2; WALLS.forEach(q => { g.beginPath(); g.moveTo(X(q[0]), Y(q[1])); g.lineTo(X(q[2]), Y(q[3])); g.stroke(); });
  const o = P.out, A = assets();
  A.forEach(a => { if (!a.pos || P.focus !== a.id) return; const ty = ASSET_TYPES[a.type], x = X(a.pos[0]), y = Y(a.pos[1]), f = P.focus === a.id; if (f && P.me) { g.strokeStyle = '#F5A524'; g.lineWidth = 2.5; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(X(P.me.pos[0]), Y(P.me.pos[1])); g.lineTo(x, y); g.stroke(); g.setLineDash([]); }
    if (f) { g.beginPath(); g.arc(x, y, 15, 0, 7); g.strokeStyle = '#F5A524'; g.lineWidth = 3; g.stroke(); } g.globalAlpha = a.online ? 1 : .45; g.fillStyle = ty.col; g.beginPath(); g.roundRect ? g.roundRect(x - 10, y - 7, 20, 14, 4) : g.rect(x - 10, y - 7, 20, 14); g.fill(); g.fillStyle = '#fff'; g.font = '700 8px system-ui'; g.textAlign = 'center'; g.fillText(ty.short, x, y + 3); g.globalAlpha = 1; });
  if (o && P.me) { const ct = Math.cos(o.ell.th), st = Math.sin(o.ell.th); g.beginPath(); for (let k = 0; k <= 36; k++) { const t = k / 36 * 6.283, ex = o.ell.a * Math.cos(t), ey = o.ell.b * Math.sin(t); const px = X(o.pos[0] + ex * ct - ey * st), py = Y(o.pos[1] + ex * st + ey * ct); k ? g.lineTo(px, py) : g.moveTo(px, py); } g.fillStyle = 'rgba(16,185,129,.12)'; g.fill(); g.strokeStyle = 'rgba(16,185,129,.7)'; g.lineWidth = 1.5; g.stroke(); }
  P.anchors.forEach((a, i) => { const m = P.meas[i], x = X(a.x), y = Y(a.y); if (m && P.me) { g.strokeStyle = 'rgba(14,157,190,.25)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(X(P.me.pos[0]), Y(P.me.pos[1])); g.stroke(); }
    g.fillStyle = m ? '#0E9DBE' : '#C9D6DB'; g.beginPath(); for (let k = 0; k < 6; k++) { const an = Math.PI / 3 * k + Math.PI / 6; g.lineTo(x + 9 * Math.cos(an), y + 9 * Math.sin(an)); } g.closePath(); g.fill(); g.fillStyle = '#fff'; g.font = '700 9px system-ui'; g.textAlign = 'center'; g.fillText(a.b, x, y + 3); g.fillStyle = '#0E9DBE'; g.font = '700 9px system-ui'; g.fillText(a.z.toFixed(1) + ' m', x, y - 12); });
  if (P.src === 'sim' && P.truth) { g.beginPath(); g.arc(X(P.truth[0]), Y(P.truth[1]), 8, 0, 7); g.strokeStyle = '#0B3A4A'; g.lineWidth = 2; g.setLineDash([3, 3]); g.stroke(); g.setLineDash([]); }
  if (P.me) { g.beginPath(); g.arc(X(P.me.pos[0]), Y(P.me.pos[1]), 7, 0, 7); g.fillStyle = '#10B981'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.stroke(); }
}
cv.addEventListener('pointerdown', e => { if (P.src !== 'sim') return; const r = cv.getBoundingClientRect(), x = (e.clientX - r.left - MS.ox) / MS.s, y = (e.clientY - r.top - MS.oy) / MS.s; if (x > 0 && y > 0 && x < P.W && y < P.H) { P.tgt = [x, y]; P.troute = null; } });
function renderBeacons() {
  $('blist').innerHTML = P.anchors.map(a => `<tr data-b="${a.b}"><td><span class="dot"></span><b>${a.b}</b></td><td>${a.z.toFixed(1)} m</td><td class="r">–</td><td class="d">–</td><td class="p">–</td><td><button class="cal${a.p1 != null ? ' set' : ''}" data-b="${a.b}">${a.p1 != null ? 'Cal ✓' : 'Cal'}</button></td></tr>`).join('');
}
function updateRadar() {
  const now = performance.now(), rows = $('blist').children; if (rows.length !== P.anchors.length) renderBeacons();
  P.anchors.forEach((a, i) => { const tr = $('blist').children[i]; if (!tr) return; const m = P.meas[i], n3 = P.samples.filter(q => q.b === a.b && q.t > now - 3000).length;
    const tm = TELE[a.b], mov = tm && clock - tm.t < 3 && tm.moving; tr.querySelector('.dot').className = 'dot ' + (mov ? 'mv' : m ? 'ok' : 'bad'); tr.title = mov ? 'moving' : ''; tr.querySelector('.r').textContent = m ? m.rssi : '–'; tr.querySelector('.d').textContent = m ? fmtDist(m.shown != null ? m.shown : m.r3) : '–'; tr.querySelector('.p').textContent = (n3 / 3).toFixed(0); tr.children[1].textContent = a.z.toFixed(1) + ' m'; });
  const o = P.out; $('k-zone').textContent = P.me ? P.me.zone.replace('Ward B · ', '') : '–'; $('k-unc').textContent = o && P.me ? fmtDist(o.ell.a) : '–'; $('k-n').textContent = P.meas.filter(Boolean).length + ' / ' + P.anchors.length;
  const nc = P.anchors.filter(a => a.p1 == null).length;
  const mvn = P.anchors.filter(a => a.why && clock - a.whyT < 6).map(a => 'Beacon ' + a.b + ' moving: ' + a.why + '. ').join('');
  $('n-map').textContent = mvn + (P.src === 'sim' ? 'Dashed ring = where you really are (simulation). ' : '') + (P.linked ? 'Laptop linked: room and beacon positions come from the dashboard.' : 'Not linked: default ' + (P.space === 'hospital' ? 'hospital floor' : P.W + ' × ' + P.H + ' m room') + '. Link the laptop to set your own room.') + (P.src === 'ble' && nc ? ' ' + nc + ' beacon' + (nc > 1 ? 's' : '') + ' not calibrated.' : '');
  drawMap();
}
let calB = null, calD = 1;
$('blist').onclick = e => { const b = e.target.closest('button.cal'); if (!b) return; calB = +b.dataset.b; $('cal').classList.add('on'); $('cal-t').textContent = 'Calibrate beacon ' + calB; $('cal-n').textContent = 'Hold this phone ' + fmtDist(calD) + ' from beacon ' + calB + ', same height, and keep still.'; $('cal-p').style.width = '0'; };
$('cald').onclick = e => { const b = e.target.closest('button'); if (!b) return; calD = +b.dataset.d; $('cald').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); if (calB) $('cal-n').textContent = 'Hold this phone ' + fmtDist(calD) + ' from beacon ' + calB + ', same height, and keep still.'; };
$('cal-x').onclick = () => { $('cal').classList.remove('on'); calB = null; P.calib = null; };
$('cal-go').onclick = () => {
  if (!calB) return; const b = calB, d = calD, t0 = performance.now(); if (P.src === 'sim') P.calib = { b, d }; $('cal-go').disabled = true;
  const tm = setInterval(() => { const f = Math.min(1, (performance.now() - t0) / 3000); $('cal-p').style.width = f * 100 + '%'; if (f < 1) return; clearInterval(tm); P.calib = null; $('cal-go').disabled = false;
    const v = P.samples.filter(q => q.b === b && q.t > t0 + 300).map(q => q.rssi); if (v.length < 6) { $('cal-n').textContent = 'Only ' + v.length + ' packets heard. Move closer and check beacon ' + b + ' is on, then measure again.'; return; }
    const med = Math.round(rssiLevel(v)), k = P.cal[b] = P.cal[b] || { pts: [] }; k.pts = k.pts.filter(p => Math.abs(p.d - d) > 1e-6).concat([{ d, rssi: med }]); const fit = fitCal(k.pts, P.pn); k.p1 = fit.p1; k.n = fit.n; LSset({ cal: P.cal });
    const a = P.anchors.find(q => q.b === b); if (a) { a.p1 = fit.p1; a.n = fit.n; } Link.send({ t: 'cal', b, d, rssi: med }); renderBeacons();
    $('cal-n').textContent = 'Saved: ' + med + ' dBm at ' + fmtDist(d) + ' → RSSI at 1 m ' + fit.p1 + ' dBm' + (k.pts.length > 1 ? ', fade n ' + fit.n : '') + '. Measure another distance to fit n, or close.'; }, 100);
};

/* ---------- staff: find equipment, patient through three gates, alerts ---------- */
const FT = ['wheelchair', 'oxygen', 'pump', 'crash', 'ecg', 'stretcher', 'vent'];
function buildStaff() {
  $('roles').innerHTML = Object.keys(ROLES).map(k => `<button class="chip${P.staff.role === k ? ' on' : ''}" data-r="${k}">${ROLES[k].label}</button>`).join('');
  $('ftypes').innerHTML = FT.map(k => `<button class="chip${P.ftype === k ? ' on' : ''}" data-t="${k}">${ASSET_TYPES[k].label.replace(' (defibrillator)', '')}</button>`).join('');
  $('t-reg').classList.toggle('on', P.staff.reg); $('t-poc').classList.toggle('on', P.staff.poc);
}
$('roles').onclick = e => { const b = e.target.closest('button'); if (!b) return; P.staff.role = b.dataset.r; LSset({ staff: P.staff }); buildStaff(); };
$('ftypes').onclick = e => { const b = e.target.closest('button'); if (!b) return; P.ftype = b.dataset.t; buildStaff(); updateStaff(); };
$('t-reg').onclick = () => { P.staff.reg = !P.staff.reg; LSset({ staff: P.staff }); buildStaff(); };
$('t-poc').onclick = () => { P.staff.poc = !P.staff.poc; LSset({ staff: P.staff }); buildStaff(); };
$('flist').onclick = e => { const it = e.target.closest('.item'); if (!it) return; P.focus = it.dataset.id; show('radar'); };
function updateStaff() {
  const L = assets().filter(a => a.type === P.ftype).map(a => ({ a, d: P.me && a.pos ? dirFrom(P.me.pos, a.pos) : null })).sort((x, y) => (y.a.online - x.a.online) || ((x.d ? x.d.d : 99) - (y.d ? y.d.d : 99)));
  $('flist').innerHTML = L.map(({ a, d }) => `<div class="item${a.online ? '' : ' off'}" data-id="${a.id}"><span class="ob" style="background:${ASSET_TYPES[a.type].col}">${ASSET_TYPES[a.type].short}</span><div><b>${a.id}</b><small>${a.pos ? a.zone : 'not located'}${d ? ' · ' + Math.round(d.d) + ' m ' + d.name : ''}</small></div><em>${a.online ? Math.round(a.conf * 100) + '%' : 'lost'}</em></div>`).join('') || '<div class="note">None tagged.</div>';
  const al = alerts(); $('alerts').className = 'flag ' + (al.length ? 'bad' : 'ok'); $('alerts').textContent = al.length ? al.join(' ') : 'No alerts. All beacons healthy, every tag on radar.';
}
/* person lookup: decided locally with the same three gates, and sent to the dashboard for its audit log */
function personLookup(id) {
  const p = assets().find(a => a.id === id), q = { role: P.staff.role, device: P.staff.reg ? 'reg' : 'own', inside: !!P.me, poc: P.staff.poc }, dec = gateDecide({ ...q, patientWard: 'Ward B' }), ans = gateAnswer(dec, p);
  Link.request(q); animateGates(dec, ans);
  const text = dec.allowed ? (dec.level === 'room' ? (p.online ? 'Patient P-112 is in ' + p.zone + ' (' + Math.round(p.conf * 100) + '% sure).' : 'Patient P-112: ' + ans + '.') : 'Patient P-112 is in the building. Only the point of contact sees the room.') : 'Request denied: ' + dec.reason + '. The request was logged.';
  return { text, allowed: dec.allowed };
}
function animateGates(dec, ans) {
  const G = ['pg1', 'pg2', 'pg3', 'pg4'].map($); G.forEach(x => x.classList.remove('pass', 'fail', 'active')); $('pans').textContent = '…';
  let i = 0; const st = () => { if (i < 3) { const r = dec.gates[i], el = G[i]; el.classList.add('active'); setTimeout(() => { el.classList.remove('active'); el.classList.add(r[0] ? 'pass' : 'fail'); if (!r[0]) return fin(); i++; st(); }, 350); } else fin(); };
  const fin = () => { G[3].classList.add(dec.allowed ? 'pass' : 'fail'); $('pans').textContent = dec.allowed ? ans : 'Denied'; $('n-pat').textContent = dec.allowed ? 'Allowed. ' + (P.linked ? 'Logged on the dashboard.' : 'Link the laptop to see the audit log.') : 'Denied: ' + dec.reason + '.'; };
  st();
}
$('b-pat').onclick = () => { const r = personLookup('P-112'); say(r.text, false); };

/* ---------- ISHA: chat + voice ---------- */
function ishaCtx() {
  return { assets: assets(), me: P.me, alerts: alerts(), person: personLookup,
    beacons: P.anchors.map((a, i) => ({ b: a.b, z: a.z, ok: !!P.meas[i], trust: P.out ? P.out.trust[i] : 0, range: P.meas[i] ? P.meas[i].r3 : null, why: P.out ? P.out.reasons[i] : '' })) };
}
function bubble(t, who) { const d = document.createElement('div'); d.className = 'msg ' + who; d.textContent = t; $('chat').appendChild(d); $('chat').scrollTop = 1e9; }
function say(t, speak) { if (speak !== false && P.voice) speakOut(t); }
function ask(q) {
  q = (q || '').trim(); if (!q) return; bubble(q, 'u'); const r = ishaAsk(q, ishaCtx()); bubble(r.text, 'a'); if (r.focus) P.focus = r.focus; if (P.voice) speakOut(r.text);
}
function speakOut(t) { if (NATIVE && NATIVE.speak) { NATIVE.speak(t); return; } try { const u = new SpeechSynthesisUtterance(t); u.lang = 'en-IN'; u.rate = 1.02; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { } }
let rec = null;
function micOff() { $('b-mic').classList.remove('on'); }
function onSpeech(t) { micOff(); if (t) ask(t); }
$('b-mic').onclick = () => {
  if ($('b-mic').classList.contains('on')) { try { rec && rec.stop(); } catch (e) { } micOff(); return; }
  if (NATIVE && NATIVE.listen) { $('b-mic').classList.add('on'); NATIVE.listen(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) { bubble('Voice input is not available in this browser. Type your question, or use Chrome / the Android app.', 'a'); return; }
  rec = new SR(); rec.lang = 'en-IN'; rec.interimResults = false; rec.maxAlternatives = 1;
  rec.onresult = e => onSpeech(e.results[0][0].transcript); rec.onerror = () => micOff(); rec.onend = micOff; $('b-mic').classList.add('on'); try { rec.start(); } catch (e) { micOff(); }
};
$('askf').onsubmit = e => { e.preventDefault(); const q = $('askq').value; $('askq').value = ''; ask(q); };
$('sugg').onclick = e => { const b = e.target.closest('button'); if (b) ask(b.textContent); };
$('b-spk').onclick = () => { P.voice = !P.voice; $('b-spk').textContent = P.voice ? 'Voice on' : 'Voice off'; if (!P.voice) try { speechSynthesis.cancel(); } catch (e) { } };

/* ---------- beacon role ---------- */
function selfStatus(e) {
  $('s-mov').textContent = e.moving ? 'moving' : 'still'; $('s-steps').textContent = e.steps; $('s-head').textContent = e.head == null ? 'no sensor' : Math.round(e.head) % 360 + '°';
  const pe = Object.keys(e.peers || {}).filter(k => e.peers[k]); $('s-peers').innerHTML = pe.length ? 'Hears ' + pe.map(k => '<b>B' + k + '</b> ' + e.peers[k] + ' dBm (≈' + fmtDist(rangeFrom(e.peers[k], -62, 2.2)) + ')').join(' · ') : 'Hears no other beacons yet.';
}
function buildBeacon() {
  $('bnum').innerHTML = [1, 2, 3, 4, 5, 6].map(i => `<button class="${i === P.bId ? 'on' : ''}" data-i="${i}">${i}</button>`).join(''); $('bpn').textContent = P.bId;
  $('bh').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.h === P.bH));
  if (!NATIVE) { $('bstat').innerHTML = 'Browsers cannot send Bluetooth beacons. Install the <b>Android app</b> on each beacon phone.'; $('b-adv').textContent = 'Preview'; }
}
$('bnum').onclick = e => { const b = e.target.closest('button'); if (!b || P.adv) return; P.bId = +b.dataset.i; LSset({ bId: P.bId }); buildBeacon(); };
$('bh').onclick = e => { const b = e.target.closest('button'); if (!b || P.adv) return; P.bH = +b.dataset.h; LSset({ bH: P.bH }); buildBeacon(); };
$('b-adv').onclick = () => { if (NATIVE) NATIVE.startBeacon(P.bId, Math.round(P.bH * 10)); else { $('bpulse').classList.add('on'); $('bstat').innerHTML = 'Preview only: this browser is not sending anything. Install the <b>Android app</b> to make this phone a real beacon.'; } };
$('b-advs').onclick = () => { if (NATIVE) NATIVE.stopBeacon(); $('bpulse').classList.remove('on'); P.adv = false; if (!NATIVE) buildBeacon(); else $('bstat').textContent = 'Not sending.'; };

/* ---------- wiring ---------- */
$('go-rx').onclick = goReceiver; $('go-bc').onclick = () => { P.role = 'bc'; buildBeacon(); show('beacon'); };
$('b-back').onclick = () => { if (P.scr === 'beacon') $('b-advs').onclick(); if (NATIVE) NATIVE.stopScan(); Link.stop(); pill('', 'Ready'); show('home'); };
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => show(b.dataset.s));
$('srcs').onclick = e => { const b = e.target.closest('button'); if (b) setSrc(b.dataset.s); };
const site = /github\.io|localhost|127\.0\.0\.1/.test(location.host) ? location.href.replace(/[^/]*$/, '') : 'https://siddhu2606.github.io/locus-final-isha/';
$('site').textContent = site.replace(/^https?:\/\//, '') + 'dashboard.html';
$('n-env').innerHTML = NATIVE ? 'Android app: real Bluetooth on.' : 'Running in a browser: Bluetooth is <b>simulated</b>. For real beacons install the <a href="https://github.com/siddhu2606/locus-final-isha/releases/latest">Android app</a>.';
{ const s = LSget(); if (s.bId) P.bId = s.bId; if (s.bH) P.bH = s.bH; }
setupSpace(null); buildStaff(); bubble('Hi, I am ISHA. Ask me where any equipment is, where you are, or about beacons and alerts.', 'a');
if (/[#&?]rx\b/.test(location.href)) goReceiver();
setInterval(() => { try { tick(); if (++frame % 3 === 0) { if (P.scr === 'radar') updateRadar(); if (P.scr === 'staff') updateStaff(); } } catch (e) { console.error(e); } }, 100);
addEventListener('resize', () => P.scr === 'radar' && drawMap());
window.__phone = { P, Link, ask, setSrc, goReceiver, get eng() { return eng; } };
