/* ===== dashboard part 3: saved layouts and blueprints =====
   A layout = floor plan (size, walls with doors, named zones) + the 6 beacon slots (position, height, on/off, calibration).
   Built in: Hospital floor and Warehouse (the trained 40 x 24 m maps, positions of beacons editable, walls fixed).
   Editable examples: Clinic OPD, Office floor, Home 2BHK. Draw / erase walls, add zones, move beacons, then save. */
const LAY_KEY = 'locus.isha.layouts.v1';
const W2 = (x1, y1, x2, y2, door) => door ? (x1 === x2 ? [[x1, y1, x1, door[0]], [x1, door[1], x1, y2]] : [[x1, y1, door[0], y1], [door[1], y1, x2, y1]]) : [[x1, y1, x2, y2]];
const BP_EXAMPLES = [
  { name: 'Clinic OPD', icon: '🩺', W: 14, H: 9, Z: 3,
    rooms: [['wait', 'Waiting area', 0, 0, 6, 9], ['c1', 'Consult 1', 6, 0, 10, 4], ['c2', 'Consult 2', 10, 0, 14, 4], ['corr', 'Corridor', 6, 4, 14, 5.5], ['pharm', 'Pharmacy', 6, 5.5, 14, 9]],
    walls: [...W2(6, 0, 6, 9, [4, 5.5]), ...W2(6, 4, 14, 4, [7.4, 8.6]), ...W2(10, 0, 10, 4), ...W2(10, 4, 14, 4, [11.4, 12.6]), ...W2(6, 5.5, 14, 5.5, [9.4, 10.6])].map(w => w),
    beacons: [[0.4, 0.4, 2.4], [8, 0.4, 0.9], [13.6, 2, 2.4], [13.6, 8.6, 0.9], [7, 8.6, 2.4], [0.4, 8.6, 0.9]], k: 6 },
  { name: 'Office floor', icon: '💼', W: 18, H: 10, Z: 3,
    rooms: [['desk', 'Open desks', 0, 0, 12, 10], ['meet', 'Meeting room', 12, 0, 18, 5], ['srv', 'Server room', 12, 5, 18, 10]],
    walls: [...W2(12, 0, 12, 10, [3.8, 5.0]), ...W2(12, 5, 18, 5, [14.4, 15.6]), ...W2(12, 5, 12, 10, [7, 8.2])].filter((w, i, a) => true),
    beacons: [[0.4, 0.4, 2.6], [6, 9.6, 0.9], [11.6, 0.4, 2.6], [17.6, 0.4, 0.9], [17.6, 9.6, 2.6], [0.4, 9.6, 0.9]], k: 5 },
  { name: 'Home 2BHK', icon: '🏠', W: 10, H: 8, Z: 2.8,
    rooms: [['liv', 'Living room', 0, 0, 6, 5], ['bed1', 'Bedroom 1', 6, 0, 10, 4], ['bed2', 'Bedroom 2', 6, 4, 10, 8], ['kit', 'Kitchen', 0, 5, 6, 8]],
    walls: [...W2(6, 0, 6, 8, [1.6, 2.6]), ...W2(6, 4, 10, 4), ...W2(0, 5, 6, 5, [2.5, 3.5])],
    beacons: [[0.4, 0.4, 2.3], [5.6, 4.6, 0.9], [9.6, 0.4, 2.3], [9.6, 7.6, 0.9], [0.4, 7.6, 2.3], [3, 0.4, 0.9]], k: 4 },
];
/* the office's x = 12 wall is drawn once with two doors */
BP_EXAMPLES[1].walls = [[12, 0, 12, 3.8], [12, 5, 12, 7], [12, 8.2, 12, 10], ...W2(12, 5, 18, 5, [14.4, 15.6])];
const BP_SITES = [{ name: 'Hospital floor', icon: '🏥', site: 'hospital', note: '40 × 24 m, 9 rooms, the map the ML was trained on' }, { name: 'Warehouse', icon: '📦', site: 'warehouse', note: '40 × 24 m, 3 aisles with shelves' }];
function exampleLayout(e) {
  return { v: 1, name: e.name, icon: e.icon, space: 'room', W: e.W, H: e.H, Z: e.Z, walls: e.walls.map(w => w.slice()), rooms: e.rooms.map(r => ({ id: r[0], name: r[1], r: r.slice(2) })),
    slots: e.beacons.map((b, i) => ({ x: b[0], y: b[1], z: b[2], on: i < e.k, p1: null, n: null, cal: null })) };
}
const LS2 = (v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(LAY_KEY)); localStorage.setItem(LAY_KEY, JSON.stringify(v)); } catch (e) { } return null; };
function layoutStore() { let L = LS2(); if (!L || typeof L !== 'object') { L = {}; BP_EXAMPLES.forEach(e => L[e.name] = exampleLayout(e)); LS2(L); } return L; }
/* the current setup as a layout */
function snapshotLayout(name) {
  const site = S.space !== 'room';
  return { v: 1, name, icon: site ? (BP_SITES.find(b => b.site === S.space) || {}).icon : '📐', space: S.space, W: S.W, H: S.H, Z: S.Z, walls: site ? [] : S.plan.walls.map(w => w.map(v => +v.toFixed(2))), rooms: site ? [] : S.plan.rooms.map(r => ({ id: r.id, name: r.name, r: r.r.map(v => +v.toFixed(2)) })),
    slots: S.all.map(a => ({ x: +a.x.toFixed(2), y: +a.y.toFixed(2), z: +a.z.toFixed(2), on: a.on, p1: a.p1, n: a.n, cal: a.cal })) };
}
function applyLayout(L) {
  if (!L || !Array.isArray(L.slots)) throw new Error('not a LOCUS layout');
  const num = (v, lo, hi, d) => isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, +v)) : d;
  if (S.mode === 'live' && L.space !== 'room') throw new Error('real phones need a room layout; switch the source to Demo to open a site');
  if (L.space === 'hospital' || L.space === 'warehouse') { setSpace(L.space); }
  else {
    S.plan = { walls: (L.walls || []).filter(w => w.length === 4 && w.every(isFinite)).map(w => w.map(Number)), rooms: (L.rooms || []).filter(r => r && r.name && r.r && r.r.length === 4).map((r, i) => ({ id: String(r.id || 'z' + i), name: String(r.name).slice(0, 30), r: r.r.map(Number) })) };
    S.roomW = num(L.W, 2, 40, 5); S.roomH = num(L.H, 2, 24, 4); $('i-Z').value = num(L.Z, 2, 8, 2.7); setSpace('room');
  }
  S.all = Array.from({ length: 6 }, (_, i) => { const q = L.slots[i] || {}, a = S.all[i] || {}; return { ...a, id: 'A' + (i + 1), b: i + 1, x: num(q.x, 0, S.W, a.x), y: num(q.y, 0, S.H, a.y), z: num(q.z, 0, S.Z, a.z), on: q.on != null ? !!q.on : a.on, p1: q.p1 != null ? +q.p1 : null, n: q.n != null ? +q.n : null, cal: Array.isArray(q.cal) ? q.cal : null, mv: false }; });
  if (!S.all.some(a => a.on)) S.all[0].on = true;
  S.k = S.all.filter(a => a.on).length; rebuild(true); buildTable(); renderAnchors(); spaceNote(); S.layName = L.name || null; renderLayouts(); Phone.cfgChanged();
}
function renderLayouts() {
  const L = layoutStore(), cur = S.layName;
  $('bp-list').innerHTML = BP_SITES.map(b => `<button class="bp${cur === b.name ? ' on' : ''}" data-site="${b.site}"><i>${b.icon}</i><b>${b.name}</b><span>${b.note}</span><em>built in</em></button>`).join('') +
    Object.keys(L).map(k => `<button class="bp${cur === k ? ' on' : ''}" data-name="${escH(k)}"><i>${L[k].icon || '📐'}</i><b>${escH(k)}</b><span>${L[k].space === 'room' ? L[k].W + ' × ' + L[k].H + ' m · ' + (L[k].rooms || []).length + ' zones · ' + (L[k].walls || []).length + ' walls' : L[k].space}</span><em>editable</em></button>`).join('');
  $('l-name').placeholder = 'Name, e.g. ' + (S.space === 'room' ? 'Ward 7 night shift' : 'My ' + S.space);
}
const escH = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
function lnote(t, bad) { $('l-note').textContent = t; $('l-note').style.color = bad ? '#b13a3a' : ''; }

