import type { Env } from '../env.js';

type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

type Totals = {
  first_seen_at: string | null;
  ws_messages_total: number;
  ws_parse_errors_total: number;
  last_message_at: string | null;
};

type Bucket = { sec: number; count: number };

type Lease = {
  sse_clients: number;
  upstream_connected: boolean;
  expires_at_ms: number;
};

type ReportPayload = {
  gameId: string;
  sseClients?: number;
  upstreamConnected?: boolean;
  deltaMessages?: number;
  deltaParseErrors?: number;
  lastMessageAt?: string;
  leaseTtlMs?: number;
};

function json(data: JsonValue, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export class HealthMetricsDO {
  private state: DurableObjectState;
  private env: Env;

  private initPromise: Promise<void> | null = null;
  private totals: Totals = {
    first_seen_at: null,
    ws_messages_total: 0,
    ws_parse_errors_total: 0,
    last_message_at: null
  };
  private buckets: Bucket[] = [];
  private leases: Record<string, Lease> = {};

  private dirty = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  private async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const [totals, buckets, leases] = await Promise.all([
        this.state.storage.get<Totals>('live_tracker_totals'),
        this.state.storage.get<Bucket[]>('live_tracker_last60s_buckets'),
        this.state.storage.get<Record<string, Lease>>('live_tracker_leases')
      ]);
      if (totals) this.totals = totals;
      if (Array.isArray(buckets)) this.buckets = buckets;
      if (leases && typeof leases === 'object') this.leases = leases;

      if (!this.totals.first_seen_at) {
        this.totals.first_seen_at = new Date().toISOString();
        this.dirty = true;
        await this.flush();
      }
    })();
    return this.initPromise;
  }

  private pruneLeases(nowMs: number): void {
    const leases = this.leases || {};
    for (const gameId of Object.keys(leases)) {
      const lease = leases[gameId];
      if (!lease || lease.expires_at_ms <= nowMs) {
        delete leases[gameId];
        this.dirty = true;
      }
    }
  }

  private updateBuckets(delta: number): void {
    const sec = nowSec();
    const buckets = Array.isArray(this.buckets) ? this.buckets : [];

    const existing = buckets.find(b => b.sec === sec);
    if (existing) {
      existing.count += delta;
    } else {
      buckets.push({ sec, count: delta });
    }

    const min = sec - 59;
    this.buckets = buckets.filter(b => Number.isFinite(b.sec) && b.sec >= min);
  }

  private scheduleFlush(): void {
    if (!this.dirty) return;
    void this.state.storage.setAlarm(Date.now() + 5000);
  }

  private async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    await this.state.storage.put('live_tracker_totals', this.totals);
    await this.state.storage.put('live_tracker_last60s_buckets', this.buckets);
    await this.state.storage.put('live_tracker_leases', this.leases);
  }

  async alarm(): Promise<void> {
    await this.init();
    await this.flush();
  }

  private buildRollups(): Record<string, JsonValue> {
    const nowMs = Date.now();
    this.pruneLeases(nowMs);

    let activeGames = 0;
    let activeSseClients = 0;
    let upstreamConnectedGames = 0;

    for (const lease of Object.values(this.leases || {})) {
      if (!lease) continue;
      if (lease.sse_clients > 0) activeGames += 1;
      activeSseClients += Number(lease.sse_clients) || 0;
      if (lease.upstream_connected) upstreamConnectedGames += 1;
    }

    const sec = nowSec();
    const min = sec - 59;
    const buckets = Array.isArray(this.buckets) ? this.buckets : [];
    const last60s = buckets
      .filter(b => Number.isFinite(b.sec) && b.sec >= min)
      .reduce((sum, b) => sum + (Number(b.count) || 0), 0);

    return {
      active_games: activeGames,
      active_sse_clients: activeSseClients,
      upstream_ws_connected_games: upstreamConnectedGames,
      ws_messages_total: Number(this.totals.ws_messages_total) || 0,
      ws_messages_last_60s: last60s,
      ws_parse_errors_total: Number(this.totals.ws_parse_errors_total) || 0,
      last_message_at: this.totals.last_message_at
    };
  }

  private async handleReport(request: Request): Promise<Response> {
    const body = (await request.json()) as ReportPayload;
    const gameId = String(body?.gameId || '');
    if (!gameId) return json({ error: 'gameId is required' }, { status: 400 });

    const nowMs = Date.now();

    const leaseTtlMs = Number(body.leaseTtlMs) > 0 ? Number(body.leaseTtlMs) : 30000;
    const existing = this.leases[gameId] || {
      sse_clients: 0,
      upstream_connected: false,
      expires_at_ms: nowMs + leaseTtlMs
    };

    if (typeof body.sseClients === 'number') existing.sse_clients = body.sseClients;
    if (typeof body.upstreamConnected === 'boolean') existing.upstream_connected = body.upstreamConnected;
    existing.expires_at_ms = nowMs + leaseTtlMs;
    this.leases[gameId] = existing;

    const deltaMessages = Number(body.deltaMessages) || 0;
    const deltaParseErrors = Number(body.deltaParseErrors) || 0;

    if (deltaMessages > 0) {
      this.totals.ws_messages_total = (Number(this.totals.ws_messages_total) || 0) + deltaMessages;
      this.updateBuckets(deltaMessages);
      this.dirty = true;
    }

    if (deltaParseErrors > 0) {
      this.totals.ws_parse_errors_total = (Number(this.totals.ws_parse_errors_total) || 0) + deltaParseErrors;
      this.dirty = true;
    }

    if (body.lastMessageAt) {
      this.totals.last_message_at = body.lastMessageAt;
      this.dirty = true;
    }

    this.pruneLeases(nowMs);
    this.dirty = true;
    this.scheduleFlush();

    return json({ ok: true });
  }

  async fetch(request: Request): Promise<Response> {
    await this.init();
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/report') {
      return this.handleReport(request);
    }

    if (request.method === 'GET' && url.pathname === '/live-tracker-rollups') {
      return json(this.buildRollups());
    }

    return json({ error: 'Not found' }, { status: 404 });
  }
}
