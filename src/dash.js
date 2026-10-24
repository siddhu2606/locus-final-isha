/* ===== LOCUS · ISHA dashboard: demo or real receiver phone -> LOCUS engine (rules + ML trust) -> 3D view, tagged objects, moving beacons, alerts, access gates ===== */
const $ = id => document.getElementById(id);
const LS_KEY = 'locus.isha.v1';
const ACOL = ['#2A78D6', '#EB6834', '#1BAF7A', '#E0A000', '#8B5CF6', '#E0508C'], acol = a => ACOL[(a.b - 1) % 6];
const TH = [], TMARK = [], SILENT = {};   /* trust trace: last 20 s of {t, v: {anchorId: trust}}; event marks (killed / revived / lost) */
const COL = { truth: '#0B3A4A', locus: '#10B981', ls: '#F5A524', kf: '#8B5CF6', pt: '#22C3E6', dead: '#9AA9B0', obs: '#F5A524', drift: '#8B5CF6' };
const S = {
  space: 'room', W: 5, H: 4, Z: 2.7, n: 5, clock: 0, calD: 1, shield: false, focus: null, phoneTruth: null, phoneTruthT: 0, phoneSrc: null, linkKind: null, zDev: 1.3, zKnow: true, zAssume: 1.3, partition: false,
  src: 'demo', pos: [2.5, 2], trail: [], showTrail: true, heading: null, scale: 1, steps: 0, path: 0,
  anchors: [], all: null, k: 4, sel: 0, dead: new Set(), obstruct: new Set(), drift: new Set(),
  model: 'rssi', sigDb: 4, sigM: 0.6, loss: 0.1, rssi1m: -59, pn: 2.2, scorer: 'fused',
  mode: 'demo', host: '', samples: [], seq: 0, link: false, liveTruth: null, calib: null, heard: {},
  view: { tilt: 90, yaw: 0, zoom: 1 }, show: { truth: true, locus: true, ls: false, kf: false, pt: true, obj: true, links: true }, shieldSet: new Set(),
};
const SAVED = ['roomW', 'roomH', 'Z', 'k', 'zDev', 'model', 'sigDb', 'loss', 'rssi1m', 'pn', 'host'];
let savedSlots = null;
try { const j = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); SAVED.forEach(k => { if (j[k] != null) S[k] = j[k]; }); if (Array.isArray(j.slots) && j.slots.length === 6) savedSlots = j.slots; } catch (e) { }
const save = () => { try { const o = Object.fromEntries(SAVED.map(k => [k, S[k]])); if (S.space === 'room' && S.all) o.slots = S.all.map(a => ({ x: a.x, y: a.y, z: a.z, on: a.on, p1: a.p1, n: a.n, cal: a.cal })); localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch (e) { } };

/* ---------- space / beacons: always 6 slots (beacon IDs 1-6 in the LOCUS Beacon app), each on or off ---------- */
const LAYOUT = {
  2: (W, H) => [[.3, .3], [W - .3, .3]], 3: (W, H) => [[.3, .3], [W - .3, .3], [W / 2, H - .3]],
  4: (W, H) => [[.3, .3], [W - .3, .3], [W - .3, H - .3], [.3, H - .3]], 6: (W, H) => [[.3, .3], [W / 2, .3], [W - .3, .3], [W - .3, H - .3], [W / 2, H - .3], [.3, H - .3]]
};
/* preset positions; heights alternate low/high so >= 4 beacons can also observe the phone's height */
function presetAnchors(k) {
  const W = S.W, H = S.H, lo = 0.4, hi = Math.max(1.2, S.Z - 0.35), pts = (LAYOUT[k] || LAYOUT[4])(W, H), old = S.all || [];
  return Array.from({ length: 6 }, (_, i) => ({ id: 'A' + (i + 1), b: i + 1, x: pts[i] ? pts[i][0] : W / 2, y: pts[i] ? pts[i][1] : H / 2, z: i % 2 ? hi : lo, on: i < k, p1: old[i] && old[i].p1 != null ? old[i].p1 : null, n: old[i] ? old[i].n : null, cal: old[i] ? old[i].cal : null }));
}
function activate() { S.anchors = S.all.filter(a => a.on); S.n = S.anchors.length; S.k = S.n; S.sel = Math.max(0, Math.min(S.sel, S.n - 1)); }
let eng = null, last = null;
function partitions() { return S.partition && S.space === 'room' ? [[S.W / 2, 0, S.W / 2, S.H * 0.36], [S.W / 2, S.H * 0.64, S.W / 2, S.H]] : []; }
function rebuild(keepAnchors) {
  if (S.space === 'hospital') {
    setSite('hospital'); S.Z = 3; S.W = FLOOR.w; S.H = FLOOR.h;
    const old = S.all || [], base = DROP_ORDER.slice(0, 6).map(i => ANCHORS[i]);
    S.all = base.map((a, i) => ({ id: 'A' + (i + 1), b: i + 1, x: a.x, y: a.y, z: i % 2 ? 0.9 : 2.6, on: keepAnchors && old[i] ? old[i].on : i < S.k, p1: old[i] ? old[i].p1 : null, n: old[i] ? old[i].n : null, cal: old[i] ? old[i].cal : null }));
  } else {
    let all = keepAnchors && S.all ? S.all : presetAnchors(S.k);
    if (savedSlots) { all = all.map((a, i) => ({ ...a, ...savedSlots[i] })); savedSlots = null; }
    S.all = all.map((a, i) => ({ ...a, id: 'A' + (i + 1), b: i + 1, x: Math.min(S.W - .1, Math.max(.1, a.x)), y: Math.min(S.H - .1, Math.max(.1, a.y)), z: Math.min(S.Z, Math.max(0, a.z)) }));
  }
  if (!S.all.some(a => a.on)) S.all[0].on = true;
  S.all.forEach(a => { a.tx = a.x; a.ty = a.y; a.hx = a.x; a.hy = a.y; a.mv = !!a.mv && S.mode === 'demo'; a.wp = null; a.pause = 0; });
  activate();
  if (S.space === 'room') setRoom(S.W, S.H, S.anchors, partitions());
  S.pos = [Math.min(S.W - .2, Math.max(.2, S.pos[0])), Math.min(S.H - .2, Math.max(.2, S.pos[1]))];
  if (S.space === 'hospital' && (S.pos[0] < 1 || S.pos[1] < 1)) S.pos = [3, 12];
  newEngine(); S.trail = []; S.estTrail = []; S.path = 0; S.pp = null; S.liveTruth = null;
  S.assets = new AssetSim(S.space, S.W, S.H, 77); MT.log.length = 0; MT.b = {}; S.anchors.forEach(a => MT.update(a.id, a.x, -a.y, S.clock, true));
  fitView(); save(); Phone.cfgChanged();
}
function newEngine() {
  eng = { loc: new Locus(S.anchors, { N: 400, sigma: engSigma(), rng: rngMake(11), inflate: 2.0, scorer: trustPredict, mode: S.scorer }), kf: new KalmanCV(), ls: S.pos.slice(), rng: rngMake(2026), t: 0 };
  stats = { loc: [], ls: [], kf: [] }; logRows = []; TH.length = 0; TMARK.length = 0;
}
/* the filter's range-noise belief: dB shadowing is multiplicative in range (rel. error = sigma_dB*ln10/(10n)) */
function engSigma() {
  if (S.space === 'hospital') return Math.max(0.3, S.sigM * 0.75);
  if (S.model === 'add') return Math.max(0.15, S.sigM);
  return Math.min(3, Math.max(0.2, S.sigDb * Math.LN10 / (10 * S.pn) * 0.4 * Math.hypot(S.W, S.H)));
}
function radioCfg() {
  const hosp = S.space === 'hospital';
  return {
    model: S.model, loss: S.loss, rssi1m: S.rssi1m, n: S.pn, sigma: S.model === 'add' ? S.sigM : 0.6, sigmaDb: S.sigDb, wallDb: 6, obstructDb: 12, driftDb: 6, burst: hosp ? 0.004 : 0.002,
    wallBias: hosp ? 1.8 : 1.2, obstructBias: hosp ? 4 : 1.8, driftBias: hosp ? 2.5 : 1.2, dead: S.dead, obstruct: S.obstruct, drift: S.drift,
  };
}

/* ---------- truth sources ---------- */
let walker = null, keys = {}, joy = { x: 0, y: 0 }, target = null, demoI = 0;
function demoPath() {
  if (S.space === 'hospital') return [[3, 12], [15, 12], [15, 4], [15, 12], [25, 12], [25, 4], [25, 12], [36, 12], [36, 19.5], [36, 12], [27, 12], [27, 19.5], [27, 12], [6, 12], [6, 19.5], [6, 12]];
  const W = S.W, H = S.H, a = 0.8, p = S.partition ? [[a, a], [W / 2 - .6, a], [W / 2 - .6, H / 2], [W / 2 + .6, H / 2], [W / 2 + .6, a], [W - a, a], [W - a, H - a], [W / 2 + .6, H - a], [W / 2 + .6, H / 2], [W / 2 - .6, H / 2], [W / 2 - .6, H - a], [a, H - a]] : [[a, a], [W - a, a], [W - a, H - a], [a, H - a]];
  return p;
}
function moveToward(tx, ty, sp, dt) { const dx = tx - S.pos[0], dy = ty - S.pos[1], d = Math.hypot(dx, dy); if (d < 0.05) return true; const st = Math.min(d, sp * dt); stepMove(dx / d * st, dy / d * st); return false; }
function stepMove(dx, dy) {
  const [x, y] = S.pos, m = 0.12; let nx = Math.min(S.W - m, Math.max(m, x + dx)), ny = Math.min(S.H - m, Math.max(m, y + dy));
  if (crossesWall(x, y, nx, ny)) { if (!crossesWall(x, y, nx, y)) ny = y; else if (!crossesWall(x, y, x, ny)) nx = x; else { nx = x; ny = y; } }
  S.pos = [nx, ny];
}
function updateTruth(dt) {
  const spd = S.space === 'hospital' ? 1.4 : 0.9;
  if (S.mode === 'live') return;   /* real radio: the only truth is where the user taps */
  if (S.calib != null) { const a = S.all[S.calib], rh = S.calD, cx = S.W / 2 - a.x, cy = S.H / 2 - a.y, L = Math.hypot(cx, cy) || 1; S.pos = [a.x + cx / L * rh, a.y + cy / L * rh]; return; }
  if (S.src === 'demo') { const p = demoPath(); demoI %= p.length; if (moveToward(p[demoI][0], p[demoI][1], spd, dt)) demoI = (demoI + 1) % p.length; }
  else if (S.src === 'touch') {
    let vx = (keys.d || keys.ArrowRight ? 1 : 0) - (keys.a || keys.ArrowLeft ? 1 : 0) + joy.x, vy = (keys.s || keys.ArrowDown ? 1 : 0) - (keys.w || keys.ArrowUp ? 1 : 0) + joy.y;
    const L = Math.hypot(vx, vy);
    if (L > 0.05) { target = null; const sp = spd * Math.min(1, L); const c = Math.cos(-S.view.yaw * Math.PI / 180), s = Math.sin(-S.view.yaw * Math.PI / 180); stepMove((vx * c - vy * s) / L * sp * dt, (vx * s + vy * c) / L * sp * dt); }
    else if (target && moveToward(target[0], target[1], spd, dt)) target = null;
  }
}

/* ---------- receiver phone (LOCUS Beacon app): GET http://<ip>:8080/api/samples?since=N -> [[seq, beaconId, rssi, msAgo], ...] ---------- */
let poll = null;
function startLive() {
  const h = $('i-host').value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''), base = h ? 'http://' + h : ''; S.host = h; save();
  if (poll) clearInterval(poll); S.seq = 0; S.link = false; S.samples = []; let fails = 0, busy = false;
  if (!h) { $('n-live').textContent = 'Type the address shown in the app (e.g. 192.168.43.1:8080), then Connect.'; return; }
  $('n-live').textContent = 'Connecting to ' + h + '…';
  poll = setInterval(async () => {
    if (busy) return; busy = true;
    try {
      const ac = new AbortController(), to = setTimeout(() => ac.abort(), 3000), r = await fetch(base + '/api/samples?since=' + S.seq, { signal: ac.signal, cache: 'no-store' }); clearTimeout(to);
      const j = await r.json(), now = performance.now(); fails = 0; if (j.seq < S.seq) S.seq = 0;
      (j.samples || []).forEach(a => S.samples.push({ b: a[1], rssi: a[2], t: now - a[3] })); S.seq = j.seq;
      if (!S.link) $('n-live').textContent = 'Linked to ' + (j.device || 'receiver') + '. Packets are real Bluetooth advertisements.'; S.link = true;
    } catch (e) { if (++fails > 8 && S.link !== false) { S.link = false; $('n-live').textContent = 'No link to ' + h + '. Same Wi-Fi / hotspot? Receiver screen on?' + (location.protocol === 'https:' ? ' This https page cannot reach http devices: download it first (below).' : ''); } }
    busy = false;
  }, 250);
}
function stopLive() { if (poll) clearInterval(poll); poll = null; S.link = false; }
/* real RSSI -> range per active beacon: median of the last 1.5 s, log-distance model with the beacon's OWN calibration (p1 and n) */
function liveMeas(assumedZ) {
  const now = performance.now(), maxR = Math.hypot(S.W, S.H, S.Z) * 1.2;
  return S.anchors.map(a => {
    const v = S.samples.filter(m => m.b === a.b && m.t > now - RADIO.winMs).map(m => m.rssi); if (!v.length) return null;
    const rssi = rssiLevel(v), r3 = rangeFrom(rssi, a.p1 != null ? a.p1 : S.rssi1m, a.n || S.pn, maxR), dz = (a.z || 0) - assumedZ;
    return { r: Math.sqrt(Math.max(0.0025, r3 * r3 - dz * dz)), r3, rssi: Math.round(rssi), nlos: false, d3: null };
  });
}
function setMode(m) {
  S.mode = m; $('b-demo').setAttribute('aria-pressed', m === 'demo'); $('b-live').setAttribute('aria-pressed', m === 'live');
  $('o-live').style.display = m === 'live' ? 'flex' : 'none'; $('o-demo').style.display = m === 'demo' ? 'flex' : 'none'; $('n-https').style.display = m === 'live' && location.protocol === 'https:' ? 'block' : 'none';
  if (m === 'live' && S.space !== 'room') setSpace('room');   /* real phones are in a real room: set its size and where each beacon phone is */
  if (m === 'live') S.all.forEach(a => a.mv = false);
  S.samples = []; S.heard = {}; S.liveTruth = null; S.trail = []; S.estTrail = []; S.path = 0; S.pp = null; newEngine(); renderAnchors();
  if (m === 'demo') { stopLive(); setSource(S.src === 'live' ? 'demo' : S.src); } else { if (S.src === 'touch') setSource('demo'); S.src = 'live'; srcPill(); if ($('i-host').value.trim()) startLive(); }
}

