"""python build.py -> dashboard.html, phone.html, moving.html (self-contained: engine, model and libraries inlined, no CDN)
and copies phone.html + dashboard.html into the Android app's assets."""
import pathlib, shutil
R = pathlib.Path(__file__).parent
r = lambda f: (R / f).read_text(encoding='utf-8')
vendor = ''   # no third-party libraries: the code link is our own small MQTT client (src/relay.js)
shared = r('src/engine.js') + r('src/trust_model.js') + r('src/room_core.js') + r('src/radio.js') + r('src/assets.js') + r('src/access.js') + r('src/isha.js') + r('src/relay.js')

# the head of the dashboard template (CSS) is kept in _head.html, the rest in _body.html
(R / 'src/dashboard.template.html').write_text(r('src/_head.html') + r('src/_body.html'), encoding='utf-8')
dash = shared + r('src/moving/motion.js') + r('src/dash.js') + r('src/dash_more.js') + '\ninit();\n'
out = {}
out['dashboard.html'] = r('src/dashboard.template.html').replace('/*__VENDOR__*/', vendor).replace('/*__APP__*/', dash)
out['phone.html'] = r('src/phone.template.html').replace('/*__VENDOR__*/', vendor).replace('/*__APP__*/', shared + r('src/phone.js'))
mv = ''.join(r('src/moving/' + f + '.js') for f in ['config', 'motion', 'sim', 'estimator', 'compare'])
out['moving.html'] = r('src/moving.template.html').replace('/*__ENGINE__*/', r('src/engine.js')).replace('/*__MOVING__*/', mv).replace('/*__APP__*/', r('src/moving/dashboard.js'))
for k, v in out.items():
    (R / k).write_text(v, encoding='utf-8'); print('built', k, len(v) // 1024, 'KB')
a = R / 'android/app/src/main/assets'; a.mkdir(parents=True, exist_ok=True)
for k in ['phone.html', 'dashboard.html']: shutil.copy(R / k, a / k)
