import type { Env } from '../env.js';
import { getCountsFp, getGameFp, getOddsFp, getSportFp } from '../lib/fingerprints.js';
import { buildOddsArrFromMarket, getSportMainMarketTypePriority, pickPreferredMarketFromEmbedded } from '../lib/odds.js';
import { parseGamesFromData } from '../lib/parseGamesFromData.js';
import { extractSportsCountsFromSwarm } from '../lib/swarmCounts.js';

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

type Client = {
  id: string;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  abortSignal: AbortSignal;
};

type SubscriptionEntry = {
  state: Record<string, unknown>;
  onEmit: (data: unknown) => void;
};

 type OddsCacheEntry = {
  odds: unknown;
  markets_count: number;
  fp: string;
  updatedAtMs: number;
 };

type SportStreamGroup = {
  sportId: string;
  mode: 'live' | 'prematch';
  sportName: string;
  clients: Map<string, Client>;
  timer: number | null;
  oddsTimer: number | null;
  cleanupTimer: number | null;
  pollInFlight: boolean;
  lastFp: string;
  lastOddsFp: string;
  lastGamesPayload: unknown | null;
  lastOddsPayload: unknown | null;
  lastOddsSnapshotAtMs: number;
  oddsInFlight: boolean;
  oddsCursor: number;
  oddsGameIds: string[];
  oddsCache: Map<string, OddsCacheEntry>;
};

type GameStreamGroup = {
  gameId: string;
  clients: Map<string, Client>;
  timer: number | null;
  pollInFlight: boolean;
  lastFp: string;
  lastPayload: unknown | null;
  cleanupTimer: number | null;
};

