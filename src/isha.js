/* ===== ISHA: the staff advisor. Runs fully offline: a small intent parser over the live LOCUS state.
   Understands English and Hinglish ("wheelchair kahan hai"). Person lookups go through the three access gates.
   ctx = { assets: [{id,type,name,pos,zone,conf,online,ago}], me: {pos, zone} | null, beacons: [{b, z, ok, trust, range, why}],
           alerts: [text], role, person(id) -> {text, allowed} }                                                        ===== */
const ISHA_TYPES = [
  ['wheelchair', /wheel ?chairs?|\bwc\b|व्हीलचेयर/],
  ['oxygen', /oxygen|\bo2\b|o₂|cylinders?|ऑक्सीजन/],
  ['pump', /infusion|\biv\b|pumps?|drip/],
  ['crash', /crash ?cart|defib|defibrillator|aed|resus/],
  ['ecg', /\becg\b|\bekg\b|cardiogram/],
  ['stretcher', /stretcher|trolley|gurney/],
  ['vent', /ventilator|\bvent\b/],
];
const ISHA_NAMES = { wheelchair: ['wheelchair', 'wheelchairs'], oxygen: ['oxygen cylinder', 'oxygen cylinders'], pump: ['infusion pump', 'infusion pumps'], crash: ['crash cart', 'crash carts'], ecg: ['ECG machine', 'ECG machines'], stretcher: ['stretcher', 'stretchers'], vent: ['ventilator', 'ventilators'] };
function ishaWhere(a, me) {
  if (!a.pos) return 'not located yet';
  let s = 'in ' + a.zone; if (me && me.pos) { const d = dirFrom(me.pos, a.pos); s += d.d < 1.5 ? ', right next to you' : ', about ' + Math.round(d.d) + ' m ' + d.name + ' of you'; }
  return s + (a.online ? ' (' + Math.round(a.conf * 100) + '% sure)' : ' (last seen ' + (a.ago == null ? 'never' : Math.round(a.ago) + ' s ago') + ')');
}
function ishaAsk(text, ctx) {
  const q = (text || '').toLowerCase().replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim(), me = ctx.me, A = ctx.assets || [];
  const R = (t, focus) => ({ text: t, focus: focus || null });
  if (!q) return R('Ask me where something is, for example "where is the nearest wheelchair?"');
  if (/^(hi|hello|hey|namaste|namaskar)\b/.test(q) || /who are you|what can you do|help|madad/.test(q))
    return R('Hi, I am ISHA, your LOCUS advisor. I can find equipment ("nearest wheelchair", "where is O2-01"), tell you where you are, find a patient if your role allows it, and check beacon health and alerts. Tap the mic to ask by voice.');
  /* an exact tag id: WC-01, P-112, N-204 ... */
  const idm = q.match(/\b([a-z]{1,3}\d?)[- ]?(\d{2,3})\b/);
  if (idm) { const id = (idm[1] + '-' + idm[2]).toUpperCase().replace('O2', 'O2'), a = A.find(x => x.id === id || x.id.replace('-', '') === id.replace('-', ''));
    if (a) { if (a.type === 'patient' || a.type === 'staff') return R(ctx.person ? ctx.person(a.id).text : 'Person lookups need the access gates.', a.id); return R(a.id + ' (' + a.name + ') is ' + ishaWhere(a, me) + '.', a.id); } }
  if (/where am i|my location|mera location|main kahan|i am where|meri location/.test(q)) return R(me && me.pos ? 'You are in ' + me.zone + ' (' + me.pos[0].toFixed(1) + ', ' + me.pos[1].toFixed(1) + ' m on the floor plan).' : 'I cannot place you yet: no beacons heard. Check that the receiver is on.');
  if (/patient|marij|mareez|p ?112/.test(q)) { const p = A.find(x => x.type === 'patient'); return R(p && ctx.person ? ctx.person(p.id).text : 'No patient tag found.', p && p.id); }
  if (/nurse|staff|doctor|n ?204/.test(q)) { const p = A.find(x => x.type === 'staff'); return R(p && ctx.person ? ctx.person(p.id).text : 'No staff badge found.', p && p.id); }
  if (/alert|alarm|problem|issue|warning|kya hua|kuch gadbad/.test(q)) { const al = ctx.alerts || []; return R(al.length ? al.length + ' alert' + (al.length > 1 ? 's' : '') + ': ' + al.slice(0, 3).join(' ') : 'No alerts. Every beacon is healthy and every tag is on radar.'); }
  const bm = q.match(/beacon\s*(\d)/);
  if (bm || /beacons?|anchors?|signal|battery/.test(q)) {
    const B = ctx.beacons || [], one = bm ? B.find(b => b.b === +bm[1]) : null;
    if (bm && !one) return R('Beacon ' + bm[1] + ' is not part of the current layout.');
    const say = b => 'Beacon ' + b.b + ' (' + b.z.toFixed(1) + ' m high) is ' + (b.ok ? 'working, trust ' + b.trust.toFixed(2) + (b.range != null ? ', ' + fmtDist(b.range) + ' from you' : '') : 'NOT heard' + (b.why ? ': ' + b.why : '')) + '.';
    if (one) return R(say(one)); const bad = B.filter(b => !b.ok);
    return R(bad.length ? bad.length + ' of ' + B.length + ' beacons need attention. ' + bad.map(say).join(' ') : 'All ' + B.length + ' beacons are working. Lowest trust: beacon ' + B.slice().sort((x, y) => x.trust - y.trust)[0].b + ' at ' + B.slice().sort((x, y) => x.trust - y.trust)[0].trust.toFixed(2) + '.');
  }
  const ty = ISHA_TYPES.find(t => t[1].test(q));
  if (ty) {
    const all = A.filter(a => a.type === ty[0]), nm = ISHA_NAMES[ty[0]];
    if (!all.length) return R('I have no ' + nm[1] + ' tagged.');
    const loc = all.filter(a => a.pos).map(a => ({ a, d: me && me.pos ? dirFrom(me.pos, a.pos).d : 0 })).sort((x, y) => (y.a.online - x.a.online) || x.d - y.d);
    if (/how many|kitne|count/.test(q)) return R(all.length + ' ' + nm[all.length > 1 ? 1 : 0] + ' tagged: ' + all.map(a => a.id + ' in ' + a.zone).join(', ') + '.');
    if (!loc.length) return R('None of the ' + nm[1] + ' has been located yet.');
    const f = loc[0].a, rest = loc.slice(1).map(o => o.a.id + ' in ' + o.a.zone);
    return R((me && me.pos ? 'The nearest ' + nm[0] + ' is ' : 'The ' + nm[0] + ' ') + f.id + ', ' + ishaWhere(f, me) + '.' + (rest.length ? ' Also: ' + rest.join(', ') + '.' : ''), f.id);
  }
  if (/where|kahan|kaha|find|locate|dhund|search/.test(q)) return R('I did not catch which item. I track wheelchairs, oxygen cylinders, infusion pumps, crash carts, ECG machines, stretchers and ventilators, plus patient P-112 and nurse N-204.');
  return R('Sorry, I did not understand. Try "nearest wheelchair", "where am I", "any alerts" or "is beacon 3 working".');
}
if (typeof module !== 'undefined') module.exports = { ishaAsk };
