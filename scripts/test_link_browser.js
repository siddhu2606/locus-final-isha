/* Phone (receiver, simulation) <-> laptop dashboard over the 6-digit code; ISHA; staff request through the gates. Needs internet (PeerJS).
   node scripts/test_link_browser.js [baseUrl]   (serve the repo first: python -m http.server 8790) */
const { launch } = require('./cdp.js'); let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
(async () => {
  const base = process.argv[2] || 'http://localhost:8790/';
  const B = await launch(base + 'phone.html#rx', 400, 860, true); let code = '';
  for (let i = 0; i < 30 && !/^\d{6}$/.test(code); i++) { await B.sleep(1000); code = await B.ev(`(__phone.Link.code||'')`); if (!/Code/.test(await B.ev(`document.getElementById('pill-t').textContent`))) code = ''; }
  ok(/^\d{6}$/.test(code), 'phone receiver shows a 6-digit code: ' + code);
  ok(await B.ev(`__phone.P.src === 'sim' && __phone.P.meas.filter(Boolean).length >= 3 && !!__phone.P.me`), 'phone (simulation) hears beacons and places itself: ' + await B.ev(`__phone.P.me && __phone.P.me.zone`));
  const A = await launch(base + 'dashboard.html#code=' + code, 1280, 860);
  let linked = false; for (let i = 0; i < 25 && !linked; i++) { await A.sleep(1000); linked = await A.ev(`__locus.Phone.open`); }
  ok(linked, 'laptop dashboard linked to the phone with the code');
  await A.sleep(4000);
  const st = JSON.parse(await A.ev(`JSON.stringify({mode: __locus.S.mode, space: __locus.S.space, n: __locus.S.samples.length, truth: !!__locus.cur.truth, err: __locus.cur.e.loc, out: !!__locus.cur.out, src: __locus.S.phoneSrc})`));
  ok(st.mode === 'live' && st.n > 20 && st.out, `dashboard runs on the phone's packets (${st.n} samples in the buffer, source ${st.src})`);
  ok(st.truth && st.err != null && st.err < 3, 'phone simulation sends its true position: live error ' + (st.err && st.err.toFixed(2)) + ' m');
  ok(await B.ev(`__phone.P.linked && __phone.P.cfg && __phone.P.cfg.space === 'room' && __phone.P.cfg.W <= 12`), 'phone received the room + beacons from the dashboard: ' + await B.ev(`JSON.stringify(__phone.P.cfg && __phone.P.cfg.anchors)`));
  await B.sleep(1500);
  /* ISHA */
  await B.ev(`__phone.P.voice = false; document.querySelector('#tabs [data-s=isha]').click(); __phone.ask('where is the nearest wheelchair?')`);
  const a1 = await B.ev(`[...document.querySelectorAll('#chat .msg.a')].pop().textContent`);
  ok(/wheelchair is WC-0\d/.test(a1) && /m (north|south|east|west)/.test(a1), 'ISHA finds the nearest wheelchair: ' + a1);
  await B.ev(`__phone.ask('oxygen kahan hai')`); const a2 = await B.ev(`[...document.querySelectorAll('#chat .msg.a')].pop().textContent`);
  ok(/oxygen cylinder is O2-0\d/.test(a2), 'ISHA understands Hinglish: ' + a2);
  await B.ev(`__phone.ask('is beacon 2 working')`); ok(/Beacon 2 \(.* m high\) is working/.test(await B.ev(`[...document.querySelectorAll('#chat .msg.a')].pop().textContent`)), 'ISHA reports beacon health with height');
  /* staff request through the gates: as a guard (denied) twice -> flagged on the dashboard */
  await B.ev(`document.querySelector('#roles [data-r=guard]').click(); document.getElementById('b-pat').click()`); await B.sleep(1500);
  await B.ev(`document.getElementById('b-pat').click()`); await B.sleep(2500);
  const aud = await A.ev(`[...document.querySelectorAll('#audit tr')].slice(0,2).map(r=>r.textContent).join(' | ')`);
  ok(/Guard G-011.*phone.*Denied again → flagged to admin/.test(aud), 'staff phone requests land in the dashboard audit log, repeat denial flagged: ' + aud);
  await B.ev(`document.querySelector('#roles [data-r=nurseB]').click()`); await B.ev(`__phone.ask('where is patient P-112')`);
  const a3 = await B.ev(`[...document.querySelectorAll('#chat .msg.a')].pop().textContent`);
  ok(/Patient P-112 is in Ward B · bed \d+ \(\d+% sure\)/.test(a3), 'nurse of Ward B who is POC gets the room: ' + a3);
  /* moving beacons while a phone (simulation) is linked: beacons walk, the phone's radio follows where they really are */
  await A.ev(`document.querySelector('.tabs [data-t=space]').click()`); await A.sleep(300);
  ok(await A.ev(`[...document.querySelectorAll('.mvb')].every(b => !b.disabled)`), 'walks buttons are enabled with a phone in Simulation mode');
  await A.ev(`document.getElementById('b-allmv').click()`); await A.sleep(7000);
  const mv = JSON.parse(await A.ev(`JSON.stringify({ n: __locus.MT.log.length, mv: __locus.S.anchors.every(a => a.mv), err: __locus.cur.e.loc, apart: __locus.S.anchors.some(a => a.tx !== a.x) })`));
  ok(mv.mv && mv.n >= 3 && mv.apart && mv.err != null && mv.err < 3, `live: all beacons walk, ${mv.n} moves logged, error ${mv.err && mv.err.toFixed(2)} m`);
  const ph = JSON.parse(await B.ev(`JSON.stringify(__phone.P.anchors.map(a => [a.tx, a.ty]))`)), da = JSON.parse(await A.ev(`JSON.stringify(__locus.S.anchors.map(a => [a.tx, a.ty]))`));
  ok(ph.every((p, i) => Math.hypot(p[0] - da[i][0], p[1] - da[i][1]) < 0.6), 'phone simulates the radio from the beacons\' real (walking) positions');
  ok(await B.ev(`__phone.eng.inited && __phone.P.meas.filter(Boolean).length >= 3`), 'phone keeps tracking while beacons move (filter not restarted)');
  await A.ev(`document.getElementById('b-allfx').click()`);
  await B.ev(`document.querySelector('#tabs [data-s=radar]').click()`); await B.sleep(800); await B.shot(process.env.SHOT_DIR ? process.env.SHOT_DIR + '/phone_radar.png' : 'phone_radar.png');
  await A.shot(process.env.SHOT_DIR ? process.env.SHOT_DIR + '/dash_linked.png' : 'dash_linked.png');
  ok(!A.logs.length && !B.logs.length, 'no console errors' + (A.logs.concat(B.logs).length ? ': ' + A.logs.concat(B.logs).join(' | ') : ''));
  A.close(); B.close(); console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
