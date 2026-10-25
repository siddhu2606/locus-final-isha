/* ===== dashboard part 2: moving beacons, tagged objects, off radar + self-check, access gates, receiver-phone link ===== */

/* ---------- moving beacons ----------
   Every beacon has a TRUE position (a.tx, a.ty: what the radio uses) and a BELIEVED one (a.x, a.y: what LOCUS uses).
   Ways to move one: carry the real beacon phone (it senses its own steps, heading and distances to the other beacons, see
   beaconmove.js), switch it to "walks" (demo: the same sensing, simulated from its true path), drag it, or update_beacon_position(). */
const MT = new MoveTracker({ threshold: 0.1, smoothing: 0.5, trailLen: 15, recentSec: 10, speedSec: 1, settleSec: 0.8, turnDeg: 35, arrowHoldSec: 8, logMax: 120 });
/* walking is simulated motion, so it is offered only when the radio is simulated too (Demo, or a linked phone in Simulation mode) */
const canWalk = () => S.mode !== 'live' || S.phoneSrc === 'sim';
const MVR = () => S.space !== 'room' ? 3 : Math.max(0.5, Math.min(1.2, 0.25 * Math.min(S.W, S.H)));
function moveBeacons(dt) {
  const rr = eng.rng;
  S.anchors.forEach((a, i) => {
    if (!a.mv) return;
    if (a.pause > 0) { a.pause -= dt; return; }
    if (!a.wp) { const R = MVR(); for (let k = 0; k < 12 && !a.wp; k++) { const ang = rr() * 2 * Math.PI, d = R * Math.sqrt(rr()), w = [Math.min(S.W - .1, Math.max(.1, a.hx + d * Math.cos(ang))), Math.min(S.H - .1, Math.max(.1, a.hy + d * Math.sin(ang)))]; if (!crossesWall(a.tx, a.ty, w[0], w[1])) a.wp = w; } if (!a.wp) { a.pause = 1; return; } }   /* people carry beacons through doors, not walls */
    const dx = a.wp[0] - a.tx, dy = a.wp[1] - a.ty, d = Math.hypot(dx, dy), st = 0.5 * dt;
    if (d <= st) { a.tx = a.wp[0]; a.ty = a.wp[1]; a.wp = null; a.pause = 1 + 2 * rr(); } else { a.tx += dx / d * st; a.ty += dy / d * st; }
  });
}
/* an exact move (drag, typed coordinates, external report): truth = believed */
/* carried beacons: telemetry (real from the receiver phone, or simulated from the true path) -> BeaconMover -> believed position */
const BM = new BeaconMover(), BSIM = {}, TELE = {}, BRNG = rngMake(99);   /* own random stream: sensing does not change the tag's radio noise */
/* ---------- receiver motion + steady ranges ----------
   The receiver phone reads its own motion sensors too. Still -> LOCUS holds the position and keeps averaging (no wandering dot);
   walking -> its steps and compass move the estimate and Bluetooth corrects the drift. Demo: the same, from the walker's true path. */
