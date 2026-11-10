/**
 * Thin client for the LAN relay. The relay only forwards messages; the host
 * player's browser keeps the authoritative game state.
 */
export type NetEvent =
  | { t: 'open' }
  | { t: 'closed' }
  | { t: 'error'; msg: string }
  | { t: 'created'; code: string; peerId: string }
  | { t: 'joined'; peerId: string; hostId: string }
  | { t: 'peer-joined'; peerId: string; name: string }
  | { t: 'peer-left'; peerId: string }
  | { t: 'host-left' }
  | { t: 'message'; from: string; payload: Record<string, unknown> };

type Handler = (ev: NetEvent) => void;

export class LanClient {
  private ws: WebSocket | null = null;
  private queue: string[] = [];
  id = '';
  code: string | null = null;

  constructor(private onEvent: Handler) {}

  static url(explicitHost?: string): string {
    if (explicitHost) {
      const clean = explicitHost.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const withPort = /:\d+$/.test(clean) ? clean : `${clean}:7777`;
      return `ws://${withPort}/lan`;
    }
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.hostname || '127.0.0.1';
    // Electron and the relay-served build share the origin; the dev server does not.
    const port = window.location.port === '7777' || window.location.port === '' ? '' : ':7777';
    return `${proto}://${host}${port}/lan`;
  }

  async connect(url = LanClient.url()): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url);
      ws.onopen = () => {
        settled = true;
        this.ws = ws;
        for (const item of this.queue) ws.send(item);
        this.queue = [];
        this.onEvent({ t: 'open' });
        resolve();
      };
      ws.onerror = () => {
        if (!settled) reject(new Error('Keine Verbindung zum LAN-Relay.'));
        else this.onEvent({ t: 'error', msg: 'Verbindung gestört.' });
      };
      ws.onclose = () => this.onEvent({ t: 'closed' });
      ws.onmessage = (ev) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        const t = String(msg.t);
        if (t === 'created') {
          this.id = String(msg.peerId);
          this.code = String(msg.code);
          this.onEvent({ t: 'created', code: this.code, peerId: this.id });
        } else if (t === 'joined') {
          this.id = String(msg.peerId);
          this.onEvent({ t: 'joined', peerId: this.id, hostId: String(msg.hostId) });
        } else if (t === 'peer-joined') {
          this.onEvent({ t: 'peer-joined', peerId: String(msg.peerId), name: String(msg.name ?? 'Gast') });
        } else if (t === 'peer-left') {
          this.onEvent({ t: 'peer-left', peerId: String(msg.peerId) });
        } else if (t === 'host-left') {
          this.onEvent({ t: 'host-left' });
        } else if (t === 'error') {
          this.onEvent({ t: 'error', msg: String(msg.msg ?? 'Fehler') });
        } else if (t === 'relay') {
          this.onEvent({ t: 'message', from: String(msg.from), payload: msg.payload as Record<string, unknown> });
        }
      };
    });
  }

  private raw(obj: Record<string, unknown>): void {
    const text = JSON.stringify(obj);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(text);
    else this.queue.push(text);
  }

  create(name: string): void {
    this.raw({ t: 'create', name });
  }

  join(code: string, name: string): void {
    this.raw({ t: 'join', code: code.toUpperCase().trim(), name });
  }

  send(payload: Record<string, unknown>, to?: string): void {
    if (to) this.raw({ t: 'relay', to, payload });
    else this.raw({ t: 'broadcast', payload });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
