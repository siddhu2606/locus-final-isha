/* ===== LOCUS link: phone <-> laptop with a 6-digit code, over EVERY path at once so one blocked port or a down broker
   does not break the demo:  three public MQTT brokers (src/relay.js)  +  a direct WebRTC link through PeerJS on port 443
   (the path the first app version used, so old apps still connect). Each message carries a sender id + counter; the receiver
   drops copies that arrive over a second path. Same small API as one Relay: connect(), send(obj), close(), .on ===== */
class MultiLink {
  constructor(code, role, onMsg, onState) {
    this.code = code; this.role = role; this.onMsg = onMsg; this.onState = onState || (() => { }); this.sid = Math.random().toString(36).slice(2, 8);
    this.k = 0; this.seen = new Set(); this.seenQ = []; this.relays = []; this.peer = null; this.conns = []; this.closed = false; this.paths = {};
  }
  get on() { return this.relays.some(r => r.on) || this.conns.some(c => c.open); }
  pathNames() { return this.relays.filter(r => r.on).map(r => (RELAY_BROKERS[r.bi].match(/\/\/([^.]+\.[^.:]+)/) || [0, 'mqtt'])[1]).concat(this.conns.some(c => c.open) ? ['direct'] : []); }
  connect() {
    RELAY_BROKERS.forEach((u, i) => { const r = new Relay(this.code, this.role, m => this._in(m), s => this.onState(this.on ? 'online' : s), i); r.connect(); this.relays.push(r); });
    this._peer();
  }
  _peer() {
    if (this.closed || typeof Peer === 'undefined') return;
    const id = 'locus-fi-' + this.code, wire = c => { c.on('open', () => { if (!this.conns.includes(c)) this.conns.push(c); this.onState('online'); }); c.on('data', m => this._in(typeof m === 'string' ? JSON.parse(m) : m)); c.on('close', () => { this.conns = this.conns.filter(x => x !== c); }); c.on('error', () => { }); };
    try {
      if (this.role === 'phone') { this.peer = new Peer(id); this.peer.on('connection', wire); this.peer.on('error', e => { if (e.type === 'unavailable-id' || e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') this._repeer(); }); }
      else { this.peer = new Peer(); this.peer.on('open', () => wire(this.peer.connect(id, { reliable: true }))); this.peer.on('error', () => this._repeer()); }
      this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (e) { } });
    } catch (e) { this._repeer(); }
    if (this.role === 'laptop') this._watch = setInterval(() => { if (!this.closed && this.peer && !this.conns.some(c => c.open) && this.peer.open) wire(this.peer.connect(id, { reliable: true })); }, 6000);
  }
  _repeer() { clearInterval(this._watch); try { this.peer && this.peer.destroy(); } catch (e) { } this.peer = null; if (!this.closed) setTimeout(() => this._peer(), 5000); }
  _in(m) {
    if (!m || typeof m !== 'object') return;
    if (m._s) { const key = m._s + ':' + m._k; if (this.seen.has(key)) return; this.seen.add(key); this.seenQ.push(key); if (this.seenQ.length > 2000) this.seen.delete(this.seenQ.shift()); }
    this.onMsg(m);
  }
  send(obj) {
    const m = Object.assign({}, obj, { _s: this.sid, _k: ++this.k }); let sent = false;
    this.relays.forEach(r => { if (r.on && r.send(m)) sent = true; });
    this.conns.forEach(c => { if (c.open) try { c.send(m); sent = true; } catch (e) { } });
    return sent;
  }
  close() { this.closed = true; clearInterval(this._watch); this.relays.forEach(r => r.close()); this.conns.forEach(c => { try { c.close(); } catch (e) { } }); try { this.peer && this.peer.destroy(); } catch (e) { } this.relays = []; this.conns = []; }
}
if (typeof module !== 'undefined') module.exports = { MultiLink };
