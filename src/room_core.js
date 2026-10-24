/* ===== LOCUS Room Live core: 3D radio model, 3D height solver, phone-motion (PDR) maths. Pure functions, no DOM. ===== */

/* ---- 3D radio simulator --------------------------------------------------------------------
   truth = [x, y] on the floor plan, zDev = device height (m); anchors = [{id,x,y,z}].
   model 'add'  : range = d3 + bias + sigma*N(0,1)           (same noise family the trained dataset used)
   model 'rssi' : RSSI = rssi1m - 10 n log10(d3) - extraDb + sigmaDb*N(0,1), rounded to 1 dB like a real radio,
                  then inverted back to a range with the (possibly mis-calibrated) rssi1m / n the receiver assumes.
   The engine is 2D, so the 3D range is projected onto the floor using the ASSUMED height difference
   (assumedZ): r_h = sqrt(r3^2 - (anchor.z - assumedZ)^2).  A wrong assumed height therefore costs accuracy - by design.  */
function measure3D(truth, zDev, assumedZ, anchors, cfg, rng, wallsBetween) {
  return anchors.map(a => {
    if (cfg.dead && cfg.dead.has(a.id)) return null;
    if (rng() < cfg.loss) return null;
    const dx = truth[0] - a.x, dy = truth[1] - a.y, dz = (a.z || 0) - zDev, d3 = Math.max(0.05, Math.hypot(dx, dy, dz));
    const k = wallsBetween(a.x, a.y, truth[0], truth[1]);
    let nlos = k > 0, rssi = null, r3;
    if (cfg.model === 'rssi') {
      let loss = k * cfg.wallDb * (0.6 + 0.8 * rng());
      if (cfg.obstruct && cfg.obstruct.has(a.id)) { loss += cfg.obstructDb * (0.7 + 0.6 * rng()); nlos = true; }
      if (cfg.drift && cfg.drift.has(a.id)) { loss += cfg.driftDb; nlos = true; }
      if (cfg.burst) { const st = rng._b || (rng._b = {}); if (!st[a.id] && rng() < cfg.burst) st[a.id] = 20 + (rng() * 30 | 0); if (st[a.id] > 0) { st[a.id]--; loss += 9; nlos = true; } }
      rssi = Math.round(cfg.rssi1m - 10 * cfg.n * Math.log10(d3) - loss + cfg.sigmaDb * (nlos ? 1.4 : 1) * rng.g());
      r3 = Math.max(0.05, Math.pow(10, (cfg.rssi1m - rssi) / (10 * cfg.n)));
    } else {
      let bias = k * cfg.wallBias * (0.5 + rng());
      if (cfg.obstruct && cfg.obstruct.has(a.id)) { bias += cfg.obstructBias * (0.6 + 0.8 * rng()); nlos = true; }
      if (cfg.drift && cfg.drift.has(a.id)) { bias += cfg.driftBias; nlos = true; }
      if (cfg.burst) { const st = rng._b || (rng._b = {}); if (!st[a.id] && rng() < cfg.burst) st[a.id] = 20 + (rng() * 30 | 0); if (st[a.id] > 0) { st[a.id]--; bias += 3.2; nlos = true; } }
      r3 = Math.max(0.05, d3 + bias + cfg.sigma * (nlos ? 1.8 : 1) * rng.g());
      rssi = Math.round(cfg.rssi1m - 10 * cfg.n * Math.log10(r3));   /* what the radio would have reported */
    }
    const dzA = (a.z || 0) - assumedZ, rh = Math.sqrt(Math.max(0.0025, r3 * r3 - dzA * dzA));
    return { r: rh, r3, rssi, nlos, d3 };
  });
}

