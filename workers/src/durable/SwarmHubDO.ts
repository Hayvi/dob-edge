import type { Env } from '../env.js';

type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
  timeoutId: number;
};

type HierarchyCache = {
  cachedAtMs: number;
  data: unknown;
};

function json(data: JsonValue, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function unwrapSwarmData(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  const data = obj.data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (d.data && typeof d.data === 'object') return d.data;
    return data;
  }
  return raw;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function startOfDaySec(tsSec: number): number {
  return tsSec - (tsSec % 86400);
}

export class SwarmHubDO {
  private state: DurableObjectState;
  private env: Env;

  private wsUrl = 'wss://eu-swarm-newm.vmemkhhgjigrjefb.com';
  private partnerId = 1777;

  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private connecting: Promise<void> | null = null;
  private pending: Map<string, Pending> = new Map();

  private wsMessagesTotal = 0;
  private wsMessageParseErrorsTotal = 0;
  private wsMessageTimestampsMs: number[] = [];

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  private recordWsMessage(kind: 'ok' | 'parse_error'): void {
    const now = Date.now();
    this.wsMessagesTotal += 1;
    this.wsMessageTimestampsMs.push(now);
    if (this.wsMessageTimestampsMs.length > 2000) {
      this.wsMessageTimestampsMs.splice(0, this.wsMessageTimestampsMs.length - 2000);
    }
    if (kind === 'parse_error') this.wsMessageParseErrorsTotal += 1;
  }

  private getWsMessagesLast60s(): number {
    const now = Date.now();
    return this.wsMessageTimestampsMs.filter(t => Number.isFinite(t) && now - t <= 60000).length;
  }

  private rejectAllPending(err: unknown): void {
    for (const [rid, entry] of this.pending.entries()) {
      clearTimeout(entry.timeoutId);
      entry.reject(err);
      this.pending.delete(rid);
    }
  }

  private async ensureConnection(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.sessionId) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      if (this.ws) {
        try {
          this.ws.close();
        } catch {
          // ignore
        }
        this.ws = null;
      }
      this.sessionId = null;

      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;

      ws.addEventListener('message', (evt: MessageEvent) => {
        let message: unknown;
        try {
          message = JSON.parse(String(evt.data));
          this.recordWsMessage('ok');
        } catch {
          this.recordWsMessage('parse_error');
          return;
        }

        const obj = message as Record<string, unknown>;
        const rid = obj.rid;
        if (typeof rid === 'string' && this.pending.has(rid)) {
          const entry = this.pending.get(rid);
          if (!entry) return;
          clearTimeout(entry.timeoutId);
          this.pending.delete(rid);
          entry.resolve(message);
        }
      });

      ws.addEventListener('close', () => {
        this.sessionId = null;
        this.ws = null;
        this.connecting = null;
        this.rejectAllPending(new Error('Swarm WebSocket closed'));
      });

      ws.addEventListener('error', () => {
        this.sessionId = null;
        this.ws = null;
        this.connecting = null;
        this.rejectAllPending(new Error('Swarm WebSocket error'));
      });

      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Swarm WebSocket connect timeout'));
        }, 15000) as unknown as number;

        ws.addEventListener('open', () => {
          clearTimeout(timeoutId);
          resolve();
        });
        ws.addEventListener('error', () => {
          clearTimeout(timeoutId);
          reject(new Error('Swarm WebSocket error on connect'));
        });
      });

      const sessionResp = (await this.sendRequest('request_session', {
        site_id: this.partnerId,
        language: 'eng'
      })) as Record<string, unknown>;

      const sid = (sessionResp?.data as Record<string, unknown> | undefined)?.sid;
      if (!sid || typeof sid !== 'string') {
        throw new Error('Failed to get Swarm session id');
      }
      this.sessionId = sid;
    })();

    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async sendRequest(command: string, params: unknown, timeoutMs = 60000): Promise<unknown> {
    if (command !== 'request_session') {
      await this.ensureConnection();
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Swarm WebSocket not connected');
    }

    const rid = crypto.randomUUID();
    const request = { command, params, rid };

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pending.has(rid)) {
          this.pending.delete(rid);
          reject(new Error(`Swarm request ${command} timed out`));
        }
      }, timeoutMs) as unknown as number;

      this.pending.set(rid, { resolve, reject, timeoutId });

      try {
        this.ws?.send(JSON.stringify(request));
      } catch (e) {
        clearTimeout(timeoutId);
        this.pending.delete(rid);
        reject(e);
      }
    });
  }

  private async getHierarchy(forceRefresh: boolean): Promise<unknown> {
    const cacheKey = 'hierarchy_cache';
    if (!forceRefresh) {
      const cached = await this.state.storage.get<HierarchyCache>(cacheKey);
      if (cached && typeof cached.cachedAtMs === 'number' && cached.data) {
        if (Date.now() - cached.cachedAtMs <= 5 * 60 * 1000) {
          return { ...(cached.data as Record<string, unknown>), cached: true };
        }
      }
    }

    await this.ensureConnection();
    const response = await this.sendRequest('get', {
      source: 'betting',
      what: {
        sport: ['id', 'name', 'alias', 'order'],
        region: ['id', 'name', 'alias', 'order'],
        competition: ['id', 'name', 'order']
      }
    });
    const data = unwrapSwarmData(response);
    await this.state.storage.put(cacheKey, { cachedAtMs: Date.now(), data });
    return { ...(data as Record<string, unknown>), cached: false };
  }

  private async getActiveCompetitions(fromDate?: number, toDate?: number): Promise<unknown> {
    await this.ensureConnection();

    const now = nowSec();
    const from = fromDate ?? startOfDaySec(now);
    const to = toDate ?? from + 86400;

    const response = (await this.sendRequest('get_active_competitions', {
      from_date: from,
      to_date: to
    })) as Record<string, unknown>;

    if (response?.code !== undefined && response.code !== 0) {
      const msg = response?.msg ? `: ${String(response.msg)}` : '';
      throw new Error(`get_active_competitions failed${msg}`);
    }

    return (response as Record<string, unknown>)?.data;
  }

  private async getResultGames(sportId: number, fromDate?: number, toDate?: number): Promise<unknown[]> {
    await this.ensureConnection();

    const now = nowSec();
    const from = fromDate ?? startOfDaySec(now);
    const to = toDate ?? from + 86400;

    const response = (await this.sendRequest('get_result_games', {
      is_date_ts: 1,
      from_date: from,
      to_date: to,
      live: 0,
      sport_id: sportId
    })) as Record<string, unknown>;

    if (response?.code !== undefined && response.code !== 0) {
      const msg = response?.msg ? `: ${String(response.msg)}` : '';
      throw new Error(`get_result_games failed${msg}`);
    }

    const games = (response.data as Record<string, unknown> | undefined)?.games as Record<string, unknown> | undefined;
    const arr = games?.game;
    return Array.isArray(arr) ? (arr as unknown[]) : [];
  }

  private async getGameResults(gameId: string): Promise<unknown> {
    await this.ensureConnection();

    const response = (await this.sendRequest('get_results', {
      game_id: String(gameId)
    })) as Record<string, unknown>;

    if (response?.code !== undefined && response.code !== 0) {
      const msg = response?.msg ? `: ${String(response.msg)}` : '';
      throw new Error(`get_results failed${msg}`);
    }

    return response.data;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/internal/metrics') {
      return json({
        connected: Boolean(this.ws && this.ws.readyState === WebSocket.OPEN && this.sessionId),
        session_id: this.sessionId,
        ws_url: this.wsUrl,
        ws_messages_total: this.wsMessagesTotal,
        ws_messages_last_60s: this.getWsMessagesLast60s(),
        ws_parse_errors_total: this.wsMessageParseErrorsTotal
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/hierarchy') {
      const forceRefresh = url.searchParams.get('refresh') === 'true';
      try {
        const hierarchy = await this.getHierarchy(forceRefresh);
        return json(hierarchy as JsonValue);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/results/competitions') {
      try {
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        const data = await this.getActiveCompetitions(from ? Number(from) : undefined, to ? Number(to) : undefined);
        return json({ success: true, data, timestamp: new Date().toISOString() } as JsonValue);
      } catch (e) {
        return json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
      }
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/results/games/')) {
      try {
        const sportIdRaw = url.pathname.split('/').pop() || '';
        const sportId = Number(sportIdRaw);
        if (!Number.isFinite(sportId)) return json({ success: false, error: 'Invalid sportId' }, { status: 400 });
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        const games = await this.getResultGames(sportId, from ? Number(from) : undefined, to ? Number(to) : undefined);
        return json({
          success: true,
          sportId,
          count: games.length,
          games,
          timestamp: new Date().toISOString()
        } as JsonValue);
      } catch (e) {
        return json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
      }
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/results/game/')) {
      try {
        const gameId = url.pathname.split('/').pop() || '';
        if (!gameId) return json({ success: false, error: 'gameId is required' }, { status: 400 });
        const raw = await this.getGameResults(gameId);

        const settlements: { market: unknown; winners: unknown }[] = [];
        const lines = (raw as Record<string, unknown> | undefined)?.lines as Record<string, unknown> | undefined;
        const line = lines?.line;
        if (Array.isArray(line)) {
          for (const l of line) {
            const lo = l as Record<string, unknown>;
            const events = lo.events as Record<string, unknown> | undefined;
            const winners = events?.event_name ?? [];
            settlements.push({ market: lo.line_name, winners });
          }
        }

        return json({
          success: true,
          gameId,
          settlements,
          raw,
          timestamp: new Date().toISOString()
        } as JsonValue);
      } catch (e) {
        return json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
      }
    }

    return json({ error: 'Not found' }, { status: 404 });
  }
}
