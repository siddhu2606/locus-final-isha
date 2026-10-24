/* ===== LOCUS Moving Beacons: estimator. Needs Locus + rngMake + setRoom (engine.js). Pure, no DOM.
   1. The existing LOCUS particle filter runs on every reading, with each beacon's BELIEVED position and its uncertainty
      (Locus.moveAnchor). Its trust scores and dead-beacon handling are unchanged.
   2. Every usable reading goes into a sliding window {time, beacon position at that time, range, trust}. A moving beacon
      therefore contributes readings from several positions.
   3. Final estimate: weighted least squares over the window, started from (and regularised by) the particle filter.
        weight = trust^2 / (sigma^2 + beaconSd^2 + (objSpeedSd * age)^2)
      Old readings are shifted by how far the particle filter says the object moved since (motion compensation),
      and get less weight with age. Huber down-weighting caps any single bad reading. ===== */
class MovingEstimator {
  constructor(cfg, seed = 11) { setRoom(cfg.room.w, cfg.room.h, []); this.cfg = cfg; this.seed = seed; this.ids = ''; this.anchors = []; this.win = []; this.track = []; this.loc = null; this.out = null; }
  _rebuild(ids, bel) {
    const E = this.cfg.estimator, old = this.loc;
    this.anchors = ids.map(id => ({ id, x: bel[id].x, y: bel[id].y, sd: bel[id].sd }));
    this.loc = new Locus(this.anchors, { N: E.N, sigma: E.sigma, rng: rngMake(this.seed), inflate: 1 });
    if (old && old.inited) {   /* keep the particle cloud when a beacon is added / removed */
      this.loc.px.set(old.px); this.loc.py.set(old.py); this.loc.vx.set(old.vx); this.loc.vy.set(old.vy); this.loc.w.set(old.w); this.loc.inited = true;
      const ot = {}; old.anchors.forEach((a, i) => ot[a.id] = old.trust[i]); this.loc.trust = ids.map(id => ot[id] != null ? ot[id] : 0.8);
    }
    this.ids = ids.join();
  }
  /* t: time (s); ranges: {id: metres | null}; bel: {id: {x, y, sd}}; dt: seconds since last call */
  step(t, ranges, bel, dt) {
    const E = this.cfg.estimator, ids = Object.keys(bel);
    if (ids.join() !== this.ids) this._rebuild(ids, bel);
    this.anchors.forEach((a, i) => this.loc.moveAnchor(i, bel[a.id].x, bel[a.id].y, bel[a.id].sd));
    const meas = this.anchors.map(a => ranges[a.id] == null ? null : { r: ranges[a.id] });
    const o = this.loc.step(meas, dt); if (!o) return this.out = null;
    this.track.push({ t, p: o.pos.slice() }); while (this.track.length && t - this.track[0].t > E.windowSec + 1) this.track.shift();
    this.anchors.forEach((a, i) => { if (meas[i] && o.usable[i]) this.win.push({ t, id: a.id, x: a.x, y: a.y, sd: a.sd || 0, r: meas[i].r, trust: o.trust[i], pf: o.pos.slice() }); });
    this.win = this.win.filter(q => t - q.t <= E.windowSec + 1e-9 && bel[q.id]); if (this.win.length > E.maxReadings) this.win = this.win.slice(-E.maxReadings);
    const ref = this._wls(t, o);
    return this.out = { ...o, pf: o.pos.slice(), pos: ref.pos, ell: ref.ell, window: this.win.length, perBeacon: ids.reduce((m, id) => (m[id] = this.win.filter(q => q.id === id).length, m), {}), ids: this.anchors.map(a => a.id) };
  }
  _wls(t, o) {
    const E = this.cfg.estimator, sg2 = E.sigma * E.sigma, mo = this.loc._moments();
    /* prior from the particle filter (its covariance, floored) */
    const ps = E.priorScale, pc = [Math.max(0.05, mo.sxx) * ps, mo.sxy * ps, Math.max(0.05, mo.syy) * ps], pd = pc[0] * pc[2] - pc[1] * pc[1], pi = [pc[2] / pd, -pc[1] / pd, pc[0] / pd];
    const rd = this.win.map(q => [q.x, q.y, q.r, q.trust * q.trust / (sg2 + q.sd * q.sd + Math.pow(E.objSpeedSd * (t - q.t), 2)), E.motionComp ? o.pos[0] - q.pf[0] : 0, E.motionComp ? o.pos[1] - q.pf[1] : 0]);
    let x = o.pos[0], y = o.pos[1], H = null;
    for (let it = 0; it < 8; it++) {
      let a11 = pi[0], a12 = pi[1], a22 = pi[2], b1 = -(pi[0] * (x - o.pos[0]) + pi[1] * (y - o.pos[1])), b2 = -(pi[1] * (x - o.pos[0]) + pi[2] * (y - o.pos[1]));
      for (const [bx, by, r, w0, sx, sy] of rd) {
        const px = x - sx, py = y - sy, dx = px - bx, dy = py - by, d = Math.max(0.2, Math.hypot(dx, dy)), ux = dx / d, uy = dy / d, res = r - d, z = Math.abs(res) * Math.sqrt(w0), w = w0 * (z > E.huber ? E.huber / z : 1);
        a11 += w * ux * ux; a12 += w * ux * uy; a22 += w * uy * uy; b1 += w * ux * res; b2 += w * uy * res;
      }
      const det = a11 * a22 - a12 * a12; if (!(det > 1e-12)) break;
      const ddx = (a22 * b1 - a12 * b2) / det, ddy = (a11 * b2 - a12 * b1) / det; x += ddx; y += ddy; H = [a11, a12, a22];
      if (Math.hypot(ddx, ddy) < 1e-3) break;
    }
    const R = this.cfg.room; x = Math.min(R.w, Math.max(0, x)); y = Math.min(R.h, Math.max(0, y));
    if (!H) return { pos: o.pos.slice(), ell: o.ell };
    /* covariance = H^-1; 90% ellipse (chi2 2 dof = 4.605) */
    const det = H[0] * H[2] - H[1] * H[1], cxx = H[2] / det, cyy = H[0] / det, cxy = -H[1] / det, tr = cxx + cyy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - (cxx * cyy - cxy * cxy)));
    const l1 = tr / 2 + disc, l2 = Math.max(1e-4, tr / 2 - disc);
    return { pos: [x, y], ell: { a: Math.max(0.2, Math.sqrt(4.605 * l1)), b: Math.max(0.15, Math.sqrt(4.605 * l2)), th: 0.5 * Math.atan2(2 * cxy, cxx - cyy) } };
  }
}
if (typeof module !== 'undefined') module.exports = { MovingEstimator };
