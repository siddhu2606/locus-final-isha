/* ===== LOCUS access: every request for a PERSON's location passes three gates, and every request is audited. =====
   Gate 1 · Role            admin, and nurses of the patient's ward, may ask; guards see exits only; other wards are refused.
   Gate 2 · Staff + device  a registered phone that LOCUS itself places inside the hospital.
   Gate 3 · Point of contact  only the patient's POC gets the room; everyone else who passed gets "in building".
   The answer is a zone and a confidence, never raw coordinates. Equipment is not personal data: any signed-in staff may locate it. */
const ROLES = {
  admin: { name: 'Admin A-001', label: 'Admin' },
  nurseB: { name: 'Nurse N-204', label: 'Nurse, Ward B', ward: 'Ward B' },
  nurseI: { name: 'Nurse N-517', label: 'Nurse, ICU', ward: 'ICU' },
  guard: { name: 'Guard G-011', label: 'Guard' },
};
function gateDecide(q) {   /* q = {role, device: 'reg'|'own', inside: bool, poc: bool, patientWard} */
  const r = ROLES[q.role] || ROLES.guard, ward = q.patientWard || 'Ward B';
  const g1 = q.role === 'admin' || r.ward === ward ? [true, 'pass: role allows ' + ward] : [false, q.role === 'guard' ? 'denied: guards see exits only' : 'denied: not your ward'];
  const g2 = q.device !== 'reg' ? [false, 'denied: phone not registered'] : !q.inside ? [false, 'denied: phone is off-site'] : [true, 'pass: registered, inside'];
  const g3 = q.poc ? [true, 'pass: POC'] : [true, 'limited: not POC'];
  const gates = [g1, g2, g3]; let stop = gates.findIndex(g => !g[0]);
  return { gates, deniedAt: stop, allowed: stop < 0, level: stop >= 0 ? null : q.poc ? 'room' : 'building', reason: stop >= 0 ? gates[stop][1].replace('denied: ', '') : null };
}
class Audit {
  constructor() { this.rows = []; this.deny = {}; }
  add(e) {   /* e = {who, device, asked, allowed, answer, reason, via} -> row with flag when the same person is denied twice in a row */
    let result, cls = '';
    if (!e.allowed) { this.deny[e.who] = (this.deny[e.who] || 0) + 1; result = 'Denied: ' + e.reason; cls = 'deny'; if (this.deny[e.who] >= 2) { result = 'Denied again → flagged to admin'; cls = 'deny flagged'; } }
    else { this.deny[e.who] = 0; result = e.answer; }
    const row = { time: new Date().toTimeString().slice(0, 8), who: e.who, device: e.device, asked: e.asked, result, cls, via: e.via || 'dashboard' };
    this.rows.unshift(row); if (this.rows.length > 200) this.rows.pop(); return row;
  }
}
/* the answer text for a person: zone + confidence for the POC, "In building" otherwise */
function gateAnswer(dec, person) {
  if (!dec.allowed) return 'Denied';
  if (!person || !person.online) return 'Not seen' + (person && person.ago != null ? ' for ' + Math.round(person.ago) + ' s' : '');
  return dec.level === 'room' ? person.zone + ' · ' + Math.round(person.conf * 100) + '%' : 'In building';
}
if (typeof module !== 'undefined') module.exports = { ROLES, gateDecide, Audit, gateAnswer };