/* ---------- beacons table, presets, calibration, health ---------- */
function layout(k) {
  if (S.space === 'room') { S.k = k; S.all = presetAnchors(k); } else S.all.forEach((a, i) => a.on = i < k);
  rebuild(true); buildTable(); renderAnchors();
}
function buildTable() {
  document.querySelectorAll('#lays button').forEach(b => b.classList.toggle('on', +b.dataset.lay === S.n && S.all.every((a, i) => a.on === i < S.n)));
  const hosp = S.space === 'hospital'; $('i-W').value = S.W; $('i-H').value = S.H; $('i-W').disabled = $('i-H').disabled = hosp;
  $('bt').innerHTML = S.all.map((a, i) => `<tr class="${a.on ? '' : 'off'}" data-i="${i}"><td><b>${a.b}</b><span class="hd"></span></td><td><input type="checkbox"${a.on ? ' checked' : ''} aria-label="Beacon ${a.b} on"></td><td><input type="number" step="0.1" data-k="x" value="${a.x.toFixed(1)}"></td><td><input type="number" step="0.1" data-k="y" value="${a.y.toFixed(1)}"></td><td><input type="number" step="0.1" min="0" data-k="z" value="${a.z.toFixed(1)}"></td><td class="c-r">–</td><td class="c-d">–</td><td><div class="tb"><i style="width:0"></i></div></td><td><button class="cal${a.p1 != null ? ' set' : ''}">${p1Label(i)}</button></td></tr>`).join('');
  document.querySelectorAll('#bt tr').forEach(tr => {
    const i = +tr.dataset.i, a = S.all[i], ins = tr.querySelectorAll('input');
    ins[0].onchange = () => { if (!ins[0].checked && S.n <= 1) { ins[0].checked = true; return; } a.on = ins[0].checked; rebuild(true); buildTable(); renderAnchors(); };
    [ins[1], ins[2], ins[3]].forEach(inp => inp.onchange = () => { const v = parseFloat(inp.value), k = inp.dataset.k; if (isNaN(v)) return; const c = Math.min(k === 'x' ? S.W : k === 'y' ? S.H : S.Z, Math.max(0, v)); if (k === 'z') { a.z = c; renderAnchors(); Phone.cfgChanged(); } else placeBeacon(a, k === 'x' ? c : a.x, k === 'y' ? c : a.y, true); });
    tr.querySelector('.cal').onclick = () => calibrate(i);
  });
}
const p1Label = i => { const a = S.all[i]; return a.p1 == null ? 'Cal' : a.cal && a.cal.length > 1 ? 'n ' + (+a.n).toFixed(1) : String(Math.round(a.p1)); };
/* average 3 s of one beacon's packets; in Demo the walker stands 1 m from it meanwhile. resolves {med, n, sd} */
function measureBeacon(i, onProg) {
  return new Promise(res => {
    const t0 = performance.now(), D = 3000, b = S.all[i].b; if (S.mode === 'demo') S.calib = i;
    const tm = setInterval(() => {
      const f = Math.min(1, (performance.now() - t0) / D); onProg && onProg(f); if (f < 1) return; clearInterval(tm); S.calib = null;
      const rs = S.samples.filter(m => m.b === b && m.t > t0 + (S.mode === 'demo' ? 300 : 0)).map(m => m.rssi).sort((x, y) => x - y);
      if (!rs.length) return res({ med: null, n: 0, sd: 0 });
      const mean = rs.reduce((x, y) => x + y, 0) / rs.length; res({ med: rs[rs.length >> 1], n: rs.length, sd: Math.sqrt(rs.reduce((x, y) => x + (y - mean) * (y - mean), 0) / rs.length) });
    }, 100);
  });
}
/* one calibration point (distance d, median RSSI) -> refit this beacon's p1 (and n once two distances are known) */
function addCal(i, d, rssi) { const a = S.all[i]; a.cal = (a.cal || []).filter(p => Math.abs(p.d - d) > 1e-6).concat([{ d, rssi }]); const f = fitCal(a.cal, S.pn); a.p1 = f.p1; a.n = f.n; calLabel(i); save(); Phone.cfgChanged(); return f; }
function clearCal(i) { const a = S.all[i]; a.cal = null; a.p1 = null; a.n = null; calLabel(i); save(); }
function calLabel(i) { const c = document.querySelectorAll('#bt .cal')[i]; if (c) { c.textContent = p1Label(i); c.classList.toggle('set', S.all[i].p1 != null); c.title = S.all[i].cal ? S.all[i].cal.map(p => fmtDist(p.d) + ': ' + p.rssi + ' dBm').join(' · ') + ' → RSSI@1m ' + S.all[i].p1 + ' dBm, n ' + S.all[i].n : 'Calibrate: hold the receiver at the distance chosen below'; } }
function setP1(i, v) { if (v == null) clearCal(i); else addCal(i, S.calD, v); }
async function calibrate(i) {
  if (S.calib != null || !S.all[i].on) return; const btn = document.querySelectorAll('#bt .cal')[i]; btn.disabled = true;
  const m = await measureBeacon(i, f => { btn.textContent = Math.round(f * 100) + '%'; }); btn.disabled = false;
  if (m.n < 4) { btn.textContent = 'no data'; setTimeout(() => btn.textContent = p1Label(i), 1500); return; }
  addCal(i, S.calD, m.med);
}
const G = { list: [], k: 0, busy: false };
function gShow() {
  const box = $('gcal'); if (!G.list.length) { box.style.display = 'none'; return; }
  const i = G.list[G.k]; box.style.display = 'flex'; $('g-title').textContent = 'Beacon ' + S.all[i].b + ' (' + (G.k + 1) + ' of ' + G.list.length + ')';
  if (!G.busy) { $('g-text').textContent = S.mode === 'demo' ? 'Demo: the walker will stand ' + fmtDist(S.calD) + ' from beacon ' + S.all[i].b + '. Press Measure.' : 'Hold the receiver phone exactly ' + fmtDist(S.calD) + ' from beacon ' + S.all[i].b + ', same height, screen up. Keep still, then press Measure.'; $('g-bar').style.width = '0'; $('g-go').disabled = false; }
}
function gNext() { if (++G.k >= G.list.length) { G.list = []; $('gcal').style.display = 'none'; $('n-cal').textContent = 'Done. Calibrated: ' + (S.all.filter(a => a.on && a.p1 != null).map(a => a.b).join(', ') || 'none') + '.'; } else gShow(); }
async function gGo() {
  if (G.busy || !G.list.length) return; const i = G.list[G.k], b = S.all[i].b; G.busy = true; $('g-go').disabled = true; $('g-text').textContent = 'Measuring… keep the phone still.';
  const m = await measureBeacon(i, f => { $('g-bar').style.width = Math.round(f * 100) + '%'; }); G.busy = false; if (!G.list.length) return;
  if (m.n < 8) { $('g-text').textContent = 'Only ' + m.n + ' packets heard. Move closer, check beacon ' + b + ' is advertising, then press Measure again.'; $('g-go').disabled = false; return; }
  if (m.sd > 6) { $('g-text').textContent = 'Signal too jumpy (±' + m.sd.toFixed(1) + ' dB). Hold still, clear the path and measure again.'; $('g-go').disabled = false; return; }
  const f = addCal(i, S.calD, m.med); $('g-text').textContent = 'Saved ' + m.med + ' dBm at ' + fmtDist(S.calD) + ' (' + m.n + ' packets, ±' + m.sd.toFixed(1) + ' dB) → RSSI at 1 m ' + f.p1 + ' dBm' + (S.all[i].cal.length > 1 ? ', n ' + f.n : '') + '. Next…'; setTimeout(gNext, 1300);
}
/* beacon health: silent / weak / low packet rate / down-weighted, plus geometry */
function health() {
  const now = performance.now(), res = [], heard = [], c = cur;
  S.anchors.forEach((a, j) => {
    const c3 = S.samples.filter(m => m.b === a.b && m.t > now - 3000).length, rate = c3 / 3, m = c && c.meas[j], t = c && c.out ? c.out.trust[j] : null; let lv = 'ok', msg = '';
    if (c3 === 0) { const ago = S.heard[a.b] ? (now - S.heard[a.b]) / 1000 : null; lv = 'bad'; msg = 'Beacon ' + a.b + ': no packets' + (ago != null ? ' for ' + ago.toFixed(0) + ' s' : '') + '. Is that phone advertising, screen on, and close enough?'; }
    else {
      heard.push(a);
      if (m && m.rssi < -88) { lv = 'warn'; msg = 'Beacon ' + a.b + ': weak signal (' + m.rssi + ' dBm). Move it closer or clear the line of sight.'; }
      else if (rate < 2) { lv = 'warn'; msg = 'Beacon ' + a.b + ': only ' + rate.toFixed(1) + ' packets/s. Check Bluetooth and battery saver on that phone.'; }
      else if (t != null && t < 0.4) { lv = 'warn'; msg = 'Beacon ' + a.b + ' is being down-weighted' + (c.out.reasons[j] ? ': ' + c.out.reasons[j] : '') + '.'; }
    }
    res.push({ a, lv, msg, rate });
  });
  const geo = [];
  if (S.n >= 3 && heard.length < 3) geo.push('Only ' + heard.length + ' of ' + S.n + ' beacons heard. Accuracy drops with fewer than 3.');
  if (heard.length >= 3) {
    let ds = 0, A = null, B = null; heard.forEach(p => heard.forEach(q => { const d = Math.hypot(p.x - q.x, p.y - q.y); if (d > ds) { ds = d; A = p; B = q; } }));
    const off = Math.max(...heard.map(p => Math.abs((B.x - A.x) * (A.y - p.y) - (A.x - p.x) * (B.y - A.y)) / (ds || 1)));
    if (off < 0.8) geo.push('The heard beacons are almost in a line. Move one off the line (triangle or square) for a 2-D fix.');
  } else if (S.n === 2) geo.push('2 beacons give two mirror-image answers. Use 3 (triangle) or more for a 2-D fix.');
  return { res, geo };
}
const MSG = {}; let WHY = null;
function updateBeacons() {
  const c = cur, rows = document.querySelectorAll('#bt tr'); if (!c) return;
  S.all.forEach((a, i) => {
    const tr = rows[i]; if (!tr) return; const j = S.anchors.indexOf(a), m = j >= 0 ? c.meas[j] : null, t = j >= 0 && c.out ? c.out.trust[j] : null;
    tr.querySelector('.c-r').textContent = m ? m.rssi + ' dBm' : '–'; tr.querySelector('.c-d').textContent = m ? fmtDist(m.r3) : '–';
    const bar = tr.querySelector('.tb i'); bar.style.width = (t != null && m ? Math.round(t * 100) : 0) + '%'; bar.style.background = trustCol(t || 0); tr.title = j >= 0 && c.out ? c.out.reasons[j] || '' : '';
    const d = tr.querySelector('.hd'); d.className = 'hd'; d.title = '';
    tr.querySelectorAll('input[type=number]').forEach(inp => { const v = a[inp.dataset.k].toFixed(1); if (inp !== document.activeElement && inp.value !== v) inp.value = v; });   /* follow anchor drags in the view */
  });
  const wb = $('warn');
  if (S.mode === 'live' && !S.link) { wb.style.display = 'block'; wb.className = 'warnbox warn'; wb.textContent = poll ? 'Waiting for the receiver phone…' : 'Not connected: enter the receiver address above and press Connect.'; $('n-path').textContent = 'Path: ' + S.path.toFixed(1) + ' m'; return; }
  const H = health();
  H.res.forEach(h => { const d = rows[S.all.indexOf(h.a)] && rows[S.all.indexOf(h.a)].querySelector('.hd'); if (d) { d.className = 'hd ' + h.lv; d.title = h.msg || 'OK, ' + h.rate.toFixed(0) + ' packets/s'; } });
  /* sticky messages: a warning shows only after it persists 1.5 s (silent beacons at once) and stays 4 s after it clears, so the box doesn't flicker on noise */
  const now = performance.now(), live = H.res.filter(h => h.msg).map(h => ({ k: 'b' + h.a.b, lv: h.lv, t: h.msg })).concat(H.geo.map((t, i) => ({ k: 'g' + t.slice(0, 12), lv: 'warn', t })));
  live.forEach(m => { const o = MSG[m.k]; MSG[m.k] = { lv: m.lv, t: m.t, since: o && o.lv === m.lv && now - o.last < 4000 ? o.since : now, last: now }; });
  const msgs = Object.keys(MSG).filter(k => { const m = MSG[k]; if (now - m.last > 4000 || (k[0] === 'b' && !S.anchors.some(a => 'b' + a.b === k))) { delete MSG[k]; return false; } return m.lv === 'bad' || now - m.since > 1500; }).sort().map(k => MSG[k]);
  wb.style.display = 'block';
  if (!msgs.length) { wb.className = 'warnbox ok'; wb.textContent = 'All active beacons healthy.'; }
  else { wb.className = 'warnbox ' + (msgs.some(m => m.lv === 'bad') ? 'bad' : 'warn'); wb.innerHTML = msgs.map(m => '• ' + m.t.replace(/[<>&]/g, '')).join('<br>'); }
  const o = c.out; if (o) {
    const worst = S.anchors.map((a, j) => ({ a, t: o.trust[j], r: o.reasons[j] })).sort((p, q) => p.t - q.t)[0];
    if (worst && worst.t < 0.6) WHY = { t: 'Beacon ' + worst.a.b + ' down-weighted: ' + (worst.r || 'low trust'), last: now };
    $('n-why').textContent = WHY && now - WHY.last < 4000 ? WHY.t : 'Beacon # is the ID you pick in the app on each beacon phone. Untick one to test losing a beacon.';
  }
  $('n-path').textContent = 'Path: ' + S.path.toFixed(1) + ' m';
}

