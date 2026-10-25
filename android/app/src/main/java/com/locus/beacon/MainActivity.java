package com.locus.beacon;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.AdvertisingSet;
import android.bluetooth.le.AdvertisingSetCallback;
import android.bluetooth.le.AdvertisingSetParameters;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.util.SparseArray;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * LOCUS ISHA: the phone UI is the same web page as the browser version (assets/phone.html); this activity hosts it in a
 * WebView and gives it what a browser cannot do, through window.LocusNative:
 *   BEACON   : BLE advertising, manufacturer data 0xFFFF = 'L','C', beacon id, height in dm, flags (1 = moving, 2 = has compass),
 *              step count (wraps at 256), compass heading / 2, then the RSSI this beacon hears from beacons 1-6 (0 = none).
 *              Like LOCUS Trio, a beacon also listens to the other beacons, and it reads its own motion sensors, so a carried
 *              beacon can be followed on the map. The packet is refreshed twice a second.
 *   RECEIVER : BLE scanning; packets are pushed to the page in batches (window.__bleBatch([[id, rssi, heightDm], ...]))
 *   ISHA     : speech recognition and text-to-speech
 * The receiver also runs a small HTTP server on port 8080 (dashboard + /api/samples) as an offline fallback on the same Wi-Fi.
 */
