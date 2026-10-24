package com.locus.beacon;

import android.content.res.AssetManager;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Tiny HTTP server (no libraries, no internet needed).
 *   GET /                      the LOCUS dashboard (bundled in the APK assets)
 *   GET /api/samples?since=N   BLE RSSI samples newer than sequence N: [[seq, beaconId, rssi, msAgo], ...]
 * The laptop browser, or this phone's own browser (http://127.0.0.1:8080), opens it over the phone's hotspot / same Wi-Fi.
 */
public class SampleServer {
    private final AssetManager assets;
    private final int port;
    private final String device;
    private ServerSocket server;
    private volatile boolean running;
    private final List<long[]> buf = new ArrayList<>(); // seq, id, rssi, timeMs
    private long seq = 0;
    private byte[] pageCache;

    /** this phone's IPv4 addresses (hotspot / Wi-Fi), for the same-network fallback */
    public static List<String> ips() {
        List<String> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) if (a instanceof Inet4Address && !a.isLoopbackAddress()) out.add(a.getHostAddress());
            }
        } catch (Exception ignored) { }
        return out;
    }

    public SampleServer(AssetManager assets, int port, String device) {
        this.assets = assets;
        this.port = port;
        this.device = device;
    }

    public synchronized void add(int id, int rssi) {
        buf.add(new long[]{++seq, id, rssi, System.currentTimeMillis()});
        if (buf.size() > 4000) buf.subList(0, 1000).clear();
    }

    public synchronized long total() { return seq; }

    private synchronized String samplesJson(long since) {
        long now = System.currentTimeMillis();
        StringBuilder sb = new StringBuilder("{\"seq\":").append(seq).append(",\"device\":\"").append(device).append("\",\"samples\":[");
        boolean first = true;
        for (long[] s : buf) {
            if (s[0] <= since) continue;
            if (!first) sb.append(',');
            first = false;
            sb.append('[').append(s[0]).append(',').append(s[1]).append(',').append(s[2]).append(',').append(now - s[3]).append(']');
        }
        return sb.append("]}").toString();
    }

    public void start() throws Exception {
        server = new ServerSocket(port, 20, (InetAddress) null);
        running = true;
        Thread t = new Thread(() -> {
            while (running) {
                try {
                    final Socket c = server.accept();
                    new Thread(() -> handle(c)).start();
                } catch (Exception e) {
                    if (!running) return;
                }
            }
        }, "locus-http");
        t.setDaemon(true);
        t.start();
    }

    public void stop() {
        running = false;
        try { if (server != null) server.close(); } catch (Exception ignored) { }
    }

    private byte[] page() throws Exception {
        if (pageCache == null) {
            try (InputStream in = assets.open("dashboard.html")) {
                ByteArrayOutputStream o = new ByteArrayOutputStream();
                byte[] b = new byte[8192];
                int n;
                while ((n = in.read(b)) > 0) o.write(b, 0, n);
                pageCache = o.toByteArray();
            }
        }
        return pageCache;
    }

    private void handle(Socket c) {
        try {
            c.setSoTimeout(3000);
            InputStream in = c.getInputStream();
            StringBuilder line = new StringBuilder();
            int ch;
            while ((ch = in.read()) != -1 && ch != '\n') if (ch != '\r') line.append((char) ch);
            // drain headers
            int prev = 0, run = 0;
            while (run < 2 && (ch = in.read()) != -1) { if (ch == '\n') run++; else if (ch != '\r') run = 0; prev = ch; }
            String[] p = line.toString().split(" ");
            String method = p.length > 0 ? p[0] : "", target = p.length > 1 ? p[1] : "/";
            String path = target, query = "";
            int q = target.indexOf('?');
            if (q >= 0) { path = target.substring(0, q); query = target.substring(q + 1); }
            byte[] body;
            String type = "application/json";
            int code = 200;
            if (method.equals("OPTIONS")) { body = new byte[0]; code = 204; }
            else if (path.equals("/api/samples")) {
                long since = 0;
                for (String kv : query.split("&")) if (kv.startsWith("since=")) try { since = Long.parseLong(kv.substring(6)); } catch (Exception ignored) { }
                body = samplesJson(since).getBytes(StandardCharsets.UTF_8);
            } else if (path.equals("/") || path.equals("/index.html") || path.equals("/dashboard.html")) {
                body = page();
                type = "text/html; charset=utf-8";
            } else { body = "not found".getBytes(StandardCharsets.UTF_8); type = "text/plain"; code = 404; }
            String head = "HTTP/1.1 " + code + (code == 200 ? " OK" : code == 204 ? " No Content" : " Not Found") + "\r\nContent-Type: " + type
                    + "\r\nContent-Length: " + body.length + "\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Allow-Headers: *\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
            OutputStream out = c.getOutputStream();
            out.write(head.getBytes(StandardCharsets.UTF_8));
            out.write(body);
            out.flush();
        } catch (Exception ignored) {
        } finally {
            try { c.close(); } catch (Exception ignored) { }
        }
    }
}
