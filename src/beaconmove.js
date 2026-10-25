/* ===== LOCUS beacon motion: works out where a CARRIED beacon phone is now, from what the beacon phones themselves sense.
   Every beacon phone (like LOCUS Trio) also listens to the other beacons and reads its own motion sensors, and puts it all
   into its Bluetooth packet:  moving yes/no, step count, compass heading, and the RSSI it hears from each other beacon.
   For a beacon that is moving (and for 8 s after it stops, averaging):
     1. steps x step length along its compass heading predict where it went (dead reckoning)
     2. distances to the beacons that are still (RSSI between beacon phones) correct it, Trio-style
   The beacon-to-beacon radio model fits itself from the still beacons, whose distances are known.
   The compass only seeds the guess (phones' compasses are often 10-20 deg off); the distances decide.
   Shared by the dashboard and the phone app. Pure logic, no DOM. ===== */
class BeaconMover {
  constructor(opts) {
    opts = opts || {}; this.stepLen = opts.stepLen || 0.65; this.mapUp = opts.mapUp || 0;   /* compass bearing the map's "up" faces */
    this.T = {}; this.R = {}; this.link = { p1: -62, n: 2.2, pairs: 0 }; this.last = {}; this.wallDb = opts.wallDb || 6;
  }
  reset() { this.T = {}; this.R = {}; this.last = {}; this.link = { p1: -62, n: 2.2, pairs: 0 }; }
  st(b) { return this.T[b] || (this.T[b] = { moving: false, lastMove: -1e9, steps: null, pend: 0, head: null, heads: [], off: null, seg: null, t: -1e9 }); }
  /* one telemetry report from beacon b: {moving, steps (0-255, wraps), head (deg or null), peers: {otherBeacon: rssi}} at time t (s) */
  tele(b, t, m) {
    const s = this.st(b); s.t = t;
    if (m.moving) { if (!s.moving) s.seg = { start: null, pdr: 0, heads: [] }; s.lastMove = t; }
    s.moving = !!m.moving;
    if (m.steps != null) { if (s.steps != null) { const d = (m.steps - s.steps + 256) % 256; if (d > 0 && d <= 6 && s.moving) s.pend += d; } s.steps = m.steps; }   /* only steps taken while carried count; a burst > 6 between reports is a glitch */
    if (m.head != null) { s.head = m.head; if (s.seg && s.moving) s.seg.heads.push(m.head); }
    Object.keys(m.peers || {}).forEach(j => { const v = m.peers[j]; if (!v) return; const k = b + '>' + j, o = this.R[k]; this.R[k] = { v: o && t - o.t < 4 ? o.v + (s.moving ? 0.6 : 0.3) * (v - o.v) : v, t }; });
  }
  pair(i, j, t) { const a = this.R[i + '>' + j], b = this.R[j + '>' + i], ok = r => r && t - r.t < 4; return ok(a) && ok(b) ? (a.v + b.v) / 2 : ok(a) ? a.v : ok(b) ? b.v : null; }
  active(b, t) { const s = this.T[b]; return !!s && (s.moving || t - s.lastMove < 8); }
  /* beacon-to-beacon distance from the link model fitted on the still beacons. Known walls on the floor plan are added back
     (wallDb each, like the engine's own wall model), and the 3-D distance becomes a floor distance with the height difference. */
  range(i, j, t, dz, walls) { const r = this.pair(i, j, t); if (r == null) return null; const d3 = rangeFrom(r + this.wallDb * (walls || 0), this.link.p1, this.link.n, 60); return Math.sqrt(Math.max(0.01, d3 * d3 - dz * dz)); }
  /* anchors: [{b, x, y, z}] with their current (believed) positions; wallsBetween(x1, y1, x2, y2) from the floor plan (optional).
     Returns [{b, x, y, sd, why}] for every beacon whose position changed. */
  /* extra(b): more fixed references for beacon b, e.g. the receiver standing still at a known spot with its range to b: [{x, y, r, b}] */
  step(anchors, t, W, H, wallsBetween, extra) {
    const wb = wallsBetween || (() => 0), still = anchors.filter(a => !this.active(a.b, t)), out = [], dt = this.lastT == null ? 0.1 : Math.min(1, t - this.lastT); this.lastT = t;
    /* pairs between still beacons at known distances (wall loss removed first) */
    const pts = []; for (let i = 0; i < still.length; i++) for (let j = i + 1; j < still.length; j++) { const A = still[i], B = still[j], r = this.pair(A.b, B.b, t); if (r != null) pts.push({ a: A.b, b: B.b, d: Math.max(0.2, Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z)), rssi: r + this.wallDb * wb(A.x, A.y, B.x, B.y) }); }
    /* consistency check: a beacon whose readings to ALL the others disagree with where we think it is has probably been moved
       (without its motion sensor noticing). It is left out of the calibration and becomes the suspect. */
    this.suspect = null;
    if (pts.length >= 3 && still.length >= 3) {
      const bad = {}; still.forEach(o => { const mine = pts.filter(q => q.a === o.b || q.b === o.b); if (mine.length >= 2) bad[o.b] = mine.reduce((s, q) => s + Math.abs(q.rssi - (this.link.p1 - 10 * this.link.n * Math.log10(q.d))), 0) / mine.length; });
      const ks = Object.keys(bad).sort((x, y) => bad[y] - bad[x]); if (ks.length >= 3) { const top = bad[ks[0]], rest = ks.slice(1).map(k => bad[k]).sort((x, y) => x - y), med = rest[rest.length >> 1]; if (top > 3.5 && top > 2 * med + 1) this.suspect = +ks[0]; }
    }
    const fitPts = this.suspect == null ? pts : pts.filter(q => q.a !== this.suspect && q.b !== this.suspect);
    if (fitPts.length) {
      const ds = fitPts.map(q => q.d), wide = Math.max(...ds) / Math.min(...ds) >= 2.5, f = fitCal(fitPts, 2.2), n = wide ? Math.min(4, Math.max(1.6, f.n)) : 2.2, p1 = wide ? f.p1 : fitPts.reduce((q, r) => q + r.rssi + 22 * Math.log10(r.d), 0) / fitPts.length;
      const k = this.link.pairs ? 0.1 : 1; this.link = { p1: this.link.p1 + k * (p1 - this.link.p1), n: this.link.n + k * (n - this.link.n), pairs: fitPts.length };
    }
    anchors.forEach(a => {
      const s = this.st(a.b);
      if (!this.active(a.b, t)) {
        s.found = false; if (s.seg && s.seg.start) this._endSeg(a, s);
        /* moved without its motion sensor noticing (slid, carried smoothly, old app): its distances keep saying it is elsewhere -> treat it as moving */
        const refs = still.filter(o => o.b !== a.b && o.b !== this.suspect).map(o => ({ x: o.x, y: o.y, b: o.b, r: this.range(a.b, o.b, t, a.z - o.z, wb(a.x, a.y, o.x, o.y)) })).filter(q => q.r != null).concat(extra ? extra(a.b) : []);
        if (refs.length >= 2 && (this.suspect === a.b || refs.length >= 3)) { const f = BeaconMover.solve([a.x, a.y], refs, 0.02, W, H), mr = refs.reduce((q, r) => q + r.r, 0) / refs.length, off = Math.hypot(f.p[0] - a.x, f.p[1] - a.y);
          s.drift = off > Math.max(1.0, (this.suspect === a.b ? 0.15 : 0.3) * mr) ? (s.drift || 0) + dt : Math.max(0, (s.drift || 0) - dt); if (s.drift > 2.5) { s.drift = 0; s.lastMove = t; s.found = true; } }
        return;
      }
      if (s.seg && !s.seg.start) s.seg.start = [a.x, a.y];
      let p = [a.x, a.y], why = [];
      const dr = s.head != null;   /* this phone has step + compass data */
      if (s.pend > 0 && dr) {   /* dead reckoning: north = up (-y) */
        const d = s.pend * this.stepLen, br = (s.head - this.mapUp) * Math.PI / 180; p = [p[0] + d * Math.sin(br), p[1] - d * Math.cos(br)]; if (s.seg) s.seg.pdr += d; why.push(s.pend + ' step' + (s.pend > 1 ? 's' : ''));
      }
      s.pend = 0;
      const all = still.filter(o => o.b !== a.b && o.b !== this.suspect).map(o => ({ x: o.x, y: o.y, b: o.b, r: this.range(a.b, o.b, t, a.z - o.z, wb(p[0], p[1], o.x, o.y)) })).filter(q => q.r != null).concat(extra ? extra(a.b) : []);
      /* gate: a distance far from what the steps predict is a bad reading (body, wall, reflection), not a jump */
      const gate = q => { const e = Math.hypot(p[0] - q.x, p[1] - q.y); return Math.abs(q.r - e) < Math.max(1.0, 0.35 * e); };
      let rs = dr ? all.filter(gate) : all;
      if (dr && all.length >= 3 && rs.length < all.length / 2) {   /* most distances disagree: if they agree with each other for 3 s, believe them */
        const f0 = BeaconMover.solve(p, all, 0.02, W, H), mr = all.reduce((q, r) => q + r.r, 0) / all.length;
        s.rej = f0.rms < 0.2 * mr + 0.4 ? (s.rej || 0) + dt : 0; if (s.rej > 3) { rs = all; p = f0.p; s.rej = 0; why.push('re-fixed'); }
      } else s.rej = 0;
      /* while walking, steps + compass lead and the (noisy) distances nudge; once it stops, the distances are averaged for 8 s */
      const sp = 0.25 + 0.08 * (s.seg ? s.seg.pdr : 0); let sd = sp;
      if (rs.length >= 2 || (rs.length === 1 && why.length)) {
        if (s.moving && dr) { const f = BeaconMover.solve(p, rs, 1 / (sp * sp), W, H); p = f.p; }
        else { const f = BeaconMover.solve([a.x, a.y], rs, 0.3, W, H), k = s.moving ? 0.3 : s.found ? 0.2 : 0.08; p = [a.x + k * (f.p[0] - a.x), a.y + k * (f.p[1] - a.y)]; sd = Math.max(0.3, f.rms * 0.5); }
        why.push('distances to ' + rs.map(q => q.b === 'R' ? 'the receiver' : 'B' + q.b).join(', '));
      }
      p = [Math.min(W - 0.05, Math.max(0.05, p[0])), Math.min(H - 0.05, Math.max(0.05, p[1]))];
      if (Math.hypot(p[0] - a.x, p[1] - a.y) > 0.03) { out.push({ b: a.b, x: p[0], y: p[1], sd, why: why.join(' + ') }); this.last[a.b] = { why: why.join(' + '), t }; }
    });
    return out;
  }
  _endSeg(a, s) { s.seg = null; }
  /* least squares on ranges [{x, y, r}] with a prior pull towards p0 (weight w0). Returns {p, rms} */
  static solve(p0, rs, w0, W, H) {
    let x = p0[0], y = p0[1];
    for (let it = 0; it < 10; it++) {
      let a11 = w0, a12 = 0, a22 = w0, b1 = w0 * (p0[0] - x), b2 = w0 * (p0[1] - y);
      rs.forEach(q => { const dx = x - q.x, dy = y - q.y, d = Math.max(0.1, Math.hypot(dx, dy)), ux = dx / d, uy = dy / d, res = q.r - d, w = 1 / Math.pow(Math.max(0.3, 0.3 * q.r), 2); a11 += w * ux * ux; a12 += w * ux * uy; a22 += w * uy * uy; b1 += w * ux * res; b2 += w * uy * res; });
      const det = a11 * a22 - a12 * a12; if (Math.abs(det) < 1e-9) break; x += (a22 * b1 - a12 * b2) / det; y += (a11 * b2 - a12 * b1) / det;
      x = Math.min(W, Math.max(0, x)); y = Math.min(H, Math.max(0, y));
    }
    const rms = Math.sqrt(rs.reduce((q, r) => q + Math.pow(Math.hypot(x - r.x, y - r.y) - r.r, 2), 0) / Math.max(1, rs.length));
    return { p: [x, y], rms };
  }
  /* what a beacon phone senses, simulated from its TRUE position (demo, and a linked phone in Simulation mode) */
  static simulate(sim, anchors, t, rng, dead, wallsBetween) {
    anchors.forEach(a => {
      const m = sim[a.b] || (sim[a.b] = { odo: 0, last: [a.tx, a.ty], comp: (a.b * 47) % 30 - 15 });   /* each phone's compass is off by up to 15 deg */
      const dx = a.tx - m.last[0], dy = a.ty - m.last[1], d = Math.hypot(dx, dy); m.odo += d; m.last = [a.tx, a.ty];
      if (d > 0.005) m.br = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
      m.moving = !!a.mv && !(a.pause > 0);
      const peers = {}; if (!dead.has(a.id)) anchors.forEach(o => { if (o === a || dead.has(o.id) || rng() < 0.1) return; const r = Math.max(0.1, Math.hypot(a.tx - o.tx, a.ty - o.ty, a.z - o.z)); peers[o.b] = Math.round(-62 - 22 * Math.log10(r) - 6 * wallsBetween(a.tx, a.ty, o.tx, o.ty) + 3 * rng.g()); });
      m.out = { moving: m.moving, steps: Math.floor(m.odo / 0.65) % 256, head: m.br == null ? null : (m.br + m.comp + 8 * rng.g() + 360) % 360, peers };
    });
  }
}
if (typeof module !== 'undefined') module.exports = { BeaconMover };
