/* ===== LOCUS Moving Beacons: every tunable number in one place (metres, seconds, m/s) ===== */
const MB_CONFIG = {
  room: { w: 12, h: 8 },                          /* open floor, no interior walls; y points NORTH (up on the map) */
  tickHz: 10,                                     /* simulation + estimator rate */
  maxBeacons: 8,
  beacons: [[1, 1], [11, 1], [11, 7], [1, 7]],    /* start positions (corners); A1..A4 */

  /* tracked object: walks between waypoints, stops at each one (someone at a bed / desk) */
  object: { speed: 0.5, pause: 6, waypoints: [[3, 2.5], [9, 2.5], [9, 5.5], [6, 4], [3, 5.5]] },

  /* simulated beacon motion: walk to a random waypoint, pause, pick a new one.
     homeRadius: waypoints stay within this distance of the beacon's station (0 = roam the whole room) */
  motion: { speed: 0.6, pauseMin: 1, pauseMax: 3, margin: 0.6, homeRadius: 2 },

  /* what the system BELIEVES about a moving beacon's position: its own self-reported position.
     believed = true + drift + noise.  drift is an Ornstein-Uhlenbeck random walk (sd driftRate*sqrt(tau/2) at rest). */
  report: { hz: 5, noise: 0.05, driftRate: 0.02, driftTau: 30 },
  external: { posSd: 0.1 },                       /* uncertainty assumed for update_beacon_position() reports */
  surveyedSd: 0,                                  /* fixed beacons are surveyed: position known exactly */

  /* radio: range = true distance + multipath bias (smooth in BOTH beacon and object position) + white noise */
  radio: { sigma: 0.3, shadowSd: 0.9, shadowCorr: 1.5, loss: 0.1 },

  /* estimator: existing LOCUS particle filter (trust, dead beacons) + sliding-window weighted least squares */
  estimator: { N: 400, sigma: 0.9, windowSec: 4, maxReadings: 400, objSpeedSd: 0.25, huber: 2.0, priorScale: 1, motionComp: true },

  /* movement display */
  display: { threshold: 0.1, smoothing: 0.5, trailLen: 15, recentSec: 10, speedSec: 1, settleSec: 0.8, turnDeg: 35, arrowHoldSec: 8, logMax: 200 },

  /* fixed vs moving comparison */
  compare: { seconds: 90, warmup: 5, seeds: [1, 2, 3, 4],
    layouts: { '4 corners': [[1, 1], [11, 1], [11, 7], [1, 7]], '3 corners': [[1, 1], [11, 1], [6, 7]], '3 on one wall': [[2, 0.6], [6, 0.6], [10, 0.6]], '2 beacons': [[1, 4], [11, 4]] } },
};
if (typeof module !== 'undefined') module.exports = { MB_CONFIG };
