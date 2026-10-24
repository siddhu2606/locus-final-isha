/* ===== LOCUS tagged objects: the predefined set of BLE-tagged equipment, the patient tag and a staff badge,
   their home zones, how they move, and a light tracker that locates each one from the same simulated radio. =====
   Positions are given for the 40 x 24 m hospital floor (h) and as fractions of "My room" (f). y grows downward (south). */
const ASSET_TYPES = {
  wheelchair: { label: 'Wheelchair', short: 'WC', col: '#2A78D6' },
  oxygen: { label: 'Oxygen cylinder', short: 'O₂', col: '#0E9DBE' },
  pump: { label: 'Infusion pump', short: 'IV', col: '#8B5CF6' },
  crash: { label: 'Crash cart (defibrillator)', short: 'CC', col: '#EF6A6A' },
  ecg: { label: 'ECG machine', short: 'ECG', col: '#E0508C' },
  stretcher: { label: 'Stretcher', short: 'ST', col: '#E0A000' },
  vent: { label: 'Ventilator', short: 'VT', col: '#0A6B49' },
  patient: { label: 'Patient', short: 'P', col: '#0B3A4A' },
  staff: { label: 'Staff', short: 'N', col: '#10B981' },
};
const ASSETS = [
  { id: 'WC-01', type: 'wheelchair', h: [4, 20], f: [0.15, 0.82], z: 0.5, moves: [[4, 20], [5, 12], [7, 5], [5, 12]] },
  { id: 'WC-02', type: 'wheelchair', h: [17, 6.5], f: [0.85, 0.18], z: 0.5 },
  { id: 'O2-01', type: 'oxygen', h: [22.5, 2.5], f: [0.55, 0.12], z: 0.6 },
  { id: 'O2-02', type: 'oxygen', h: [14, 22], f: [0.4, 0.88], z: 0.6 },
  { id: 'IV-01', type: 'pump', h: [6, 4], f: [0.12, 0.3], z: 1.0 },
  { id: 'CC-01', type: 'crash', h: [20, 13.5], f: [0.5, 0.5], z: 0.9 },
  { id: 'ECG-01', type: 'ecg', h: [27, 6], f: [0.7, 0.42], z: 0.9 },
  { id: 'ST-01', type: 'stretcher', h: [25, 19], f: [0.88, 0.75], z: 0.7, moves: [[25, 19], [26, 12], [35, 12], [36, 19], [35, 12], [26, 12]] },
  { id: 'VT-01', type: 'vent', h: [26, 3], f: [0.62, 0.25], z: 1.1 },
  { id: 'P-112', type: 'patient', name: 'Patient P-112', h: [13, 4], f: [0.82, 0.3], z: 0.8, ward: 'Ward B', bed: 'bed 12' },
  { id: 'N-204', type: 'staff', name: 'Nurse N-204', h: [15, 7], f: [0.3, 0.6], z: 1.2, moves: [[15, 7], [15, 12], [24, 12], [24, 5], [24, 12], [12, 12], [12, 6]] },
];
/* zone names: hospital rooms come from the floor map; "My room" is treated as Ward B and split into four beds */
function zoneOf(space, x, y, W, H) {
  if (space === 'hospital') return roomName(roomAt(x, y));
  return 'Ward B · bed ' + (9 + (x >= W / 2 ? 1 : 0) + (y >= H / 2 ? 2 : 0));
}
function wardOf(space, x, y, W, H) { const z = zoneOf(space, x, y, W, H); return z.split(' · ')[0]; }
/* compass for the floor map: north = up = -y */
const COMPASS8 = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
function dirFrom(a, b) { const dx = b[0] - a[0], dn = -(b[1] - a[1]), d = Math.hypot(dx, dn), brg = (Math.atan2(dx, dn) * 180 / Math.PI + 360) % 360; return { d, brg, name: COMPASS8[Math.round(brg / 45) % 8] }; }

/* Tracks every tag: true position (simulated), a fix every 0.5 s from simulated ranges to the ACTIVE beacons
   (same radio model and faults as the main tag), smoothed, with a zone and a confidence = share of recent fixes in that zone. */
class AssetSim {
  constructor(space, W, H, seed) {
    this.space = space; this.W = W; this.H = H; this.rng = rngMake(seed || 77); this.t = 0; this.acc = 0;
    this.items = ASSETS.map((a, i) => {
      const p = space === 'hospital' ? a.h.slice() : [a.f[0] * W, a.f[1] * H];
      return { ...a, name: a.name || ASSET_TYPES[a.type].label, truth: p, est: null, zone: '–', conf: 0, zh: [], heard: 0, seen: null, wi: 0, wait: 3 + i * 2.3, path: space === 'hospital' ? a.moves : a.moves && a.moves.map((q, k) => [W * (0.2 + 0.6 * ((k * 0.37 + i * 0.21) % 1)), H * (0.2 + 0.6 * ((k * 0.61 + i * 0.13) % 1))]) };
    });
  }
  step(dt, anchors, cfg, shielded) {
    this.t += dt; const W = this.W, H = this.H;
    this.items.forEach(a => {   /* movers: walk waypoints at 0.8 m/s, pause 8-20 s at each */
      if (!a.path) return; if (a.wait > 0) { a.wait -= dt; return; }
      const tg = a.path[(a.wi + 1) % a.path.length], dx = tg[0] - a.truth[0], dy = tg[1] - a.truth[1], d = Math.hypot(dx, dy), st = 0.8 * dt;
      if (d <= st) { a.truth = tg.slice(); a.wi = (a.wi + 1) % a.path.length; a.wait = 8 + this.rng() * 12; } else { a.truth[0] += dx / d * st; a.truth[1] += dy / d * st; }
    });
    this.acc += dt; if (this.acc < 0.5) return; this.acc = 0;
    this.items.forEach(a => {
      const meas = shielded && shielded.has(a.id) ? anchors.map(() => null) : measure3D(a.truth, a.z, a.z, anchors, cfg, this.rng, wallsBetween);
      a.heard = meas.filter(Boolean).length; if (a.heard) a.seen = this.t;
      if (a.heard < 2) return;   /* one range only gives a circle: keep the last fix */
      const f = lsFix(anchors, meas, a.est || [W / 2, H / 2]); if (!f) return;
      a.est = a.est ? [a.est[0] + 0.35 * (f[0] - a.est[0]), a.est[1] + 0.35 * (f[1] - a.est[1])] : f;
      const z = zoneOf(this.space, a.est[0], a.est[1], W, H); a.zh.push(z); if (a.zh.length > 12) a.zh.shift();
      const cnt = {}; a.zh.forEach(q => cnt[q] = (cnt[q] || 0) + 1); a.zone = Object.keys(cnt).sort((p, q) => cnt[q] - cnt[p])[0]; a.conf = cnt[a.zone] / a.zh.length;
      if (a.bed && this.space === 'hospital' && a.zone === a.ward) a.zone += ' · ' + a.bed;   /* in its own ward: the bed comes from the admission record */
    });
  }
  /* compact list for the phone / ISHA */
  list() { return this.items.map(a => ({ id: a.id, type: a.type, name: a.name, pos: a.est, zone: a.zone, conf: a.conf, z: a.z, ago: a.seen == null ? null : this.t - a.seen, online: a.seen != null && this.t - a.seen < 3, ward: a.ward, bed: a.bed })); }
}
if (typeof module !== 'undefined') module.exports = { ASSET_TYPES, ASSETS, zoneOf, wardOf, dirFrom, AssetSim };