/* ---------- simulation tick (10 Hz) ---------- */
let stats = { loc: [], ls: [], kf: [] }, logRows = [], cur = null;
function tick() {
  const dt = 0.1, live = S.mode === 'live', now = performance.now(), simTruth = live && S.phoneTruth && now - S.phoneTruthT < 1500;   /* a phone in Simulation mode also sends where it really is */
  const truth = live ? (simTruth ? S.phoneTruth.slice() : null) : S.pos.slice(), zTrue = S.calib != null && !live ? S.all[S.calib].z : S.zDev, assumed = S.calib != null && !live ? zTrue : S.zKnow ? S.zDev : S.zAssume;
  S.clock += dt; if (!live) moveBeacons(dt);
  const real = S.anchors.map(a => a.tx === a.x && a.ty === a.y ? a : { ...a, x: a.tx, y: a.ty });   /* radio uses where the beacon REALLY is; the engine only knows its believed position */
  let meas = live ? liveMeas(assumed) : measure3D(truth, zTrue, assumed, real, radioCfg(), eng.rng, wallsBetween);
  if (S.shield) meas = meas.map(() => null);
  S.assets.step(dt, real, radioCfg(), S.shieldSet);
  if (!live) meas.forEach((m, i) => { if (m) S.samples.push({ b: S.anchors[i].b, rssi: m.rssi, t: now }); });   /* demo packets feed the same health/calibration code */
  S.samples.forEach(m => { if (m.t > now - 400) S.heard[m.b] = Math.max(S.heard[m.b] || 0, m.t); }); S.samples = S.samples.filter(m => m.t > now - 6000);
  const ls = lsFix(S.anchors, meas, eng.ls); if (ls) eng.ls = ls; const kf = eng.kf.update(ls, dt);
  eng.loc.sigma = engSigma(); const out = eng.loc.step(meas, dt); eng.t += dt;
  let p3 = null;
  if (out) { const w = out.trust.map((t, j) => out.usable[j] ? t * t : 0); p3 = fix3D(S.anchors, meas, [out.pos[0], out.pos[1], S.zDev], w, { w: S.W, h: S.H, z: S.Z }, 1.3, engSigma());
    /* height changes slowly: smooth it, and only trust it when the geometry can actually observe it */
    if (p3 && p3[3] < 0.8) { S.zEst = S.zEst == null ? p3[2] : S.zEst + 0.12 * (p3[2] - S.zEst); S.zStd = p3[3]; } else { S.zEst = null; S.zStd = null; } if (!p3) { S.zEst = null; S.zStd = null; } }
  const e = q => q && truth ? Math.hypot(q[0] - truth[0], q[1] - truth[1]) : null;
  if (p3 && S.zEst != null) p3 = [p3[0], p3[1], S.zEst, S.zStd]; else p3 = null;
  cur = { truth, meas, ls, kf, out, p3, e: { loc: out && e(out.pos), ls: e(ls), kf: e(kf) } };
  if (out) { const w2 = out.trust.map((q, j) => out.usable[j] ? q * q : 0), sw = w2.reduce((p, q) => p + q, 0); cur.share = w2.map(v => sw > 0 ? v / sw : 0);
    const v = {}; S.anchors.forEach((a, j) => { v[a.id] = out.trust[j];
      const gone = /^No packets/.test(out.reasons[j] || ''); if (gone && !SILENT[a.id] && live) TMARK.push({ t: eng.t, txt: 'B' + a.b + ' lost', col: '#EF6A6A' }); SILENT[a.id] = gone; });
    TH.push({ t: eng.t, v }); while (TH.length && eng.t - TH[0].t > 20.5) TH.shift(); while (TMARK.length && eng.t - TMARK[0].t > 20) TMARK.shift(); }
  ['loc', 'ls', 'kf'].forEach(k => { if (cur.e[k] != null) { stats[k].push(cur.e[k]); if (stats[k].length > 900) stats[k].shift(); } });
  if (out) { S.estTrail = (S.estTrail || []); S.estTrail.push(out.pos.slice()); if (S.estTrail.length > 80) S.estTrail.shift();
    if (!S.pp) S.pp = out.pos.slice(); const dm = Math.hypot(out.pos[0] - S.pp[0], out.pos[1] - S.pp[1]); if (dm > 0.4) { S.path += dm; S.pp = out.pos.slice(); } }
  if (S.showTrail && truth) { const t = S.trail, l = t[t.length - 1]; if (!l || Math.hypot(l[0] - truth[0], l[1] - truth[1]) > 0.04) { t.push(truth); if (t.length > 160) t.shift(); } }
  trackBeacons(); alertsTick(meas, out);
  if (logRows.length < 30000 && out && truth) logRows.push([eng.t.toFixed(1), ...truth.map(v => v.toFixed(3)), S.zDev, ...out.pos.map(v => v.toFixed(3)), p3 ? p3[2].toFixed(2) : '', ls ? ls[0].toFixed(3) : '', ls ? ls[1].toFixed(3) : '', cur.e.loc.toFixed(3), cur.e.ls == null ? '' : cur.e.ls.toFixed(3), cur.e.kf == null ? '' : cur.e.kf.toFixed(3), ...S.anchors.map((a, i) => meas[i] ? meas[i].rssi : ''), ...S.anchors.map((a, i) => out.trust[i].toFixed(2))]);
}