const RF = {}, RX = { tele: null, pend: 0, last: null };
function rxMotion(live, truth) {
  if (!live || (S.phoneSrc === 'sim' && truth)) {
    if (!truth) return null; const l = RX.last; RX.last = truth.slice(); if (!l) return { still: true };
    const dx = truth[0] - l[0], dy = truth[1] - l[1]; if (Math.hypot(dx, dy) < 0.004) return { still: true };
    const sc = 1 + 0.05 * BRNG.g(), an = 0.09 * BRNG.g(); return { d: [(dx * Math.cos(an) - dy * Math.sin(an)) * sc, (dx * Math.sin(an) + dy * Math.cos(an)) * sc] };   /* step length +-5 %, heading +-5 deg */
  }
  const m = RX.tele; if (!m || S.clock - m.t > 3) return null;
  if (!m.moving) { RX.pend = 0; return { still: true }; }
  if (RX.pend > 0 && m.head != null) { const d = RX.pend * 0.65, br = (m.head - (S.mapUp || 0)) * Math.PI / 180; RX.pend = 0; return { d: [d * Math.sin(br), -d * Math.cos(br)] }; }
  return null;
}
/* demo, realistic radio: the same steady-range filter as with real phones */
function steadyDemo(meas, assumedZ) {
  const maxR = Math.hypot(S.W, S.H, S.Z) * 1.2;
  return S.anchors.map((a, i) => {
    const f = RF[a.b] || (RF[a.b] = new RangeFilter()), m = meas[i], still = S.rxStill && !a.mv;
    if (m) { f.push(m.rssi, S.clock, still); f.lastT = S.clock; } if (f.x == null || S.clock - (f.lastT || -9) > 1.5 || !m && S.dead.has(a.id)) return null;
    const rr = f.range(a.p1 != null ? a.p1 : S.rssi1m, a.n || S.pn, maxR), dz = (a.z || 0) - assumedZ;
    return { r: Math.sqrt(Math.max(0.0025, rr.r * rr.r - dz * dz)), r3: rr.r, shown: rr.shown, sd: rr.sd, rssi: Math.round(f.x), raw: m ? m.rssi : null, nlos: m ? m.nlos : false, d3: m ? m.d3 : null };
  });
}
function resetSense() { RX.last = null; BM.reset(); Object.keys(BSIM).forEach(k => delete BSIM[k]); Object.keys(TELE).forEach(k => delete TELE[k]); }
function beaconSense(live) {
  const t = S.clock;
  if (!live || S.phoneSrc === 'sim') { BeaconMover.simulate(BSIM, S.anchors, t, BRNG, S.dead, wallsBetween); S.anchors.forEach(a => { const m = BSIM[a.b].out; BM.tele(a.b, t, m); TELE[a.b] = { ...m, t }; }); }
  BM.mapUp = S.mapUp || 0;
  BM.step(S.anchors.map(a => ({ b: a.b, x: a.x, y: a.y, z: a.z })), t, S.W, S.H, wallsBetween).forEach(u => {
    const i = S.anchors.findIndex(a => a.b === u.b), a = S.anchors[i]; if (i < 0) return;
    eng.loc.moveAnchor(i, u.x, u.y, u.sd); a.sd = u.sd; a.sense = u.why; a.senseT = t; if (live && S.phoneSrc !== 'sim') { a.tx = a.x; a.ty = a.y; a.hx = a.x; a.hy = a.y; }
  });
}
function placeBeacon(a, x, y, exact) {
  x = Math.min(S.W - .05, Math.max(.05, x)); y = Math.min(S.H - .05, Math.max(.05, y));
  const i = S.anchors.indexOf(a); a.tx = x; a.ty = y; a.hx = x; a.hy = y; a.wp = null;
  if (i >= 0) eng.loc.moveAnchor(i, x, y, S.mode === 'live' ? 0.15 : 0.03); else { a.x = x; a.y = y; }
  if (exact) MT.update(a.id, a.x, -a.y, S.clock, true);
  save(); Phone.cfgChanged();
}
function updateBeaconPosition(id, x, y, ts) {
  const a = S.all.find(q => q.id === String(id) || q.b === +id || 'A' + id === String(id)); if (!a) return { ok: false, error: 'unknown beacon ' + id };
  const from = [a.x, a.y]; a.mv = false; placeBeacon(a, +x, +y, true); renderAnchors();
  const d = dirFrom(from, [a.x, a.y]); return { ok: true, id: a.id, ts: ts || Date.now(), move: { dist: d.d, bearing: d.brg, compass: d.name, dx: a.x - from[0], dy: -(a.y - from[1]), text: moveText(a.id, from, [a.x, a.y]) } };
}
const sg1 = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
function moveText(id, f, t) { const d = dirFrom(f, t); return 'B' + id.replace('A', '') + ' moved ' + d.d.toFixed(1) + ' m toward ' + Math.round(d.brg) + '° (' + d.name + ') · dx ' + sg1(t[0] - f[0]) + ' m, dy ' + sg1(-(t[1] - f[1])) + ' m'; }
function trackBeacons() { S.anchors.forEach(a => MT.update(a.id, a.x, -a.y, S.clock, false)); }
/* arrows on the floor (at beacon height): old -> new position, with distance and bearing */
function drawBeaconMoves() {
  S.anchors.forEach(a => {
    const st = MT.stats(a.id, S.clock); if (!st) return;
    const tr = st.trail; if (tr.length > 1) for (let k = 1; k < tr.length; k++) { const f = k / tr.length; line(P(tr[k - 1][0], -tr[k - 1][1], a.z), P(tr[k][0], -tr[k][1], a.z), 'rgba(139,92,246,' + (0.1 + 0.5 * f).toFixed(2) + ')', 1 + 2 * f); }
    const sgm = st.seg; if (!sgm || sgm.dist < 0.1) return;
    const A = P(sgm.from[0], -sgm.from[1], a.z), B = P(sgm.to[0], -sgm.to[1], a.z), ang = Math.atan2(B[1] - A[1], B[0] - A[0]);
    line(A, B, '#8B5CF6', 2.5); poly([B, [B[0] - 10 * Math.cos(ang - 0.4), B[1] - 10 * Math.sin(ang - 0.4)], [B[0] - 10 * Math.cos(ang + 0.4), B[1] - 10 * Math.sin(ang + 0.4)]], '#8B5CF6');
    const lb = sgm.dist.toFixed(1) + ' m · ' + Math.round(sgm.bearing) + '° ' + COMPASS8[Math.round(sgm.bearing / 45) % 8].replace('north', 'N').replace('south', 'S').replace('east', 'E').replace('west', 'W').replace('-', '');
    g.font = '700 10.5px Figtree'; g.textAlign = 'center'; g.lineJoin = 'round'; g.lineWidth = 3.5; g.strokeStyle = 'rgba(255,255,255,.92)'; const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2 - 8; g.strokeText(lb, mx, my); g.fillStyle = '#5b34c4'; g.fillText(lb, mx, my);
  });
}
function renderMoves() {
  const L = MT.log.slice(0, 12), b = L[0];
  const why = b && (BM.last[+b.id.replace('A', '')] || {}).why; $('mv-banner').textContent = b ? moveTextSeg(b) + (b.live ? ' (moving)' : '') + (why && S.clock - BM.last[+b.id.replace('A', '')].t < 8 ? ' · sensed from ' + why : '') : canWalk() ? 'No beacon has moved yet. Switch one to "walks", or drag one in the view.' : 'Real beacons: just carry a beacon phone. Its steps, compass and the distances to the other beacons move it on the map. You can also drag it.';
  renderTele();
  $('mv-log').innerHTML = L.map(m => `<tr><td>${clockStr(m.t0)}</td><td><b>B${m.id.replace('A', '')}</b></td><td>${m.dist.toFixed(2)} m</td><td>${Math.round(m.bearing)}° ${m.compass}</td><td>${sg1(m.dx)}, ${sg1(m.dy)}</td></tr>`).join('') || '<tr><td colspan="5" class="note">–</td></tr>';
  document.querySelectorAll('#anchors .an').forEach(el => { const a = S.anchors[+el.dataset.i], st = a && MT.stats(a.id, S.clock), o = el.querySelector('.mvs'); if (o && st) o.textContent = 'moved ' + st.total.toFixed(1) + ' m · last 10 s ' + st.recent.toFixed(1) + ' m · ' + st.speed.toFixed(2) + ' m/s'; });
}
function renderTele() {
  const box = $('bt-tele'); if (!box) return; const now = S.clock, live = S.mode === 'live' && S.phoneSrc !== 'sim';
  box.innerHTML = S.anchors.map(a => { const m = TELE[a.b], fresh = m && now - m.t < 4, peers = fresh ? Object.keys(m.peers || {}).filter(k => m.peers[k]) : [];
    return `<tr><td><b>B${a.b}</b></td><td>${!fresh ? '<span class="note">' + (live ? 'old app / no data' : '–') + '</span>' : m.moving ? '<b class="mvg">moving</b>' : 'still'}</td><td>${fresh && m.steps != null ? m.steps : '–'}</td><td>${fresh && m.head != null ? Math.round(m.head) + '°' : '–'}</td><td>${peers.length ? peers.map(k => 'B' + k).join(' ') : '–'}</td><td>${a.x.toFixed(1)}, ${a.y.toFixed(1)}${a.sd ? ' ±' + a.sd.toFixed(1) : ''}</td></tr>`; }).join('');
  $('bt-link').textContent = BM.link.pairs ? 'Beacon-to-beacon radio fitted from ' + BM.link.pairs + ' still pair' + (BM.link.pairs > 1 ? 's' : '') + ': ' + Math.round(BM.link.p1) + ' dBm at 1 m, n ' + BM.link.n.toFixed(1) + '.' : 'Waiting for beacons to hear each other.';
}
function moveTextSeg(m) { return 'B' + m.id.replace('A', '') + ' moved ' + m.dist.toFixed(1) + ' m toward ' + Math.round(m.bearing) + '° (' + m.compass + ') · dx ' + sg1(m.dx) + ' m, dy ' + sg1(m.dy) + ' m'; }
const T0 = Date.now(); function clockStr(s) { return new Date(T0 + s * 1000).toTimeString().slice(0, 8); }