/* ---------- floor-plan editing (My room / editable blueprints): walls and zones, by tapping the floor in the view ---------- */
const ED = { mode: null, p: null, hover: null };
function editTap(u) {
  if (!ED.mode || S.space !== 'room') return false;
  const snap = v => Math.round(v * 10) / 10, p = [snap(u[0]), snap(u[1])];
  if (ED.mode === 'erase') {
    let best = -1, bd = 0.6; S.plan.walls.forEach((w, i) => { const d = segDist(p, w); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) { S.plan.walls.splice(best, 1); planChanged('Wall removed.'); } else lnote('Tap closer to a wall to erase it.'); return true;
  }
  if (!ED.p) { ED.p = p; lnote(ED.mode === 'wall' ? 'Now tap where the wall ends.' : 'Now tap the opposite corner of the zone.'); return true; }
  const a = ED.p; ED.p = null;
  if (ED.mode === 'wall') {
    let q = p; if (Math.abs(p[0] - a[0]) < Math.abs(p[1] - a[1]) * 0.3) q = [a[0], p[1]]; else if (Math.abs(p[1] - a[1]) < Math.abs(p[0] - a[0]) * 0.3) q = [p[0], a[1]];   /* nearly straight -> straight */
    if (Math.hypot(q[0] - a[0], q[1] - a[1]) < 0.3) { lnote('Too short. Tap two points further apart.', 1); return true; }
    S.plan.walls.push([a[0], a[1], q[0], q[1]]); planChanged('Wall added (' + Math.hypot(q[0] - a[0], q[1] - a[1]).toFixed(1) + ' m). Tap again for another, or Done.');
  } else {
    const nm = ($('z-name').value || '').trim().slice(0, 30) || 'Zone ' + (S.plan.rooms.length + 1), r = [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[0], p[0]), Math.max(a[1], p[1])];
    if (r[2] - r[0] < 0.5 || r[3] - r[1] < 0.5) { lnote('Zone too small.', 1); return true; }
    S.plan.rooms.unshift({ id: 'z' + Date.now() % 1e6, name: nm, r }); $('z-name').value = ''; planChanged('Zone "' + nm + '" added. ISHA and alerts now use it.');
  }
  return true;
}
function segDist(p, w) { const dx = w[2] - w[0], dy = w[3] - w[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((p[0] - w[0]) * dx + (p[1] - w[1]) * dy) / L)) : 0; return Math.hypot(p[0] - w[0] - t * dx, p[1] - w[1] - t * dy); }
function planChanged(msg) { S.route = null; setRoom(S.W, S.H, S.anchors, partitions(), S.plan.rooms.length ? S.plan.rooms : null); newEngine(); S.assets = new AssetSim(S.space, S.W, S.H, 77); save(); Phone.cfgChanged(); renderPlan(); if (msg) lnote(msg); }
function setEdit(m) { ED.mode = ED.mode === m ? null : m; ED.p = null; document.querySelectorAll('#ed-tools [data-ed]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ed === ED.mode))); if (ED.mode) { setView('top'); lnote(ED.mode === 'wall' ? 'Tap where the wall starts on the floor.' : ED.mode === 'zone' ? 'Type the zone name, then tap two opposite corners.' : 'Tap a wall to erase it.'); } else lnote('Editing off.'); }
function renderPlan() {
  const room = S.space === 'room'; $('ed-box').style.display = room ? 'flex' : 'none';
  if (!room) return; $('z-list').innerHTML = S.plan.rooms.map((r, i) => `<span class="zchip">${escH(r.name)} <button data-z="${i}" aria-label="Remove ${escH(r.name)}">×</button></span>`).join('') || '<span class="note">No zones yet: the room is split into four beds.</span>';
  $('ed-sum').textContent = S.W + ' × ' + S.H + ' m · ' + S.plan.walls.length + ' walls · ' + S.plan.rooms.length + ' zones';
}
function drawEdit() {
  if (!ED.p || S.space !== 'room') return; const p = P(ED.p[0], ED.p[1], 0); g.beginPath(); g.arc(p[0], p[1], 7, 0, 7); g.fillStyle = '#F5A524'; g.fill();
}
function bindLayouts() {
  $('bp-list').onclick = e => {
    const b = e.target.closest('.bp'); if (!b) return;
    try { if (b.dataset.site) { applyLayout({ name: b.querySelector('b').textContent, space: b.dataset.site, slots: [] }); lnote('Opened ' + b.querySelector('b').textContent + '. Move beacons in the view, then Save as… to keep your version.'); }
      else { const L = layoutStore()[b.dataset.name]; applyLayout(L); $('l-name').value = b.dataset.name; lnote('Opened "' + b.dataset.name + '". Edit walls, zones and beacons in the Space tab, then Save.'); } }
    catch (x) { lnote('Could not open: ' + x.message, 1); }
  };
  $('l-save').onclick = () => { const nm = ($('l-name').value || '').trim().slice(0, 40) || S.layName; if (!nm) { lnote('Type a name first.', 1); return; } if (BP_SITES.some(b => b.name === nm)) { lnote('That name is a built-in blueprint. Pick another name.', 1); return; } const L = layoutStore(); L[nm] = snapshotLayout(nm); LS2(L); S.layName = nm; $('l-name').value = nm; renderLayouts(); lnote('Saved "' + nm + '" in this browser.'); };
  $('l-del').onclick = () => { const nm = S.layName, L = layoutStore(); if (!nm || !L[nm]) { lnote('Open one of your editable layouts first.', 1); return; } delete L[nm]; LS2(L); S.layName = null; renderLayouts(); lnote('Deleted "' + nm + '".'); };
  $('l-reset').onclick = () => { const L = layoutStore(); BP_EXAMPLES.forEach(e => L[e.name] = exampleLayout(e)); LS2(L); renderLayouts(); lnote('The three example blueprints are back to their original versions.'); };
  $('l-exp').onclick = () => { const L = snapshotLayout(S.layName || 'LOCUS layout'), a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(L, null, 1)], { type: 'application/json' })); a.download = (L.name || 'locus_layout').replace(/[^\w-]+/g, '_') + '.json'; a.click(); };
  $('l-imp').onclick = () => $('l-file').click();
  $('l-file').onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { const L = JSON.parse(r.result), nm = (L.name || f.name.replace(/\.json$/, '')).slice(0, 40), st = layoutStore(); L.name = nm; st[nm] = L; LS2(st); applyLayout(L); lnote('Imported "' + nm + '".'); } catch (x) { lnote('Could not import: ' + x.message, 1); } }; r.readAsText(f); e.target.value = ''; };
  document.querySelectorAll('#ed-tools [data-ed]').forEach(b => b.onclick = () => setEdit(b.dataset.ed));
  $('ed-clear').onclick = () => { S.plan = { walls: [], rooms: [] }; planChanged('Walls and zones cleared.'); };
  $('z-list').onclick = e => { const b = e.target.closest('button[data-z]'); if (b) { S.plan.rooms.splice(+b.dataset.z, 1); planChanged('Zone removed.'); } };
  renderLayouts(); renderPlan();
}