/* ---------- 3D rendering ---------- */
const cv = $('cv'), g = cv.getContext('2d'); let DPR = 1, V = null, vp = { cx: 0, cy: 0, cz: 0, ox: 0, oy: 0, s: 40 }, hit = [];
function fitView() { vp.cx = S.W / 2; vp.cy = S.H / 2; vp.cz = S.Z / 2; }
function resize() { DPR = Math.min(2, devicePixelRatio || 1); const r = cv.getBoundingClientRect(); cv.width = r.width * DPR; cv.height = r.height * DPR; }
function setupView() {
  const w = cv.width / DPR, h = cv.height / DPR, W = S.W, H = S.H, Z = S.Z;
  /* fit: project the room box at unit scale, then scale/centre the bounding box into the free area (below the toolbar, above the HUD) */
  const T = makeView({ tilt: S.view.tilt, yaw: S.view.yaw, cx: vp.cx, cy: vp.cy, cz: vp.cz, ox: 0, oy: 0, s: 1 });
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; [[0, 0], [W, 0], [W, H], [0, H]].forEach(c => [0, Z].forEach(z => { const p = T.P(c[0], c[1], z); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }));
  const top = w < 600 ? 96 : 58, bot = w < 600 ? 84 : 72, aw = w - 36, ah = h - top - bot;
  vp.s = S.view.zoom * Math.min(aw / Math.max(0.5, x1 - x0), ah / Math.max(0.5, y1 - y0)) * (S.view.zoom === 1 ? 1 : 1);
  vp.ox = w / 2 - (x0 + x1) / 2 * vp.s; vp.oy = top + ah / 2 - (y0 + y1) / 2 * vp.s;
  V = makeView({ tilt: S.view.tilt, yaw: S.view.yaw, cx: vp.cx, cy: vp.cy, cz: vp.cz, ox: vp.ox, oy: vp.oy, s: vp.s });
}
const P = (x, y, z) => V.P(x, y, z || 0);
function line(a, b, col, w, dash) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]); }
function dot(p, r, col, stroke) { g.beginPath(); g.arc(p[0], p[1], r, 0, 7); g.fillStyle = col; g.fill(); if (stroke) { g.lineWidth = 2; g.strokeStyle = stroke; g.stroke(); } }
function poly(pts, fill, stroke, lw) { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 1; g.stroke(); } }
const trustCol = t => t > 0.7 ? '#10B981' : t > 0.4 ? '#F5A524' : '#EF6A6A';

/* ---------- trust scorer panel: per-beacon trust, share of the fix, 20 s trace ---------- */
function setFault(a, f) {
  const s = S[f], on = !s.has(a.id); on ? s.add(a.id) : s.delete(a.id);
  const txt = { dead: on ? 'killed' : 'revived', obstruct: on ? 'blocked' : 'unblocked', drift: on ? 'drifting' : 'drift off' }[f];
  TMARK.push({ t: eng.t, txt: 'B' + a.b + ' ' + txt, col: on ? (f === 'dead' ? '#EF6A6A' : f === 'obstruct' ? '#F5A524' : '#8B5CF6') : '#10B981' });
  syncFaults(); renderAnchors(); updateTrust();
}
let TSIG = '', THOV = null;
function buildTrust() {
  TSIG = S.anchors.map(a => a.id).join() + S.mode; const live = S.mode === 'live';
  $('tcards').innerHTML = S.anchors.map(a => `<div class="tc" data-id="${a.id}"><div class="top"><span class="sq" style="background:${acol(a)}"></span><b>Beacon ${a.b}</b><span class="st">live</span></div>
    <div class="kv"><span>trust</span><b class="big tv">–</b></div><div class="mt"><i style="width:0;background:${acol(a)}"></i></div>
    <div class="kv"><span>rules · ML</span><b class="rm">–</b></div><div class="kv"><span>share of the fix</span><b class="sh">–</b></div><div class="kv"><span>range</span><b class="rg">–</b></div><div class="why">–</div><div class="acts"${live ? ' style="display:none"' : ''}><button data-f="dead" aria-pressed="false">Kill</button><button class="o" data-f="obstruct" aria-pressed="false">Block</button></div></div>`).join('');
  $('tleg').innerHTML = S.anchors.map(a => `<span><i style="background:${acol(a)}"></i>Beacon ${a.b}</span>`).join('');
  $('share').innerHTML = S.anchors.map(a => `<div style="background:${acol(a)};width:0"></div>`).join('');
}
function updateTrust() {
  const c = cur; if (!c || c.meas.length !== S.anchors.length) return;   /* one frame after a layout change cur still has the old beacons */
  if (TSIG !== S.anchors.map(a => a.id).join() + S.mode) buildTrust();
  const o = c.out, live = S.mode === 'live', cards = $('tcards').children, bars = $('share').children, sh = c.share || S.anchors.map(() => 0);
  S.anchors.forEach((a, i) => {
    const el = cards[i], m = c.meas[i], q = o ? o.trust[i] : 0, why = o ? o.reasons[i] || '' : '', dead = !live && S.dead.has(a.id), blk = !live && S.obstruct.has(a.id), drf = !live && S.drift.has(a.id), silent = /^No packets/.test(why);
    el.className = 'tc' + (dead ? ' dead' : blk ? ' blk' : drf ? ' drf' : '');
    const st = el.querySelector('.st'); st.textContent = dead ? 'killed' : blk ? 'blocked' : drf ? 'drifting' : silent ? 'silent' : live ? 'real BLE' : 'live'; st.className = 'st' + (dead || silent ? ' dead' : blk ? ' blk' : drf ? ' drf' : live ? ' real' : '');
    const bs = el.querySelectorAll('.acts button'); bs[0].setAttribute('aria-pressed', String(S.dead.has(a.id))); bs[0].textContent = S.dead.has(a.id) ? 'Revive' : 'Kill'; bs[1].setAttribute('aria-pressed', String(S.obstruct.has(a.id))); bs[1].textContent = S.obstruct.has(a.id) ? 'Unblock' : 'Block';
    const tv = el.querySelector('.tv'); tv.textContent = o ? q.toFixed(2) : '–'; tv.style.color = o ? trustCol(q) : ''; el.querySelector('.mt i').style.width = (o ? q * 100 : 0).toFixed(1) + '%';
    el.querySelector('.sh').textContent = Math.round(sh[i] * 100) + '%'; el.querySelector('.rm').textContent = o && m ? o.tRule[i].toFixed(2) + ' · ' + (o.tML ? o.tML[i].toFixed(2) : '–') : '–';
    let rg = 'no packet'; if (m) { if (c.truth) { const d = Math.hypot(c.truth[0] - a.x, c.truth[1] - a.y, a.z - S.zDev), k = wallsBetween(a.x, a.y, c.truth[0], c.truth[1]); rg = m.r3.toFixed(1) + ' m · true ' + d.toFixed(1) + (k ? ' · ' + k + ' wall' + (k > 1 ? 's' : '') : ''); } else rg = m.r3.toFixed(1) + ' m · ' + m.rssi + ' dBm'; }
    el.querySelector('.rg').textContent = rg; el.querySelector('.why').textContent = why || (o ? 'Consistent with motion model' : '–');
    const bar = bars[i], p = sh[i] * 100; bar.style.width = p.toFixed(2) + '%'; bar.style.borderRightWidth = p > 0.4 ? '2px' : '0'; bar.textContent = p > 9 ? 'B' + a.b + ' ' + Math.round(p) + '%' : ''; bar.title = 'Beacon ' + a.b + ': ' + Math.round(p) + '% of the fix';
  });
  if (o) {
    const use = o.usable.filter(Boolean).length, n = S.anchors.length, nd = live ? 0 : S.anchors.filter(a => S.dead.has(a.id)).length;
    $('t-use').textContent = use + ' / ' + n; $('t-use2').textContent = nd ? nd + ' killed · ' + (n - nd - use) + ' packet lost' : (n - use) + ' packet' + (n - use === 1 ? '' : 's') + ' lost this reading';
    const lo = S.anchors.map((a, i) => ({ a, q: o.trust[i], r: o.reasons[i] })).sort((x, y) => x.q - y.q)[0];
    $('t-low').textContent = lo.q.toFixed(2); $('t-low').style.color = trustCol(lo.q); $('t-low2').textContent = 'Beacon ' + lo.a.b + (lo.q < 0.7 && lo.r ? ': ' + lo.r : ': healthy');
    $('t-ell').textContent = '± ' + o.ell.a.toFixed(1) + ' m';
    if (c.truth) { $('t-err').textContent = c.e.loc.toFixed(2) + ' m'; $('t-err2').textContent = 'trilateration ' + (c.e.ls == null ? 'no fix' : c.e.ls.toFixed(2) + ' m'); }
    else { const k = stats.loc.length; $('t-err').textContent = k ? stats.loc[k - 1].toFixed(2) + ' m' : '–'; $('t-err2').textContent = k ? 'at your last tap' : 'tap the floor where you stand'; }
  }
  drawTrace();
}
function drawTrace() {
  const box = $('tbox'), cvs = $('trace'), W = box.clientWidth, H = box.clientHeight, d = Math.min(2, devicePixelRatio || 1); if (!W || !H) return;
  if (cvs.width !== Math.round(W * d) || cvs.height !== Math.round(H * d)) { cvs.width = Math.round(W * d); cvs.height = Math.round(H * d); }
  const x = cvs.getContext('2d'), L = 38, R = 10, T = 12, B = 24, pw = W - L - R, ph = H - T - B, t1 = eng.t, t0 = t1 - 20, X = s => L + (s - t0) / 20 * pw, Y = v => T + (1 - v) * ph;
  x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, W, H);
  x.fillStyle = 'rgba(239,106,106,.06)'; x.fillRect(L, Y(0.4), pw, Y(0) - Y(0.4));   /* below 0.4: down-weighted */
  x.font = '600 10.5px Figtree'; x.lineWidth = 1;
  [0, 0.25, 0.5, 0.75, 1].forEach(v => { x.strokeStyle = '#E2F1F6'; x.beginPath(); x.moveTo(L, Y(v)); x.lineTo(W - R, Y(v)); x.stroke(); x.fillStyle = '#7A9AA6'; x.textAlign = 'right'; x.fillText(v.toFixed(2), L - 6, Y(v) + 3.5); });
  x.textAlign = 'center'; [0, 5, 10, 15, 20].forEach(s => x.fillText(s === 20 ? 'now' : '−' + (20 - s) + ' s', X(t0 + s), H - 7));
  TMARK.forEach((k, j) => { const px = X(k.t); if (px < L) return; x.strokeStyle = k.col; x.setLineDash([3, 3]); x.beginPath(); x.moveTo(px, T); x.lineTo(px, T + ph); x.stroke(); x.setLineDash([]); x.font = '700 10.5px Figtree'; x.textAlign = px > W - 90 ? 'right' : 'left'; const lx = px + (px > W - 90 ? -4 : 4), ly = Y(0.06) - (j % 3) * 12; x.lineJoin = 'round'; x.lineWidth = 3; x.strokeStyle = '#fff'; x.strokeText(k.txt, lx, ly); x.fillStyle = k.col; x.fillText(k.txt, lx, ly); x.lineWidth = 1; });
  S.anchors.forEach(a => { x.strokeStyle = acol(a); x.lineWidth = 2; x.lineJoin = 'round'; x.beginPath(); let on = false; TH.forEach(h => { const v = h.v[a.id]; if (v == null) { on = false; return; } const px = X(h.t), py = Y(v); on ? x.lineTo(px, py) : x.moveTo(px, py); on = true; }); x.stroke(); });
  const tip = $('ttip');
  if (THOV != null && TH.length && THOV >= L && THOV <= W - R) {
    const s = t0 + (THOV - L) / pw * 20; let best = TH[0]; for (const h of TH) if (Math.abs(h.t - s) < Math.abs(best.t - s)) best = h;
    const px = X(best.t); x.strokeStyle = '#7A9AA6'; x.lineWidth = 1; x.beginPath(); x.moveTo(px, T); x.lineTo(px, T + ph); x.stroke();
    S.anchors.forEach(a => { const v = best.v[a.id]; if (v != null) { x.beginPath(); x.arc(px, Y(v), 3.5, 0, 7); x.fillStyle = acol(a); x.fill(); } });
    tip.hidden = false; tip.style.left = Math.min(W - 80, Math.max(80, px)) + 'px'; tip.style.top = T + 'px';
    tip.innerHTML = (eng.t - best.t < 0.15 ? 'now' : '−' + (eng.t - best.t).toFixed(1) + ' s') + '<br>' + S.anchors.filter(a => best.v[a.id] != null).map(a => 'B' + a.b + ' ' + best.v[a.id].toFixed(2)).join(' · ');
  } else tip.hidden = true;
}

