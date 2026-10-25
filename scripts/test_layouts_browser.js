/* Saved layouts + blueprints: open each, edit walls / zones / beacons, save, reload, export shape. node scripts/test_layouts_browser.js [baseUrl] */
const { launch } = require('./cdp.js'); let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
(async () => {
  const base = process.argv[2] || 'http://localhost:8790/', dir = process.env.SHOT_DIR || '.';
  const b = await launch(base + 'dashboard.html', 1280, 900); await b.sleep(3500); const S = js => b.ev(js);
  await S(`localStorage.removeItem('locus.isha.layouts.v1'); __locus.renderLayouts && 0; document.getElementById('l-reset').click()`); await b.sleep(200);
  const names = await S(`[...document.querySelectorAll('#bp-list .bp b')].map(x => x.textContent).join(' | ')`);
  ok(names === 'Hospital floor | Warehouse | Clinic OPD | Office floor | Home 2BHK', 'five blueprints listed: ' + names);
  const open = async nm => { await S(`[...document.querySelectorAll('#bp-list .bp')].find(x => x.querySelector('b').textContent === ${JSON.stringify(nm)}).click()`); await b.sleep(2500); };
  await open('Warehouse');
  ok(await S(`__locus.S.space === 'warehouse' && ROOMS.some(r => r.name === 'Aisle B') && __locus.cur.out && __locus.cur.e.loc < 5`), 'Warehouse opens: aisles, tracking, error ' + (await S(`__locus.cur.e.loc`)).toFixed(2) + ' m');
  ok(await S(`__locus.S.assets.list().some(a => /Aisle|Receiving|Dispatch/.test(a.zone))`), 'objects are placed in warehouse zones: ' + await S(`__locus.S.assets.list().slice(0,3).map(a => a.id + ' ' + a.zone).join(', ')`));
  await b.shot(dir + '/lay_warehouse.png');
  for (const nm of ['Clinic OPD', 'Office floor', 'Home 2BHK']) {
    await open(nm); await b.sleep(6000);
    const r = JSON.parse(await S(`JSON.stringify({ sp: __locus.S.space, W: __locus.S.W, walls: __locus.S.plan.walls.length, zones: __locus.S.plan.rooms.map(z => z.name), err: (a => a[a.length >> 1])([...__locus.stats.loc].sort((x, y) => x - y)), zone: __locus.S.assets.list()[0].zone, moved: __locus.S.path })`));
    ok(r.sp === 'room' && r.walls >= 3 && r.zones.length >= 3 && r.err != null && r.err < 3.5, `${nm}: ${r.W} m wide, ${r.walls} walls, zones ${r.zones.join(' / ')}, median error ${r.err.toFixed(2)} m`);
    ok(r.zones.some(z => r.zone.startsWith(z)) && r.moved > 1, `${nm}: objects named by zone (WC-01 in ${r.zone}), walker moves through doors (${r.moved.toFixed(1)} m)`);
  }
  await b.shot(dir + '/lay_home.png');
  /* edit: add a wall + a zone by tapping the floor, move a beacon, save under a new name */
  await S(`document.querySelector('.tabs [data-t=space]').click()`); await b.sleep(300);
  const tap = async (x, y) => { const p = JSON.parse(await S(`JSON.stringify((() => { const V = makeView({ tilt: __locus.S.view.tilt, yaw: __locus.S.view.yaw, cx: __locus.S.W / 2, cy: __locus.S.H / 2, cz: __locus.S.Z / 2, ox: 0, oy: 0, s: 1 }); return null; })())`)); };
  const walls0 = await S(`__locus.S.plan.walls.length`);
  await S(`document.querySelector('#ed-tools [data-ed=wall]').click()`); await b.sleep(900);
  const pt = async (x, y) => JSON.parse(await S(`JSON.stringify(__locus.screen(${x}, ${y}))`));
  const click = async (x, y) => { const [sx, sy] = await pt(x, y); await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1 }); await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx, y: sy, button: 'left', clickCount: 1 }); await b.sleep(250); };
  await click(2, 0.2); await click(2.05, 4.4);
  ok(await S(`__locus.S.plan.walls.length`) === walls0 + 1 && await S(`(() => { const w = __locus.S.plan.walls[__locus.S.plan.walls.length - 1]; return w[0] === w[2]; })()`), 'tapping the floor twice draws a (straightened) wall: ' + await S(`JSON.stringify(__locus.S.plan.walls[__locus.S.plan.walls.length - 1])`));
  await S(`document.querySelector('#ed-tools [data-ed=zone]').click(); document.getElementById('z-name').value = 'Puja room'`); await click(0.9, 0.9); await click(2.6, 3);
  ok(await S(`__locus.S.plan.rooms[0].name === 'Puja room' && ROOMS.some(r => r.name === 'Puja room')`), 'zone "Puja room" added and used by the engine');
  await S(`document.querySelector('#ed-tools [data-ed=zone]').click()`);
  await S(`update_beacon_position('A2', 5, 4)`);
  await S(`document.querySelector('.tabs [data-t=beacons]').click(); document.getElementById('l-name').value = 'My flat'; document.getElementById('l-save').click()`); await b.sleep(300);
  ok(await S(`[...document.querySelectorAll('#bp-list .bp b')].some(x => x.textContent === 'My flat') && /Saved "My flat"/.test(document.getElementById('l-note').textContent)`), 'saved as a new layout "My flat"');
  await open('Hospital floor'); ok(await S(`__locus.S.space === 'hospital'`), 'switch to the hospital');
  await open('My flat');
  ok(await S(`__locus.S.plan.rooms.some(r => r.name === 'Puja room') && __locus.S.all[1].x === 5 && __locus.S.plan.walls.length === ${walls0 + 1}`), 'reopening "My flat" restores the wall, the zone and the moved beacon');
  const ex = JSON.parse(await S(`JSON.stringify(snapshotLayout('x'))`));
  ok(ex.v === 1 && ex.slots.length === 6 && ex.walls.length === walls0 + 1 && ex.rooms.length >= 4, 'export format: size, walls, zones, 6 beacon slots with heights');
  await S(`document.getElementById('l-del').click()`); await b.sleep(200); ok(!(await S(`[...document.querySelectorAll('#bp-list .bp b')].some(x => x.textContent === 'My flat')`)), 'delete removes it');
  ok(!b.logs.length, 'no console errors' + (b.logs.length ? ': ' + b.logs.join(' | ') : ''));
  b.close(); console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
