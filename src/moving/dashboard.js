/* ===== LOCUS Moving Beacons: dashboard (DOM + canvas only; maths lives in motion.js / sim.js / estimator.js) ===== */
const $ = id => document.getElementById(id);
const CFG = MB_CONFIG, PAL = ['#2A78D6', '#EB6834', '#1BAF7A', '#E0A000', '#8B5CF6', '#E0508C', '#0E9DBE', '#7A5C3A'];
const AB = { north: 'N', 'north-east': 'NE', east: 'E', 'south-east': 'SE', south: 'S', 'south-west': 'SW', west: 'W', 'north-west': 'NW' };
const colOf = id => { const n = parseInt(String(id).replace(/\D/g, ''), 10); return PAL[((isNaN(n) ? String(id).length : n) - 1 + PAL.length) % PAL.length]; };
const clock = t => { const m = Math.floor(t / 60), s = t - 60 * m; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };
let world, est, trk, out = null, paused = false, errs = [], objTrail = [], bsig = '', drag = null;

function reset() {
  world = new World(CFG, 1); est = new MovingEstimator(CFG); trk = new MoveTracker(CFG.display);
  world.beacons.forEach(b => trk.update(b.id, b.believed[0], b.believed[1], 0, true));
  out = null; errs = []; objTrail = []; bsig = ''; updateUI();
}

/* ---------- simulation tick: world -> estimator -> movement tracker ---------- */
function tick(dt) {
  world.step(dt);
  const bel = {}; world.beacons.forEach(b => bel[b.id] = { x: b.believed[0], y: b.believed[1], sd: b.sd });
  out = est.step(world.t, world.measure(), bel, dt);
  world.beacons.forEach(b => trk.update(b.id, b.believed[0], b.believed[1], world.t, b.mode !== 'moving'));
  const o = world.obj.pos;
  if (out) { errs.push({ t: world.t, e: Math.hypot(out.pos[0] - o[0], out.pos[1] - o[1]), pf: Math.hypot(out.pf[0] - o[0], out.pf[1] - o[1]) }); while (errs.length && world.t - errs[0].t > 30) errs.shift(); }
  const l = objTrail[objTrail.length - 1]; if (!l || Math.hypot(l[0] - o[0], l[1] - o[1]) > 0.1) { objTrail.push(o.slice()); if (objTrail.length > 60) objTrail.shift(); }
}

/* ---------- external position updates (real phones later): function, postMessage, BroadcastChannel ---------- */
function update_beacon_position(id, x, y, timestamp) {
  x = +x; y = +y; if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: 'x and y must be numbers (metres)' };
  const R = CFG.room; x = Math.min(R.w, Math.max(0, x)); y = Math.min(R.h, Math.max(0, y));
  const b = world.externalUpdate(String(id), x, y, timestamp); if (!b) return { ok: false, error: 'too many beacons (max ' + CFG.maxBeacons + ')' };
  trk.update(b.id, x, y, world.t, true); updateUI();
  const s = trk.stats(b.id, world.t), g = s && s.seg && s.seg.live ? s.seg : null;
  return { ok: true, id: b.id, move: g ? { dist: g.dist, bearing: g.bearing, compass: g.compass, dx: g.dx, dy: g.dy, text: fmtMove(b.id, g) } : null };
}
window.update_beacon_position = window.updateBeaconPosition = update_beacon_position;
addEventListener('message', e => { const d = e.data; if (d && d.type === 'beacon_position') update_beacon_position(d.id, d.x, d.y, d.timestamp); });
try { new BroadcastChannel('locus-beacons').onmessage = e => { const d = e.data; if (d && d.type === 'beacon_position') update_beacon_position(d.id, d.x, d.y, d.timestamp); }; } catch (e) { }