function draw() {
  const w = cv.width / DPR, h = cv.height / DPR; g.setTransform(DPR, 0, 0, DPR, 0, 0); g.clearRect(0, 0, w, h); setupView();
  const W = S.W, H = S.H, Z = S.Z, tilt = S.view.tilt;
  /* floor + grid */
  poly([P(0, 0, 0), P(W, 0, 0), P(W, H, 0), P(0, H, 0)], '#FFFFFF', '#9CCFE0', 1.5);
  g.save(); g.globalAlpha = 0.55; const step = W > 14 ? 5 : 1;
  for (let x = step; x < W; x += step) line(P(x, 0, 0), P(x, H, 0), '#DDF0F6', 1); for (let y = step; y < H; y += step) line(P(0, y, 0), P(W, y, 0), '#DDF0F6', 1); g.restore();
  if (S.space === 'hospital') ROOMS.forEach(r => { const [a, b, c, d] = r.r; poly([P(a, b, 0), P(c, b, 0), P(c, d, 0), P(a, d, 0)], r.id === 'corr' ? 'rgba(34,195,230,.07)' : 'rgba(16,185,129,.05)', null); const m = P((a + c) / 2, (b + d) / 2, 0); if (tilt > 45) { g.fillStyle = '#7A9AA6'; g.font = '600 11px Figtree'; g.textAlign = 'center'; g.fillText(r.name, m[0], m[1]); } });
  /* room box edges */
  const cs = [[0, 0], [W, 0], [W, H], [0, H]];
  if (tilt < 88) { poly(cs.map(c => P(c[0], c[1], Z)), null, 'rgba(14,157,190,.45)', 1.2); cs.forEach(c => line(P(c[0], c[1], 0), P(c[0], c[1], Z), 'rgba(14,157,190,.35)', 1.2)); }
  /* walls (translucent panels): interior walls only, far-first */
  const wl = WALLS.filter(q => !((q[1] === 0 && q[3] === 0) || (q[1] === H && q[3] === H) || (q[0] === 0 && q[2] === 0) || (q[0] === W && q[2] === W)));
  const wd = wl.map(q => ({ q, d: P((q[0] + q[2]) / 2, (q[1] + q[3]) / 2, Z / 2)[2] })).sort((a, b) => a.d - b.d);
  wd.forEach(({ q }) => { const a = P(q[0], q[1], 0), b = P(q[2], q[3], 0), c = P(q[2], q[3], Z), d = P(q[0], q[1], Z); if (tilt > 80) line(a, b, '#0E9DBE', 2.5); else poly([a, b, c, d], 'rgba(14,157,190,.16)', 'rgba(14,157,190,.55)', 1.2); });
  [[0, 0, W, 0], [W, 0, W, H], [W, H, 0, H], [0, H, 0, 0]].forEach(q => line(P(q[0], q[1], 0), P(q[2], q[3], 0), '#0E9DBE', 2.2));
  /* particles */
  const loc = eng.loc, c = cur;
  if (S.show.pt && loc.inited) { g.fillStyle = 'rgba(34,195,230,.42)'; for (let i = 0; i < loc.N; i += 3) { const p = P(loc.px[i], loc.py[i], 0); g.fillRect(p[0] - 1.2, p[1] - 1.2, 2.4, 2.4); } }
  /* 90% ellipse on the floor */
  if (S.show.locus && c && c.out) { const o = c.out, pts = []; for (let k = 0; k < 40; k++) { const t = k / 40 * 2 * Math.PI, ex = o.ell.a * Math.cos(t), ey = o.ell.b * Math.sin(t), ct = Math.cos(o.ell.th), st = Math.sin(o.ell.th); pts.push(P(o.pos[0] + ex * ct - ey * st, o.pos[1] + ex * st + ey * ct, 0)); } poly(pts, 'rgba(16,185,129,.07)', 'rgba(16,185,129,.6)', 1.5); }
  /* trails */
  const trl = (arr, col, wd) => { if (arr && arr.length > 1) { g.beginPath(); arr.forEach((q, i) => { const p = P(q[0], q[1], 0); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); g.strokeStyle = col; g.lineWidth = wd; g.stroke(); } };
  if (S.show.truth && S.showTrail) trl(S.trail, 'rgba(11,58,74,.35)', 2); if (S.show.locus && S.showTrail) trl(S.estTrail, 'rgba(16,185,129,.55)', 2);
  drawSelfCheck(); drawBeaconMoves(); drawAssets(); drawOffRadar();
  if (S.mode === 'live' && S.liveTruth && !(c && c.truth)) { const p = P(S.liveTruth[0], S.liveTruth[1], 0); g.beginPath(); g.arc(p[0], p[1], 11, 0, 7); g.strokeStyle = COL.truth; g.lineWidth = 2.5; g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]); g.fillStyle = COL.truth; g.font = '700 10.5px Figtree'; g.textAlign = 'center'; g.fillText('you (tapped)', p[0], p[1] - 15); }
  if (target && S.src === 'touch') { const p = P(target[0], target[1], 0); g.beginPath(); g.arc(p[0], p[1], 9, 0, 7); g.strokeStyle = '#10B981'; g.lineWidth = 2; g.stroke(); }
  /* objects sorted far -> near */
  const items = [];
  S.anchors.forEach((a, i) => items.push({ d: P(a.x, a.y, a.z)[2], f: () => drawAnchor(a, i) }));
  if (c && c.truth) items.push({ d: P(c.truth[0], c.truth[1], S.zDev)[2], f: drawPhone });
  if (c && c.out && S.show.locus) { const z = c.p3 ? c.p3[2] : S.zDev; items.push({ d: P(c.out.pos[0], c.out.pos[1], z)[2] + 0.001, f: () => drawEst(c.out.pos, z, COL.locus, 'LOCUS', true) }); }
  if (c && c.ls && S.show.ls) items.push({ d: P(c.ls[0], c.ls[1], S.zDev)[2] - 0.001, f: () => drawEst(c.ls, S.zDev, COL.ls, 'trilat', false) });
  if (c && c.kf && S.show.kf) items.push({ d: P(c.kf[0], c.kf[1], S.zDev)[2] - 0.002, f: () => drawEst(c.kf, S.zDev, COL.kf, 'kalman', false) });
  items.sort((a, b) => a.d - b.d).forEach(it => it.f());
  g.fillStyle = '#7A9AA6'; g.font = '600 11px Figtree'; g.textAlign = 'right'; if (w > 700) g.fillText(W.toFixed(1) + ' × ' + H.toFixed(1) + ' × ' + Z.toFixed(1) + ' m  ·  tilt ' + tilt + '°', w - 12, h - 76);
}
function drawAnchor(a, i) {
  const base = P(a.x, a.y, 0), top = P(a.x, a.y, a.z), dead = S.dead.has(a.id) || (S.mode === 'live' && cur && !cur.meas[i]), ob = S.obstruct.has(a.id), dr = S.drift.has(a.id), col = dead ? COL.dead : ob ? COL.obs : dr ? COL.drift : '#0E9DBE';
  const m = cur && cur.meas[i], t = cur && cur.out ? cur.out.trust[i] : 0.8;
  if (S.view.tilt < 89) line(base, top, 'rgba(14,157,190,.35)', 1.5, [3, 3]); dot(base, 3, 'rgba(14,157,190,.35)');
  const ref = cur && (cur.truth || (cur.out && cur.out.pos));
  if (ref && !dead && S.show.locus) { const p = P(ref[0], ref[1], S.zDev); g.save(); g.globalAlpha = m ? 0.8 : 0.18; line(top, p, m ? trustCol(t) : '#9AA9B0', m ? 1 + 9 * (cur.share ? cur.share[i] : 0.25) : 1, m ? [] : [4, 5]); g.restore();
    if (S.view.tilt < 65 && m) { const dz = a.z - S.zDev, mid = [(top[0] + p[0]) / 2, (top[1] + p[1]) / 2]; g.fillStyle = '#0E9DBE'; g.font = '700 10.5px Figtree'; g.textAlign = 'center'; g.fillText('Δz ' + (dz >= 0 ? '+' : '') + dz.toFixed(1) + ' m', mid[0], mid[1] - 4); } }
  if (i === S.sel) { g.beginPath(); g.arc(top[0], top[1], 15, 0, 7); g.strokeStyle = '#10B981'; g.lineWidth = 2; g.stroke(); }
  if (a.mv || a.tx !== a.x || a.ty !== a.y) { const tp = P(a.tx, a.ty, a.z); g.beginPath(); g.arc(tp[0], tp[1], 5, 0, 7); g.strokeStyle = 'rgba(11,58,74,.55)'; g.lineWidth = 1.5; g.setLineDash([2, 2]); g.stroke(); g.setLineDash([]); }   /* true spot when it differs from the believed one */
  poly([[top[0], top[1] - 9], [top[0] + 8, top[1] - 4.5], [top[0] + 8, top[1] + 4.5], [top[0], top[1] + 9], [top[0] - 8, top[1] + 4.5], [top[0] - 8, top[1] - 4.5]], col, '#fff', 2);
  g.fillStyle = '#fff'; g.font = '700 9px Figtree'; g.textAlign = 'center'; g.fillText(a.id.replace('A', ''), top[0], top[1] + 3.2);
  g.fillStyle = col; g.font = '700 10.5px Figtree'; g.fillText((a.z).toFixed(1) + ' m', top[0], top[1] - 14);
  if (cur && cur.out && cur.share && cur.share.length === S.anchors.length) { const lb = dead ? 'no packets' : t.toFixed(2) + ' · ' + Math.round(cur.share[i] * 100) + '%'; g.font = '700 10px Figtree'; g.textAlign = 'center'; g.lineJoin = 'round'; g.lineWidth = 3.5; g.strokeStyle = 'rgba(255,255,255,.92)'; g.strokeText(lb, top[0], top[1] + 22); g.fillStyle = dead ? '#C44' : '#0B3A4A'; g.fillText(lb, top[0], top[1] + 22); }
  hit.push({ i, x: top[0], y: top[1] });
}
function drawPhone() {
  const p = cur.truth, f = P(p[0], p[1], 0), t = P(p[0], p[1], S.zDev);
  g.beginPath(); g.ellipse(f[0], f[1], 9, 9 * Math.max(0.35, Math.sin(S.view.tilt * Math.PI / 180)), 0, 0, 7); g.fillStyle = 'rgba(11,58,74,.18)'; g.fill();
  if (S.view.tilt < 89) line(f, t, COL.truth, 2.5);
  if (S.heading != null && S.src === 'remote') { const a = S.heading * Math.PI / 180, q = P(p[0] + Math.sin(a) * 0.9, p[1] - Math.cos(a) * 0.9, 0); line(f, q, '#10B981', 3); }
  dot(t, 8, COL.truth, '#fff'); g.fillStyle = '#fff'; g.fillRect(t[0] - 2.4, t[1] - 4, 4.8, 8);
  g.fillStyle = COL.truth; g.font = '700 10.5px Figtree'; g.textAlign = 'center'; g.fillText('phone ' + S.zDev.toFixed(1) + ' m', t[0], t[1] - 13);
}
function drawEst(pos, z, col, label, big) {
  const f = P(pos[0], pos[1], 0), t = P(pos[0], pos[1], z);
  if (S.view.tilt < 89) line(f, t, col, 1.5, [2, 3]);
  g.beginPath(); g.arc(t[0], t[1], big ? 10 : 7, 0, 7); g.lineWidth = big ? 3 : 2.5; g.strokeStyle = col; g.stroke();
  if (big) { g.fillStyle = col; g.font = '700 10.5px Figtree'; g.textAlign = 'center'; g.fillText(label + (cur.p3 ? ' · ' + z.toFixed(1) + ' m' : ''), t[0], t[1] + 24); }
}

