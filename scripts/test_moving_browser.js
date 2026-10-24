/* Headless-Chrome end-to-end check of moving.html: node scripts/test_moving_browser.js [url]  (serve the repo first: python -m http.server 8765) */
const { launch } = require('./cdp.js'); let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
(async () => {
  const b = await launch(process.argv[2] || 'http://localhost:8790/moving.html'); await b.sleep(3000);
  ok(await b.ev(`__mb.world.t > 2 && __mb.out && __mb.out.window > 20 && /^[0-9]+$/.test(document.getElementById('k-win').textContent)`), 'simulation + estimator run; readings-in-window shown: ' + await b.ev(`document.getElementById('k-win').textContent`));
  /* external update: A2 (11,1) -> (8,5): dx -3, dy +4 = 5.0 m toward 323° north-west */
  const r = JSON.parse(await b.ev(`JSON.stringify(update_beacon_position('A2', 8, 5, Date.now()))`));
  ok(r.ok && r.move && r.move.dist.toFixed(1) === '5.0' && Math.round(r.move.bearing) === 323 && r.move.compass === 'north-west', 'update_beacon_position returns the move at once: ' + (r.move && r.move.text));
  ok(await b.ev(`document.getElementById('banner-t').textContent.startsWith('A2 moved 5.0 m toward 323° (north-west) · dx = −3.0 m, dy = +4.0 m')`), 'banner: ' + await b.ev(`document.getElementById('banner-t').textContent`));
  ok(await b.ev(`(()=>{ const td = document.querySelectorAll('#log tr')[0].children; return td[1].textContent === 'A2' && td[2].textContent.startsWith('5.00 m') && td[3].textContent === '323° north-west' && td[4].textContent === 'dx −3.0, dy +4.0'; })()`), 'movement log row: ' + await b.ev(`document.querySelectorAll('#log tr')[0].textContent`));
  ok(await b.ev(`(()=>{ const s = __mb.trk.stats('A2', __mb.world.t); return s.seg && s.seg.from[0] === 11 && s.seg.from[1] === 1 && s.seg.to[0] === 8 && s.seg.to[1] === 5; })()`), 'map arrow goes from the old (11, 1) to the new (8, 5) position');
  await b.sleep(1500); ok(await b.ev(`__mb.est.anchors.find(a => a.id === 'A2').x === 8 && __mb.est.anchors.find(a => a.id === 'A2').y === 5`), 'estimator uses A2 at its new position');
  /* drag A1 from (1,1) to (4,1) with real mouse events */
  const [x0, y0] = JSON.parse(await b.ev(`JSON.stringify(__mb.screen(1, 1))`)), [x1, y1] = JSON.parse(await b.ev(`JSON.stringify(__mb.screen(4, 1))`));
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 });
  for (let k = 1; k <= 10; k++) { await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * k / 10, y: y0 + (y1 - y0) * k / 10, button: 'left', buttons: 1 }); await b.sleep(40); }
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1 }); await b.sleep(1500);
  const a1 = JSON.parse(await b.ev(`JSON.stringify(__mb.trk.log.find(m => m.id === 'A1'))`));
  ok(a1 && Math.abs(a1.dist - 3) < 0.05 && Math.abs(a1.bearing - 90) < 1 && a1.compass === 'east', `drag A1 3 m east: log says ${a1 && a1.dist.toFixed(2)} m toward ${a1 && a1.bearing.toFixed(0)}° ${a1 && a1.compass}`);
  ok(await b.ev(`Math.abs(__mb.world.get('A1').believed[0] - 4) < 0.05 && Math.abs(__mb.trk.stats('A1', __mb.world.t).total - 3) < 0.1`), 'A1 marker at x = 4, total moved 3.0 m');
  /* per-beacon controls */
  await b.ev(`document.querySelector('.bc[data-id=A3] [data-m=moving]').click()`); await b.sleep(6000);
  ok(await b.ev(`__mb.world.get('A3').mode === 'moving' && __mb.trk.log.some(m => m.id === 'A3') && __mb.trk.stats('A3', __mb.world.t).trail.length > 3`), 'A3 switched to Moving: it walks, gets log entries and a trail');
  ok(await b.ev(`/readings in window/.test(document.querySelector('.bc[data-id=A3] .lm').textContent) && parseFloat(document.querySelector('.bc[data-id=A3] .rc').textContent) > 0`), 'A3 card: last-10 s distance + readings in window: ' + await b.ev(`document.querySelector('.bc[data-id=A3] .lm').textContent`));
  await b.ev(`document.querySelector('.bc[data-id=A4] [data-a=kill]').click()`); await b.sleep(2500);
  ok(await b.ev(`(()=>{ const i = __mb.out.ids.indexOf('A4'); return __mb.out.trust[i] < 0.05 && /No packets/.test(__mb.out.reasons[i]); })()`), 'kill A4: trust 0, "No packets"');
  await b.ev(`document.getElementById('b-add').click()`); await b.sleep(500); ok(await b.ev(`__mb.world.beacons.length === 5 && __mb.out.ids.length === 5 && document.querySelectorAll('.bc').length === 5`), 'add beacon');
  await b.ev(`document.querySelector('.bc[data-id=A5] [data-a=rm]').click()`); await b.sleep(400); ok(await b.ev(`__mb.world.beacons.length === 4`), 'remove beacon');
  await b.ev(`document.getElementById('b-pause').click()`); const t1 = await b.ev(`__mb.world.t`); await b.sleep(800); ok(await b.ev(`__mb.world.t`) === t1, 'pause stops the clock');
  await b.ev(`document.getElementById('b-pause').click(); document.getElementById('b-reset').click()`); await b.sleep(300); ok(await b.ev(`__mb.world.t < 1 && __mb.trk.log.length === 0 && __mb.world.beacons.every(b => b.mode === 'fixed' && !b.dead)`), 'reset');
  /* comparison (shortened for the test) */
  await b.ev(`__mb.CFG.compare.seconds = 20; __mb.CFG.compare.seeds = [1]; document.getElementById('b-cmp').click()`); await b.sleep(9000);
  ok(await b.ev(`document.querySelectorAll('#cmp-out tbody tr').length === 4 && /lowered the mean error in [0-9] of 4 layouts/.test(document.getElementById('cmp-out').textContent)`), 'comparison table: ' + await b.ev(`[...document.querySelectorAll('#cmp-out tbody tr')].map(r => r.textContent).join(' | ')`));
  ok(!b.logs.length, 'no console errors' + (b.logs.length ? ': ' + b.logs.join(' | ') : '')); b.close(); console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