/* ---------- tagged objects (wheelchairs, oxygen, pumps ..., patient P-112, nurse N-204) ---------- */
function drawAssets() {
  if (!S.assets || !S.show.obj) return;
  S.assets.items.forEach(a => {
    if (!a.est) return; const ty = ASSET_TYPES[a.type], f = P(a.est[0], a.est[1], 0), tp = P(a.est[0], a.est[1], a.z), on = a.seen != null && S.assets.t - a.seen < 3, foc = S.focus === a.id;
    if (S.view.tilt < 89) line(f, tp, 'rgba(11,58,74,.25)', 1, [2, 2]);
    if (foc) { g.beginPath(); g.arc(tp[0], tp[1], 20, 0, 7); g.strokeStyle = '#F5A524'; g.lineWidth = 3; g.stroke(); }
    g.globalAlpha = on ? 1 : 0.45; const w = 13; g.beginPath(); g.roundRect ? g.roundRect(tp[0] - w, tp[1] - 9, 2 * w, 18, 5) : g.rect(tp[0] - w, tp[1] - 9, 2 * w, 18); g.fillStyle = ty.col; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke();
    g.fillStyle = '#fff'; g.font = '700 9.5px Figtree'; g.textAlign = 'center'; g.fillText(ty.short, tp[0], tp[1] + 3.5);
    if (foc || S.view.tilt > 60 && vp.s > 14) { g.font = '700 10px Figtree'; g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.9)'; g.strokeText(a.id, tp[0], tp[1] + 21); g.fillStyle = '#0B3A4A'; g.fillText(a.id, tp[0], tp[1] + 21); }
    g.globalAlpha = 1;
  });
}
function renderObjects() {
  const L = S.assets ? S.assets.list() : [];
  $('objs').innerHTML = L.map(a => `<tr data-id="${a.id}" class="${S.focus === a.id ? 'foc' : ''}"><td><span class="ob" style="background:${ASSET_TYPES[a.type].col}">${ASSET_TYPES[a.type].short}</span></td><td><b>${a.id}</b><br><span class="note">${a.name}</span></td><td>${a.pos ? a.zone : '–'}</td><td>${a.online ? Math.round(a.conf * 100) + '%' : '<span class="bad">' + (a.ago == null ? 'not seen' : 'lost ' + Math.round(a.ago) + ' s') + '</span>'}</td><td><button class="mini" data-sh="${a.id}" aria-pressed="${S.shieldSet.has(a.id)}">${S.shieldSet.has(a.id) ? 'Unshield' : 'Shield'}</button></td></tr>`).join('');
}
function updateObjects() {
  if (!S.assets) return; const rows = document.querySelectorAll('#objs tr');
  if (rows.length !== S.assets.items.length) return renderObjects();
  S.assets.list().forEach((a, i) => { const td = rows[i].children; td[2].textContent = a.pos ? a.zone : '–'; td[3].innerHTML = a.online ? Math.round(a.conf * 100) + '%' : '<span class="bad">' + (a.ago == null ? 'not seen' : 'lost ' + Math.round(a.ago) + ' s') + '</span>'; rows[i].classList.toggle('foc', S.focus === a.id); });
}