/* ---------- map ---------- */
const cv = $('map'), g = cv.getContext('2d'); let S = 40, OX = 0, OY = 0, DPR = 1;
const X = x => OX + x * S, Y = y => OY + (CFG.room.h - y) * S;   /* y = north = up */
function fit() {
  const r = $('mapbox').getBoundingClientRect(); DPR = Math.min(2, devicePixelRatio || 1); cv.width = r.width * DPR; cv.height = r.height * DPR;
  const pad = 30, W = CFG.room.w, H = CFG.room.h; S = Math.min((r.width - 2 * pad) / W, (r.height - 2 * pad) / H); OX = (r.width - S * W) / 2 + 6; OY = (r.height - S * H) / 2;
}
const toW = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left - OX) / S, CFG.room.h - (e.clientY - r.top - OY) / S]; };
function halo(txt, x, y, col, font) { g.font = font || '700 11.5px Figtree'; g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,.95)'; g.strokeText(txt, x, y); g.fillStyle = col; g.fillText(txt, x, y); }
function arrow(a, b, col, w, alpha) {
  const x1 = X(a[0]), y1 = Y(a[1]), x2 = X(b[0]), y2 = Y(b[1]), an = Math.atan2(y2 - y1, x2 - x1), L = Math.hypot(x2 - x1, y2 - y1), h = Math.min(12, L * 0.5);
  g.save(); g.globalAlpha = alpha; g.strokeStyle = col; g.fillStyle = col; g.lineWidth = w; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2 - Math.cos(an) * h * 0.6, y2 - Math.sin(an) * h * 0.6); g.stroke();
  g.beginPath(); g.moveTo(x2, y2); g.lineTo(x2 - h * Math.cos(an - 0.45), y2 - h * Math.sin(an - 0.45)); g.lineTo(x2 - h * Math.cos(an + 0.45), y2 - h * Math.sin(an + 0.45)); g.closePath(); g.fill();
  g.beginPath(); g.arc(x1, y1, 3.5, 0, 7); g.fill(); g.restore();
}
function draw() {
  const r = $('mapbox').getBoundingClientRect(), W = CFG.room.w, H = CFG.room.h; g.setTransform(DPR, 0, 0, DPR, 0, 0); g.clearRect(0, 0, r.width, r.height);
  g.fillStyle = '#fff'; g.fillRect(X(0), Y(H), W * S, H * S);
  g.lineWidth = 1; g.strokeStyle = '#E6F3F7'; for (let x = 1; x < W; x++) { g.beginPath(); g.moveTo(X(x), Y(0)); g.lineTo(X(x), Y(H)); g.stroke(); } for (let y = 1; y < H; y++) { g.beginPath(); g.moveTo(X(0), Y(y)); g.lineTo(X(W), Y(y)); g.stroke(); }
  g.strokeStyle = '#0E9DBE'; g.lineWidth = 2.2; g.strokeRect(X(0), Y(H), W * S, H * S);
  g.fillStyle = '#7A9AA6'; g.font = '600 10.5px Figtree'; g.textAlign = 'center'; for (let x = 0; x <= W; x += 2) g.fillText(x + ' m', X(x), Y(0) + 15); g.textAlign = 'right'; for (let y = 0; y <= H; y += 2) g.fillText(y + '', X(0) - 6, Y(y) + 4);
  /* north arrow */
  { const nx = X(W) + 14, ny = Y(H) + 6; g.fillStyle = '#0B3A4A'; g.beginPath(); g.moveTo(nx, ny); g.lineTo(nx - 5, ny + 12); g.lineTo(nx + 5, ny + 12); g.closePath(); g.fill(); g.textAlign = 'center'; g.font = '700 10.5px Sora'; g.fillText('N', nx, ny + 24); }
  const t = world.t, stats = {}, small = S < 34, R0 = small ? 8 : 11; world.beacons.forEach(b => stats[b.id] = trk.stats(b.id, t));
  /* fading trails */
  world.beacons.forEach(b => { const s = stats[b.id]; if (!s) return; const tr = s.trail, c = colOf(b.id); for (let i = 1; i < tr.length; i++) { const a = i / tr.length; g.globalAlpha = 0.15 + 0.6 * a; g.strokeStyle = c; g.lineWidth = 2; g.beginPath(); g.moveTo(X(tr[i - 1][0]), Y(tr[i - 1][1])); g.lineTo(X(tr[i][0]), Y(tr[i][1])); g.stroke(); g.beginPath(); g.arc(X(tr[i][0]), Y(tr[i][1]), 2.5, 0, 7); g.fillStyle = c; g.fill(); } g.globalAlpha = 1; });
  /* links beacon -> estimate (width = trust) */
  if (out) world.beacons.forEach(b => { const i = out.ids.indexOf(b.id); if (i < 0 || b.dead) return; const q = out.trust[i]; g.globalAlpha = 0.18 + 0.4 * q; g.strokeStyle = colOf(b.id); g.lineWidth = 0.8 + 3 * q; g.setLineDash(out.usable[i] ? [] : [4, 5]); g.beginPath(); g.moveTo(X(b.believed[0]), Y(b.believed[1])); g.lineTo(X(out.pos[0]), Y(out.pos[1])); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; });
  /* object trail, ellipse, error line, estimate, truth */
  if (objTrail.length > 1) { g.strokeStyle = 'rgba(11,58,74,.25)'; g.lineWidth = 2; g.beginPath(); objTrail.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke(); }
  const o = world.obj.pos;
  if (out) {
    g.save(); g.translate(X(out.pos[0]), Y(out.pos[1])); g.rotate(-out.ell.th); g.beginPath(); g.ellipse(0, 0, out.ell.a * S, out.ell.b * S, 0, 0, 7); g.fillStyle = 'rgba(16,185,129,.1)'; g.fill(); g.strokeStyle = 'rgba(16,185,129,.7)'; g.lineWidth = 1.5; g.stroke(); g.restore();
    g.setLineDash([3, 3]); g.strokeStyle = '#EF6A6A'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(o[0]), Y(o[1])); g.lineTo(X(out.pos[0]), Y(out.pos[1])); g.stroke(); g.setLineDash([]);
    g.beginPath(); g.arc(X(out.pos[0]), Y(out.pos[1]), 7, 0, 7); g.fillStyle = '#10B981'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke();
  }
  g.beginPath(); g.arc(X(o[0]), Y(o[1]), 7, 0, 7); g.fillStyle = '#0B3A4A'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke();
  if (out) { g.textAlign = 'left'; halo('error ' + Math.hypot(out.pos[0] - o[0], out.pos[1] - o[1]).toFixed(2) + ' m', X(o[0]) + 11, Y(o[1]) - 9, '#0B3A4A'); }
  /* move arrows + labels (live: solid; finished: fade over arrowHoldSec) */
  world.beacons.forEach(b => {
    const s = stats[b.id], m = s && s.seg; if (!m || m.dist < CFG.display.threshold) return;
    const al = m.live ? 1 : Math.max(0, 1 - (t - m.t1) / CFG.display.arrowHoldSec), c = colOf(b.id); if (al <= 0) return;
    arrow(m.from, m.to, c, 3, al);
    /* label at the middle of the arrow, beside it; a short arrow gets its label behind the tail so the beacon marker cannot hide it */
    const fx = X(m.from[0]), fy = Y(m.from[1]), tx = X(m.to[0]), ty = Y(m.to[1]), an = Math.atan2(ty - fy, tx - fx), L = Math.hypot(tx - fx, ty - fy);
    const [lx, ly] = L > 80 ? [(fx + tx) / 2 - Math.sin(an) * 14, (fy + ty) / 2 + Math.cos(an) * 14] : [fx - Math.cos(an) * 34, fy - Math.sin(an) * 22];
    g.save(); g.globalAlpha = al; g.textAlign = 'center'; halo(m.dist.toFixed(1) + ' m · ' + (small ? '' : Math.round(m.bearing) + '° ') + AB[m.compass], lx, ly + 4, c, small ? '700 10px Figtree' : null); g.restore();
  });
  /* beacons: true position (dashed) and believed position (filled) */
  world.beacons.forEach(b => {
    const c = colOf(b.id), bx = X(b.believed[0]), by = Y(b.believed[1]), tx = X(b.truth[0]), ty = Y(b.truth[1]);
    if (Math.hypot(tx - bx, ty - by) > 1.5 || b.mode === 'moving') { g.setLineDash([3, 3]); g.strokeStyle = '#7A9AA6'; g.lineWidth = 1.5; g.beginPath(); g.arc(tx, ty, 8, 0, 7); g.stroke(); g.setLineDash([]); if (Math.hypot(tx - bx, ty - by) > 1.5) { g.beginPath(); g.moveTo(tx, ty); g.lineTo(bx, by); g.stroke(); } }
    if (b.mode === 'moving') { g.beginPath(); g.arc(bx, by, R0 + 4, 0, 7); g.strokeStyle = 'rgba(16,185,129,.55)'; g.lineWidth = 2; g.stroke(); }
    if (drag && drag.id === b.id) { g.beginPath(); g.arc(bx, by, 18, 0, 7); g.strokeStyle = '#0B3A4A'; g.lineWidth = 2; g.stroke(); }
    g.beginPath(); g.arc(bx, by, R0, 0, 7); g.fillStyle = b.dead ? '#fff' : c; g.fill(); g.lineWidth = 2.5; g.strokeStyle = b.dead ? '#EF6A6A' : '#fff'; g.stroke();
    if (b.dead) { g.strokeStyle = '#EF6A6A'; g.lineWidth = 2; g.beginPath(); g.moveTo(bx - 5, by - 5); g.lineTo(bx + 5, by + 5); g.moveTo(bx + 5, by - 5); g.lineTo(bx - 5, by + 5); g.stroke(); }
    else { g.fillStyle = '#fff'; g.font = (small ? '700 8px' : '700 10px') + ' Sora'; g.textAlign = 'center'; g.fillText(b.id, bx, by + (small ? 3 : 3.5)); }
    if (small && !b.dead) return; const i = out ? out.ids.indexOf(b.id) : -1; g.textAlign = 'center'; halo(b.dead ? 'dead' : i >= 0 ? 'trust ' + out.trust[i].toFixed(2) : '', bx, by + 26, b.dead ? '#C44' : '#3F6572', '600 10.5px Figtree');
  });
}

