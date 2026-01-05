import type { Env } from '../env.js';

type Client = {
  id: string;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  abortSignal: AbortSignal;
};

const encoder = new TextEncoder();

function sseHeaders(): Headers {
  const headers = new Headers();
  headers.set('Content-Type', 'text/event-stream');
  headers.set('Cache-Control', 'no-cache, no-transform');
  headers.set('Connection', 'keep-alive');
  headers.set('X-Accel-Buffering', 'no');
  return headers;
}

function encodeSseEvent(event: string | null, data: unknown): Uint8Array {
  const json = JSON.stringify(data);
  if (event) {
    return encoder.encode(`event: ${event}\ndata: ${json}\n\n`);
  }
  return encoder.encode(`data: ${json}\n\n`);
}

function encodeSseComment(text: string): Uint8Array {
  return encoder.encode(`: ${text}\n\n`);
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export class LiveTrackerDO {
  private state: DurableObjectState;
  private env: Env;

  private clients: Map<string, Client> = new Map();
  private heartbeatTimer: number | null = null;

  private upstream: WebSocket | null = null;
  private upstreamConnected = false;
  private upstreamConnecting: Promise<void> | null = null;

  private pendingMessagesDelta = 0;
  private pendingParseErrorsDelta = 0;
  private lastReportAtMs = 0;
  private lastMessageAtIso: string | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  private metricsStub(): DurableObjectStub {
    const id = this.env.HEALTH_METRICS.idFromName('global');
    return this.env.HEALTH_METRICS.get(id);
  }

  private async report(opts: {
    gameId: string;
    force?: boolean;
    sseClients?: number;
    upstreamConnected?: boolean;
  }): Promise<void> {
    const now = Date.now();
    const force = Boolean(opts.force);

    const shouldSend =
      force ||
      this.pendingMessagesDelta >= 50 ||
      this.pendingParseErrorsDelta >= 5 ||
      now - this.lastReportAtMs >= 5000;

    if (!shouldSend) return;

    const payload: Record<string, unknown> = {
      gameId: opts.gameId,
      leaseTtlMs: 30000,
      deltaMessages: this.pendingMessagesDelta,
      deltaParseErrors: this.pendingParseErrorsDelta,
      lastMessageAt: this.lastMessageAtIso
    };

    if (typeof opts.sseClients === 'number') payload.sseClients = opts.sseClients;
    if (typeof opts.upstreamConnected === 'boolean') payload.upstreamConnected = opts.upstreamConnected;

    this.pendingMessagesDelta = 0;
    this.pendingParseErrorsDelta = 0;
    this.lastReportAtMs = now;

    try {
      await this.metricsStub().fetch('https://internal/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch {
      return;
    }
  }

  private pruneDisconnectedClients(): void {
    for (const [id, client] of this.clients.entries()) {
      if (client.abortSignal.aborted) {
        try {
          client.writer.close();
        } catch {
          // ignore
        }
        this.clients.delete(id);
      }
    }
  }

  private async broadcast(bytes: Uint8Array): Promise<void> {
    const dead: string[] = [];
    for (const [id, client] of this.clients.entries()) {
      if (client.abortSignal.aborted) {
        dead.push(id);
        continue;
      }
      try {
        await client.writer.write(bytes);
      } catch {
        dead.push(id);
      }
    }

    for (const id of dead) {
      const client = this.clients.get(id);
      if (client) {
        try {
          client.writer.close();
        } catch {
          // ignore
        }
      }
      this.clients.delete(id);
    }
  }

  private startHeartbeat(gameId: string): void {
    if (this.heartbeatTimer != null) return;

    this.heartbeatTimer = setInterval(() => {
      void this.broadcast(encodeSseComment(`ping ${Date.now()}`));
      this.pruneDisconnectedClients();
      if (this.clients.size === 0) {
        this.stopHeartbeat();
        this.closeUpstream();
        void this.report({ gameId, force: true, sseClients: 0, upstreamConnected: false });
      } else {
        void this.report({ gameId });
      }
    }, 15000) as unknown as number;
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer == null) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private closeUpstream(): void {
    if (!this.upstream) return;
    try {
      this.upstream.close();
    } catch {
      // ignore
    }
    this.upstream = null;
    this.upstreamConnected = false;
    this.upstreamConnecting = null;
  }

  private async ensureUpstream(gameId: string): Promise<void> {
    if (this.upstreamConnected) return;
    if (this.upstreamConnecting) return this.upstreamConnecting;

    this.upstreamConnecting = (async () => {
      const partnerIdRaw = this.env.LIVE_TRACKER_PARTNER_ID;
      const partnerId = Number.isFinite(Number(partnerIdRaw)) && Number(partnerIdRaw) > 0 ? Number(partnerIdRaw) : 1777;

      const siteRefRaw = this.env.LIVE_TRACKER_SITE_REF ? String(this.env.LIVE_TRACKER_SITE_REF) : 'https://sportsbook.forzza1x2.com/';
      const siteRef = encodeURIComponent(siteRefRaw);

      const baseUrl = this.env.LIVE_TRACKER_WS_URL ? String(this.env.LIVE_TRACKER_WS_URL) : 'wss://animation.ml.bcua.io/animation_json_v2';
      const url = `${baseUrl}?partner_id=${partnerId}&site_ref=${siteRef}`;

      const ws = new WebSocket(url);
      this.upstream = ws;

      ws.addEventListener('open', () => {
        this.upstreamConnected = true;
        void this.report({ gameId, force: true, sseClients: this.clients.size, upstreamConnected: true });

        try {
          const ts = nowSec();
          const msg = {
            request: {
              arg: {
                submatch: {
                  feed_type: 'live',
                  gameevents: 'true',
                  id: String(gameId),
                  link_id: '',
                  provider: 'animation',
                  snapshot: true
                }
              },
              meta: {
                request_id: ts,
                ts
              }
            }
          };
          ws.send(JSON.stringify(msg));
        } catch {
          void this.broadcast(encodeSseEvent('error', { error: 'Failed to subscribe' }));
        }
      });

      ws.addEventListener('message', (evt: MessageEvent) => {
        this.pendingMessagesDelta += 1;
        this.lastMessageAtIso = new Date().toISOString();

        let payload: unknown = null;
        try {
          payload = typeof evt.data === 'string' ? JSON.parse(evt.data) : evt.data;
        } catch {
          this.pendingParseErrorsDelta += 1;
          payload = { raw: typeof evt.data === 'string' ? evt.data : String(evt.data) };
        }

        void this.broadcast(encodeSseEvent(null, payload));
        void this.report({ gameId });
      });

      ws.addEventListener('error', () => {
        void this.broadcast(encodeSseEvent('error', { error: 'WebSocket error' }));
      });

      ws.addEventListener('close', () => {
        this.upstreamConnected = false;
        this.upstream = null;
        this.upstreamConnecting = null;
        void this.broadcast(encodeSseEvent('end', { gameId: String(gameId) }));
        void this.report({ gameId, force: true, sseClients: this.clients.size, upstreamConnected: false });
      });

      await this.broadcast(encodeSseEvent('ready', { gameId: String(gameId) }));
    })();

    try {
      await this.upstreamConnecting;
    } finally {
      this.upstreamConnecting = null;
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const gameId = url.searchParams.get('gameId');
    if (!gameId) {
      return new Response(JSON.stringify({ error: 'gameId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();

    const id = crypto.randomUUID();
    const client: Client = { id, writer, abortSignal: request.signal };
    this.clients.set(id, client);

    request.signal.addEventListener('abort', () => {
      const existing = this.clients.get(id);
      if (existing) {
        try {
          existing.writer.close();
        } catch {
          // ignore
        }
        this.clients.delete(id);
        void this.report({ gameId, force: true, sseClients: this.clients.size, upstreamConnected: this.upstreamConnected });
      }
    });

    this.startHeartbeat(gameId);
    void this.report({ gameId, force: true, sseClients: this.clients.size, upstreamConnected: this.upstreamConnected });

    if (this.clients.size === 1) {
      void this.ensureUpstream(gameId);
    } else if (this.upstreamConnected) {
      try {
        await writer.write(encodeSseEvent('ready', { gameId: String(gameId) }));
      } catch {
        // ignore
      }
    }

    return new Response(readable, {
      status: 200,
      headers: sseHeaders()
    });
  }
}
