/* Minimal headless-Chrome driver (no deps): node scripts/cdp.js <url> <scenario.js> */
const { spawn } = require('child_process'), fs = require('fs'), path = require('path');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
async function launch(url, w = 1280, h = 860, mobile = false, tries = 0) {
  const port = 9300 + (process.pid * 13 + (launch.n = (launch.n || 0) + 1) * 53) % 600, dir = path.join(require('os').tmpdir(), 'cdp' + port);
  const p = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + dir, '--no-first-run', '--disable-gpu', '--window-size=' + w + ',' + h, 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 60; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (tabs.length) break; } catch (e) { } await new Promise(r => setTimeout(r, 250)); }
  if (!tabs || !tabs.find(t => t.type === 'page')) { try { p.kill(); } catch (e) { } if (tries < 3) return launch(url, w, h, mobile, tries + 1); throw new Error('Chrome did not start'); }   /* port busy or slow start: try another port */
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(), logs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails.text)); else if (d.method === 'Runtime.consoleAPICalled' && /error|warning/.test(d.params.type)) logs.push(d.params.type + ' ' + d.params.args.map(a => a.value || a.description).join(' ')); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await send('Page.navigate', { url }); await new Promise(r => setTimeout(r, 1500));
  const ev = async js => { const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails)); return r.result.result.value; };
  const shot = async f => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(f, Buffer.from(r.result.data, 'base64')); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const close = () => { try { ws.close(); p.kill(); } catch (e) { } };
  return { ev, shot, sleep, logs, close, send };
}
module.exports = { launch };
if (require.main === module) (async () => { const b = await launch(process.argv[2]); try { await require(path.resolve(process.argv[3]))(b); } catch (e) { console.log('SCENARIO ERROR', e.message); } console.log('console issues:', b.logs.length ? b.logs : 'none'); b.close(); process.exit(0); })();