/* ---------- drag a beacon ---------- */
cv.addEventListener('pointerdown', e => {
  const p = toW(e); let best = null, bd = 18 / S; world.beacons.forEach(b => { const d = Math.hypot(b.believed[0] - p[0], b.believed[1] - p[1]); if (d < bd) { bd = d; best = b; } });
  if (!best) return; drag = best; best.held = true; cv.setPointerCapture(e.pointerId); e.preventDefault();
});
cv.addEventListener('pointermove', e => {
  const p = toW(e), R = CFG.room;
  if (!drag) { cv.style.cursor = world.beacons.some(b => Math.hypot(b.believed[0] - p[0], b.believed[1] - p[1]) < 18 / S) ? 'grab' : 'crosshair'; return; }
  world.dragBeacon(drag.id, Math.min(R.w, Math.max(0, p[0])), Math.min(R.h, Math.max(0, p[1]))); trk.update(drag.id, drag.believed[0], drag.believed[1], world.t, drag.mode !== 'moving'); cv.style.cursor = 'grabbing'; updateUI();
});
const endDrag = () => { if (drag) { drag.held = false; drag = null; } };
cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);

/* ---------- side panel ---------- */
function buildBeacons() {
  bsig = world.beacons.map(b => b.id + b.mode + b.dead).join();
  $('bl').innerHTML = world.beacons.map(b => `<div class="bc${b.dead ? ' dead' : b.mode === 'moving' ? ' mv' : ''}" data-id="${b.id}">
    <div class="top"><span class="sq" style="background:${colOf(b.id)}"></span><b>${b.id}</b>${b.mode === 'external' ? '<span class="note">external updates</span>' : ''}<div class="mini"><button data-m="fixed" aria-pressed="${b.mode === 'fixed'}">Fixed</button><button data-m="moving" aria-pressed="${b.mode === 'moving'}">Moving</button></div>
      <span class="acts"><button data-a="kill" aria-pressed="${b.dead}">${b.dead ? 'Revive' : 'Kill'}</button><button data-a="rm">Remove</button></span></div>
    <div class="g"><div>believed (x, y)<b class="pb">–</b></div><div>true (x, y)<b class="pt">–</b></div><div>trust<b class="tr">–</b></div><div>total moved<b class="tt">–</b></div><div>last ${CFG.display.recentSec} s<b class="rc">–</b></div><div>speed<b class="spd">–</b></div></div>
    <div class="lm">–</div></div>`).join('');
  $('b-add').disabled = world.beacons.length >= CFG.maxBeacons;
}
$('bl').addEventListener('click', e => {
  const btn = e.target.closest('button'), el = btn && btn.closest('.bc'); if (!el) return; const b = world.get(el.dataset.id); if (!b) return;
  if (btn.dataset.m) world.setMode(b.id, btn.dataset.m);
  else if (btn.dataset.a === 'kill') b.dead = !b.dead;
  else if (btn.dataset.a === 'rm' && world.beacons.length > 1) { world.removeBeacon(b.id); trk.reset(b.id); }
  updateUI();
});
function updateUI() {
  if (!world) return; const t = world.t;
  if (bsig !== world.beacons.map(b => b.id + b.mode + b.dead).join()) buildBeacons();
  const cards = $('bl').children;
  world.beacons.forEach((b, k) => {
    const el = cards[k], s = trk.stats(b.id, t); if (!el || !s) return; const i = out ? out.ids.indexOf(b.id) : -1, q = i >= 0 ? out.trust[i] : null;
    el.querySelector('.pb').textContent = b.believed[0].toFixed(2) + ', ' + b.believed[1].toFixed(2) + (b.sd ? ' ±' + b.sd.toFixed(2) : '');
    el.querySelector('.pt').textContent = b.truth[0].toFixed(2) + ', ' + b.truth[1].toFixed(2);
    el.querySelector('.tr').textContent = q == null ? '–' : q.toFixed(2) + (out.reasons[i] && q < 0.7 ? ' ⚠' : ''); el.querySelector('.tr').title = i >= 0 ? out.reasons[i] || '' : '';
    el.querySelector('.tt').textContent = s.total.toFixed(1) + ' m'; el.querySelector('.rc').textContent = s.recent.toFixed(1) + ' m'; el.querySelector('.spd').textContent = s.speed.toFixed(2) + ' m/s';
    const last = trk.log.find(m => m.id === b.id), n = out && out.perBeacon[b.id] || 0;
    el.querySelector('.lm').textContent = n + ' readings in window · ' + (last ? (last.live ? 'moving: ' : 'last move: ') + last.dist.toFixed(1) + ' m toward ' + Math.round(last.bearing) + '° ' + AB[last.compass] : 'has not moved');
    el.querySelector('.lm').title = last ? fmtMove(b.id, last) : '';
  });
  /* banner = newest move */
  const m = trk.log[0], bn = $('banner');
  if (m) { bn.className = 'banner' + (m.live ? ' live' : ''); bn.firstElementChild.style.background = colOf(m.id); $('banner-t').textContent = fmtMove(m.id, m) + (m.live ? ' · moving…' : ' · at ' + clock(m.t1)); }
  /* log */
  $('log').innerHTML = trk.log.slice(0, 80).map(q => `<tr class="${q.live ? 'live' : ''}"><td>${clock(q.t0)}</td><td><span class="sq" style="background:${colOf(q.id)}"></span>${q.id}</td><td><b>${q.dist.toFixed(2)} m</b>${q.live ? ' …' : ''}</td><td>${Math.round(q.bearing)}° ${q.compass}</td><td>dx ${sgn(q.dx)}, dy ${sgn(q.dy)}</td></tr>`).join('') || '<tr><td colspan="5" class="note">No moves yet.</td></tr>';
  $('n-log').textContent = trk.log.length + ' moves · threshold ' + CFG.display.threshold.toFixed(2) + ' m';
  /* KPIs */
  if (out) {
    const o = world.obj.pos, e = Math.hypot(out.pos[0] - o[0], out.pos[1] - o[1]), pe = Math.hypot(out.pf[0] - o[0], out.pf[1] - o[1]);
    $('k-err').textContent = e.toFixed(2) + ' m'; $('k-err2').textContent = 'particle filter alone ' + pe.toFixed(2) + ' m';
    const me = errs.reduce((a, q) => a + q.e, 0) / Math.max(1, errs.length), wo = errs.reduce((a, q) => Math.max(a, q.e), 0); $('k-mean').textContent = me.toFixed(2) + ' m'; $('k-worst').textContent = 'worst ' + wo.toFixed(2) + ' m';
    $('k-win').textContent = out.window; $('k-win2').textContent = 'last ' + CFG.estimator.windowSec + ' s, ' + Object.values(out.perBeacon).filter(Boolean).length + ' beacons';
    const use = out.usable.filter(Boolean).length, nd = world.beacons.filter(b => b.dead).length; $('k-use').textContent = use + ' / ' + out.ids.length; $('k-use2').textContent = nd ? nd + ' dead' : 'all alive';
    $('k-ell').textContent = '± ' + out.ell.a.toFixed(2) + ' m';
  }
  $('p-run').className = 'pill ' + (paused ? 'warn' : 'ok'); $('p-run').lastElementChild.textContent = (paused ? 'Paused · ' : 'Running · ') + Math.floor(t) + ' s';
}

