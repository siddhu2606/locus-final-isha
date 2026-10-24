/* Headless-Chrome check of every dashboard feature in Demo mode. node scripts/test_dashboard_browser.js [baseUrl] */
const { launch } = require('./cdp.js'); let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
(async () => {
  const base = process.argv[2] || 'http://localhost:8790/', dir = process.env.SHOT_DIR || '.';
  const b = await launch(base + 'dashboard.html', 1280, 900); await b.sleep(5000);
  const S = js => b.ev(js);
  ok(await S(`__locus.S.space === 'hospital' && __locus.S.anchors.length === 6 && __locus.cur.out && __locus.cur.e.loc < 4`), 'demo runs on the hospital floor with 6 beacons, error ' + (await S(`__locus.cur.e.loc`)).toFixed(2) + ' m');
  /* trust: rules + ML on every card */
  ok(await S(`[...document.querySelectorAll('#tcards .rm')].every(e => /^\\d\\.\\d\\d · \\d\\.\\d\\d$/.test(e.textContent) || e.textContent === '–')`), 'every trust card shows rules · ML: ' + await S(`[...document.querySelectorAll('#tcards .rm')].map(e=>e.textContent).join(' | ')`));
  await S(`document.querySelector('#scorer [data-sc=rules]').click()`); ok(await S(`__locus.eng.loc.mode === 'rules'`), 'scorer switch: rules only'); await S(`document.querySelector('#scorer [data-sc=fused]').click()`);
  /* height column */
  ok(await S(`document.querySelectorAll('#bt tr')[0].querySelectorAll('input[type=number]').length === 3 && document.querySelector('#bt [data-k=z]').value === '2.6'`), 'beacon table has a height column (beacon 1 at 2.6 m)');
  /* self-check: kill beacon 3 -> repair alert in ~3 s, trust -> 0 */
  await S(`document.querySelector('#tcards .tc[data-id=A3] [data-f=dead]').click()`); await b.sleep(5500);
  ok(await S(`/Repair/i.test(document.getElementById('al-flag').textContent) && /beacon 3/i.test(document.getElementById('al-log').textContent)`), 'killed beacon -> repair alert: ' + await S(`document.getElementById('al-flag').textContent`));
  ok(await S(`(() => { const i = __locus.S.anchors.findIndex(a => a.id === 'A3'); return __locus.cur.out.trust[i] < 0.05; })()`), 'killed beacon trust drops to 0');
  await S(`document.querySelector('#tcards .tc[data-id=A3] [data-f=dead]').click()`);
  /* off radar: shield the tag -> flag with last zone */
  await S(`document.getElementById('b-shield').click()`); await b.sleep(4000);
  ok(await S(`/Flag → POC/.test(document.getElementById('al-flag').textContent) && !!__locus.Alerts.off`), 'shielded tag -> off-radar flag: ' + await S(`document.getElementById('al-flag').textContent`));
  await S(`document.getElementById('b-shield').click()`); await b.sleep(1500); ok(await S(`!__locus.Alerts.off && /back on radar/.test(document.getElementById('al-log').textContent)`), 'tag back on radar is logged');
  /* objects + shielding one */
  await S(`document.querySelector('.tabs [data-t=objects]').click()`); await b.sleep(300);
  ok(await S(`document.querySelectorAll('#objs tr').length === 11 && __locus.S.assets.list().filter(a => a.online).length >= 10`), 'objects tab lists 11 tags, all on radar');
  await S(`document.querySelector('#objs [data-sh="WC-01"]').click()`); await b.sleep(4500);
  ok(await S(`/WC-01 \\(Wheelchair\\) off radar/.test(document.getElementById('al-log').textContent)`), 'shielded wheelchair -> off-radar event');
  await S(`document.querySelector('#objs [data-sh="WC-01"]').click()`);
  /* ISHA on the dashboard */
  await S(`document.getElementById('isha-q').value = 'where is the nearest oxygen cylinder'; document.getElementById('isha-f').requestSubmit()`); await b.sleep(300);
  ok(await S(`/oxygen cylinder is O2-0\\d/.test(document.querySelector('#isha-a .a').textContent) && /^O2-0/.test(__locus.S.focus)`), 'ISHA answers and highlights: ' + await S(`document.querySelector('#isha-a .a').textContent`));
  /* access gates */
  const send = async (role, dev, where, poc) => { await S(`['role','device','where','poc'].forEach((k, i) => document.querySelector('#ag-' + k + ' [data-v=' + [${JSON.stringify(role)}, ${JSON.stringify(dev)}, ${JSON.stringify(where)}, ${JSON.stringify(poc)}][i] + ']').click()); document.getElementById('ag-send').click()`); await b.sleep(3000); };
  await send('nurseB', 'reg', 'in', 'yes'); ok(await S(`/Ward B · bed 12 · \\d+%/.test(document.getElementById('ans').textContent) && document.getElementById('g3').classList.contains('pass')`), 'Ward B nurse (POC) passes all gates: ' + await S(`document.getElementById('ans').textContent`));
  await send('nurseB', 'reg', 'in', 'no'); ok(await S(`document.getElementById('ans').textContent === 'In building'`), 'not POC -> "In building"');
  await send('guard', 'reg', 'in', 'yes'); await send('guard', 'reg', 'in', 'yes');
  ok(await S(`document.getElementById('g1').classList.contains('fail') && /flagged to admin/.test(document.querySelector('#audit tr').textContent)`), 'guard denied twice -> flagged: ' + await S(`document.querySelector('#audit tr').textContent`));
  await send('admin', 'own', 'in', 'yes'); ok(await S(`document.getElementById('g2').classList.contains('fail') && /not registered/.test(document.getElementById('g2r').textContent)`), 'personal phone stopped at gate 2');
  /* moving beacons: external API, drag-free; arrow + log + distance + direction */
  await S(`document.querySelector('.tabs [data-t=space]').click()`);
  const r = JSON.parse(await S(`(() => { const a = __locus.S.anchors.find(q => q.id === 'A2'), x = a.x + 3, y = a.y - 4; window.__A2 = x; return JSON.stringify(update_beacon_position('A2', x, y, Date.now())); })()`));
  ok(r.ok && r.move.dist.toFixed(1) === '5.0' && r.move.compass === 'north-east' && Math.round(r.move.bearing) === 37, 'update_beacon_position, 3 m east + 4 m north: ' + r.move.text);
  await b.sleep(800);
  ok(await S(`/B2 moved 5\\.0 m toward 37° \\(north-east\\)/.test(document.getElementById('mv-banner').textContent) && /B2/.test(document.querySelector('#mv-log tr').textContent)`), 'banner + movement log: ' + await S(`document.getElementById('mv-banner').textContent`));
  ok(await S(`__locus.eng.loc.anchors.find(a => a.id === 'A2').x === window.__A2`), 'engine uses the new beacon position');
  await S(`document.getElementById('b-allmv').click()`); await b.sleep(6000);
  ok(await S(`__locus.S.anchors.every(a => a.mv) && __locus.MT.log.filter(m => m.id !== 'A2').length >= 2 && __locus.cur.e.loc < 6`), 'all beacons walk: ' + await S(`__locus.MT.log.length`) + ' moves logged, error ' + (await S(`__locus.cur.e.loc`)).toFixed(2) + ' m');
  ok(await S(`__locus.S.anchors.some(a => a.tx !== a.x)`), 'true and believed beacon positions are kept apart');
  await S(`document.getElementById('b-allfx').click()`);
  /* calibration at 10 cm in My room: the range near the beacon then reads in cm */
  await S(`document.querySelector('#spaces [data-sp=room]').click()`); await b.sleep(1500);
  await S(`document.querySelector('.tabs [data-t=beacons]').click(); document.querySelector('#cald [data-d="0.1"]').click(); document.querySelectorAll('#bt .cal')[0].click()`); await b.sleep(3800);
  const cal = JSON.parse(await S(`JSON.stringify(__locus.S.all[0])`));
  ok(cal.cal && cal.cal[0].d === 0.1 && Math.abs(cal.p1 - (-59)) < 4, 'calibrated beacon 1 at 10 cm -> RSSI at 1 m ' + cal.p1 + ' dBm (simulated truth -59)');
  await S(`document.getElementById('b-gcal').click()`); ok(await S(`/10 cm from beacon/.test(document.getElementById('g-text').textContent)`), 'guided calibration uses the chosen distance'); await S(`document.getElementById('g-stop').click()`);
  await S(`window.scrollTo(0,0)`); await b.sleep(400); await b.shot(dir + '/dash_room.png');
  await S(`document.querySelector('#spaces [data-sp=hospital]').click(); document.querySelector('#views [data-v=iso]').click()`); await b.sleep(1500); await b.shot(dir + '/dash_3d.png');
  ok(!b.logs.length, 'no console errors' + (b.logs.length ? ': ' + b.logs.join(' | ') : ''));
  b.close(); console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