/* ---------- off radar + self-check ----------
   Off radar: a tag silent to EVERY beacon for 3 s -> flag to its point of contact, with last zone, time and trail.
   Self-check: beacons hear each other. One silent to all the others for 3 s -> repair alert. With real phones the
   receiver stands in for the others: a beacon it has not heard for 3 s while it hears the rest -> repair alert.   */
const Alerts = { log: [], off: null, lastHeard: 0, bSilent: {}, repair: new Set(), tags: {} };
function alertLog(kind, msg) { Alerts.log.unshift({ t: clockStr(S.clock), kind, msg }); if (Alerts.log.length > 60) Alerts.log.pop(); renderAlertLog(); }
function alertsTick(meas, out) {
  const live = S.mode === 'live', heard = meas.filter(Boolean).length, zn = p => zoneOf(S.space, p[0], p[1], S.W, S.H);
  if (heard || !out) { Alerts.lastHeard = S.clock; if (Alerts.off) { alertLog('ok', 'Tag back on radar in ' + (out ? zn(out.pos) : '–') + '.'); Alerts.off = null; } }
  else if (S.clock - Alerts.lastHeard > 3 && !Alerts.off && S.estTrail && S.estTrail.length) { const p = S.estTrail[S.estTrail.length - 1]; Alerts.off = { p, t: Alerts.lastHeard, zone: zn(p), trail: S.estTrail.slice(-40) }; alertLog('flag', 'FLAG → POC: tracked tag silent to all beacons. Last seen in ' + Alerts.off.zone + ' at ' + clockStr(Alerts.lastHeard) + '.'); }
  /* self-check */
  S.anchors.forEach((a, j) => {
    const silent = live ? !meas[j] && heard > 0 && (performance.now() - (S.heard[a.b] || 0)) > 3000 : S.dead.has(a.id);
    if (silent) { Alerts.bSilent[a.id] = (Alerts.bSilent[a.id] || 0) + 0.1; if (Alerts.bSilent[a.id] > 3 && !Alerts.repair.has(a.id)) { Alerts.repair.add(a.id); alertLog('repair', 'REPAIR: beacon ' + a.b + ' silent to ' + (live ? 'the receiver while the others are heard' : 'all the other beacons') + '. Check its battery / app.'); } }
    else { Alerts.bSilent[a.id] = 0; if (Alerts.repair.delete(a.id)) alertLog('ok', 'Beacon ' + a.b + ' back online.'); }
  });
  [...Alerts.repair].forEach(id => { if (!S.anchors.some(a => a.id === id)) Alerts.repair.delete(id); });
  /* tagged objects off radar */
  if (S.assets) S.assets.items.forEach(a => { const lost = a.seen != null && S.assets.t - a.seen > 3, was = Alerts.tags[a.id]; if (lost && !was) { Alerts.tags[a.id] = true; alertLog('flag', 'FLAG: ' + a.id + ' (' + a.name + ') off radar. Last seen in ' + a.zone + '.'); } else if (!lost && was) { Alerts.tags[a.id] = false; alertLog('ok', a.id + ' back on radar in ' + a.zone + '.'); } });
}
function alertList() {
  const L = []; if (Alerts.off) L.push('Tracked tag off radar since ' + clockStr(Alerts.off.t) + ', last seen in ' + Alerts.off.zone + '.');
  Alerts.repair.forEach(id => L.push('Beacon ' + id.replace('A', '') + ' needs repair.'));
  Object.keys(Alerts.tags).forEach(id => { if (Alerts.tags[id]) { const a = S.assets.items.find(q => q.id === id); L.push(id + ' off radar, last seen in ' + (a ? a.zone : '–') + '.'); } });
  return L;
}
function renderAlerts() {
  const f = $('al-flag'), L = alertList(), nOk = S.anchors.filter(a => !Alerts.repair.has(a.id)).length, tags = S.assets ? S.assets.items : [];
  if (Alerts.off) { f.className = 'flag alert'; f.innerHTML = '<span class="tag">Flag → POC</span><span>Tracked tag off radar. Last seen in <b>' + Alerts.off.zone + '</b> at ' + clockStr(Alerts.off.t) + '. Trail shown on the map.</span>'; }
  else if (Alerts.repair.size) { f.className = 'flag fault'; f.innerHTML = '<span class="tag">Repair</span><span>Beacon ' + [...Alerts.repair].map(i => i.replace('A', '')).join(' and ') + ' offline. Tracking continues with ' + nOk + ' beacon' + (nOk === 1 ? '' : 's') + '.</span>'; }
  else if (L.length) { f.className = 'flag alert'; f.innerHTML = '<span class="tag">Flag</span><span>' + L[0] + '</span>'; }
  else { f.className = 'flag ok'; f.innerHTML = '<span class="tag">Status</span><span>All ' + S.anchors.length + ' beacons healthy · every tag on radar.</span>'; }
  $('al-b').textContent = nOk + ' / ' + S.anchors.length; $('al-t').textContent = tags.filter(a => a.seen != null && S.assets.t - a.seen < 3).length + ' / ' + tags.length;
  $('al-h').textContent = S.mode === 'live' ? (cur && cur.meas.filter(Boolean).length) + ' heard' : S.shield ? 'shielded' : (cur ? cur.meas.filter(Boolean).length : 0) + ' heard';
  $('b-shield').setAttribute('aria-pressed', S.shield); $('b-shield').textContent = S.shield ? 'Unshield the tag' : 'Shield the tag';
}
function renderAlertLog() { $('al-log').innerHTML = Alerts.log.slice(0, 30).map(e => `<div class="${e.kind}"><b>${e.t}</b> ${e.msg}</div>`).join('') || '<div>No events yet.</div>'; }
/* beacons check each other: a line per pair, solid when both alive, red dashed when one is silent */
function drawSelfCheck() {
  if (!S.show.links) return; const A = S.anchors;
  for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) { const ok = !Alerts.repair.has(A[i].id) && !Alerts.repair.has(A[j].id) && !S.dead.has(A[i].id) && !S.dead.has(A[j].id); line(P(A[i].x, A[i].y, A[i].z), P(A[j].x, A[j].y, A[j].z), ok ? 'rgba(16,185,129,.16)' : 'rgba(239,106,106,.6)', ok ? 1.2 : 1.6, ok ? [] : [6, 5]); }
}
function drawOffRadar() {
  const o = Alerts.off; if (!o) return;
  g.beginPath(); o.trail.forEach((q, i) => { const p = P(q[0], q[1], 0); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); g.strokeStyle = '#F5A524'; g.lineWidth = 2.5; g.setLineDash([3, 4]); g.stroke(); g.setLineDash([]);
  const p = P(o.p[0], o.p[1], 0); g.beginPath(); g.arc(p[0], p[1], 14 + 4 * Math.sin(performance.now() / 200), 0, 7); g.strokeStyle = '#F5A524'; g.lineWidth = 3; g.stroke();
  g.font = '700 11px Figtree'; g.textAlign = 'left'; g.fillStyle = '#8a5a00'; g.fillText('last seen ' + clockStr(o.t), p[0] + 18, p[1] - 8);
}

/* ---------- access: every request passes three gates ---------- */
const AUD = new Audit(), AQ = { role: 'nurseB', device: 'reg', where: 'in', poc: 'yes' };
const AOPT = { role: Object.keys(ROLES).map(k => [k, ROLES[k].label]), device: [['reg', 'Registered phone'], ['own', 'Personal phone']], where: [['in', 'Inside hospital'], ['out', 'Off-site']], poc: [['yes', 'Yes, POC'], ['no', 'No']] };
function buildAccess() {
  Object.keys(AOPT).forEach(k => { $('ag-' + k).innerHTML = AOPT[k].map(([v, l]) => `<button class="chip" data-v="${v}">${l}</button>`).join(''); $('ag-' + k).onclick = e => { const b = e.target.closest('button'); if (b) { AQ[k] = b.dataset.v; paintAccess(); } }; });
  $('ag-send').onclick = () => gateRun({ role: AQ.role, device: AQ.device, inside: AQ.where === 'in', poc: AQ.poc === 'yes', via: 'dashboard' });
  paintAccess(); renderAudit();
}
function paintAccess() { Object.keys(AOPT).forEach(k => $('ag-' + k).querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === AQ[k])))); }
let gateBusy = Promise.resolve();
/* runs the request through the gates with the live position of P-112; animates the pipeline; returns {allowed, answer, text} */
function gateRun(q) {
  const pat = S.assets.list().find(a => a.id === 'P-112'), dec = gateDecide({ ...q, patientWard: 'Ward B' }), ans = gateAnswer(dec, pat), who = ROLES[q.role] ? ROLES[q.role].name : q.role;
  const row = AUD.add({ who, device: (q.device === 'reg' ? 'Registered' : 'Personal') + ', ' + (q.inside ? 'inside' : 'off-site'), asked: 'P-112', allowed: dec.allowed, answer: ans + (dec.level === 'room' ? ' (POC)' : dec.level ? ' (not POC)' : ''), reason: dec.reason, via: q.via });
  const G = [0, 1, 2, 3, 4].map(i => $('g' + i));
  gateBusy = gateBusy.then(() => new Promise(res => {
    G.forEach(x => x.classList.remove('pass', 'fail', 'active')); ['g1r', 'g2r', 'g3r'].forEach(i => $(i).textContent = '–'); $('ans').textContent = '–'; $('g4r').textContent = ''; $('g0r').textContent = 'sent' + (q.via === 'phone' ? ' from a staff phone' : ''); G[0].classList.add('active');
    let i = 0; const stepG = () => {
      G[i].classList.remove('active'); i++;
      if (i <= 3) { const r = dec.gates[i - 1]; G[i].classList.add('active'); setTimeout(() => { G[i].classList.remove('active'); G[i].classList.add(r[0] ? 'pass' : 'fail'); $('g' + i + 'r').textContent = r[1]; if (!r[0]) return fin(); stepG(); }, 420); }
      else fin();
    };
    const fin = () => { $('ans').textContent = dec.allowed ? ans : 'Denied'; G[4].classList.add(dec.allowed ? 'pass' : 'fail'); $('g4r').textContent = dec.allowed ? (dec.level === 'room' ? 'room shared' : 'zone hidden') : 'nothing revealed'; renderAudit(); setTimeout(res, 300); };
    setTimeout(stepG, 350);
  }));
  const text = dec.allowed ? (dec.level === 'room' ? (pat.online ? 'Patient P-112 is in ' + pat.zone + ' (' + Math.round(pat.conf * 100) + '% sure).' : 'Patient P-112: ' + ans + '.') : 'Patient P-112 is in the building. Only the point of contact sees the room.') : 'Request denied: ' + dec.reason + '. It was logged' + (row.cls.includes('flagged') ? ' and flagged to admin.' : '.');
  return { allowed: dec.allowed, answer: dec.allowed ? ans : 'Denied', text, row };
}
function renderAudit() { $('audit').innerHTML = AUD.rows.slice(0, 12).map(r => `<tr class="${r.cls}"><td>${r.time}</td><td>${r.who}</td><td>${r.device}${r.via === 'phone' ? ' · <b>phone</b>' : ''}</td><td>${r.asked}</td><td>${r.result}</td></tr>`).join('') || '<tr><td colspan="5" class="note">No requests yet. Pick who is asking and press Send request.</td></tr>'; }

