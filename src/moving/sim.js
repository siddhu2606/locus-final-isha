/* ===== LOCUS Moving Beacons: simulator. Pure, no DOM. Needs rngMake (engine.js).
   Every beacon has TWO positions:
     truth    - where it physically is (simulation only; the radio is generated from it)
     believed - what the system is told: surveyed (fixed), self-reported with noise + drift (moving), or update_beacon_position()
   mode: 'fixed' | 'moving' (simulated waypoint walk) | 'external' (positions arrive from outside, e.g. a real phone) ===== */
function hashSeed(s) { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

/* multipath / shadowing bias of a link: a smooth random field of BOTH ends (Gaussian-like, sd shadowSd, correlation ~shadowCorr m).
   Same beacon + same object position -> same bias, so a fixed beacon next to a still object keeps the same error;
   moving either end changes it. One field per beacon id, independent of mode and seed of the motion. */
function makeShadow(id, seed, sd, corr) {
  const r = rngMake(hashSeed(id + ':' + seed)), K = 24, w = [];
  for (let k = 0; k < K; k++) { const kn = r.g() / corr, km = r.g() / corr, ka = r.g() / corr, kb = r.g() / corr; w.push([kn, km, ka, kb, r() * 2 * Math.PI]); }
  const a = sd * Math.sqrt(2 / K);
  return (b, o) => { let s = 0; for (const q of w) s += Math.cos(q[0] * b[0] + q[1] * b[1] + q[2] * o[0] + q[3] * o[1] + q[4]); return a * s; };
}

class ObjectWalker {
  constructor(cfg) { this.cfg = cfg; this.i = 0; this.pos = cfg.waypoints[0].slice(); this.wait = cfg.pause; }
  step(dt) {
    if (this.wait > 0) { this.wait -= dt; return this.pos; }
    const W = this.cfg.waypoints, t = W[(this.i + 1) % W.length], dx = t[0] - this.pos[0], dy = t[1] - this.pos[1], d = Math.hypot(dx, dy), v = this.cfg.speed * dt;
    if (d <= v) { this.pos = t.slice(); this.i = (this.i + 1) % W.length; this.wait = this.cfg.pause; } else this.pos = [this.pos[0] + dx / d * v, this.pos[1] + dy / d * v];
    return this.pos;
  }
}

class World {
  constructor(cfg, seed = 1, opts = {}) {
    this.cfg = cfg; this.seed = seed; this.t = 0; this.beacons = []; this.nextId = 1;
    /* separate random streams so fixed / moving runs see the SAME object path and radio noise */
    this.rRadio = rngMake(seed * 101 + 1); this.rMove = rngMake(seed * 101 + 2); this.rRep = rngMake(seed * 101 + 3);
    this.obj = new ObjectWalker(cfg.object); this.events = [];
    (opts.beacons || cfg.beacons).forEach(p => this.addBeacon(p[0], p[1], opts.mode || 'fixed'));
  }
  addBeacon(x, y, mode = 'fixed', wantId) {
    if (this.beacons.length >= this.cfg.maxBeacons) return null;
    const used = new Set(this.beacons.map(b => b.id)); let n = 1; while (used.has('A' + n)) n++;
    const id = wantId && !used.has(wantId) ? wantId : 'A' + n, b = { id, mode, dead: false, home: [x, y], truth: [x, y], believed: [x, y], sd: this.cfg.surveyedSd, drift: [0, 0], target: null, pause: 0, nextRep: 0, held: false,
      shadow: makeShadow(id, 'room', 1, this.cfg.radio.shadowCorr) };   /* unit field, scaled by radio.shadowSd at measurement time */
    this.beacons.push(b); this.setMode(id, mode); return b;
  }
  removeBeacon(id) { const i = this.beacons.findIndex(b => b.id === id); if (i >= 0) this.beacons.splice(i, 1); return i >= 0; }
  get(id) { return this.beacons.find(b => b.id === id); }
  setMode(id, mode) {
    const b = this.get(id); if (!b) return; b.mode = mode; b.target = null; b.pause = 0;
    if (mode === 'fixed') { b.believed = b.truth.slice(); b.sd = this.cfg.surveyedSd; b.drift = [0, 0]; }   /* re-surveyed where it stands */
    else if (mode === 'moving') b.sd = this.repSd();
    else b.sd = this.cfg.external.posSd;
  }
  repSd() { const r = this.cfg.report; return Math.hypot(r.noise, r.driftRate * Math.sqrt(r.driftTau / 2)); }
  /* the user drags a beacon: it physically moves there; a fixed beacon is re-surveyed, a moving one reports it with its usual noise */
  dragBeacon(id, x, y) { const b = this.get(id); if (!b) return; b.truth = [x, y]; b.home = [x, y]; b.target = null; b.pause = 1; if (b.mode !== 'moving') b.believed = [x, y]; else this._report(b); }
  /* external position report (real phone data later). In the simulation the radio needs a truth, so truth follows the report. */
  externalUpdate(id, x, y, ts) {
    let b = this.get(id); if (!b) b = this.addBeacon(x, y, 'external', id); if (!b) return null;
    if (b.mode !== 'external') this.setMode(id, 'external');
    b.truth = [x, y]; b.home = [x, y]; b.believed = [x, y]; b.extTs = ts == null ? this.t : ts; return b;
  }
  _report(b) {
    const r = this.cfg.report, g = this.rRep;
    b.believed = [b.truth[0] + b.drift[0] + r.noise * g.g(), b.truth[1] + b.drift[1] + r.noise * g.g()];
  }
  step(dt) {
    this.t += dt; const C = this.cfg, R = C.room, M = C.motion, rp = C.report;
    this.obj.step(dt);
    for (const b of this.beacons) {
      if (b.mode !== 'moving') continue;
      if (!b.held) {
        if (b.pause > 0) b.pause -= dt;
        else {
          if (!b.target) {   /* next waypoint: anywhere in the room, or within homeRadius of the beacon's station */
            const hr = M.homeRadius, cl = (v, L) => Math.min(L - M.margin, Math.max(M.margin, v));
            b.target = hr ? [cl(b.home[0] + (2 * this.rMove() - 1) * hr, R.w), cl(b.home[1] + (2 * this.rMove() - 1) * hr, R.h)] : [M.margin + this.rMove() * (R.w - 2 * M.margin), M.margin + this.rMove() * (R.h - 2 * M.margin)];
          }
          const dx = b.target[0] - b.truth[0], dy = b.target[1] - b.truth[1], d = Math.hypot(dx, dy), v = M.speed * dt;
          if (d <= v) { b.truth = b.target.slice(); b.target = null; b.pause = M.pauseMin + this.rMove() * (M.pauseMax - M.pauseMin); }
          else b.truth = [b.truth[0] + dx / d * v, b.truth[1] + dy / d * v];
        }
      }
      const k = Math.exp(-dt / rp.driftTau), q = rp.driftRate * Math.sqrt(dt);   /* OU drift of the self-reported position */
      b.drift = [b.drift[0] * k + q * this.rRep.g(), b.drift[1] * k + q * this.rRep.g()];
      if (this.t >= b.nextRep - 1e-9) { b.nextRep = this.t + 1 / rp.hz; this._report(b); }
    }
  }
  /* one range reading per beacon (null = packet lost / dead) */
  measure() {
    const o = this.obj.pos, rc = this.cfg.radio, g = this.rRadio, out = {};
    for (const b of this.beacons) {
      const lost = g() < rc.loss, n = g.g();   /* always draw both so every run consumes the same random numbers */
      if (b.dead || lost) { out[b.id] = null; continue; }
      const d = Math.hypot(o[0] - b.truth[0], o[1] - b.truth[1]);
      out[b.id] = Math.max(0.1, d + rc.shadowSd * b.shadow(b.truth, o) + rc.sigma * n);
    }
    return out;
  }
}
if (typeof module !== 'undefined') module.exports = { World, ObjectWalker, makeShadow, hashSeed };
