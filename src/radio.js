/* ===== LOCUS radio: RSSI -> distance, and per-beacon calibration. Shared by the dashboard and the phone app. =====
   Log-distance model: rssi = p1 - 10 n log10(d), so d = 10^((p1 - rssi) / (10 n)).
   p1 (RSSI at 1 m) differs a lot between phones: one that really reads -70 dBm at 13 cm would be called 3.2 m away
   if we assumed the textbook -59 dBm. So every beacon is calibrated: hold the receiver at a KNOWN distance
   (10 cm, 50 cm, 1 m or 2 m) for 3 s. One point sets p1; two points at different distances also fit n. */
const RADIO = { winMs: 1500, minR: 0.05, nDef: 2.2, p1Def: -59 };
/* median of the last winMs of samples (robust to the odd faded packet); vals = RSSI numbers */
function rssiLevel(vals) { if (!vals.length) return null; const s = [...vals].sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; }
function rangeFrom(rssi, p1, n, maxR) { const d = Math.pow(10, (p1 - rssi) / (10 * n)); return Math.min(maxR || 60, Math.max(RADIO.minR, d)); }
/* calibration points [{d, rssi}] -> {p1, n}. One point: p1 only (n stays). Two+ points at distances at least 1.5x apart: least-squares p1 and n. */
function fitCal(pts, nDef) {
  const n0 = nDef || RADIO.nDef; if (!pts || !pts.length) return null;
  const xs = pts.map(p => Math.log10(p.d)), spread = Math.max(...xs) - Math.min(...xs);
  if (pts.length < 2 || spread < Math.log10(1.5)) { const p1s = pts.map(p => p.rssi + 10 * n0 * Math.log10(p.d)); return { p1: Math.round(p1s.reduce((a, b) => a + b, 0) / p1s.length * 10) / 10, n: n0 }; }
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = pts.reduce((a, p) => a + p.rssi, 0) / pts.length;
  let sxy = 0, sxx = 0; pts.forEach((p, i) => { sxy += (xs[i] - mx) * (p.rssi - my); sxx += (xs[i] - mx) * (xs[i] - mx); });
  const n = Math.min(4.5, Math.max(1.4, -sxy / sxx / 10)), p1 = my + 10 * n * mx;
  return { p1: Math.round(p1 * 10) / 10, n: Math.round(n * 100) / 100 };
}
const fmtDist = m => m == null ? '–' : m < 1 ? Math.round(m * 100) + ' cm' : m.toFixed(m < 10 ? 2 : 1) + ' m';
const CAL_DISTS = [0.1, 0.5, 1, 2];
if (typeof module !== 'undefined') module.exports = { RADIO, rssiLevel, rangeFrom, fitCal, fmtDist, CAL_DISTS };
