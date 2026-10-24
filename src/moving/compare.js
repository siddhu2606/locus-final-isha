/* ===== LOCUS Moving Beacons: fixed vs moving comparison. Needs World (sim.js) + MovingEstimator (estimator.js).
   Same seed => same object path, same radio noise draws, same estimator seed. Only the beacons' mode differs. ===== */
function runScenario(cfg, seed, moving, opts = {}) {
  const C = { ...cfg, beacons: opts.beacons || cfg.beacons, estimator: opts.windowSec == null ? cfg.estimator : { ...cfg.estimator, windowSec: opts.windowSec } };
  const w = new World(C, seed, { mode: moving ? 'moving' : 'fixed' }), est = new MovingEstimator(C, 11 + seed), dt = 1 / C.tickHz, errs = [];
  for (let k = 0, n = Math.round(C.compare.seconds * C.tickHz); k < n; k++) {
    w.step(dt); const bel = {}; w.beacons.forEach(b => bel[b.id] = { x: b.believed[0], y: b.believed[1], sd: b.sd });
    const o = est.step(w.t, w.measure(), bel, dt);
    if (o && w.t >= C.compare.warmup) errs.push(Math.hypot(o.pos[0] - w.obj.pos[0], o.pos[1] - w.obj.pos[1]));
  }
  return errs;
}
const summarise = e => { const s = [...e].sort((a, b) => a - b); return { mean: e.reduce((a, b) => a + b, 0) / e.length, median: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)], worst: s[s.length - 1], n: e.length }; };
/* every layout in cfg.compare.layouts, fixed and moving, all seeds. Returns [{layout, fixed, moving}] with summaries.
   onProgress(fraction) is awaited between runs so a page can repaint. */
async function compareFixedMoving(cfg, onProgress, opts = {}) {
  const L = Object.entries(opts.layouts || cfg.compare.layouts), seeds = cfg.compare.seeds, rows = []; let k = 0;
  for (const [name, beacons] of L) {
    const F = [], M = [];
    for (const s of seeds) {
      F.push(...runScenario(cfg, s, false, { beacons, windowSec: opts.windowSec })); if (onProgress) await onProgress(++k / (L.length * seeds.length * 2));
      M.push(...runScenario(cfg, s, true, { beacons, windowSec: opts.windowSec })); if (onProgress) await onProgress(++k / (L.length * seeds.length * 2));
    }
    rows.push({ layout: name, fixed: summarise(F), moving: summarise(M) });
  }
  return rows;
}
if (typeof module !== 'undefined') module.exports = { runScenario, compareFixedMoving, summarise };
