package com.locus.beacon;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
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
import java.util.List;
import java.util.Locale;

/**
 * LOCUS ISHA: the phone UI is the same web page as the browser version (assets/phone.html); this activity hosts it in a
 * WebView and gives it what a browser cannot do, through window.LocusNative:
 *   BEACON   : BLE advertising, manufacturer data 0xFFFF = 'L','C', beacon id, height in decimetres
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
                    for (int[] p : batch) { JSONArray q = new JSONArray(); q.put(p[0]); q.put(p[1]); q.put(p[2]); a.put(q); }
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
        if (Build.VERSION.SDK_INT >= 31) { l.add(advertise ? Manifest.permission.BLUETOOTH_ADVERTISE : Manifest.permission.BLUETOOTH_SCAN); l.add(Manifest.permission.BLUETOOTH_CONNECT); }
        if (!advertise) l.add(Manifest.permission.ACCESS_FINE_LOCATION);
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
        @Override public void onStartSuccess(AdvertiseSettings s) { advertising = true; emitAdv(true, "Sending as beacon " + lastId + " at " + (lastH / 10.0) + " m. Leave the app open."); }
        @Override public void onStartFailure(int e) { advertising = false; emitAdv(false, "Could not start (code " + e + ")" + (e == 5 ? ": this phone cannot advertise over Bluetooth. Use it as the receiver." : e == 3 ? ": already running." : ".")); }
    };
    private int lastId = 1, lastH = 9;
    private void emitAdv(boolean on, String text) {
        try { JSONObject o = new JSONObject(); o.put("type", "adv"); o.put("on", on); o.put("text", text); final String js = "window.__nativeEvent&&window.__nativeEvent(" + o + ")"; ui.post(() -> web.evaluateJavascript(js, null)); } catch (Exception ignored) { }
    }
    private void startAdvertising(int id, int hDm) {
        BluetoothAdapter a = adapter();
        if (a == null || !a.isEnabled()) { emitAdv(false, "Turn Bluetooth on first."); return; }
        advertiser = a.getBluetoothLeAdvertiser();
        if (advertiser == null) { emitAdv(false, "This phone cannot advertise over Bluetooth. Use it as the receiver."); return; }
        if (advertising) try { advertiser.stopAdvertising(advCb); } catch (Exception ignored) { }
        lastId = id; lastH = Math.max(0, Math.min(127, hDm));
        AdvertiseSettings s = new AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH).setConnectable(false).setTimeout(0).build();
        AdvertiseData d = new AdvertiseData.Builder().setIncludeDeviceName(false).setIncludeTxPowerLevel(false)
                .addManufacturerData(COMPANY, new byte[]{'L', 'C', (byte) id, (byte) lastH}).build();
        advertiser.startAdvertising(s, d, advCb);
    }
    private void stopAdvertising() {
        try { if (advertiser != null) advertiser.stopAdvertising(advCb); } catch (Exception ignored) { }
        if (advertising) emitAdv(false, "Not sending.");
        advertising = false;
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
        if (server != null) server.add(id, r.getRssi());
        synchronized (batch) { batch.add(new int[]{id, r.getRssi(), h}); if (batch.size() > 400) batch.subList(0, 100).clear(); }
    }
    private void startReceiver() {
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
        stopAdvertising(); stopReceiver();
        if (tts != null) tts.shutdown();
        if (recognizer != null) recognizer.destroy();
        super.onDestroy();
    }
}