/* ---------- controls ---------- */
const path = k => { const [a, b] = k.split('.'); return [CFG[a], b]; };
function sliderText(inp) { const [o, k] = path(inp.dataset.k), v = o[k]; inp.previousElementSibling.textContent = inp.dataset.u === '%' ? Math.round(v * 100) + '%' : v + inp.dataset.u; }
document.querySelectorAll('input[data-k]').forEach(inp => { const [o, k] = path(inp.dataset.k); inp.value = o[k]; sliderText(inp); inp.oninput = () => { o[k] = +inp.value; sliderText(inp); if (inp.dataset.k.startsWith('report')) world.beacons.forEach(b => { if (b.mode === 'moving') b.sd = world.repSd(); }); updateUI(); }; });
$('b-pause').onclick = () => { paused = !paused; $('b-pause').textContent = paused ? 'Resume' : 'Pause'; updateUI(); };
$('b-reset').onclick = reset;
$('b-add').onclick = () => { const R = CFG.room, b = world.addBeacon(1 + Math.random() * (R.w - 2), 1 + Math.random() * (R.h - 2), 'fixed'); if (b) trk.update(b.id, b.believed[0], b.believed[1], world.t, true); updateUI(); };
$('b-allmv').onclick = () => { world.beacons.forEach(b => world.setMode(b.id, 'moving')); updateUI(); };
$('b-allfx').onclick = () => { world.beacons.forEach(b => world.setMode(b.id, 'fixed')); updateUI(); };
$('b-clearlog').onclick = () => { trk.log.length = 0; updateUI(); };
$('n-cmpcfg').textContent = CFG.compare.seeds.length + ' seeds × ' + CFG.compare.seconds + ' s per run, with the current noise settings.';
$('b-cmp').onclick = async () => {
  const bt = $('b-cmp'), pr = $('cmp-prog'); bt.disabled = true; pr.style.display = 'block'; $('cmp-out').innerHTML = '';
  const rows = await compareFixedMoving(CFG, async f => { pr.firstElementChild.style.width = (f * 100).toFixed(0) + '%'; await new Promise(r => setTimeout(r, 0)); });
  setRoom(CFG.room.w, CFG.room.h, []);
  const pct = (m, f) => { const d = (m - f) / f * 100; return `<td class="${d < -2 ? 'good' : d > 2 ? 'bad' : ''}">${d > 0 ? '+' : ''}${d.toFixed(0)}%</td>`; };
  const better = rows.filter(r => r.moving.mean < r.fixed.mean * 0.98).length;
  $('cmp-out').innerHTML = `<table><thead><tr><th>Layout</th><th>Fixed mean / worst</th><th>Moving mean / worst</th><th>Mean change</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r.layout}</td><td>${r.fixed.mean.toFixed(2)} / ${r.fixed.worst.toFixed(2)} m</td><td>${r.moving.mean.toFixed(2)} / ${r.moving.worst.toFixed(2)} m</td>${pct(r.moving.mean, r.fixed.mean)}</tr>`).join('')}</tbody></table>
    <div class="note" style="margin-top:8px"><b>Moving beacons lowered the mean error in ${better} of ${rows.length} layouts.</b> Moving helps most when the fixed layout is weak (two beacons: the position along their line is poorly constrained, and a moving beacon adds new angles). When fixed beacons already surround the object, moving adds little: the multipath bias near one spot stays correlated over the 1-2 m a beacon walks in a few seconds, and a moving beacon's own reported position is uncertain (noise + drift), which costs accuracy.</div>`;
  pr.style.display = 'none'; bt.disabled = false; window.__mbCompare = rows;
};

/* ---------- main loop ---------- */
let acc = 0, lastT = performance.now(), lastUI = 0;
function loop(now) {
  const dt = Math.min(0.25, (now - lastT) / 1000); lastT = now;
  if (!paused) { acc += dt; const h = 1 / CFG.tickHz; while (acc >= h) { acc -= h; tick(h); } }
  draw(); if (now - lastUI > 200) { lastUI = now; updateUI(); }
  requestAnimationFrame(loop);
}
addEventListener('resize', fit);
reset(); fit(); requestAnimationFrame(loop);
window.__mb = { get world() { return world; }, get est() { return est; }, get trk() { return trk; }, get out() { return out; }, CFG, tick, reset, update_beacon_position, updateUI, draw, screen: (x, y) => { const r = cv.getBoundingClientRect(); return [r.left + X(x), r.top + Y(y)]; } };