/* ---- 3D position + height from the trust-weighted ranges (needs >= 4 usable anchors at different heights) ---- */
function fix3D(anchors, meas, init, w, bounds, z0, sigma) {
  let x = init[0], y = init[1], z = init[2] == null ? z0 : init[2], n = 0, zs = [], lastJ = null;
  anchors.forEach((a, i) => { if (meas[i] && (w ? w[i] > 0.05 : true)) zs.push(a.z || 0); });
  if (zs.length < 4 || Math.max(...zs) - Math.min(...zs) < 0.6) return null;      /* height is unobservable with coplanar anchors */
  for (let it = 0; it < 15; it++) {
    const J = [[1e-3, 0, 0], [0, 1e-3, 0], [0, 0, 1e-3]], b = [0, 0, 0]; n = 0;
    for (let i = 0; i < anchors.length; i++) {
      const m = meas[i]; if (!m || (w && w[i] <= 0.05)) continue; n++;
      const dx = x - anchors[i].x, dy = y - anchors[i].y, dz = z - (anchors[i].z || 0), d = Math.max(0.2, Math.hypot(dx, dy, dz)), u = [dx / d, dy / d, dz / d], res = m.r3 - d, wt = w ? w[i] : 1;
      for (let p = 0; p < 3; p++) { b[p] += wt * u[p] * res; for (let q = 0; q < 3; q++) J[p][q] += wt * u[p] * u[q]; }
    }
    if (n < 4) return null;
    J[2][2] += 0.15; b[2] += 0.15 * (z0 - z);                                       /* weak prior: people hold phones around chest height */
    for (let p = 0; p < 3; p++) J[p][p] += 0.05;
    lastJ = J.map(r => r.slice());
    const s = solve3(J, b); if (!s) return null;
    x += s[0]; y += s[1]; z += s[2];
    x = Math.min(bounds.w, Math.max(0, x)); y = Math.min(bounds.h, Math.max(0, y)); z = Math.min(bounds.z, Math.max(0, z));
  }
  /* 1-sigma height uncertainty = sigma * sqrt((J^-1)_zz); large when anchors are far / at similar heights */
  let zstd = 9; const inv = lastJ && solve3(lastJ, [0, 0, 1]); if (inv && inv[2] > 0) zstd = (sigma || 0.5) * Math.sqrt(inv[2]);
  return [x, y, z, zstd];
}
function solve3(A, b) {
  const M = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < 3; c++) {
    let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null; [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 3; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k]; }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

/* ---- phone orientation -> compass heading (deg clockwise from north) of the direction the person walks ----
   W3C rotation R = Rz(alpha) Rx(beta) Ry(gamma); earth frame x=east y=north z=up.
   Phone held flat / in front of the chest (beta small): forward = top edge (device +y).
   Phone held upright (beta > ~55 deg, camera pointing ahead): forward = -z (back camera).                            */
function headingFromEuler(alpha, beta, gamma) {
  const r = Math.PI / 180, cA = Math.cos(alpha * r), sA = Math.sin(alpha * r), cB = Math.cos(beta * r), sB = Math.sin(beta * r), cG = Math.cos(gamma * r), sG = Math.sin(gamma * r);
  let E, N;
  if (Math.abs(beta) > 55) { E = -(cA * sG + sA * sB * cG); N = -(sA * sG - cA * sB * cG); }
  else { E = -sA * cB; N = cA * cB; }
  return (Math.atan2(E, N) / r + 360) % 360;
}
const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
class HeadingFilter {                                    /* circular low-pass */
  constructor(k = 0.25) { this.k = k; this.h = null; }
  push(h) { this.h = this.h == null ? h : (this.h + this.k * angDiff(h, this.h) + 360) % 360; return this.h; }
}

/* ---- pedestrian dead reckoning: step detection from the accelerometer ----
   Works at any sample rate (time-based filters) and any carrying style: gravity is removed with a ~0.8 s low-pass, the dynamic part is smoothed
   (~45 ms), and a step is a local peak above an ADAPTIVE threshold (0.8 x running RMS, floor 0.35 m/s^2 / sensitivity) at least 280 ms after the last one.
   ax,ay,az in m/s^2 (with or without gravity), t in ms. Returns true on a step.                                                                 */