/* ---------- receiver phone link: 6-digit code over the internet (MQTT relay, src/relay.js: works through any Wi-Fi or mobile network) ----------
   The phone (LOCUS ISHA app, Receiver) shows a code and waits. The laptop types the code and joins it; it sends 'join' every 2 s.
   phone -> laptop:  hello {device, src: 'ble' | 'sim'},  s {s: [[beacon, rssi, msAgo, heightDm]]},  truth {p} (simulation only),  req {role, device, inside, poc},  cal {b, d, rssi}
   laptop -> phone:  cfg (room, beacons, calibration, scorer),  st (estimate, zone, trust, objects, alerts) every 0.5 s,  ans (gate result)          */
const Phone = (() => {
  let relay = null, code = null, lastRx = 0, stT = 0, joinT = 0, mvT = 0, cfgDirty = true;
  const say = m => { $('n-code').innerHTML = m; };
  const live = () => !!relay && relay.on && performance.now() - lastRx < 5000;
  function connect(cd) {
    cd = String(cd || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(cd)) { say('Type the <b>6-digit code</b> shown on the receiver phone.'); return; }
    leave(true); code = cd; lastRx = 0; if (S.mode !== 'live') setMode('live'); say('Connecting to phone <b>' + cd + '</b>…');
    relay = new Relay(cd, 'laptop', onData, s => { if (s === 'online') { say('Waiting for phone <b>' + cd + '</b>…'); relay.send({ t: 'join' }); } else if (s === 'offline') say('Internet link dropped, reconnecting…'); });
    relay.connect(); $('b-unpair').disabled = false;
    setTimeout(() => { if (code === cd && !live()) say('No data from phone <b>' + cd + '</b> yet. On the phone: Receiver screen open, internet on. Check the code.'); }, 10000);
  }
  function onData(d) {
    const now = performance.now(); lastRx = now;
    if (!S.link || S.linkKind !== 'code') { S.link = true; S.linkKind = 'code'; srcPill(); cfgDirty = true; say('Linked to the receiver phone <b>' + code + '</b>.'); }
    if (d.t === 's') {
      (d.s || []).forEach(q => { S.samples.push({ b: q[0], rssi: q[1], t: now - (q[2] || 0) }); if (q[3] != null) { const a = S.all.find(x => x.b === q[0]); if (a && q[3] > 0 && Math.abs(a.z - q[3] / 10) > 0.05) { a.z = q[3] / 10; renderAnchors(); buildTable(); cfgDirty = true; } } });
      if (d.src) S.phoneSrc = d.src;
    } else if (d.t === 'hello') { if (S.phoneSrc !== d.src) { S.phoneSrc = d.src; if (!canWalk()) S.anchors.forEach(a => { if (a.mv) { a.mv = false; placeBeacon(a, a.tx, a.ty, false); } }); renderAnchors(); } if (S.phoneSrc !== d.src || !/Linked to <b>/.test($('n-code').innerHTML)) say('Linked to <b>' + (d.device || 'phone') + '</b> (' + (d.src === 'ble' ? 'real Bluetooth' : 'simulation') + ') · code ' + code + '.'); S.phoneSrc = d.src; }
    else if (d.t === 'truth') { S.phoneTruth = d.p; S.phoneTruthT = now; }
    else if (d.t === 'req') { const r = gateRun({ role: d.role, device: d.device, inside: d.inside, poc: d.poc, via: 'phone' }); send({ t: 'ans', id: d.id, allowed: r.allowed, answer: r.answer, text: r.text }); }
    else if (d.t === 'cal') { const i = S.all.findIndex(a => a.b === d.b); if (i >= 0) { addCal(i, d.d, d.rssi); buildTable(); } }
    else if (d.t === 'want') cfgDirty = true;
    else if (d.t === 'me') { const o = RX.tele; if (o && d.s != null && o.steps != null && d.m) { const k = (d.s - o.steps + 256) % 256; if (k > 0 && k <= 6) RX.pend += k; } RX.tele = { moving: !!d.m, steps: d.s, head: d.h, t: S.clock }; }
    else if (d.t === 'bt') Object.keys(d.b || {}).forEach(k => { const q = d.b[k], m = { moving: !!(q[0] & 1), steps: q[1], head: q[0] & 2 ? q[2] * 2 : null, peers: q[3] || {} }; BM.tele(+k, S.clock, m); TELE[+k] = { ...m, t: S.clock }; });
  }
  function send(m) { return relay ? relay.send(m) : false; }
  function leave(quiet) { if (relay) relay.close(); relay = null; if (S.linkKind === 'code') { S.link = false; S.linkKind = null; S.phoneTruth = null; srcPill(); } if (!quiet) { say('Not linked.'); code = null; $('b-unpair').disabled = true; } }
  function cfg() { return { space: S.space, walls: S.space === 'room' ? partitions() : [], rooms: S.space === 'room' ? S.plan.rooms : [], W: S.W, H: S.H, Z: S.Z, model: S.model, sigDb: S.sigDb, sigM: S.sigM, loss: S.loss, rssi1m: S.rssi1m, pn: S.pn, scorer: S.scorer, anchors: S.anchors.map(a => [a.b, +a.x.toFixed(2), +a.y.toFixed(2), +a.z.toFixed(2), a.p1, a.n, +a.tx.toFixed(2), +a.ty.toFixed(2)]) }; }
  function pump(now) {
    if (!relay || !relay.on) return;
    if (now - joinT > 2000) { joinT = now; send({ t: 'join' }); }
    if (S.linkKind === 'code' && now - lastRx > 6000) { S.link = false; S.linkKind = null; S.phoneTruth = null; srcPill(); say('Phone <b>' + code + '</b> stopped sending. Waiting…'); }
    if (!live()) return;
    if (S.anchors.some(a => a.mv || S.clock - (a.senseT == null ? -9 : a.senseT) < 1) && now - mvT > 300) { mvT = now; cfgDirty = true; }   /* moving beacons: keep the phone's map in step */
    if (cfgDirty) { cfgDirty = false; send({ t: 'cfg', c: cfg() }); }
    if (now - stT > 600 && cur) { stT = now; const o = cur.out; send({ t: 'st', est: o ? o.pos : null, zone: o ? zoneOf(S.space, o.pos[0], o.pos[1], S.W, S.H) : null, err: cur.e.loc, assets: S.assets.list(), alerts: alertList() }); }
  }
  return { connect, leave, pump, send, cfgChanged() { cfgDirty = true; }, get open() { return live(); } };
})();