public class MainActivity extends Activity {
    static final int COMPANY = 0xFFFF;
    static final int PORT = 8080;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private WebView web;
    private BluetoothLeAdvertiser advertiser;
    private BluetoothLeScanner scanner;
    private boolean advertising = false, scanning = false;
    private SampleServer server;
    private TextToSpeech tts;
    private SpeechRecognizer recognizer;
    private final List<int[]> batch = new ArrayList<>();
    private Runnable afterPerm;
    /* beacon mode: what this beacon senses */
    private boolean beaconMode = false, moving = false, hasHeading = false;
    private int steps = 0;
    private float heading = 0;
    private long moveUntil = 0, lastPeak = 0;
    private final float[] accBuf = new float[50];
    private int accN = 0;
    private float gLow = 9.81f, prevDyn = 0, prevPrevDyn = 0;
    private boolean hwSteps = false;
    private final long[][] peerT = new long[7][12];
    private final int[][] peerR = new int[7][12];
    private final int[] peerN = new int[7];
    private AdvertisingSet advSet;
    private boolean useLegacy = Build.VERSION.SDK_INT < 26;
    private SensorManager sensors;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest r) { r.grant(r.getResources()); }
        });
        web.addJavascriptInterface(new Bridge(), "LocusNative");
        setContentView(web);
        web.loadUrl("file:///android_asset/phone.html");
        tts = new TextToSpeech(this, st -> { if (st == TextToSpeech.SUCCESS) tts.setLanguage(new Locale("en", "IN")); });
        ui.post(flush);
    }

    /* ---------- page <-> native ---------- */
    private void emit(String type, String key, String val) {
        try {
            JSONObject o = new JSONObject(); o.put("type", type); if (key != null) o.put(key, val);
            final String js = "window.__nativeEvent&&window.__nativeEvent(" + o + ")";
            ui.post(() -> web.evaluateJavascript(js, null));
        } catch (Exception ignored) { }
    }

    private final Runnable flush = new Runnable() {
        @Override public void run() {
            String js = null;
            synchronized (batch) {
                if (!batch.isEmpty()) {
                    JSONArray a = new JSONArray();
                    for (int[] p : batch) { JSONArray q = new JSONArray(); for (int v : p) q.put(v); a.put(q); }
                    batch.clear();
                    js = "window.__bleBatch&&window.__bleBatch(" + a + ")";
                }
            }
            if (js != null) web.evaluateJavascript(js, null);
            ui.postDelayed(this, 150);
        }
    };

    class Bridge {
        @JavascriptInterface public boolean isNative() { return true; }
        @JavascriptInterface public String deviceName() { return Build.MANUFACTURER + " " + Build.MODEL; }
        @JavascriptInterface public void startScan() { ui.post(() -> ensure(false, MainActivity.this::startReceiver)); }
        @JavascriptInterface public void stopScan() { ui.post(MainActivity.this::stopReceiver); }
        @JavascriptInterface public void startBeacon(int id, int hDm) { ui.post(() -> ensure(true, () -> startAdvertising(id, hDm))); }
        @JavascriptInterface public void stopBeacon() { ui.post(MainActivity.this::stopAdvertising); }
        @JavascriptInterface public void speak(String t) { if (tts != null) tts.speak(t, TextToSpeech.QUEUE_FLUSH, null, "isha"); }
        @JavascriptInterface public void listen() { ui.post(() -> ensureMic(MainActivity.this::startListening)); }
        @JavascriptInterface public String ips() { return new JSONArray(SampleServer.ips()).toString(); }
    }

    /* ---------- permissions ---------- */
    private String[] needed(boolean advertise) {
        List<String> l = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31) { if (advertise) l.add(Manifest.permission.BLUETOOTH_ADVERTISE); l.add(Manifest.permission.BLUETOOTH_SCAN); l.add(Manifest.permission.BLUETOOTH_CONNECT); }
        l.add(Manifest.permission.ACCESS_FINE_LOCATION);
        return l.toArray(new String[0]);
    }
    private boolean granted(String[] ps) { for (String p : ps) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false; return true; }
    private void ensure(boolean advertise, Runnable go) {
        String[] ps = needed(advertise);
        if (Build.VERSION.SDK_INT < 23 || granted(ps)) { go.run(); return; }
        afterPerm = go; requestPermissions(ps, 7);
    }
    private void ensureMic(Runnable go) {
        String[] ps = {Manifest.permission.RECORD_AUDIO};
        if (Build.VERSION.SDK_INT < 23 || granted(ps)) { go.run(); return; }
        afterPerm = go; requestPermissions(ps, 8);
    }
    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        boolean ok = res.length > 0; for (int r : res) if (r != PackageManager.PERMISSION_GRANTED) ok = false;
        if (ok && afterPerm != null) afterPerm.run();
        else if (code == 8) emit("speechEnd", null, null);
        else emit("status", "text", "Permission denied. Allow Nearby devices (and Location for scanning) in Settings → Apps → LOCUS ISHA.");
        afterPerm = null;
    }
    private BluetoothAdapter adapter() { BluetoothManager m = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE); return m == null ? null : m.getAdapter(); }

    /* ---------- BEACON ---------- */
    private final AdvertiseCallback advCb = new AdvertiseCallback() {
        @Override public void onStartSuccess(AdvertiseSettings s) { boolean first = !advertising; advertising = true; if (first) emitAdv(true, "Sending as beacon " + lastId + " at " + (lastH / 10.0) + " m. Carry it and the map follows it."); }
        @Override public void onStartFailure(int e) { advertising = false; emitAdv(false, "Could not start (code " + e + ")" + (e == 5 ? ": this phone cannot advertise over Bluetooth. Use it as the receiver." : e == 3 ? ": already running." : ".")); }
    };
    private int lastId = 1, lastH = 9;
    private void emitAdv(boolean on, String text) {
        try { JSONObject o = new JSONObject(); o.put("type", "adv"); o.put("on", on); o.put("text", text); final String js = "window.__nativeEvent&&window.__nativeEvent(" + o + ")"; ui.post(() -> web.evaluateJavascript(js, null)); } catch (Exception ignored) { }
    }
    private byte[] payload() {
        byte[] d = new byte[13];
        d[0] = 'L'; d[1] = 'C'; d[2] = (byte) lastId; d[3] = (byte) lastH;
        d[4] = (byte) ((moving ? 1 : 0) | (hasHeading ? 2 : 0)); d[5] = (byte) (steps & 0xff); d[6] = (byte) (((int) (heading / 2)) & 0xff);
        long now = System.currentTimeMillis();
        for (int k = 1; k <= 6; k++) d[6 + k] = (byte) peerMedian(k, now);
        return d;
    }
    private AdvertiseData adData() { return new AdvertiseData.Builder().setIncludeDeviceName(false).setIncludeTxPowerLevel(false).addManufacturerData(COMPANY, payload()).build(); }
    private final AdvertisingSetCallback setCb = new AdvertisingSetCallback() {
        @Override public void onAdvertisingSetStarted(AdvertisingSet set, int txPower, int st) {
            if (st == ADVERTISE_SUCCESS) { advSet = set; advertising = true; emitAdv(true, "Sending as beacon " + lastId + " at " + (lastH / 10.0) + " m. Carry it and the map follows it."); }
            else { useLegacy = true; startLegacy(); }
        }
        @Override public void onAdvertisingSetStopped(AdvertisingSet set) { advSet = null; }
    };
    private void startAdvertising(int id, int hDm) {
        BluetoothAdapter a = adapter();
        if (a == null || !a.isEnabled()) { emitAdv(false, "Turn Bluetooth on first."); return; }
        advertiser = a.getBluetoothLeAdvertiser();
        if (advertiser == null) { emitAdv(false, "This phone cannot advertise over Bluetooth. Use it as the receiver."); return; }
        stopAdvertising();
        lastId = id; lastH = Math.max(0, Math.min(127, hDm)); beaconMode = true;
        startSensors(); startScanning(a);
        if (!useLegacy) {
            try {
                AdvertisingSetParameters ps = new AdvertisingSetParameters.Builder().setLegacyMode(true).setConnectable(false).setScannable(false)
                        .setInterval(AdvertisingSetParameters.INTERVAL_LOW).setTxPowerLevel(AdvertisingSetParameters.TX_POWER_HIGH).build();
                advertiser.startAdvertisingSet(ps, adData(), null, null, null, setCb);
            } catch (Exception e) { useLegacy = true; startLegacy(); }
        } else startLegacy();
        ui.removeCallbacks(beaconTick); ui.postDelayed(beaconTick, 500);
    }
    private void startLegacy() {
        try {
            AdvertiseSettings s = new AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                    .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH).setConnectable(false).setTimeout(0).build();
            advertiser.startAdvertising(s, adData(), advCb);
        } catch (Exception e) { emitAdv(false, "Could not start: " + e.getMessage()); }
    }
    private int tickNo = 0;
    /* twice a second: refresh the packet with the latest motion + readings, and show them on the beacon screen */
    private final Runnable beaconTick = new Runnable() {
        @Override public void run() {
            if (!beaconMode) return;
            tickNo++;
            if (System.currentTimeMillis() > moveUntil) moving = false;
            try {
                if (advSet != null) advSet.setAdvertisingData(adData());
                else if (useLegacy && advertising && advertiser != null && tickNo % 2 == 0) { advertiser.stopAdvertising(advCb); startLegacy(); }
            } catch (Exception ignored) { }
            try {
                JSONObject o = new JSONObject(); o.put("type", "self"); o.put("moving", moving); o.put("steps", steps); if (hasHeading) o.put("head", heading);
                JSONObject pe = new JSONObject(); long now = System.currentTimeMillis(); for (int k = 1; k <= 6; k++) { int r = peerMedian(k, now); if (r != 0) pe.put(String.valueOf(k), r); } o.put("peers", pe);
                final String js = "window.__nativeEvent&&window.__nativeEvent(" + o + ")"; web.evaluateJavascript(js, null);
            } catch (Exception ignored) { }
            ui.postDelayed(this, 500);
        }
    };
    private void stopAdvertising() {
        beaconMode = false; ui.removeCallbacks(beaconTick);
        try { if (advertiser != null) { if (advSet != null) advertiser.stopAdvertisingSet(setCb); advertiser.stopAdvertising(advCb); } } catch (Exception ignored) { }
        advSet = null;
        stopSensors();
        try { if (scanner != null && scanning && server == null) { scanner.stopScan(scanCb); scanning = false; } } catch (Exception ignored) { }
        if (advertising) emitAdv(false, "Not sending.");
        advertising = false;
    }

    /* ---------- motion sensors (beacon mode): moving yes/no, steps, compass ---------- */
    private final SensorEventListener sensorCb = new SensorEventListener() {
        @Override public void onSensorChanged(SensorEvent e) {
            int ty = e.sensor.getType(); long now = System.currentTimeMillis();
            if (ty == Sensor.TYPE_ACCELEROMETER) {
                float m = (float) Math.sqrt(e.values[0] * e.values[0] + e.values[1] * e.values[1] + e.values[2] * e.values[2]);
                gLow += 0.05f * (m - gLow); float dyn = m - gLow;
                accBuf[accN % accBuf.length] = dyn; accN++;
                if (accN >= accBuf.length) { float s = 0; for (float v : accBuf) s += v * v; if (Math.sqrt(s / accBuf.length) > 0.6) { moving = true; moveUntil = now + 1500; } }
                if (!hwSteps && prevDyn > 1.3f && prevDyn >= prevPrevDyn && prevDyn > dyn && now - lastPeak > 300) { steps++; lastPeak = now; moving = true; moveUntil = now + 1500; }
                prevPrevDyn = prevDyn; prevDyn = dyn;
            } else if (ty == Sensor.TYPE_STEP_DETECTOR) { steps++; moving = true; moveUntil = now + 1500; }
            else if (ty == Sensor.TYPE_ROTATION_VECTOR) {
                float[] R = new float[9], o = new float[3]; SensorManager.getRotationMatrixFromVector(R, e.values); SensorManager.getOrientation(R, o);
                heading = (float) ((Math.toDegrees(o[0]) + 360) % 360); hasHeading = true;
            }
        }
        @Override public void onAccuracyChanged(Sensor s, int a) { }
    };
    private void startSensors() {
        sensors = (SensorManager) getSystemService(Context.SENSOR_SERVICE); if (sensors == null) return;
        Sensor acc = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER), st = sensors.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR), rot = sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
        if (acc != null) sensors.registerListener(sensorCb, acc, SensorManager.SENSOR_DELAY_GAME);
        hwSteps = st != null && (Build.VERSION.SDK_INT < 29 || checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED);
        if (hwSteps) sensors.registerListener(sensorCb, st, SensorManager.SENSOR_DELAY_GAME);
        if (rot != null) sensors.registerListener(sensorCb, rot, SensorManager.SENSOR_DELAY_UI);
    }
    private void stopSensors() { try { if (sensors != null) sensors.unregisterListener(sensorCb); } catch (Exception ignored) { } }

    /* RSSI this beacon hears from beacon k: median of the last 2 s (0 = none) */
    private synchronized void addPeer(int k, int rssi) { int n = peerN[k] % 12; peerR[k][n] = rssi; peerT[k][n] = System.currentTimeMillis(); peerN[k]++; }
    private synchronized int peerMedian(int k, long now) {
        if (k == lastId) return 0; int[] v = new int[12]; int c = 0;
        for (int i = 0; i < 12; i++) if (peerT[k][i] > 0 && now - peerT[k][i] < 2000) v[c++] = peerR[k][i];
        if (c == 0) return 0; int[] s = Arrays.copyOf(v, c); Arrays.sort(s); return Math.max(-127, Math.min(-1, s[c / 2]));
    }

    /* ---------- RECEIVER ---------- */
    private final ScanCallback scanCb = new ScanCallback() {
        @Override public void onScanResult(int type, ScanResult r) { handle(r); }
        @Override public void onBatchScanResults(List<ScanResult> rs) { for (ScanResult r : rs) handle(r); }
        @Override public void onScanFailed(int e) { scanning = false; emit("status", "text", "Bluetooth scan failed (code " + e + "). Turn Bluetooth off and on."); }
    };
    private void handle(ScanResult r) {
        if (r.getScanRecord() == null) return;
        SparseArray<byte[]> m = r.getScanRecord().getManufacturerSpecificData();
        byte[] d = m == null ? null : m.get(COMPANY);
        if (d == null || d.length < 3 || d[0] != 'L' || d[1] != 'C') return;
        int id = d[2]; if (id < 1 || id > 6) return;
        int h = d.length >= 4 ? d[3] : 0;
        if (beaconMode) { addPeer(id, r.getRssi()); return; }
        if (server != null) server.add(id, r.getRssi());
        int[] q;
        if (d.length >= 13) { q = new int[12]; q[0] = id; q[1] = r.getRssi(); q[2] = h; q[3] = d[4] & 0xff; q[4] = d[5] & 0xff; q[5] = d[6] & 0xff; for (int k = 0; k < 6; k++) q[6 + k] = d[7 + k]; }
        else q = new int[]{id, r.getRssi(), h};
        synchronized (batch) { batch.add(q); if (batch.size() > 400) batch.subList(0, 100).clear(); }
    }
    private void startScanning(BluetoothAdapter a) {
        if (scanning) return; scanner = a.getBluetoothLeScanner(); if (scanner == null) return;
        try { scanner.startScan(null, new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).setReportDelay(0).build(), scanCb); scanning = true; } catch (Exception ignored) { }
    }
    private void startReceiver() {
        beaconMode = false;
        try { if (server == null) { server = new SampleServer(getAssets(), PORT, Build.MODEL); server.start(); } } catch (Exception e) { server = null; }
        BluetoothAdapter a = adapter();
        if (a == null || !a.isEnabled()) { emit("status", "text", "Turn Bluetooth on, then pick Real Bluetooth again."); return; }
        if (Build.VERSION.SDK_INT >= 28) {
            LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            if (lm != null && !lm.isLocationEnabled()) { emit("status", "text", "Turn Location ON (Android needs it for Bluetooth scanning). Nothing is sent anywhere."); return; }
        }
        scanner = a.getBluetoothLeScanner();
        if (scanner == null) { emit("status", "text", "Bluetooth scanner unavailable."); return; }
        if (scanning) return;
        // No hardware filter: some phones (certain OPPO / ColorOS builds) drop manufacturer-data filters. We filter in handle().
        ScanSettings s = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).setReportDelay(0).build();
        scanner.startScan(null, s, scanCb);
        scanning = true;
        List<String> ips = SampleServer.ips();
        emit("status", "text", "Listening for real beacons." + (ips.isEmpty() ? "" : " Same-Wi-Fi fallback: http://" + ips.get(0) + ":" + PORT + "/"));
    }
    private void stopReceiver() {
        if (beaconMode) return;   /* the beacon's own listening is stopped with the beacon */
        try { if (scanner != null && scanning) scanner.stopScan(scanCb); } catch (Exception ignored) { }
        scanning = false;
        if (server != null) { server.stop(); server = null; }
    }

    /* ---------- ISHA voice ---------- */
    private void startListening() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { emit("speechEnd", null, null); emit("status", "text", "No speech recognition on this phone. Type to ISHA instead."); return; }
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onResults(Bundle r) { ArrayList<String> l = r.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION); emit("speech", "text", l != null && !l.isEmpty() ? l.get(0) : ""); }
                @Override public void onError(int e) { emit("speechEnd", null, null); }
                @Override public void onReadyForSpeech(Bundle p) { }
                @Override public void onBeginningOfSpeech() { }
                @Override public void onRmsChanged(float v) { }
                @Override public void onBufferReceived(byte[] b) { }
                @Override public void onEndOfSpeech() { }
                @Override public void onPartialResults(Bundle p) { }
                @Override public void onEvent(int t, Bundle p) { }
            });
        }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN");
        recognizer.startListening(i);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.__phone&&__phone.P.scr!=='home')?(document.getElementById('b-back').click(),'1'):'0'", v -> { if (!"\"1\"".equals(v)) finish(); });
    }

    @Override
    protected void onDestroy() {
        stopAdvertising(); beaconMode = false; stopReceiver();
        if (tts != null) tts.shutdown();
        if (recognizer != null) recognizer.destroy();
        super.onDestroy();
    }
}