const encoder = new TextEncoder();

 const ODDS_CHUNK_SIZE = 30;
 const ODDS_POLL_INTERVAL_MS = 2500;
 const ODDS_SNAPSHOT_REBUILD_MS = 15000;
 const ODDS_REFRESH_AFTER_MS = 60000;
 const GROUP_GRACE_MS = 30000;

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

  private subscriptions: Map<string, SubscriptionEntry> = new Map();

  private countsClients: Map<string, Client> = new Map();
  private countsHeartbeatTimer: number | null = null;
  private countsLiveSubid: string | null = null;
  private countsPrematchSubid: string | null = null;
  private countsLastLiveFp = '';
  private countsLastPrematchFp = '';
  private countsLivePayload: unknown = null;
  private countsPrematchPayload: unknown = null;

  private liveGroups: Map<string, SportStreamGroup> = new Map();
  private prematchGroups: Map<string, SportStreamGroup> = new Map();
  private liveGameGroups: Map<string, GameStreamGroup> = new Map();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;

    if (this.env.SWARM_WS_URL) {
      this.wsUrl = String(this.env.SWARM_WS_URL);
    }
    if (this.env.SWARM_PARTNER_ID) {
      const pid = Number(this.env.SWARM_PARTNER_ID);
      if (Number.isFinite(pid) && pid > 0) {
        this.partnerId = pid;
      }
    }
  }

  private deepMerge(target: Record<string, unknown>, patch: unknown): void {
    if (!patch || typeof patch !== 'object') return;
    const p = patch as Record<string, unknown>;
    for (const [k, v] of Object.entries(p)) {
      if (v === null) {
        delete target[k];
        continue;
      }
      if (Array.isArray(v)) {
        target[k] = v;
        continue;
      }
      if (v && typeof v === 'object') {
        const cur = target[k];
        if (!cur || typeof cur !== 'object' || Array.isArray(cur)) {
          target[k] = {};
        }
        this.deepMerge(target[k] as Record<string, unknown>, v);
        continue;
      }
      target[k] = v;
    }
  }

  private handleSubscriptionDelta(subid: string, delta: unknown): void {
    const entry = this.subscriptions.get(subid);
    if (!entry) return;
    this.deepMerge(entry.state, { data: delta });
    entry.onEmit((entry.state as any).data);
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

        if ((rid === 0 || rid === '0') && obj.data && typeof obj.data === 'object') {
          for (const [subid, delta] of Object.entries(obj.data as Record<string, unknown>)) {
            this.handleSubscriptionDelta(String(subid), delta);
          }
          return;
        }

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

  private async subscribeGet(params: Record<string, unknown>, onEmit: (data: unknown) => void): Promise<string> {
    const response = (await this.sendRequest('get', { ...params, subscribe: true })) as Record<string, unknown>;
    if (response?.code !== undefined && response.code !== 0) {
      const msg = response?.msg ? `: ${String(response.msg)}` : '';
      throw new Error(`get subscribe failed${msg}`);
    }

    const initial = response.data as Record<string, unknown> | undefined;
    const subid = initial?.subid;
    if (!subid) throw new Error('subscribe did not return subid');

    const state = (initial as Record<string, unknown>) || {};
    this.subscriptions.set(String(subid), { state, onEmit });
    onEmit((state as any).data);
    return String(subid);
  }

  private async unsubscribe(subid: string): Promise<void> {
    this.subscriptions.delete(String(subid));
    try {
      await this.sendRequest('unsubscribe', { subid: String(subid) }, 15000);
    } catch {
      return;
    }
  }

  private async broadcast(clients: Map<string, Client>, bytes: Uint8Array): Promise<void> {
    const dead: string[] = [];
    for (const [id, client] of clients.entries()) {
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
      const client = clients.get(id);
      if (client) {
        try {
          client.writer.close();
        } catch {
          // ignore
        }
      }
      clients.delete(id);
    }
  }

  private async broadcastAllLiveGroups(bytes: Uint8Array): Promise<void> {
    for (const group of this.liveGroups.values()) {
      await this.broadcast(group.clients, bytes);
    }
  }

  private startCountsHeartbeat(): void {
    if (this.countsHeartbeatTimer != null) return;
    this.countsHeartbeatTimer = setInterval(() => {
      void this.broadcast(this.countsClients, encodeSseComment(`ping ${Date.now()}`));
      if (this.countsClients.size === 0) this.stopCountsHeartbeat();
    }, 15000) as unknown as number;
  }

  private stopCountsHeartbeat(): void {
    if (this.countsHeartbeatTimer == null) return;
    clearInterval(this.countsHeartbeatTimer);
    this.countsHeartbeatTimer = null;
  }

  private handleCountsEmit(kind: 'live' | 'prematch', data: unknown): void {
    const counts = extractSportsCountsFromSwarm(data);
    const payload = { sports: counts.sports, total_games: counts.totalGames };

    if (kind === 'live') {
      const fp = getCountsFp(counts.sports);
      if (fp && fp === this.countsLastLiveFp) return;
      this.countsLastLiveFp = fp;
      this.countsLivePayload = payload;
      void this.broadcast(this.countsClients, encodeSseEvent('live_counts', payload));
      void this.broadcastAllLiveGroups(encodeSseEvent('counts', payload));
      return;
    }

    const fp = getCountsFp(counts.sports);
    if (fp && fp === this.countsLastPrematchFp) return;
    this.countsLastPrematchFp = fp;
    this.countsPrematchPayload = payload;
    void this.broadcast(this.countsClients, encodeSseEvent('prematch_counts', payload));
    void this.broadcastAllLiveGroups(encodeSseEvent('prematch_counts', payload));
  }

  private async ensureCountsSubscriptions(): Promise<void> {
    if (this.countsLiveSubid && this.countsPrematchSubid) return;

    if (!this.countsLiveSubid) {
      this.countsLiveSubid = await this.subscribeGet(
        {
          source: 'betting',
          what: { sport: ['id', 'name'], game: ['id'] },
          where: { sport: { type: { '@nin': [1, 4] } }, game: { type: 1 } }
        },
        (data) => this.handleCountsEmit('live', data)
      );
    }

    if (!this.countsPrematchSubid) {
      this.countsPrematchSubid = await this.subscribeGet(
        {
          source: 'betting',
          what: { sport: ['id', 'name'], game: ['id'] },
          where: {
            sport: { type: { '@nin': [1, 4] } },
            game: {
              '@or': [{ visible_in_prematch: 1 }, { type: { '@in': [0, 2] } }]
            }
          }
        },
        (data) => this.handleCountsEmit('prematch', data)
      );
    }
  }

  private async stopCountsSubscriptions(): Promise<void> {
    const live = this.countsLiveSubid;
    const pre = this.countsPrematchSubid;
    this.countsLiveSubid = null;
    this.countsPrematchSubid = null;
    this.countsLastLiveFp = '';
    this.countsLastPrematchFp = '';
    this.countsLivePayload = null;
    this.countsPrematchPayload = null;

    if (live) await this.unsubscribe(live);
    if (pre) await this.unsubscribe(pre);
  }

  private async handleCountsStream(request: Request): Promise<Response> {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const id = crypto.randomUUID();
    const client: Client = { id, writer, abortSignal: request.signal };
    this.countsClients.set(id, client);

    request.signal.addEventListener('abort', () => {
      const existing = this.countsClients.get(id);
      if (existing) {
        try {
          existing.writer.close();
        } catch {
          // ignore
        }
        this.countsClients.delete(id);
      }
      if (this.countsClients.size === 0) {
        this.stopCountsHeartbeat();
        if (!this.hasActiveLiveSportClients()) {
          void this.stopCountsSubscriptions();
        }
      }
    });

    if (this.countsClients.size === 1) {
      this.startCountsHeartbeat();
      setTimeout(() => {
        void this.ensureCountsSubscriptions().catch((e) => {
          void this.broadcast(this.countsClients, encodeSseEvent('error', { error: e instanceof Error ? e.message : String(e) }));
        });
      }, 0);
    }

    const initialLivePayload = this.countsLivePayload;
    const initialPrematchPayload = this.countsPrematchPayload;
    setTimeout(() => {
      void (async () => {
        try {
          await writer.write(encodeSseComment(' '.repeat(2048)));
          await writer.write(encodeSseComment(`ready ${Date.now()}`));
          if (initialLivePayload) {
            await writer.write(encodeSseEvent('live_counts', initialLivePayload));
          }
          if (initialPrematchPayload) {
            await writer.write(encodeSseEvent('prematch_counts', initialPrematchPayload));
          }
        } catch {
          // ignore
        }
      })();
    }, 0);

    return new Response(readable, { status: 200, headers: sseHeaders() });
  }

  private async getSportName(sportId: string, fallback: string | null): Promise<string> {
    if (fallback) return fallback;
    try {
      const hierarchy = (await this.getHierarchy(false)) as any;
      const h = hierarchy?.data || hierarchy;
      const sports = h?.sport || {};
      const s = sports[String(sportId)];
      if (s?.name) return String(s.name);
    } catch {
      // ignore
    }
    return String(sportId);
  }

  private filterPrematchGames(games: any[]): any[] {
    return (Array.isArray(games) ? games : []).filter((g) => {
      return g?.visible_in_prematch === 1 || [0, 2].includes(Number(g?.type));
    });
  }

  private startSportGroup(group: SportStreamGroup): void {
    if (group.cleanupTimer != null) {
      clearTimeout(group.cleanupTimer);
      group.cleanupTimer = null;
    }
    if (group.timer == null) {
      group.timer = setInterval(() => {
        void this.pollSportGroup(group);
      }, 5000) as unknown as number;
    }
    if (group.oddsTimer == null) {
      group.oddsTimer = setInterval(() => {
        void this.pollSportOddsGroup(group);
      }, ODDS_POLL_INTERVAL_MS) as unknown as number;
    }
  }

  private stopSportGroup(group: SportStreamGroup): void {
    if (group.timer != null) {
      clearInterval(group.timer);
      group.timer = null;
    }
    if (group.oddsTimer != null) {
      clearInterval(group.oddsTimer);
      group.oddsTimer = null;
    }
  }

  private hasActiveLiveSportClients(): boolean {
    for (const g of this.liveGroups.values()) {
      if (g && g.clients && g.clients.size > 0) return true;
    }
    return false;
  }

  private async pollSportGroup(group: SportStreamGroup): Promise<void> {
    if (group.clients.size === 0) {
      this.stopSportGroup(group);
      return;
    }

    if (group.pollInFlight) return;
    group.pollInFlight = true;

    try {
      const gameFields =
        group.mode === 'live'
          ? ['id', 'sport_id', 'type', 'start_ts', 'team1_name', 'team2_name', 'is_blocked', 'info', 'text_info', 'markets_count']
          : ['id', 'sport_id', 'type', 'start_ts', 'team1_name', 'team2_name', 'is_blocked', 'visible_in_prematch', 'markets_count'];

      const response = await this.sendRequest(
        'get',
        {
          source: 'betting',
          what: {
            sport: ['id', 'name'],
            region: ['id', 'name'],
            competition: ['id', 'name'],
            game: gameFields
          },
          where:
            group.mode === 'live'
              ? { sport: { id: Number(group.sportId) }, game: { type: 1 } }
              : {
                  sport: { id: Number(group.sportId) },
                  game: {
                    '@or': [{ visible_in_prematch: 1 }, { type: { '@in': [0, 2] } }]
                  }
                }
        },
        15000
      );

      if (response && typeof response === 'object') {
        const ro = response as Record<string, unknown>;
        if (ro.code !== undefined && ro.code !== 0) {
          const msg = ro.msg ? `: ${String(ro.msg)}` : '';
          throw new Error(`get sport stream failed${msg}`);
        }
      }

      const data = unwrapSwarmData(response);
      let games = parseGamesFromData(data as any, group.sportName, group.sportId);
      games = (Array.isArray(games) ? games : []).filter((g) => {
        const sid = (g as any)?.sport_id;
        if (sid === null || sid === undefined || sid === '') return true;
        return String(sid) === String(group.sportId);
      });
      if (group.mode === 'prematch') {
        games = this.filterPrematchGames(games);
      }

      const nextIds: string[] = [];
      const nextIdSet = new Set<string>();
      for (const g of games) {
        const gid = (g as any)?.id ?? (g as any)?.gameId;
        if (gid === null || gid === undefined || gid === '') continue;
        const s = String(gid);
        if (nextIdSet.has(s)) continue;
        nextIdSet.add(s);
        nextIds.push(s);
      }

      const prevFirst = group.oddsGameIds.length ? group.oddsGameIds[0] : '';
      if (group.oddsGameIds.length !== nextIds.length || prevFirst !== (nextIds[0] || '')) {
        group.oddsCursor = 0;
        group.lastOddsSnapshotAtMs = 0;
      }
      group.oddsGameIds = nextIds;

      for (const k of group.oddsCache.keys()) {
        if (!nextIdSet.has(k)) {
          group.oddsCache.delete(k);
        }
      }

      const fp = getSportFp(games);
      if (fp && fp === group.lastFp && group.lastGamesPayload) return;
      group.lastFp = fp;

      const payload = {
        sportId: group.sportId,
        sportName: group.sportName,
        data: games,
        last_updated: new Date().toISOString()
      };
      group.lastGamesPayload = payload;
      await this.broadcast(group.clients, encodeSseEvent('games', payload));
    } catch (e) {
      await this.broadcast(group.clients, encodeSseEvent('error', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      group.pollInFlight = false;
    }
  }

  private extractGamesFromNode(gamesNode: unknown): any[] {
    if (!gamesNode || typeof gamesNode !== 'object') return [];
    if (Array.isArray(gamesNode)) return gamesNode as any[];
    const vals = Object.values(gamesNode as Record<string, unknown>);
    return vals.filter((v) => v && typeof v === 'object' && !Array.isArray(v)) as any[];
  }

  private maybeRebuildOddsSnapshot(group: SportStreamGroup): void {
    const now = Date.now();
    if (group.lastOddsPayload && now - group.lastOddsSnapshotAtMs < ODDS_SNAPSHOT_REBUILD_MS) return;

    const updates: Array<{ gameId: unknown; odds: unknown; markets_count: number }> = [];
    const entries = Array.from(group.oddsCache.entries()).sort(([a], [b]) => String(a).localeCompare(String(b)));
    for (const [gameId, entry] of entries) {
      if (!Array.isArray(entry?.odds)) continue;
      updates.push({ gameId, odds: entry.odds, markets_count: Number(entry.markets_count) || 0 });
    }

    group.lastOddsPayload = { sportId: group.sportId, updates };
    group.lastOddsSnapshotAtMs = now;
  }

  private async pollSportOddsGroup(group: SportStreamGroup): Promise<void> {
    if (group.clients.size === 0) {
      this.stopSportGroup(group);
      return;
    }
    if (group.oddsInFlight) return;

    const allIds = Array.isArray(group.oddsGameIds) ? group.oddsGameIds : [];
    if (allIds.length === 0) return;

    const now = Date.now();
    const chunk: string[] = [];
    let idx = allIds.length ? group.oddsCursor % allIds.length : 0;
    let scanned = 0;
    while (chunk.length < Math.min(ODDS_CHUNK_SIZE, allIds.length) && scanned < allIds.length) {
      const gid = allIds[idx];
      idx = (idx + 1) % allIds.length;
      scanned += 1;
      const prev = group.oddsCache.get(String(gid));
      if (!prev || now - prev.updatedAtMs > ODDS_REFRESH_AFTER_MS) {
        chunk.push(String(gid));
      }
    }
    group.oddsCursor = idx;
    if (chunk.length === 0) {
      this.maybeRebuildOddsSnapshot(group);
      return;
    }

    group.oddsInFlight = true;
    try {
      const whereIds = chunk.map((s) => {
        const n = Number(s);
        return Number.isFinite(n) ? n : s;
      });

      const response = await this.sendRequest(
        'get',
        {
          source: 'betting',
          what: {
            game: ['id', 'markets_count'],
            market: ['id', 'type', 'order', 'is_blocked', 'display_key'],
            event: ['id', 'type', 'name', 'order', 'price', 'base', 'is_blocked']
          },
          where: { game: { id: { '@in': whereIds } } }
        },
        60000
      );

      if (response && typeof response === 'object') {
        const ro = response as Record<string, unknown>;
        if (ro.code !== undefined && ro.code !== 0) {
          const msg = ro.msg ? `: ${String(ro.msg)}` : '';
          throw new Error(`get odds chunk failed${msg}`);
        }
      }

      const data = unwrapSwarmData(response) as any;
      const games = this.extractGamesFromNode(data?.game);
      const typePriority = getSportMainMarketTypePriority(group.sportName);
      const updates: Array<{ gameId: unknown; odds: unknown; markets_count: number }> = [];

      for (const g of games) {
        const gid = (g as any)?.id ?? (g as any)?.gameId;
        if (gid === null || gid === undefined || gid === '') continue;
        const idStr = String(gid);

        const marketMap = (g as any)?.market;
        const market = pickPreferredMarketFromEmbedded(marketMap, typePriority);
        const oddsArr = buildOddsArrFromMarket(market);
        const marketsCount = typeof (g as any)?.markets_count === 'number'
          ? Number((g as any).markets_count)
          : (marketMap && typeof marketMap === 'object' ? Object.keys(marketMap).length : 0);
        const fp = getOddsFp(market);

        const prev = group.oddsCache.get(idStr);
        if (!prev || prev.fp !== fp) {
          group.oddsCache.set(idStr, { odds: oddsArr, markets_count: marketsCount, fp, updatedAtMs: now });
          if (Array.isArray(oddsArr)) {
            updates.push({ gameId: gid, odds: oddsArr, markets_count: marketsCount });
          }
        } else {
          group.oddsCache.set(idStr, { ...prev, updatedAtMs: now, markets_count: marketsCount });
        }
      }

      if (updates.length) {
        const payload = { sportId: group.sportId, updates };
        await this.broadcast(group.clients, encodeSseEvent('odds', payload));
      }

      this.maybeRebuildOddsSnapshot(group);
    } catch (e) {
      await this.broadcast(group.clients, encodeSseEvent('error', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      group.oddsInFlight = false;
    }
  }

  private async handleSportStream(request: Request, mode: 'live' | 'prematch'): Promise<Response> {
    const url = new URL(request.url);
    const sportId = url.searchParams.get('sportId');
    if (!sportId) {
      return json({ error: 'sportId is required' }, { status: 400 });
    }

    const sportNameParam = url.searchParams.get('sportName');
    const sportName = await this.getSportName(sportId, sportNameParam);

    const key = String(sportId);
    const groups = mode === 'live' ? this.liveGroups : this.prematchGroups;
    let group = groups.get(key);
    if (!group) {
      group = {
        sportId: key,
        sportName,
        mode,
        clients: new Map(),
        timer: null,
        oddsTimer: null,
        cleanupTimer: null,
        pollInFlight: false,
        lastFp: '',
        lastOddsFp: '',
        lastGamesPayload: null,
        lastOddsPayload: null,
        lastOddsSnapshotAtMs: 0,
        oddsInFlight: false,
        oddsCursor: 0,
        oddsGameIds: [],
        oddsCache: new Map()
      };
      groups.set(key, group);
    } else if (!group.sportName && sportName) {
      group.sportName = sportName;
    }

    if (!(group as any).oddsCache) {
      (group as any).oddsCache = new Map();
    }
    if (!(group as any).oddsGameIds) {
      (group as any).oddsGameIds = [];
    }
    if (typeof (group as any).pollInFlight !== 'boolean') {
      (group as any).pollInFlight = false;
    }
    if (typeof (group as any).oddsCursor !== 'number') {
      (group as any).oddsCursor = 0;
    }
    if (typeof (group as any).oddsInFlight !== 'boolean') {
      (group as any).oddsInFlight = false;
    }
    if (typeof (group as any).lastOddsSnapshotAtMs !== 'number') {
      (group as any).lastOddsSnapshotAtMs = 0;
    }

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const id = crypto.randomUUID();
    const client: Client = { id, writer, abortSignal: request.signal };
    group.clients.set(id, client);

    if (group.cleanupTimer != null) {
      clearTimeout(group.cleanupTimer);
      group.cleanupTimer = null;
    }

    request.signal.addEventListener('abort', () => {
      const existing = group?.clients.get(id);
      if (existing) {
        try {
          existing.writer.close();
        } catch {
          // ignore
        }
        group?.clients.delete(id);
      }
      if (group && group.clients.size === 0) {
        this.stopSportGroup(group);
        if (group.cleanupTimer == null) {
          group.cleanupTimer = setTimeout(() => {
            if (group.clients.size === 0) {
              this.stopSportGroup(group);
              groups.delete(key);
              if (mode === 'live' && !this.hasActiveLiveSportClients() && this.countsClients.size === 0) {
                void this.stopCountsSubscriptions();
              }
            }
          }, GROUP_GRACE_MS) as unknown as number;
        }

        if (mode === 'live' && !this.hasActiveLiveSportClients() && this.countsClients.size === 0) {
          void this.stopCountsSubscriptions();
        }
      }
    });

    const initialCountsPayload = mode === 'live' ? this.countsLivePayload : null;
    const initialPrematchCountsPayload = mode === 'live' ? this.countsPrematchPayload : null;
    const initialGamesPayload = group.lastGamesPayload;
    const initialOddsPayload = group.lastOddsPayload;
    setTimeout(() => {
      void (async () => {
        try {
          await writer.write(encodeSseComment(' '.repeat(2048)));
          await writer.write(encodeSseComment(`ready ${Date.now()}`));
          if (mode === 'live') {
            if (initialCountsPayload) {
              await writer.write(encodeSseEvent('counts', initialCountsPayload));
            }
            if (initialPrematchCountsPayload) {
              await writer.write(encodeSseEvent('prematch_counts', initialPrematchCountsPayload));
            }
          }
          if (initialGamesPayload) {
            await writer.write(encodeSseEvent('games', initialGamesPayload));
          }
          if (initialOddsPayload) {
            await writer.write(encodeSseEvent('odds', initialOddsPayload));
          }
        } catch {
          // ignore
        }
      })();
    }, 0);

    if (mode === 'live') {
      if (!this.countsLiveSubid || !this.countsPrematchSubid) {
        setTimeout(() => {
          void this.ensureCountsSubscriptions().catch(() => null);
        }, 0);
      }
    }

    this.startSportGroup(group);
    setTimeout(() => {
      void this.pollSportGroup(group);
    }, 0);

    return new Response(readable, { status: 200, headers: sseHeaders() });
  }

  private startGameGroup(group: GameStreamGroup): void {
    if (group.cleanupTimer != null) {
      clearTimeout(group.cleanupTimer);
      group.cleanupTimer = null;
    }
    if (group.timer != null) return;
    group.timer = setInterval(() => {
      void this.pollGameGroup(group);
    }, 5000) as unknown as number;
  }

  private stopGameGroup(group: GameStreamGroup): void {
    if (group.timer == null) return;
    clearInterval(group.timer);
    group.timer = null;
  }

  private async pollGameGroup(group: GameStreamGroup): Promise<void> {
    if (group.clients.size === 0) {
      this.stopGameGroup(group);
      return;
    }

    if (group.pollInFlight) return;
    group.pollInFlight = true;

    try {
      const gidNum = Number(group.gameId);
      const whereId = Number.isFinite(gidNum) ? gidNum : String(group.gameId);
      const response = await this.sendRequest(
        'get',
        {
          source: 'betting',
          what: {
            game: ['id', 'type', 'start_ts', 'team1_name', 'team2_name', 'info', 'text_info', 'markets_count'],
            market: ['id', 'type', 'order', 'is_blocked', 'display_key'],
            event: ['id', 'type', 'name', 'order', 'price', 'base', 'is_blocked']
          },
          where: { game: { id: whereId } }
        },
        15000
      );

      const data = unwrapSwarmData(response) as any;
      let game: any = null;
      const gamesNode = data?.game;
      if (gamesNode && typeof gamesNode === 'object') {
        if (Array.isArray(gamesNode)) {
          game = gamesNode.find((g) => g && String((g as any).id) === String(group.gameId)) || null;
        } else {
          game = gamesNode[String(group.gameId)] ?? gamesNode[group.gameId] ?? null;
          if (!game) {
            const vals = Object.values(gamesNode as Record<string, unknown>);
            if (vals.length === 1 && vals[0] && typeof vals[0] === 'object' && !Array.isArray(vals[0])) {
              game = vals[0];
            } else {
              game = vals.find((g: any) => g && typeof g === 'object' && String(g.id) === String(group.gameId)) || null;
            }
          }
        }
      }
      const fp = getGameFp(game);
      if (fp && fp === group.lastFp) return;
      group.lastFp = fp;

      const payload = { gameId: group.gameId, data: game, last_updated: new Date().toISOString() };
      group.lastPayload = payload;
      await this.broadcast(group.clients, encodeSseEvent('game', payload));
    } catch (e) {
      await this.broadcast(group.clients, encodeSseEvent('error', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      group.pollInFlight = false;
    }
  }

  private async handleLiveGameStream(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const gameId = url.searchParams.get('gameId');
    if (!gameId) return json({ error: 'gameId is required' }, { status: 400 });

    const key = String(gameId);
    let group = this.liveGameGroups.get(key);
    if (!group) {
      group = { gameId: key, clients: new Map(), timer: null, pollInFlight: false, lastFp: '', lastPayload: null, cleanupTimer: null };
      this.liveGameGroups.set(key, group);
    }

    if (typeof (group as any).pollInFlight !== 'boolean') {
      (group as any).pollInFlight = false;
    }
    if (typeof (group as any).cleanupTimer !== 'number' && (group as any).cleanupTimer !== null) {
      (group as any).cleanupTimer = null;
    }
    if (typeof (group as any).lastPayload === 'undefined') {
      (group as any).lastPayload = null;
    }

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const id = crypto.randomUUID();
    const client: Client = { id, writer, abortSignal: request.signal };
    group.clients.set(id, client);

    if (group.cleanupTimer != null) {
      clearTimeout(group.cleanupTimer);
      group.cleanupTimer = null;
    }

    request.signal.addEventListener('abort', () => {
      const existing = group?.clients.get(id);
      if (existing) {
        try {
          existing.writer.close();
        } catch {
          // ignore
        }
        group?.clients.delete(id);
      }
      if (group && group.clients.size === 0) {
        this.stopGameGroup(group);
        if (group.cleanupTimer == null) {
          group.cleanupTimer = setTimeout(() => {
            if (group.clients.size === 0) {
              this.stopGameGroup(group);
              this.liveGameGroups.delete(key);
            }
          }, GROUP_GRACE_MS) as unknown as number;
        }
      }
    });

    const initialGamePayload = group.lastPayload;
    setTimeout(() => {
      void (async () => {
        try {
          await writer.write(encodeSseComment(' '.repeat(2048)));
          await writer.write(encodeSseComment(`ready ${Date.now()}`));
          if (initialGamePayload) {
            await writer.write(encodeSseEvent('game', initialGamePayload));
          }
        } catch {
          // ignore
        }
      })();
    }, 0);

    this.startGameGroup(group);
    setTimeout(() => {
      void this.pollGameGroup(group);
    }, 0);

    return new Response(readable, { status: 200, headers: sseHeaders() });
  }

  private async getHierarchy(forceRefresh: boolean): Promise<unknown> {
    const cacheKey = 'hierarchy_cache';
    const ttlMs = 30 * 60 * 1000;
    const cached = await this.state.storage.get<HierarchyCache>(cacheKey);

    if (!forceRefresh && cached && typeof cached.cachedAtMs === 'number' && cached.data) {
      const age = Date.now() - cached.cachedAtMs;
      if (age <= ttlMs) {
        return { ...(cached.data as Record<string, unknown>), cached: true };
      }

      const refreshPromise = (async () => {
        try {
          await this.refreshHierarchyCache(cacheKey);
        } catch {
          // ignore
        }
      })();

      const stateAny = this.state as any;
      if (stateAny && typeof stateAny.waitUntil === 'function') {
        stateAny.waitUntil(refreshPromise);
      } else {
        void refreshPromise;
      }

      return { ...(cached.data as Record<string, unknown>), cached: true, stale: true };
    }

    const data = await this.refreshHierarchyCache(cacheKey);
    return { ...(data as Record<string, unknown>), cached: false };
  }

  private async refreshHierarchyCache(cacheKey: string): Promise<unknown> {
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
    return data;
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
        const resp = json(hierarchy as JsonValue);
        if (forceRefresh) return resp;

        const headers = new Headers(resp.headers);
        headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/counts-stream') {
      return this.handleCountsStream(request);
    }

    if (request.method === 'GET' && url.pathname === '/api/live-stream') {
      return this.handleSportStream(request, 'live');
    }

    if (request.method === 'GET' && url.pathname === '/api/prematch-stream') {
      return this.handleSportStream(request, 'prematch');
    }

    if (request.method === 'GET' && url.pathname === '/api/live-game-stream') {
      return this.handleLiveGameStream(request);
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