/* ---------- UI ---------- */
function setSeg(id, attr, val) { document.querySelectorAll('#' + id + ' button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === val))); }
function setView(kind) { const v = { top: [90, 0], iso: [48, S.view.yaw || -28], side: [10, 0] }[kind]; animateView(v[0], kind === 'top' ? 0 : v[1]); setSeg('views', 'v', kind); }
let anim = null; function animateView(tilt, yaw) { anim = { t0: performance.now(), a: S.view.tilt, b: tilt, c: S.view.yaw, d: yaw }; }
function syncView() { $('tilt').value = S.view.tilt; $('tiltv').textContent = Math.round(S.view.tilt) + '°'; $('yaw').value = S.view.yaw; $('yawv').textContent = Math.round(S.view.yaw) + '°'; const k = S.view.tilt > 80 ? 'top' : S.view.tilt < 20 ? 'side' : 'iso'; setSeg('views', 'v', k); }
function renderAnchors() {
  $('anchors').innerHTML = S.anchors.map((a, i) => { const dz = a.z - S.zDev, st = S.dead.has(a.id) ? 'killed' : S.obstruct.has(a.id) ? 'blocked' : S.drift.has(a.id) ? 'drifting' : 'ok'; return `<div class="an${i === S.sel ? ' sel' : ''}" data-i="${i}"><header><span>Beacon ${a.b}</span><span class="note">${st}</span><button class="mvb" data-mv="${i}" aria-pressed="${!!a.mv}"${S.mode === 'live' ? ' disabled title="Real beacons: drag them in the view or type the new position"' : ''}>${a.mv ? 'walks' : 'fixed'}</button><span class="dz">${dz >= 0 ? '↑' : '↓'} ${Math.abs(dz).toFixed(1)} m ${dz >= 0 ? 'above' : 'below'} phone</span></header>
    <div class="row"><label class="fld">x <input type="number" step="0.1" value="${a.x.toFixed(1)}" data-k="x"></label><label class="fld">y <input type="number" step="0.1" value="${a.y.toFixed(1)}" data-k="y"></label><label class="fld">height z <input type="number" step="0.1" min="0" max="${S.Z}" value="${a.z.toFixed(1)}" data-k="z"></label></div><div class="note mvs">–</div></div>`; }).join('');
  document.querySelectorAll('#anchors .an').forEach(el => {
    el.onclick = e => { if (e.target.tagName === 'INPUT') return; const mb = e.target.closest('.mvb'); if (mb) { const a = S.anchors[+mb.dataset.mv]; if (S.mode === 'live') return; a.mv = !a.mv; if (a.mv) { a.hx = a.tx; a.hy = a.ty; } else placeBeacon(a, a.tx, a.ty, false); renderAnchors(); return; } S.sel = +el.dataset.i; renderAnchors(); syncFaults(); };
    el.querySelectorAll('input').forEach(inp => inp.onchange = () => { const a = S.anchors[+el.dataset.i], k = inp.dataset.k, v = parseFloat(inp.value); if (isNaN(v)) return; const c = Math.min(k === 'x' ? S.W : k === 'y' ? S.H : S.Z, Math.max(0, v)); if (k === 'z') { a.z = c; renderAnchorsDz(); buildTable(); Phone.cfgChanged(); } else { a.mv = false; placeBeacon(a, k === 'x' ? c : a.x, k === 'y' ? c : a.y, true); buildTable(); } });
  });
}
function relayout() { if (S.space === 'room') { setRoom(S.W, S.H, S.anchors, partitions()); } newEngine(); renderAnchors(); }
function syncFaults() { const a = S.anchors[S.sel]; if (!a) return; document.querySelectorAll('#faults button').forEach(b => { const f = b.dataset.f; b.setAttribute('aria-pressed', f === 'clear' ? 'false' : String(S[f === 'dead' ? 'dead' : f].has(a.id))); }); }
function spaceNote() {
  $('n-space').innerHTML = S.space === 'room' ? 'Your own room: set its size and beacons in the <b>Beacons</b> tab (virtual BLE beacons in Demo, real phones in Receiver mode). Heights are set here.' : '<b>The 40 × 24 m hospital floor the ML model was trained on.</b> A synced phone walk is scaled up ×8 so crossing your room crosses a ward. The trained trust model is fully in-distribution here. Beacons 1-6 are the first six hospital anchors.';
  $('o-room').style.display = S.space === 'room' ? 'flex' : 'none';
  $('n-ml').innerHTML = { rules: '<b>Rules only:</b> residual against the motion model, sudden jumps and variance spikes. Every reason you see on a card comes from these checks.', ml: '<b>ML only:</b> a LightGBM model trained on ' + (TRUST_MODEL.n_train / 1000 | 0) + 'k simulated hospital readings (AUC ' + TRUST_MODEL.auc.toFixed(2) + ' vs ' + TRUST_MODEL.auc_heuristic.toFixed(2) + ' for the rules) scores each reading. It runs in your browser.', fused: '<b>Rules + ML (default):</b> both score every reading. When they agree the trust is their average; when either is sure a reading is bad (below 0.25) that one wins. So the ML catches what the rules miss, and the rules keep the ML honest outside its training data. Each card shows both scores.' }[S.scorer] + (S.space === 'room' && S.scorer !== 'rules' ? ' The ML was trained on a 40 × 24 m hospital; in a small room the rules carry more of the weight.' : '');
}
function bindUI() {
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b))); document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 't-' + b.dataset.t)); if (b.dataset.t === 'space') renderAnchors(); if (b.dataset.t === 'beacons') buildTable(); });
  document.querySelectorAll('#views button').forEach(b => b.onclick = () => setView(b.dataset.v));
  $('tilt').oninput = e => { S.view.tilt = +e.target.value; anim = null; syncView(); }; $('yaw').oninput = e => { S.view.yaw = +e.target.value; anim = null; syncView(); };
  ['truth', 'locus', 'ls', 'kf', 'pt', 'obj', 'links'].forEach(k => { const cb = $('L-' + k); cb.checked = S.show[k]; cb.parentElement.style.opacity = S.show[k] ? 1 : .4; cb.parentElement.onclick = e => { e.preventDefault(); S.show[k] = !S.show[k]; cb.checked = S.show[k]; cb.parentElement.style.opacity = S.show[k] ? 1 : .4; }; });
  $('b-demo').onclick = () => setMode('demo'); $('b-live').onclick = () => setMode('live'); $('b-conn').onclick = startLive;
  $('i-host').onkeydown = e => { if (e.key === 'Enter') startLive(); };
  $('b-offline').onclick = async () => { try { const h = await (await fetch(location.href.split('#')[0], { cache: 'no-store' })).text(), a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([h], { type: 'text/html' })); a.download = 'locus-room-live.html'; a.click(); } catch (e) { $('n-live').textContent = 'Download failed: use your browser\'s Save page (Ctrl+S).'; } };
  document.querySelectorAll('#walk button').forEach(b => b.onclick = () => setSource(b.dataset.w));
  document.querySelectorAll('#lays button').forEach(b => b.onclick = () => layout(+b.dataset.lay));
  const resizeRoom = () => { if (S.space !== 'room') return; S.W = S.roomW = Math.min(40, Math.max(2, +$('i-W').value || 5)); S.H = S.roomH = Math.min(24, Math.max(2, +$('i-H').value || 4)); if (LAYOUT[S.n] && S.all.every((a, i) => a.on === i < S.n)) S.all = presetAnchors(S.n); demoI = 0; S.pos = [S.W / 2, S.H / 2]; rebuild(true); buildTable(); renderAnchors(); };
  $('i-W').onchange = resizeRoom; $('i-H').onchange = resizeRoom;
  $('b-gcal').onclick = () => { G.list = S.all.map((a, i) => a.on ? i : -1).filter(i => i >= 0); G.k = 0; G.busy = false; gShow(); };
  $('g-stop').onclick = () => { G.list = []; G.busy = false; S.calib = null; gShow(); }; $('g-skip').onclick = () => { if (!G.busy) gNext(); }; $('g-go').onclick = gGo;
  $('b-reset').onclick = () => { S.trail = []; S.estTrail = []; S.path = 0; S.pp = null; }; $('b-trail').onclick = e => { S.showTrail = !S.showTrail; e.target.textContent = 'Trail: ' + (S.showTrail ? 'on' : 'off'); if (!S.showTrail) { S.trail = []; S.estTrail = []; } };
  document.querySelectorAll('#spaces button').forEach(b => b.onclick = () => setSpace(b.dataset.sp));
  const sl = (id, k, fmt, after) => { $('i-' + id).oninput = e => { S[k] = +e.target.value; $('v-' + id).textContent = fmt(S[k]); after && after(); save(); }; };
  sl('Z', 'Z', v => v.toFixed(1), () => { rebuild(true); renderAnchors(); });
  $('g-part').onclick = e => { S.partition = !S.partition; e.target.setAttribute('aria-pressed', S.partition); demoI = 0; rebuild(true); renderAnchors(); buildTable(); };
  $('i-zd').oninput = e => { S.zDev = +e.target.value; $('v-zd').textContent = S.zDev.toFixed(2) + ' m'; if (S.zKnow) { S.zAssume = S.zDev; $('i-za').value = S.zDev; $('v-za').textContent = S.zDev.toFixed(2) + ' m'; } renderAnchorsDz(); save(); };
  document.querySelectorAll('#zpre button').forEach(b => b.onclick = () => { $('i-zd').value = b.dataset.z; $('i-zd').oninput({ target: $('i-zd') }); });
  $('g-zknow').onclick = e => { S.zKnow = !S.zKnow; e.target.setAttribute('aria-pressed', S.zKnow); $('f-zas').style.display = S.zKnow ? 'none' : 'flex'; if (S.zKnow) S.zAssume = S.zDev; };
  $('i-za').oninput = e => { S.zAssume = +e.target.value; $('v-za').textContent = S.zAssume.toFixed(2) + ' m'; };
  $('i-model').onchange = e => { S.model = e.target.value; sigUI(); save(); };
  $('i-sig').oninput = e => { if (S.model === 'rssi') S.sigDb = +e.target.value; else S.sigM = +e.target.value; $('v-sig').textContent = e.target.value + (S.model === 'rssi' ? ' dB' : ' m'); save(); };
  $('i-loss').oninput = e => { S.loss = +e.target.value / 100; $('v-loss').textContent = e.target.value + '%'; save(); };
  $('i-r1').onchange = e => { S.rssi1m = +e.target.value; save(); }; $('i-pn').onchange = e => { S.pn = +e.target.value; save(); };
  document.querySelectorAll('#scorer button').forEach(b => b.onclick = () => { S.scorer = b.dataset.sc; setSeg('scorer', 'sc', S.scorer); eng.loc.mode = S.scorer; TMARK.push({ t: eng.t, txt: { rules: 'rules only', ml: 'ML only', fused: 'rules + ML' }[S.scorer], col: '#0E9DBE' }); spaceNote(); Phone.cfgChanged(); });
  document.querySelectorAll('#faults button').forEach(b => b.onclick = () => { const a = S.anchors[S.sel]; if (!a) return; const f = b.dataset.f; if (f === 'clear') { if (S.dead.size || S.obstruct.size || S.drift.size) TMARK.push({ t: eng.t, txt: 'faults cleared', col: '#10B981' }); S.dead.clear(); S.obstruct.clear(); S.drift.clear(); syncFaults(); renderAnchors(); } else setFault(a, f); });
  $('tcards').onclick = e => { const b = e.target.closest('button[data-f]'), el = b && b.closest('.tc'); if (!el) return; const a = S.anchors.find(q => q.id === el.dataset.id); if (a) setFault(a, b.dataset.f); };
  const tbx = $('tbox'); tbx.onpointermove = e => { THOV = e.clientX - tbx.getBoundingClientRect().left; drawTrace(); }; tbx.onpointerleave = () => { THOV = null; drawTrace(); };
  $('b-clear').onclick = () => { stats = { loc: [], ls: [], kf: [] }; logRows = []; };
  $('b-csv').onclick = () => { const head = ['t_s', 'truth_x', 'truth_y', 'truth_z', 'locus_x', 'locus_y', 'locus_z_est', 'trilat_x', 'trilat_y', 'err_locus', 'err_trilat', 'err_kalman'].concat(S.anchors.map(a => 'rssi_' + a.id), S.anchors.map(a => 'trust_' + a.id)).join(','); const blob = new Blob([head + '\n' + logRows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'locus-room-session.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  /* canvas: orbit (drag), zoom (wheel/pinch), tap floor to walk, drag anchors */
  const ptrs = new Map(); let mode = null, st = null;
  cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; ptrs.set(e.pointerId, [x, y]);
    const h = hit.find(q => Math.hypot(q.x - x, q.y - y) < 18); if (ptrs.size === 1) { if (h) { S.sel = h.i; syncFaults(); renderAnchors(); mode = S.view.tilt > 25 ? 'anchor' : null; st = { x, y, moved: 0, i: h.i }; } else { mode = 'orbit'; st = { x, y, moved: 0, tilt: S.view.tilt, yaw: S.view.yaw }; } } else { mode = 'pinch'; const p = [...ptrs.values()]; st = { d: Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]), z: S.view.zoom }; } cv.classList.add('drag'); };
  cv.onpointermove = e => { if (!ptrs.has(e.pointerId)) return; const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; ptrs.set(e.pointerId, [x, y]);
    if (mode === 'orbit') { st.moved = Math.max(st.moved, Math.hypot(x - st.x, y - st.y)); if (st.moved > 5) { S.view.yaw = ((st.yaw + (x - st.x) * 0.4 + 540) % 360) - 180; S.view.tilt = Math.min(90, Math.max(8, st.tilt - (y - st.y) * 0.35)); anim = null; syncView(); } }
    else if (mode === 'anchor') { st.moved = Math.max(st.moved, Math.hypot(x - st.x, y - st.y)); if (st.moved > 3) { const a = S.anchors[st.i], u = V.U(x, y, a.z); a.mv = false; placeBeacon(a, u[0], u[1], true); } }
    else if (mode === 'pinch' && ptrs.size === 2) { const p = [...ptrs.values()]; S.view.zoom = Math.min(4, Math.max(0.5, st.z * Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) / st.d)); } };
  cv.onpointerup = cv.onpointercancel = e => { const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (mode === 'anchor' && st.moved > 3) { renderAnchors(); buildTable(); }
    else if (mode === 'orbit' && st.moved <= 5) { const u = V.U(x, y, 0); if (u[0] >= 0 && u[1] >= 0 && u[0] <= S.W && u[1] <= S.H) { if (S.mode === 'live') logTap(u); else if (S.src === 'touch') target = u; } }
    ptrs.delete(e.pointerId); if (!ptrs.size) { mode = null; cv.classList.remove('drag'); } };
  cv.onwheel = e => { e.preventDefault(); S.view.zoom = Math.min(4, Math.max(0.5, S.view.zoom * (e.deltaY < 0 ? 1.1 : 0.9))); };
  addEventListener('keydown', e => { if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return; keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = true; if (S.mode === 'demo' && S.src !== 'touch' && /^(w|a|s|d|Arrow.*)$/.test(e.key) && !e.metaKey) setSource('touch'); if (e.key.startsWith('Arrow')) e.preventDefault(); });
  addEventListener('keyup', e => { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
  const jy = $('joy'), jk = $('joyk'); let jd = false; const jm = e => { const r = jy.getBoundingClientRect(), dx = (e.clientX - r.left - 52) / 40, dy = (e.clientY - r.top - 52) / 40, L = Math.hypot(dx, dy), k = L > 1 ? 1 / L : 1; joy = { x: dx * k, y: dy * k }; jk.style.transform = `translate(${joy.x * 34}px,${joy.y * 34}px)`; };
  jy.onpointerdown = e => { jd = true; jy.setPointerCapture(e.pointerId); jm(e); }; jy.onpointermove = e => { if (jd) jm(e); }; jy.onpointerup = jy.onpointercancel = () => { jd = false; joy = { x: 0, y: 0 }; jk.style.transform = ''; };
  addEventListener('resize', resize);
}
function setSpace(sp) { S.space = sp; setSeg('spaces', 'sp', S.space); if (S.space === 'hospital') { S.k = 6; S.scale = 8; S.model = 'add'; $('i-model').value = 'add'; S.sigM = 0.8; sigUI(); S.pos = [3, 12]; } else { S.scale = 1; S.model = 'rssi'; $('i-model').value = 'rssi'; sigUI(); S.Z = +$('i-Z').value; S.k = 4; S.W = S.roomW || 5; S.H = S.roomH || 4; $('i-W').value = S.W; $('i-H').value = S.H; S.pos = [S.W / 2, S.H / 2]; S.all = null; } S.dead.clear(); S.obstruct.clear(); S.drift.clear(); demoI = 0; rebuild(false); spaceNote(); renderAnchors(); buildTable(); }
function renderAnchorsDz() { document.querySelectorAll('#anchors .an').forEach(el => { const a = S.anchors[+el.dataset.i], dz = a.z - S.zDev, s = el.querySelector('.dz'); if (s) s.textContent = (dz >= 0 ? '↑ ' : '↓ ') + Math.abs(dz).toFixed(1) + ' m ' + (dz >= 0 ? 'above' : 'below') + ' phone'; }); }
function sigUI() { const r = S.model === 'rssi', el = $('i-sig'); el.max = r ? 10 : 3; el.step = r ? 0.5 : 0.1; el.value = r ? S.sigDb : S.sigM; $('v-sig').textContent = el.value + (r ? ' dB' : ' m'); }
function setSource(s) {
  if (S.mode === 'live' && s !== 'remote') s = 'live'; S.src = s; setSeg('walk', 'w', s); $('joy').classList.toggle('on', s === 'touch'); srcPill();
}
function srcPill() {
  const names = { demo: 'Demo · auto loop', touch: 'Demo · tap / keys', live: S.linkKind === 'code' ? 'Receiver phone · code' : 'Receiver phone' }; $('p-src').lastElementChild.textContent = names[S.src] || S.src;
  $('p-src').className = 'pill' + (S.src === 'demo' ? '' : S.src === 'live' ? (S.link ? ' ok' : ' warn') : ' ok');
}
/* receiver mode: one ground-truth sample per tap, like the LOCUS Beacon dashboard */
function logTap(u) {
  S.liveTruth = u; const c = cur; if (!c || !c.out) return; const err = Math.hypot(c.out.pos[0] - u[0], c.out.pos[1] - u[1]); stats.loc.push(err); if (c.ls) stats.ls.push(Math.hypot(c.ls[0] - u[0], c.ls[1] - u[1])); if (c.kf) stats.kf.push(Math.hypot(c.kf[0] - u[0], c.kf[1] - u[1]));
  logRows.push([eng.t.toFixed(1), u[0].toFixed(3), u[1].toFixed(3), S.zDev, ...c.out.pos.map(v => v.toFixed(3)), c.p3 ? c.p3[2].toFixed(2) : '', c.ls ? c.ls[0].toFixed(3) : '', c.ls ? c.ls[1].toFixed(3) : '', err.toFixed(3), c.ls ? stats.ls[stats.ls.length - 1].toFixed(3) : '', c.kf ? stats.kf[stats.kf.length - 1].toFixed(3) : '', ...S.anchors.map((a, i) => c.meas[i] ? c.meas[i].rssi : ''), ...S.anchors.map((a, i) => c.out.trust[i].toFixed(2))]);
  $('h-err').textContent = err.toFixed(2) + ' m';
}
function updateReport() {
  const c = cur; if (!c) return; const med = a => a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : null, q95 = a => a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * .95))] : null, f = v => v == null ? '–' : v.toFixed(2) + ' m';
  $('k-m1').textContent = f(med(stats.loc)); $('k-m2').textContent = f(med(stats.ls)); $('k-m3').textContent = f(med(stats.kf)); $('k-p1').textContent = f(q95(stats.loc)); $('k-p2').textContent = f(q95(stats.ls)); $('k-n').textContent = stats.loc.length;
  if (S.mode === 'demo' || c.truth) { $('h-err').textContent = c.e.loc == null ? '–' : c.e.loc.toFixed(2) + ' m'; $('h-ls').textContent = c.e.ls == null ? 'no fix' : c.e.ls.toFixed(2) + ' m'; } else if (!S.liveTruth) { $('h-err').textContent = 'tap floor'; $('h-ls').textContent = c.ls ? c.ls[0].toFixed(1) + ', ' + c.ls[1].toFixed(1) : 'no fix'; }
  $('h-z').textContent = (c.p3 ? c.p3[2].toFixed(1) + '±' + c.p3[3].toFixed(1) : '–') + ' · ' + S.zDev.toFixed(1) + ' m'; $('h-n').textContent = c.meas.filter(Boolean).length + ' / ' + S.anchors.length;
  $('tb').innerHTML = S.anchors.map((a, i) => { const m = c.meas[i], t = c.out ? c.out.trust[i] : 0; return `<tr><td><b>${a.id}</b></td><td>${S.dead.has(a.id) && S.mode === 'demo' ? 'off' : m ? m.rssi + ' dBm' : 'lost'}</td><td>${m ? m.r3.toFixed(1) + ' m' : '–'}</td><td><div class="tb"><i style="width:${Math.round(t * 100)}%;background:${trustCol(t)}"></i></div></td></tr>`; }).join('');
  const bad = c.out && S.anchors.map((a, i) => ({ a, t: c.out.trust[i], r: c.out.reasons[i] })).filter(x => x.t < 0.7 && x.r).sort((a, b) => a.t - b.t)[0]; $('n-reason').innerHTML = bad ? '<b>' + bad.a.id + ':</b> ' + bad.r : 'All readings look consistent.';
  const nh = c.meas.filter(Boolean).length; $('p-mode').className = 'pill ' + (nh >= 3 ? 'ok' : nh >= 1 ? 'warn' : 'bad'); $('p-mode').lastElementChild.textContent = S.mode === 'live' ? (S.link ? (S.phoneSrc === 'sim' ? 'Phone simulation · ' : 'Real BLE · ') + nh + ' beacons heard' : 'No link to receiver') : 'Simulated radio · ' + nh + ' anchors heard'; if (S.mode === 'live') { $('p-mode').className = 'pill ' + (S.link && nh >= 3 ? 'ok' : S.link ? 'warn' : 'bad'); srcPill(); }
  updateBeacons(); updateTrust();
  const sp = $('spark'), sg = sp.getContext('2d'), W = sp.clientWidth, Hh = sp.clientHeight; if (sp.width !== W * 2) { sp.width = W * 2; sp.height = Hh * 2; } sg.setTransform(2, 0, 0, 2, 0, 0); sg.clearRect(0, 0, W, Hh);
  const mx = Math.max(1, ...stats.loc.slice(-300), ...stats.ls.slice(-300)); [['ls', COL.ls], ['loc', COL.locus]].forEach(([k, col]) => { const a = stats[k].slice(-300); if (a.length < 2) return; sg.beginPath(); a.forEach((v, i) => { const x = i / 299 * W, y = Hh - 6 - v / mx * (Hh - 14); i ? sg.lineTo(x, y) : sg.moveTo(x, y); }); sg.strokeStyle = col; sg.lineWidth = 2; sg.stroke(); });
  sg.fillStyle = '#7A9AA6'; sg.font = '600 10px Figtree'; sg.fillText('error (m) · green LOCUS · amber trilateration · max ' + mx.toFixed(1), 6, 11);
}

