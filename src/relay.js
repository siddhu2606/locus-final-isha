/* ===== LOCUS relay: phone <-> laptop over the internet with a 6-digit code, through any Wi-Fi / mobile network.
   A tiny MQTT 3.1.1 client over secure WebSocket (no library) to a public broker, with fallbacks.
   Topics: locus-isha/<code>/up (phone -> laptop) and locus-isha/<code>/down (laptop -> phone). JSON payloads, QoS 0.
   Prototype note: public brokers are open; anyone who knows the code can read the stream. ===== */
const RELAY_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
class Relay {
  /* role 'phone' publishes up / listens down; role 'laptop' the reverse. onMsg(obj), onState('connecting'|'online'|'offline', broker) */
  constructor(code, role, onMsg, onState) { this.code = code; this.role = role; this.onMsg = onMsg; this.onState = onState || (() => { }); this.bi = 0; this.ws = null; this.on = false; this.closed = false; this.buf = new Uint8Array(0); this.pid = 1; }
  get topicOut() { return 'locus-isha/' + this.code + (this.role === 'phone' ? '/up' : '/down'); }
  get topicIn() { return 'locus-isha/' + this.code + (this.role === 'phone' ? '/down' : '/up'); }
  connect() {
    if (this.closed) return; const url = RELAY_BROKERS[this.bi % RELAY_BROKERS.length]; this.onState('connecting', url);
    let ws; try { ws = new WebSocket(url, ['mqtt']); } catch (e) { return this._retry(); }
    this.ws = ws; ws.binaryType = 'arraybuffer'; const t0 = setTimeout(() => { if (!this.on) try { ws.close(); } catch (e) { } }, 7000);
    ws.onopen = () => { const id = 'locus-' + this.role + '-' + Math.random().toString(36).slice(2, 10); ws.send(Relay._pkt(0x10, [...Relay._str('MQTT'), 4, 0x02, 0, 30], Relay._str(id))); };
    ws.onmessage = e => { const d = new Uint8Array(e.data), b = new Uint8Array(this.buf.length + d.length); b.set(this.buf); b.set(d, this.buf.length); this.buf = b; this._drain(); };
    ws.onclose = ws.onerror = () => { clearTimeout(t0); if (this.ws !== ws) return; const was = this.on; this.on = false; this.ws = null; clearInterval(this.ping); if (was) this.onState('offline', url); else this.bi++; this._retry(); };
  }
  _retry() { if (!this.closed) setTimeout(() => this.connect(), this.on ? 500 : 1500); }
  _drain() {
    for (;;) {
      const b = this.buf; if (b.length < 2) return; let mul = 1, len = 0, i = 1, byte;
      do { if (i >= b.length) return; byte = b[i++]; len += (byte & 127) * mul; mul *= 128; } while (byte & 128);
      if (b.length < i + len) return; const type = b[0] >> 4, body = b.subarray(i, i + len); this.buf = b.slice(i + len);
      if (type === 2) {   /* CONNACK */
        if (body[1] !== 0) { this.bi++; try { this.ws.close(); } catch (e) { } return; }
        this.on = true; this.onState('online', RELAY_BROKERS[this.bi % RELAY_BROKERS.length]);
        this.ws.send(Relay._pkt(0x82, [0, (this.pid++ & 0xffff) || 1], [...Relay._str(this.topicIn), 0]));
        clearInterval(this.ping); this.ping = setInterval(() => { try { this.ws && this.ws.send(new Uint8Array([0xC0, 0])); } catch (e) { } }, 20000);
      } else if (type === 3) {   /* PUBLISH (QoS 0) */
        const tl = (body[0] << 8) | body[1], qos = (b[0] >> 1) & 3, off = 2 + tl + (qos ? 2 : 0);
        try { this.onMsg(JSON.parse(new TextDecoder().decode(body.subarray(off)))); } catch (e) { }
      }
    }
  }
  send(obj) { if (!this.on || !this.ws) return false; try { this.ws.send(Relay._pkt(0x30, Relay._str(this.topicOut), new TextEncoder().encode(JSON.stringify(obj)))); return true; } catch (e) { return false; } }
  close() { this.closed = true; this.on = false; clearInterval(this.ping); try { this.ws && this.ws.send(new Uint8Array([0xE0, 0])); this.ws && this.ws.close(); } catch (e) { } this.ws = null; }
  static _str(s) { const u = new TextEncoder().encode(s); return [u.length >> 8, u.length & 255, ...u]; }
  static _pkt(h, vh, payload) {
    const body = new Uint8Array(vh.length + payload.length); body.set(vh); body.set(payload, vh.length);
    const len = []; let n = body.length; do { let x = n % 128; n = Math.floor(n / 128); if (n > 0) x |= 128; len.push(x); } while (n > 0);
    const out = new Uint8Array(1 + len.length + body.length); out[0] = h; out.set(len, 1); out.set(body, 1 + len.length); return out;
  }
}
if (typeof module !== 'undefined') module.exports = { Relay, RELAY_BROKERS };