class StepDetector {
  constructor(minGapMs = 280) { this.g = null; this.s = 0; this.p1 = 0; this.p2 = 0; this.pw = 0.4; this.tp = null; this.last = -1e9; this.minGap = minGapMs; this.count = 0; this.sens = 1; this.mag = 0; this.thr = 0; }
  push(ax, ay, az, t) {
    const mag = Math.sqrt(ax * ax + ay * ay + az * az); this.mag = mag;
    const dt = this.tp == null ? 16 : Math.min(120, Math.max(3, t - this.tp)); this.tp = t;
    if (this.g == null) this.g = mag;
    this.g += (1 - Math.exp(-dt / 800)) * (mag - this.g);
    this.s += (1 - Math.exp(-dt / 45)) * ((mag - this.g) - this.s);
    this.pw += (1 - Math.exp(-dt / 1500)) * (this.s * this.s - this.pw);
    const cur = this.s, p1 = this.p1, p2 = this.p2; this.p2 = this.p1; this.p1 = cur;
    this.thr = Math.max(0.35 / this.sens, 0.8 / this.sens * Math.sqrt(this.pw));
    if (p1 > this.thr && p1 >= p2 && p1 > cur && t - this.last > this.minGap) { this.last = t; this.count++; return true; }
    return false;
  }
}

/* ---- dead-reckoning position with wall sliding ---- */
class Walker2 {
  constructor(bounds, crossesWall) { this.b = bounds; this.cw = crossesWall; this.pos = [bounds.w / 2, bounds.h / 2]; this.trail = []; }
  move(dx, dy) {
    const [x, y] = this.pos, m = 0.12; let nx = Math.min(this.b.w - m, Math.max(m, x + dx)), ny = Math.min(this.b.h - m, Math.max(m, y + dy));
    if (this.cw(x, y, nx, ny)) { if (!this.cw(x, y, nx, y)) ny = y; else if (!this.cw(x, y, x, ny)) nx = x; else { nx = x; ny = y; } }
    this.pos = [nx, ny]; return this.pos;
  }
  /* compass heading h (deg cw from north) with alignment offset; map up (-y) is "north" of the room */
  step(len, h, off) { const a = (h - off) * Math.PI / 180; return this.move(len * Math.sin(a), -len * Math.cos(a)); }
}

/* ---- GPS (geolocation) -> local metres, for big rooms / outdoors ---- */
function gpsToLocal(lat, lon, lat0, lon0) { return [(lon - lon0) * 111320 * Math.cos(lat0 * Math.PI / 180), (lat - lat0) * 110540]; }   /* [east, north] */

/* ---- 3D <-> screen projection (orthographic). tilt: 90 = top-down, 0 = side-on. yaw: deg about vertical ---- */
function makeView(v) {
  const e = v.tilt * Math.PI / 180, y = v.yaw * Math.PI / 180, ce = Math.cos(e), se = Math.sin(e), cy = Math.cos(y), sy = Math.sin(y);
  return {
    P(x, yy, z) { const dx = x - v.cx, dy = yy - v.cy, xr = dx * cy - dy * sy, yr = dx * sy + dy * cy; return [v.ox + xr * v.s, v.oy + (yr * se - (z - v.cz) * ce) * v.s, yr * ce + (z - v.cz) * se]; },
    /* screen -> world point lying on the horizontal plane z */
    U(sx, sy_, z) { const xr = (sx - v.ox) / v.s, vv = (sy_ - v.oy) / v.s + (z - v.cz) * ce, yr = vv / Math.max(se, 0.05), dx = xr * cy + yr * sy, dy = -xr * sy + yr * cy; return [v.cx + dx, v.cy + dy]; },
  };
}

if (typeof module !== 'undefined') module.exports = { measure3D, fix3D, headingFromEuler, angDiff, HeadingFilter, StepDetector, Walker2, gpsToLocal, makeView };