/* ---------- main loop ---------- */
let acc = 0, lastT = performance.now(), frameN = 0;
function loop(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now; acc += dt;
  if (anim) { const k = Math.min(1, (now - anim.t0) / 600), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; S.view.tilt = anim.a + (anim.b - anim.a) * e; S.view.yaw = anim.c + (anim.d - anim.c) * e; syncView(); if (k >= 1) anim = null; }
  while (acc >= 0.1) { acc -= 0.1; updateTruth(0.1); tick(); Phone.pump(now); }
  hit = []; draw(); if (++frameN % 6 === 0) { updateReport(); renderAlerts(); updateObjects(); renderMoves(); }
  requestAnimationFrame(loop);
}
function init() {
  $('i-W').value = S.W; $('i-H').value = S.H; $('i-Z').value = S.Z; $('v-Z').textContent = S.Z.toFixed(1); $('i-host').value = S.host || '';
  $('i-zd').value = S.zDev; $('v-zd').textContent = S.zDev.toFixed(2) + ' m'; S.zAssume = S.zDev; $('i-model').value = S.model; $('i-loss').value = S.loss * 100; $('v-loss').textContent = Math.round(S.loss * 100) + '%'; $('i-r1').value = S.rssi1m; $('i-pn').value = S.pn;
  sigUI(); bindUI(); bindMore(); resize(); rebuild(false); buildTable(); spaceNote(); renderAnchors(); syncFaults(); syncView(); setSource('demo');
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
  const sp = /[?&#]space=(room|hospital)/.exec(location.href); setSpace(sp ? sp[1] : 'hospital');
  const jm = /[#&?]code=(\d{6})/.exec(location.href); if (jm) { setMode('live'); $('i-code').value = jm[1]; setTimeout(() => Phone.connect(jm[1]), 300); }
  buildAccess(); renderObjects(); requestAnimationFrame(loop);
  window.update_beacon_position = updateBeaconPosition;
  window.__locus = { Phone, S, tick, MT, Alerts, gateRun, addCal, placeBeacon, updateBeaconPosition, get eng() { return eng; }, get cur() { return cur; }, get stats() { return stats; }, setSource, setMode, rebuild, layout, health, measureBeacon, calibrate, logTap, liveMeas, setFault, updateTrust, get TH() { return TH; }, get TMARK() { return TMARK; } };
}
