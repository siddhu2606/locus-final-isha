/* ===== LOCUS Moving Beacons: movement maths + per-beacon movement tracker. Pure, no DOM.
   Coordinates in metres, y = north. Bearing = degrees clockwise from north (0 = N, 90 = E). ===== */
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
function displacement(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dist = Math.hypot(dx, dy), bearing = dist > 0 ? (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 : 0;
  return { dx, dy, dist, bearing, compass: COMPASS[Math.round(bearing / 45) % 8] };
}
const sgn = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
function fmtMove(id, d) { return `${id} moved ${d.dist.toFixed(1)} m toward ${Math.round(d.bearing)}° (${d.compass}) · dx = ${sgn(d.dx)} m, dy = ${sgn(d.dy)} m`; }
function angGap(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

/* Turns a stream of (possibly noisy) believed positions into what the dashboard shows:
   - smoothed position (EMA; exact sources such as a drag or an external report skip the smoothing)
   - move SEGMENTS: start when the beacon is >= threshold away from where it rested, follow it while it moves,
     end when it has made no progress for settleSec or turns by more than turnDeg. One log entry per segment,
     created at the start and updated live, so jitter below the threshold never reaches the log.
   - fading trail, odometer (total + last recentSec), speed over speedSec. */
class MoveTracker {
  constructor(cfg) { this.cfg = cfg; this.b = {}; this.log = []; }
  reset(id) { delete this.b[id]; }
  _st(id, p, t) { return this.b[id] || (this.b[id] = { sm: p.slice(), raw: p.slice(), rest: p.slice(), pivot: p.slice(), progT: t, seg: null, last: null, trail: [p.slice()], odo: 0, odoPts: [], hist: [{ t, p: p.slice() }] }); }
  update(id, x, y, t, exact) {
    const c = this.cfg, fresh = !this.b[id], s = this._st(id, [x, y], t), thr = c.threshold;
    s.raw = [x, y]; if (fresh) return null;
    const al = exact ? 1 : c.smoothing; s.sm = [s.sm[0] + al * (x - s.sm[0]), s.sm[1] + al * (y - s.sm[1])];
    const p = s.sm;
    /* trail + odometer: a point every threshold metres */
    const lt = s.trail[s.trail.length - 1], step = Math.hypot(p[0] - lt[0], p[1] - lt[1]);
    if (step >= thr) { s.trail.push(p.slice()); if (s.trail.length > c.trailLen) s.trail.shift(); s.odo += step; s.odoPts.push({ t, d: step }); }
    s.odoPts = s.odoPts.filter(q => t - q.t <= c.recentSec);
    s.hist.push({ t, p: p.slice() }); while (s.hist.length > 2 && t - s.hist[1].t >= c.speedSec) s.hist.shift();
    /* segments */
    if (Math.hypot(p[0] - s.pivot[0], p[1] - s.pivot[1]) >= thr / 2) { s.pivot = p.slice(); s.progT = t; }
    if (!s.seg) {
      if (Math.hypot(p[0] - s.rest[0], p[1] - s.rest[1]) >= thr) this._start(id, s, s.rest, p, t);
    } else {
      const g = s.seg; g.to = p.slice(); g.t1 = t; Object.assign(g, displacement(g.from, g.to));
      const dm = Math.hypot(p[0] - g.mid[0], p[1] - g.mid[1]);
      if (dm >= 3 * thr) {   /* turn check over a 3-threshold baseline so jitter cannot fake a turn */
        const before = displacement(g.from, g.mid), now = displacement(g.mid, p);
        if (before.dist >= 3 * thr && angGap(before.bearing, now.bearing) > c.turnDeg) { this._end(s, g.mid, t); this._start(id, s, s.rest, p, t); }
        else g.mid = p.slice();
      }
      if (s.seg && t - s.progT >= c.settleSec) this._end(s, p, t);
    }
    return s.seg;
  }
  _start(id, s, from, to, t) {
    const g = { id, from: from.slice(), to: to.slice(), mid: from.slice(), t0: t, t1: t, live: true, ...displacement(from, to) };
    s.seg = g; s.last = g; this.log.unshift(g); if (this.log.length > this.cfg.logMax) this.log.pop();
  }
  _end(s, at, t) { const g = s.seg; g.to = at.slice(); g.t1 = t; g.live = false; Object.assign(g, displacement(g.from, g.to)); s.rest = at.slice(); s.seg = null; if (g.dist < this.cfg.threshold) this.log.splice(this.log.indexOf(g), 1); }
  stats(id, t) {
    const s = this.b[id]; if (!s) return null; const h0 = s.hist[0], dt = t - h0.t, v = dt > 0 ? Math.hypot(s.sm[0] - h0.p[0], s.sm[1] - h0.p[1]) / dt : 0;
    return { pos: s.sm, total: s.odo, recent: s.odoPts.reduce((a, q) => a + q.d, 0), speed: v * this.cfg.speedSec < this.cfg.threshold ? 0 : v, moving: !!s.seg, seg: s.seg || (s.last && t - s.last.t1 <= this.cfg.arrowHoldSec ? s.last : null), trail: s.trail };
  }
}
if (typeof module !== 'undefined') module.exports = { displacement, fmtMove, angGap, MoveTracker, COMPASS };