/* ---------- part-2 UI wiring ---------- */
function bindMore() {
  $('b-rail-lay') && ($('b-rail-lay').onclick = () => document.querySelector('.tabs button[data-t=beacons]').click());
  document.querySelectorAll('.rail a[data-tab]').forEach(l => l.addEventListener('click', () => { const b = document.querySelector('.tabs button[data-t=' + l.dataset.tab + ']'); if (b) b.click(); }));
  $('b-pair').onclick = () => Phone.connect($('i-code').value); $('i-code').onkeydown = e => { if (e.key === 'Enter') Phone.connect($('i-code').value); };
  $('b-unpair').onclick = () => Phone.leave();
  renderAlertLog();
  $('b-shield').onclick = () => { S.shield = !S.shield; alertLog('info', S.shield ? 'Tag shielded (wrapped in foil / carried out of range).' : 'Shield removed.'); renderAlerts(); };
  $('objs').onclick = e => { const sh = e.target.closest('button[data-sh]'); if (sh) { const id = sh.dataset.sh; S.shieldSet.has(id) ? S.shieldSet.delete(id) : S.shieldSet.add(id); renderObjects(); return; } const tr = e.target.closest('tr[data-id]'); if (tr) { S.focus = S.focus === tr.dataset.id ? null : tr.dataset.id; updateObjects(); } };
  document.querySelectorAll('#cald button').forEach(b => b.onclick = () => { S.calD = +b.dataset.d; setSeg('cald', 'd', b.dataset.d); gShow(); });
  $('b-allmv').onclick = () => { if (!canWalk()) { renderMoves(); return; } S.anchors.forEach(a => { a.mv = true; a.hx = a.tx; a.hy = a.ty; }); renderAnchors(); };
  $('b-allfx').onclick = () => { S.anchors.forEach(a => { if (a.mv) { a.mv = false; placeBeacon(a, a.tx, a.ty, false); } }); renderAnchors(); };
  $('i-mapup').onchange = e => { S.mapUp = +e.target.value; };
  $('b-mvclr').onclick = () => { MT.log.length = 0; renderMoves(); };
  $('isha-f').onsubmit = e => { e.preventDefault(); const q = $('isha-q').value.trim(); if (!q) return; $('isha-q').value = ''; dashIsha(q); };
  document.querySelectorAll('#isha-s button').forEach(b => b.onclick = () => dashIsha(b.textContent));
}
/* ISHA on the dashboard too (same brain as the phone): the laptop asks as Admin */
function dashIsha(q) {
  const o = cur && cur.out, me = o ? { pos: o.pos, zone: zoneOf(S.space, o.pos[0], o.pos[1], S.W, S.H) } : null;
  const r = ishaAsk(q, { assets: S.assets.list(), me, alerts: alertList(), beacons: S.anchors.map((a, j) => ({ b: a.b, z: a.z, ok: !!(cur && cur.meas[j]) && !Alerts.repair.has(a.id), trust: o ? o.trust[j] : 0, range: cur && cur.meas[j] ? cur.meas[j].r3 : null, why: o ? o.reasons[j] : '' })), person: id => gateRun({ role: 'admin', device: 'reg', inside: true, poc: true, via: 'dashboard' }) });
  if (r.focus) { S.focus = r.focus; updateObjects(); }
  const box = $('isha-a'); box.innerHTML = '<div class="q">' + q.replace(/[<>&]/g, '') + '</div><div class="a">' + r.text.replace(/[<>&]/g, '') + '</div>' + box.innerHTML; while (box.children.length > 8) box.lastChild.remove();
}
