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

 type MarketTypeCacheEntry = {
  cachedAtMs: number;
  types: string[];
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
  lastGamesUpdateAtMs: number;
  lastFp: string;
  lastOddsFp: string;
  lastGamesPayload: unknown | null;
  lastOddsPayload: unknown | null;
  lastOddsSnapshotAtMs: number;
  oddsInFlight: boolean;
  oddsCursor: number;
  oddsGameIds: string[];
  oddsCache: Map<string, OddsCacheEntry>;
  gamesSubid: string | null;
  gamesSubscribing: boolean;
  featuredOddsSubid: string | null;
  featuredOddsSubscribing: boolean;
  oddsSubid: string | null;
  oddsSubscribing: boolean;
  oddsTypePriority: string[] | null;
};

type GameStreamGroup = {
  gameId: string;
  clients: Map<string, Client>;
  timer: number | null;
  pollInFlight: boolean;
  subid: string | null;
  subscribing: boolean;
  lastFp: string;
  lastPayload: unknown | null;
  cleanupTimer: number | null;
};

type CompetitionOddsGroup = {
  key: string;
  sportId: string;
  sportName: string;
  mode: 'live' | 'prematch';
  competitionId: string;
  clients: Map<string, Client>;
  subid: string | null;
  cleanupTimer: number | null;
  oddsCache: Map<string, OddsCacheEntry>;
};

const encoder = new TextEncoder();

 const ODDS_CHUNK_SIZE = 30;
 const ODDS_POLL_INTERVAL_MS = 2500;
 const ODDS_SNAPSHOT_REBUILD_MS = 15000;
 const ODDS_REFRESH_AFTER_MS = 60000;
 const GROUP_GRACE_MS = 30000;
 
 // Cache limits to prevent memory exhaustion
 const ODDS_CACHE_TTL_MS = 3600000; // 1 hour TTL
 const ODDS_CACHE_MAX_SIZE = 1000; // Max entries per cache

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
  
  // Circular buffer for message timestamps (replaces unbounded array)
  private wsMessageTimestampsBuffer: number[] = new Array(2000).fill(0);
  private wsMessageTimestampsIndex = 0;
  private wsMessageTimestampsCount = 0;

  private subscriptions: Map<string, SubscriptionEntry> = new Map();

  private countsClients: Map<string, Client> = new Map();
  private countsHeartbeatTimer: number | null = null;
  private countsWatchdogTimer: number | null = null;
  private countsRefreshInFlight = false;
  private countsLiveSubid: string | null = null;
  private countsPrematchSubid: string | null = null;
  private countsLastLiveFp = '';
  private countsLastPrematchFp = '';
  private countsLivePayload: unknown = null;
  private countsPrematchPayload: unknown = null;

  private hierarchyMapsAtMs = 0;
  private hierarchySportNameById: Record<string, string> = {};
  private hierarchySportAliasById: Record<string, string> = {};
  private hierarchyRegionNameById: Record<string, string> = {};
  private hierarchyCompetitionNameById: Record<string, string> = {};

  private marketTypeCache: Map<string, MarketTypeCacheEntry> = new Map();

  private liveGroups: Map<string, SportStreamGroup> = new Map();
  private prematchGroups: Map<string, SportStreamGroup> = new Map();
  private liveGameGroups: Map<string, GameStreamGroup> = new Map();
  private competitionOddsGroups: Map<string, CompetitionOddsGroup> = new Map();

  private resetAfterDisconnect(): void {
    this.subscriptions.clear();

    this.countsLiveSubid = null;
    this.countsPrematchSubid = null;
    this.countsLastLiveFp = '';
    this.countsLastPrematchFp = '';
    this.countsLivePayload = null;
    this.countsPrematchPayload = null;

    for (const g of this.liveGroups.values()) {
      if (!g) continue;
      g.gamesSubid = null;
      g.gamesSubscribing = false;
      g.oddsSubid = null;
      g.oddsSubscribing = false;
      g.featuredOddsSubid = null;
      g.featuredOddsSubscribing = false;
      g.lastGamesUpdateAtMs = 0;
      g.lastFp = '';
      g.lastOddsFp = '';
    }
    for (const g of this.prematchGroups.values()) {
      if (!g) continue;
      g.gamesSubid = null;
      g.gamesSubscribing = false;
      g.oddsSubid = null;
      g.oddsSubscribing = false;
      g.featuredOddsSubid = null;
      g.featuredOddsSubscribing = false;
      g.lastGamesUpdateAtMs = 0;
      g.lastFp = '';
      g.lastOddsFp = '';
    }
    for (const g of this.liveGameGroups.values()) {
      if (!g) continue;
      g.subid = null;
      g.subscribing = false;
      g.lastFp = '';
    }
    for (const g of this.competitionOddsGroups.values()) {
      if (!g) continue;
      g.subid = null;
      g.oddsCache.clear();
    }

    if (this.countsClients.size > 0 || this.hasActiveLiveSportClients()) {
      setTimeout(() => {
        void this.ensureCountsSubscriptions().catch(() => null);
      }, 0);
    }

    for (const g of this.liveGroups.values()) {
      if (g && g.clients.size > 0) this.startSportGroup(g);
    }
    for (const g of this.prematchGroups.values()) {
      if (g && g.clients.size > 0) this.startSportGroup(g);
    }
    for (const g of this.liveGameGroups.values()) {
      if (g && g.clients.size > 0) this.startGameGroup(g);
    }
    for (const g of this.competitionOddsGroups.values()) {
      if (!g || g.clients.size === 0) continue;
      setTimeout(() => {
        void this.ensureCompetitionOddsSubscription(g).catch(() => null);
      }, 0);
    }
  }

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
    
    // Add to circular buffer - O(1) operation instead of O(n) splice
    this.wsMessageTimestampsBuffer[this.wsMessageTimestampsIndex] = now;
    this.wsMessageTimestampsIndex = (this.wsMessageTimestampsIndex + 1) % 2000;
    if (this.wsMessageTimestampsCount < 2000) {
      this.wsMessageTimestampsCount++;
    }
    
    if (kind === 'parse_error') this.wsMessageParseErrorsTotal += 1;
  }

  private getWsMessagesLast60s(): number {
    const now = Date.now();
    let count = 0;
    
    // Efficiently count messages in last 60s using circular buffer
    for (let i = 0; i < this.wsMessageTimestampsCount; i++) {
      const timestamp = this.wsMessageTimestampsBuffer[i];
      if (Number.isFinite(timestamp) && now - timestamp <= 60000) {
        count++;
      }
    }
    
    return count;
  }

  private rejectAllPending(err: unknown): void {
    for (const [rid, entry] of this.pending.entries()) {
      clearTimeout(entry.timeoutId);
      entry.reject(err);
      this.pending.delete(rid);
    }
  }

  /**
   * Clean expired entries from odds cache to prevent memory exhaustion
   * Uses TTL-based eviction with LRU fallback if cache exceeds max size
   */
  private cleanOddsCache(cache: Map<string, OddsCacheEntry>): void {
    const now = Date.now();
    
    // First pass: Remove expired entries (TTL-based eviction)
    for (const [key, entry] of cache.entries()) {
      if (now - entry.updatedAtMs > ODDS_CACHE_TTL_MS) {
        cache.delete(key);
      }
    }
    
    // Second pass: If still over limit, remove oldest entries (LRU eviction)
    if (cache.size > ODDS_CACHE_MAX_SIZE) {
      const entries = Array.from(cache.entries())
        .sort(([, a], [, b]) => a.updatedAtMs - b.updatedAtMs); // Sort by age, oldest first
      
      const toRemove = cache.size - ODDS_CACHE_MAX_SIZE;
      for (let i = 0; i < toRemove; i++) {
        cache.delete(entries[i][0]);
      }
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
        this.resetAfterDisconnect();
      });

      ws.addEventListener('error', () => {
        this.sessionId = null;
        this.ws = null;
        this.connecting = null;
        this.rejectAllPending(new Error('Swarm WebSocket error'));
        this.resetAfterDisconnect();
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
    const subid =
      (initial as any)?.subid ??
      (response as any)?.subid ??
      ((response as any)?.data && typeof (response as any).data === 'object' ? (response as any).data.subid : undefined);
    if (subid === undefined || subid === null || (typeof subid === 'string' && subid.trim() === '')) {
      throw new Error('subscribe did not return subid');
    }

    const state = (initial as Record<string, unknown>) || {};
    this.subscriptions.set(String(subid), { state, onEmit });
    const stateAny = state as any;
    const hasNodes = (v: any) => Boolean(
      v && typeof v === 'object' && !Array.isArray(v) && (
        v.game !== undefined ||
        v.market !== undefined ||
        v.event !== undefined ||
        v.sport !== undefined ||
        v.competition !== undefined ||
        v.region !== undefined
      )
    );
    const fromData = stateAny?.data;
    const candidate = hasNodes(fromData)
      ? fromData
      : hasNodes(stateAny)
        ? state
        : (fromData !== undefined && fromData !== null)
          ? fromData
          : undefined;
    if (candidate !== undefined) onEmit(candidate);
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

  private async getSportAlias(sportId: string): Promise<string | null> {
    await this.ensureHierarchyNameMaps();
    const cached = this.hierarchySportAliasById[String(sportId)];
    if (cached) return String(cached);

    try {
      const hierarchy = (await this.getHierarchy(false)) as any;
      const h = hierarchy?.data || hierarchy;
      const sports = h?.sport || {};
      const s = sports[String(sportId)];
      const alias = s?.alias;
      if (alias) return String(alias);
    } catch {
      return null;
    }

    return null;
  }

  private async getMarketTypePriority(sportId: string, sportName: string): Promise<string[]> {
    const ttlMs = 12 * 60 * 60 * 1000;
    const key = String(sportId);
    const cacheKey = `market_types:${key}`;
    const fallback = getSportMainMarketTypePriority(String(sportName || ''));

    const mem = this.marketTypeCache.get(key);
    if (mem && typeof mem.cachedAtMs === 'number' && Date.now() - mem.cachedAtMs <= ttlMs && Array.isArray(mem.types) && mem.types.length) {
      return mem.types.slice();
    }

    const stored = await this.state.storage.get<MarketTypeCacheEntry>(cacheKey);
    if (stored && typeof stored.cachedAtMs === 'number' && Date.now() - stored.cachedAtMs <= ttlMs && Array.isArray(stored.types) && stored.types.length) {
      this.marketTypeCache.set(key, stored);
      return stored.types.slice();
    }

    const sportAlias = await this.getSportAlias(key);
    if (!sportAlias) return Array.isArray(fallback) ? fallback.slice() : [];

    try {
      const response = (await this.sendRequest('get_market_type', { sport_alias: String(sportAlias) }, 20000)) as any;
      if (response && typeof response === 'object' && response.code !== undefined && response.code !== 0) {
        return Array.isArray(fallback) ? fallback.slice() : [];
      }

      const details = response?.data?.details;
      const arr = Array.isArray(details) ? details.slice() : [];
      arr.sort((a: any, b: any) => {
        const ao = typeof a?.Order === 'number' ? Number(a.Order) : Number.MAX_SAFE_INTEGER;
        const bo = typeof b?.Order === 'number' ? Number(b.Order) : Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return String(a?.BasaltKind ?? '').localeCompare(String(b?.BasaltKind ?? ''));
      });

      const types = arr
        .map((d: any) => d?.BasaltKind)
        .filter((v: any) => v !== null && v !== undefined && String(v) !== '')
        .map((v: any) => String(v));

      const entry: MarketTypeCacheEntry = { cachedAtMs: Date.now(), types: types.length ? types : (Array.isArray(fallback) ? fallback.slice() : []) };
      this.marketTypeCache.set(key, entry);
      await this.state.storage.put(cacheKey, entry);
      return entry.types.slice();
    } catch {
      return Array.isArray(fallback) ? fallback.slice() : [];
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

  private startCountsWatchdog(): void {
    if (this.countsWatchdogTimer != null) return;
    this.countsWatchdogTimer = setInterval(() => {
      if (this.countsClients.size === 0 && !this.hasActiveLiveSportClients()) {
        this.stopCountsWatchdog();
        return;
      }
      void this.refreshCountsOnce('watchdog').catch(() => null);
    }, 15000) as unknown as number;
  }

  private stopCountsWatchdog(): void {
    if (this.countsWatchdogTimer == null) return;
    clearInterval(this.countsWatchdogTimer);
    this.countsWatchdogTimer = null;
  }

  private async refreshCountsOnce(_reason: string): Promise<void> {
    if (this.countsRefreshInFlight) return;
    this.countsRefreshInFlight = true;
    try {
      const live = await this.sendRequest(
        'get',
        {
          source: 'betting',
          what: { sport: ['id', 'name'], game: '@count' },
          where: { sport: { type: { '@nin': [1, 4] } }, game: { type: 1 } }
        },
        15000
      );
      this.handleCountsEmit('live', live);

      const prematch = await this.sendRequest(
        'get',
        {
          source: 'betting',
          what: { sport: ['id', 'name'], game: '@count' },
          where: {
            sport: { type: { '@nin': [1, 4] } },
            game: {
              '@or': [{ visible_in_prematch: 1 }, { type: { '@in': [0, 2] } }]
            }
          }
        },
        15000
      );
      this.handleCountsEmit('prematch', prematch);
    } finally {
      this.countsRefreshInFlight = false;
    }
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
          what: { sport: ['id', 'name'], game: '@count' },
          where: { sport: { type: { '@nin': [1, 4] } }, game: { type: 1 } }
        },
        (data) => this.handleCountsEmit('live', data)
      );
    }

    if (!this.countsPrematchSubid) {
      this.countsPrematchSubid = await this.subscribeGet(
        {
          source: 'betting',
          what: { sport: ['id', 'name'], game: '@count' },
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

    this.stopCountsWatchdog();

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
          this.stopCountsWatchdog();
          void this.stopCountsSubscriptions();
        }
      }
    });

    if (this.countsClients.size === 1) {
      this.startCountsHeartbeat();
      this.startCountsWatchdog();
      setTimeout(() => {
        void this.ensureCountsSubscriptions().catch((e) => {
          void this.broadcast(this.countsClients, encodeSseEvent('error', { error: e instanceof Error ? e.message : String(e) }));
        });
      }, 0);

      setTimeout(() => {
        void this.refreshCountsOnce('connect').catch(() => null);
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

  private async handleLiveSportGamesEmit(group: SportStreamGroup, rawData: unknown): Promise<void> {
    if (!group.clients || group.clients.size === 0) return;

    const data = unwrapSwarmData(rawData);
    let games = parseGamesFromData(data as any, group.sportName, group.sportId);
    games = (Array.isArray(games) ? games : []).filter((g) => {
      const sid = (g as any)?.sport_id;
      if (sid === null || sid === undefined || sid === '') return true;
      return String(sid) === String(group.sportId);
    });

    games = this.filterLiveGames(games);

    group.lastGamesUpdateAtMs = Date.now();

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
  }

  private async ensureCompetitionOddsSubscription(group: CompetitionOddsGroup): Promise<void> {
    if (group.subid) return;
    await this.ensureConnection();

    const cidNum = Number(group.competitionId);
    const whereCompetitionId = Number.isFinite(cidNum) ? cidNum : String(group.competitionId);

    const whereGame =
      group.mode === 'live'
        ? { type: 1 }
        : { '@or': [{ visible_in_prematch: 1 }, { type: { '@in': [0, 2] } }] };

    const subid = await this.subscribeGet(
      {
        source: 'betting',
        what: {
          game: ['id', 'markets_count'],
          market: ['id', 'game_id', 'type', 'order', 'is_blocked', 'display_key', 'display_sub_key', 'main_order', 'base'],
          event: ['id', 'market_id', 'type', 'type_1', 'name', 'order', 'price', 'base', 'is_blocked']
        },
        where: {
          competition: { id: whereCompetitionId },
          game: whereGame,
          market: {
            '@or': [
              { display_key: { '@in': ['HANDICAP', 'TOTALS'] }, display_sub_key: 'MATCH', main_order: 1 },
              { display_key: 'WINNER', display_sub_key: 'MATCH' }
            ]
          }
        }
      },
      (data) => {
        void this.handleCompetitionOddsEmit(group, data);
      }
    );

    group.subid = subid;
  }

  private async handleCompetitionOddsEmit(group: CompetitionOddsGroup, rawData: unknown): Promise<void> {
    if (!group.clients || group.clients.size === 0) return;

    const data = unwrapSwarmData(rawData) as any;
    const games = this.extractGamesFromNode(data?.game);
    if (!games.length) return;

    for (const g of games) {
      const gid = (g as any)?.id ?? (g as any)?.gameId;
      if (gid === null || gid === undefined || gid === '') continue;
      this.embedMarketsIntoGame(g, data, String(gid));
    }

    const dynamicTypes = await this.getMarketTypePriority(group.sportId, group.sportName);
    const fallbackTypes = getSportMainMarketTypePriority(group.sportName);
    const merged: string[] = [];
    for (const t of (Array.isArray(dynamicTypes) ? dynamicTypes : [])) {
      const s = String(t || '');
      if (!s) continue;
      if (!merged.includes(s)) merged.push(s);
    }
    for (const t of (Array.isArray(fallbackTypes) ? fallbackTypes : [])) {
      const s = String(t || '');
      if (!s) continue;
      if (!merged.includes(s)) merged.push(s);
    }
    const typePriority = merged.length ? merged : fallbackTypes;
    const updates: Array<{ gameId: unknown; odds: unknown; markets_count: number }> = [];
    const now = Date.now();

    for (const g of games) {
      const gid = (g as any)?.id ?? (g as any)?.gameId;
      if (gid === null || gid === undefined || gid === '') continue;
      const idStr = String(gid);

      const marketMap = (g as any)?.market;
      let market = pickPreferredMarketFromEmbedded(marketMap, typePriority);
      if (!market && marketMap && typeof marketMap === 'object') {
        const markets = Object.values(marketMap as Record<string, unknown>)
          .map((mRaw) => (mRaw && typeof mRaw === 'object' && !Array.isArray(mRaw) ? (mRaw as any) : null))
          .filter(Boolean) as any[];
        markets.sort((a, b) => {
          const ao = typeof a?.order === 'number' ? Number(a.order) : Number.MAX_SAFE_INTEGER;
          const bo = typeof b?.order === 'number' ? Number(b.order) : Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return ao - bo;
          return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
        });
        const candidate = markets.find((m) => {
          const ev = m?.event;
          const cnt = ev && typeof ev === 'object' && !Array.isArray(ev) ? Object.keys(ev).length : 0;
          return cnt === 2 || cnt === 3;
        });
        if (candidate) market = candidate;
      }

      const oddsArr = buildOddsArrFromMarket(market);
      const marketsCount = typeof (g as any)?.markets_count === 'number'
        ? Number((g as any).markets_count)
        : (marketMap && typeof marketMap === 'object' ? Object.keys(marketMap).length : 0);
      const fp = getOddsFp(market);

      const prev = group.oddsCache.get(idStr);
      const prevCount = typeof prev?.markets_count === 'number' ? Number(prev.markets_count) : null;
      const shouldEmit = !prev || prev.fp !== fp || (typeof prevCount === 'number' && prevCount !== marketsCount);
      if (!shouldEmit) {
        group.oddsCache.set(idStr, { ...prev, updatedAtMs: now, markets_count: marketsCount });
        continue;
      }

      group.oddsCache.set(idStr, { odds: oddsArr, markets_count: marketsCount, fp, updatedAtMs: now });
      updates.push({ gameId: gid, odds: Array.isArray(oddsArr) ? oddsArr : null, markets_count: marketsCount });
    }

    if (!updates.length) return;

    const payload = { sportId: group.sportId, competitionId: group.competitionId, updates };
    await this.broadcast(group.clients, encodeSseEvent('odds', payload));
    
    // Clean expired cache entries to prevent memory exhaustion
    this.cleanOddsCache(group.oddsCache);
  }

  private async handleCompetitionOddsStream(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const competitionId = url.searchParams.get('competitionId');
    const sportId = url.searchParams.get('sportId');
    const modeParam = url.searchParams.get('mode');

    if (!competitionId) return json({ error: 'competitionId is required' }, { status: 400 });
    if (!sportId) return json({ error: 'sportId is required' }, { status: 400 });
    if (modeParam !== 'live' && modeParam !== 'prematch') return json({ error: 'mode must be live or prematch' }, { status: 400 });

    const mode = modeParam as 'live' | 'prematch';
    const sportNameParam = url.searchParams.get('sportName');
    const sportName = sportNameParam ? String(sportNameParam) : await this.getSportName(sportId, null);

    const key = `${mode}:${String(competitionId)}`;
    let group = this.competitionOddsGroups.get(key);
    if (!group) {
      group = {
        key,
        sportId: String(sportId),
        sportName,
        mode,
        competitionId: String(competitionId),
        clients: new Map(),
        subid: null,
        cleanupTimer: null,
        oddsCache: new Map()
      };
      this.competitionOddsGroups.set(key, group);
    } else {
      group.sportId = String(sportId);
      if (sportName && !group.sportName) group.sportName = sportName;
      if (group.cleanupTimer != null) {
        clearTimeout(group.cleanupTimer);
        group.cleanupTimer = null;
      }
    }

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const id = crypto.randomUUID();
    const client: Client = { id, writer, abortSignal: request.signal };
    group.clients.set(id, client);

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
        if (group.cleanupTimer == null) {
          group.cleanupTimer = setTimeout(() => {
            if (group.clients.size === 0) {
              const sid = group.subid;
              group.subid = null;
              group.oddsCache.clear();
              this.competitionOddsGroups.delete(key);
              if (sid) void this.unsubscribe(sid);
            }
          }, GROUP_GRACE_MS) as unknown as number;
        }
      }
    });

    setTimeout(() => {
      void (async () => {
        try {
          await writer.write(encodeSseComment(' '.repeat(2048)));
          await writer.write(encodeSseComment(`ready ${Date.now()}`));

          if (group.oddsCache.size) {
            const updates = Array.from(group.oddsCache.entries()).map(([gameId, v]) => ({
              gameId,
              odds: Array.isArray((v as any)?.odds) ? (v as any).odds : null,
              markets_count: typeof (v as any)?.markets_count === 'number' ? Number((v as any).markets_count) : 0
            }));
            await writer.write(encodeSseEvent('odds', { sportId: group.sportId, competitionId: group.competitionId, updates }));
          }
        } catch {
          // ignore
        }
      })();
    }, 0);

    setTimeout(() => {
      void this.ensureCompetitionOddsSubscription(group!).catch((e) => {
        void this.broadcast(group!.clients, encodeSseEvent('error', { error: e instanceof Error ? e.message : String(e) }));
      });
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

  private filterLiveGames(games: any[]): any[] {
    return (Array.isArray(games) ? games : []).filter((g) => {
      if (!g) return false;
      if (Number(g?.type) !== 1) return false;

      const showType = String(g?.show_type ?? '').trim().toUpperCase();
      if (showType) {
        if (showType === 'OUTRIGHT') return false;
        if (showType.includes('FINISH') || showType.includes('ENDED') || showType.includes('RESULT') || showType.includes('CLOSED')) {
          return false;
        }
      }

      const isLive = (g as any)?.is_live;
      if (isLive === 0 || isLive === false) return false;

      const info = g?.info && typeof g.info === 'object' ? g.info : null;
      const state = String(info?.current_game_state ?? info?.stage ?? info?.period_name ?? info?.period ?? '').trim().toUpperCase();
      if (state && (state.includes('FINISH') || state.includes('FINAL') || state.includes('ENDED') || state === 'FT')) {
        return false;
      }

      const lastEvent = String((g as any)?.last_event ?? '').trim().toUpperCase();
      if (lastEvent && lastEvent.includes('FINISH')) return false;

      const textInfo = String(g?.text_info ?? '').trim().toUpperCase();
      if (textInfo && (textInfo.includes('FINISH') || textInfo.includes('FINAL') || /\bFT\b/.test(textInfo))) {
        return false;
      }

      return true;
    });
  }

  private async ensureHierarchyNameMaps(): Promise<void> {
    const cacheKey = 'hierarchy_cache';
    const cached = await this.state.storage.get<HierarchyCache>(cacheKey);
    if (!cached || typeof cached.cachedAtMs !== 'number' || !cached.data) return;
    if (cached.cachedAtMs === this.hierarchyMapsAtMs) return;

    const raw = cached.data as any;
    const h = raw?.data || raw;
    const sports = h?.sport && typeof h.sport === 'object' ? h.sport : {};
    const regions = h?.region && typeof h.region === 'object' ? h.region : {};
    const competitions = h?.competition && typeof h.competition === 'object' ? h.competition : {};

    const sportById: Record<string, string> = {};
    const sportAliasById: Record<string, string> = {};
    const regionById: Record<string, string> = {};
    const competitionById: Record<string, string> = {};

    for (const [id, s] of Object.entries(sports)) {
      if (!s || typeof s !== 'object') continue;
      const name = (s as any)?.name;
      if (name) sportById[String(id)] = String(name);
      const alias = (s as any)?.alias;
      if (alias) sportAliasById[String(id)] = String(alias);
    }
    for (const [id, r] of Object.entries(regions)) {
      if (!r || typeof r !== 'object') continue;
      const name = (r as any)?.name;
      if (name) regionById[String(id)] = String(name);
    }
    for (const [id, c] of Object.entries(competitions)) {
      if (!c || typeof c !== 'object') continue;
      const name = (c as any)?.name;
      if (name) competitionById[String(id)] = String(name);
    }

    this.hierarchyMapsAtMs = cached.cachedAtMs;
    this.hierarchySportNameById = sportById;
    this.hierarchySportAliasById = sportAliasById;
    this.hierarchyRegionNameById = regionById;
    this.hierarchyCompetitionNameById = competitionById;
  }

  private startSportGroup(group: SportStreamGroup): void {
    if (group.cleanupTimer != null) {
      clearTimeout(group.cleanupTimer);
      group.cleanupTimer = null;
    }
    if (group.mode === 'prematch') {
      if (group.timer == null) {
        group.timer = setInterval(() => {
          void this.pollSportGroup(group);
        }, 5000) as unknown as number;
      }

      if (!group.featuredOddsSubid && !group.featuredOddsSubscribing) {
        setTimeout(() => {
          void this.ensurePrematchFeaturedOddsSubscription(group);
        }, 0);
      }
    } else {
      if (!group.gamesSubid && !group.gamesSubscribing) {
        setTimeout(() => {
          void this.ensureLiveSportGamesSubscription(group);
        }, 0);
      }
      if (group.timer == null) {
        group.timer = setInterval(() => {
          void this.pollSportGroup(group);
        }, 5000) as unknown as number;
      }
    }

    if (group.mode === 'prematch') {
      if (group.oddsTimer == null) {
        group.oddsTimer = setInterval(() => {
          void this.pollSportOddsGroup(group);
        }, ODDS_POLL_INTERVAL_MS) as unknown as number;
      }
    } else {
      if (!group.oddsSubid && !group.oddsSubscribing) {
        setTimeout(() => {
          void this.ensureLiveSportOddsSubscription(group);
        }, 0);
      }
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

  private async ensureLiveSportGamesSubscription(group: SportStreamGroup): Promise<void> {
    if (group.mode !== 'live') return;
    if (group.gamesSubid) return;
    if (group.gamesSubscribing) return;

    group.gamesSubscribing = true;
    try {
      await this.ensureConnection();

      const sportIdNum = Number(group.sportId);
      const whereSportId = Number.isFinite(sportIdNum) ? sportIdNum : String(group.sportId);

      const gameFields = [
        'id',
        'sport_id',
        'type',
        'start_ts',
        'team1_name',
        'team2_name',
        'is_blocked',
        'info',
        'text_info',
        'markets_count',
        'show_type',
        'is_live',
        'is_started',
        'last_event',
        'live_events',
        'match_length'
      ];
      if (!gameFields.includes('competition_id')) gameFields.push('competition_id');
      if (!gameFields.includes('region_id')) gameFields.push('region_id');

      const subid = await this.subscribeGet(
        {
          source: 'betting',
          what: {
            sport: ['id', 'name'],
            region: ['id', 'name'],
            competition: ['id', 'name'],
            game: gameFields
          },
          where: {
            sport: { id: whereSportId },
            game: { type: 1 }
          }
        },
        (data) => {
          void this.handleLiveSportGamesEmit(group, data);
        }
      );

      group.gamesSubid = String(subid);

      if (group.timer != null) {
        clearInterval(group.timer);
        group.timer = null;
      }
    } catch (e) {
      if (group.timer == null) {
        group.timer = setInterval(() => {
          void this.pollSportGroup(group);
        }, 5000) as unknown as number;
      }
      setTimeout(() => {
        void this.pollSportGroup(group);
      }, 0);
    } finally {
      group.gamesSubscribing = false;
    }
  }

  private async ensureLiveSportOddsSubscription(group: SportStreamGroup): Promise<void> {
    if (group.mode !== 'live') return;
    if (group.oddsSubid) return;
    if (group.oddsSubscribing) return;

    group.oddsSubscribing = true;
    try {
      await this.ensureConnection();
      const types = await this.getMarketTypePriority(group.sportId, group.sportName);
      const typePriority = Array.isArray(types) && types.length ? types : getSportMainMarketTypePriority(group.sportName);
      group.oddsTypePriority = Array.isArray(typePriority) ? typePriority.map(String) : [];
      const mainType = group.oddsTypePriority.length ? group.oddsTypePriority[0] : null;
      if (!mainType) return;

      const sportIdNum = Number(group.sportId);
      const whereSportId = Number.isFinite(sportIdNum) ? sportIdNum : String(group.sportId);

      const subid = await this.subscribeGet(
        {
          source: 'betting',
          what: {
            game: ['id', 'markets_count'],
            market: ['id', 'game_id', 'type', 'order', 'is_blocked', 'display_key', 'display_sub_key', 'main_order', 'base'],
            event: ['id', 'market_id', 'type', 'type_1', 'name', 'order', 'price', 'base', 'is_blocked']
          },
          where: {
            sport: { id: whereSportId },
            game: { type: 1 },
            market: { type: String(mainType) }
          }
        },
        (data) => {
          void this.handleLiveSportOddsEmit(group, data);
        }
      );

      group.oddsSubid = String(subid);
    } catch {
      return;
    } finally {
      group.oddsSubscribing = false;
    }
  }

  private async ensurePrematchFeaturedOddsSubscription(group: SportStreamGroup): Promise<void> {
    if (group.mode !== 'prematch') return;
    if (group.featuredOddsSubid) return;
    if (group.featuredOddsSubscribing) return;

    group.featuredOddsSubscribing = true;
    try {
      await this.ensureConnection();

      const sportIdNum = Number(group.sportId);
      const whereSportId = Number.isFinite(sportIdNum) ? sportIdNum : String(group.sportId);

      const subid = await this.subscribeGet(
        {
          source: 'betting',
          what: {
            sport: ['id', 'name', 'alias', 'order'],
            game: [[
              'id',
              'markets_count',
              'is_blocked',
              'is_stat_available',
              'show_type',
              'sport_alias',
              'team1_name',
              'team2_name',
              'team1_id',
              'team2_id',
              'sportcast_id',
              'start_ts',
              '_parent_id',
              'region_alias'
            ]],
            market: ['type', 'name', 'display_key', 'base', 'id', 'express_id', 'name_template', 'main_order'],
            event: ['id', 'price', 'type_1', 'name', 'base', 'order']
          },
          where: {
            sport: { id: whereSportId, type: { '@nin': [1, 4] } },
            game: {
              show_type: { '@ne': 'OUTRIGHT' },
              start_ts: { '@now': { '@gte': 1800, '@lt': 3600 } }
            },
            market: {
              '@or': [
                { display_key: { '@in': ['HANDICAP', 'TOTALS'] }, display_sub_key: 'MATCH', main_order: 1 },
                { display_key: 'WINNER', display_sub_key: 'MATCH' }
              ]
            }
          }
        },
        (data) => {
          void this.handlePrematchFeaturedOddsEmit(group, data);
        }
      );

      group.featuredOddsSubid = String(subid);
    } catch {
      // silent: we'll fall back to normal polling
      return;
    } finally {
      group.featuredOddsSubscribing = false;
    }
  }

  private async handlePrematchFeaturedOddsEmit(group: SportStreamGroup, rawData: unknown): Promise<void> {
    if (!group.clients || group.clients.size === 0) return;

    const data = unwrapSwarmData(rawData) as any;
    const games = this.extractGamesFromNode(data?.game);
    if (!games.length) return;

    for (const g of games) {
      const gid = (g as any)?.id ?? (g as any)?.gameId;
      if (gid === null || gid === undefined || gid === '') continue;
      this.embedMarketsIntoGame(g, data, String(gid));
    }

    const dynamicTypes = await this.getMarketTypePriority(group.sportId, group.sportName);
    const fallbackTypes = getSportMainMarketTypePriority(group.sportName);
    const merged: string[] = [];
    for (const t of (Array.isArray(dynamicTypes) ? dynamicTypes : [])) {
      const s = String(t || '');
      if (!s) continue;
      if (!merged.includes(s)) merged.push(s);
    }
    for (const t of (Array.isArray(fallbackTypes) ? fallbackTypes : [])) {
      const s = String(t || '');
      if (!s) continue;
      if (!merged.includes(s)) merged.push(s);
    }
    const typePriority = merged.length ? merged : fallbackTypes;

    const updates: Array<{ gameId: unknown; odds: unknown; markets_count: number }> = [];
    const now = Date.now();

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
      const prevCount = typeof prev?.markets_count === 'number' ? Number(prev.markets_count) : null;
      const shouldEmit = !prev || prev.fp !== fp || (typeof prevCount === 'number' && prevCount !== marketsCount);
      if (!shouldEmit) {
        group.oddsCache.set(idStr, { ...prev, updatedAtMs: now, markets_count: marketsCount });
        continue;
      }

      group.oddsCache.set(idStr, { odds: oddsArr, markets_count: marketsCount, fp, updatedAtMs: now });
      updates.push({ gameId: gid, odds: Array.isArray(oddsArr) ? oddsArr : null, markets_count: marketsCount });
    }

    if (updates.length) {
      const payload = { sportId: group.sportId, updates };
      await this.broadcast(group.clients, encodeSseEvent('odds', payload));
    }

    this.maybeRebuildOddsSnapshot(group);
    
    // Clean expired cache entries to prevent memory exhaustion
    this.cleanOddsCache(group.oddsCache);
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

    if (group.mode === 'live' && group.gamesSubid) {
      const last = typeof (group as any).lastGamesUpdateAtMs === 'number' ? Number((group as any).lastGamesUpdateAtMs) : 0;
      if (last && Date.now() - last < 20000) return;
    }

    if (group.pollInFlight) return;
    group.pollInFlight = true;

    try {
      const gameFields =
        group.mode === 'live'
          ? [
              'id',
              'sport_id',
              'type',
              'start_ts',
              'team1_name',
              'team2_name',
              'is_blocked',
              'info',
              'text_info',
              'markets_count',
              'show_type',
              'is_live',
              'is_started',
              'last_event',
              'live_events',
              'match_length'
            ]
          : ['id', 'sport_id', 'type', 'start_ts', 'team1_name', 'team2_name', 'is_blocked', 'visible_in_prematch', 'markets_count'];

      if (!gameFields.includes('competition_id')) gameFields.push('competition_id');
      if (!gameFields.includes('region_id')) gameFields.push('region_id');

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
      } else {
        games = this.filterLiveGames(games);
      }

      if (group.mode === 'live') {
        group.lastGamesUpdateAtMs = Date.now();
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

      if (group.mode === 'prematch') {
        setTimeout(() => {
          void this.pollSportOddsGroup(group);
        }, 0);
      }
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

  private embedMarketsIntoGame(game: any, data: any, gameId: string): void {
    if (!game || typeof game !== 'object') return;

    const marketMap: Record<string, any> = {};
    const existingMarket = (game as any).market;
    if (existingMarket && typeof existingMarket === 'object' && !Array.isArray(existingMarket)) {
      for (const [k, v] of Object.entries(existingMarket as Record<string, unknown>)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const ev = (v as any).event;
          marketMap[String(k)] = { ...(v as any), event: (ev && typeof ev === 'object' && !Array.isArray(ev)) ? ev : {} };
        }
      }
    }

    const marketsNode = data?.market;
    const markets = marketsNode && typeof marketsNode === 'object'
      ? (Array.isArray(marketsNode) ? marketsNode : Object.values(marketsNode as Record<string, unknown>))
      : [];

    for (const mRaw of markets) {
      const m = mRaw && typeof mRaw === 'object' && !Array.isArray(mRaw) ? (mRaw as any) : null;
      if (!m) continue;
      const gid = m?.game_id ?? m?.gameId;
      if (gid === null || gid === undefined || gid === '') continue;
      if (String(gid) !== String(gameId)) continue;

      const mid = m?.id;
      if (mid === null || mid === undefined || mid === '') continue;
      const midStr = String(mid);
      const prev = marketMap[midStr] && typeof marketMap[midStr] === 'object' ? marketMap[midStr] : {};
      const prevEvent = prev?.event && typeof prev.event === 'object' && !Array.isArray(prev.event) ? prev.event : {};
      marketMap[midStr] = { ...prev, ...m, event: prevEvent };
    }

    const eventsNode = data?.event;
    const events = eventsNode && typeof eventsNode === 'object'
      ? (Array.isArray(eventsNode) ? eventsNode : Object.values(eventsNode as Record<string, unknown>))
      : [];

    for (const eRaw of events) {
      const e = eRaw && typeof eRaw === 'object' && !Array.isArray(eRaw) ? (eRaw as any) : null;
      if (!e) continue;
      const mid = e?.market_id ?? e?.marketId;
      if (mid === null || mid === undefined || mid === '') continue;
      const midStr = String(mid);
      const market = marketMap[midStr];
      if (!market || typeof market !== 'object') continue;
      if (!market.event || typeof market.event !== 'object' || Array.isArray(market.event)) market.event = {};
      const eid = e?.id;
      if (eid === null || eid === undefined || eid === '') continue;
      market.event[String(eid)] = e;
    }

    if (Object.keys(marketMap).length > 0) {
      (game as any).market = marketMap;
      if (typeof (game as any).markets_count !== 'number') {
        (game as any).markets_count = Object.keys(marketMap).length;
      }
    }
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

  private async handleLiveSportOddsEmit(group: SportStreamGroup, rawData: unknown): Promise<void> {
    if (!group.clients || group.clients.size === 0) return;

    const data = unwrapSwarmData(rawData) as any;
    const games = this.extractGamesFromNode(data?.game);
    if (!games.length) return;

    for (const g of games) {
      const gid = (g as any)?.id ?? (g as any)?.gameId;
      if (gid === null || gid === undefined || gid === '') continue;
      this.embedMarketsIntoGame(g, data, String(gid));
    }

    const typePriority = Array.isArray(group.oddsTypePriority) && group.oddsTypePriority.length
      ? group.oddsTypePriority
      : getSportMainMarketTypePriority(group.sportName);

    const updates: Array<{ gameId: unknown; odds: unknown; markets_count: number }> = [];
    const now = Date.now();

    for (const g of games) {
      const gid = (g as any)?.id ?? (g as any)?.gameId;
      if (gid === null || gid === undefined || gid === '') continue;
      const idStr = String(gid);

      const marketMap = (g as any)?.market;
      let market = pickPreferredMarketFromEmbedded(marketMap, typePriority);
      if (!market && marketMap && typeof marketMap === 'object') {
        const markets = Object.values(marketMap as Record<string, unknown>)
          .map((mRaw) => (mRaw && typeof mRaw === 'object' && !Array.isArray(mRaw) ? (mRaw as any) : null))
          .filter(Boolean) as any[];
        markets.sort((a, b) => {
          const ao = typeof a?.order === 'number' ? Number(a.order) : Number.MAX_SAFE_INTEGER;
          const bo = typeof b?.order === 'number' ? Number(b.order) : Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return ao - bo;
          return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
        });
        const candidate = markets.find((m) => {
          const ev = m?.event;
          const cnt = ev && typeof ev === 'object' && !Array.isArray(ev) ? Object.keys(ev).length : 0;
          return cnt === 2 || cnt === 3;
        });
        if (candidate) market = candidate;
      }

      const oddsArr = buildOddsArrFromMarket(market);
      const marketsCount = typeof (g as any)?.markets_count === 'number'
        ? Number((g as any).markets_count)
        : (marketMap && typeof marketMap === 'object' ? Object.keys(marketMap).length : 0);
      const fp = getOddsFp(market);

      const prev = group.oddsCache.get(idStr);
      const prevCount = typeof prev?.markets_count === 'number' ? Number(prev.markets_count) : null;
      const shouldEmit = !prev || prev.fp !== fp || (typeof prevCount === 'number' && prevCount !== marketsCount);
      if (!shouldEmit) {
        group.oddsCache.set(idStr, { ...prev, updatedAtMs: now, markets_count: marketsCount });
        continue;
      }

      group.oddsCache.set(idStr, { odds: oddsArr, markets_count: marketsCount, fp, updatedAtMs: now });
      updates.push({ gameId: gid, odds: Array.isArray(oddsArr) ? oddsArr : null, markets_count: marketsCount });
    }

    if (updates.length) {
      const payload = { sportId: group.sportId, updates };
      await this.broadcast(group.clients, encodeSseEvent('odds', payload));
    }

    this.maybeRebuildOddsSnapshot(group);
    
    // Clean expired cache entries to prevent memory exhaustion
    this.cleanOddsCache(group.oddsCache);
  }

  private async pollSportOddsGroup(group: SportStreamGroup): Promise<void> {
    if (group.mode !== 'prematch') return;
    if (group.clients.size === 0) {
      this.stopSportGroup(group);
      return;
    }
    if (group.oddsInFlight) return;
    if (group.pollInFlight) return;
    if (!group.lastGamesPayload) return;

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
      // Clean expired cache entries when no updates needed
      this.cleanOddsCache(group.oddsCache);
      return;
    }

    group.oddsInFlight = true;
    try {
      const whereIds = chunk.map((s) => {
        const n = Number(s);
        return Number.isFinite(n) ? n : s;
      });

      const dynamicTypes = group.oddsTypePriority && Array.isArray(group.oddsTypePriority) && group.oddsTypePriority.length
        ? group.oddsTypePriority
        : await this.getMarketTypePriority(group.sportId, group.sportName);
      const fallbackTypes = getSportMainMarketTypePriority(group.sportName);
      const merged: string[] = [];
      for (const t of (Array.isArray(dynamicTypes) ? dynamicTypes : [])) {
        const s = String(t || '');
        if (!s) continue;
        if (!merged.includes(s)) merged.push(s);
      }
      for (const t of (Array.isArray(fallbackTypes) ? fallbackTypes : [])) {
        const s = String(t || '');
        if (!s) continue;
        if (!merged.includes(s)) merged.push(s);
      }
      const typePriority = merged.length ? merged : fallbackTypes;
      group.oddsTypePriority = Array.isArray(typePriority) ? typePriority.slice(0, 20) : null;
      const where: any = { game: { id: { '@in': whereIds } } };
      const pri = Array.isArray(typePriority) ? typePriority.slice(0, 8).map(String) : [];
      if (pri.length) {
        where.market = { type: { '@in': pri } };
      }

      const response = await this.sendRequest(
        'get',
        {
          source: 'betting',
          what: {
            game: ['id', 'markets_count'],
            market: ['id', 'game_id', 'type', 'order', 'is_blocked', 'display_key'],
            event: ['id', 'market_id', 'type', 'name', 'order', 'price', 'base', 'is_blocked']
          },
          where
        },
        20000
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
      const updates: Array<{ gameId: unknown; odds: unknown; markets_count: number }> = [];

      for (const g of games) {
        const gid = (g as any)?.id ?? (g as any)?.gameId;
        if (gid === null || gid === undefined || gid === '') continue;
        this.embedMarketsIntoGame(g, data, String(gid));
      }

      for (const g of games) {
        const gid = (g as any)?.id ?? (g as any)?.gameId;
        if (gid === null || gid === undefined || gid === '') continue;
        const idStr = String(gid);

        const marketMap = (g as any)?.market;
        let market = pickPreferredMarketFromEmbedded(marketMap, typePriority);
        if (!market && marketMap && typeof marketMap === 'object') {
          const markets = Object.values(marketMap as Record<string, unknown>)
            .map((mRaw) => (mRaw && typeof mRaw === 'object' && !Array.isArray(mRaw) ? (mRaw as any) : null))
            .filter(Boolean) as any[];

          markets.sort((a, b) => {
            const ao = typeof a?.order === 'number' ? Number(a.order) : Number.MAX_SAFE_INTEGER;
            const bo = typeof b?.order === 'number' ? Number(b.order) : Number.MAX_SAFE_INTEGER;
            if (ao !== bo) return ao - bo;
            return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
          });

          const candidate = markets.find((m) => {
            const ev = m?.event;
            const cnt = ev && typeof ev === 'object' && !Array.isArray(ev) ? Object.keys(ev).length : 0;
            return cnt === 2 || cnt === 3;
          });
          if (candidate) market = candidate;
        }

        const oddsArr = buildOddsArrFromMarket(market);
        const marketsCount = typeof (g as any)?.markets_count === 'number'
          ? Number((g as any).markets_count)
          : (marketMap && typeof marketMap === 'object' ? Object.keys(marketMap).length : 0);
        const fp = getOddsFp(market);

        const prev = group.oddsCache.get(idStr);
        const prevCount = typeof prev?.markets_count === 'number' ? Number(prev.markets_count) : null;
        const shouldEmit = !prev || prev.fp !== fp || (typeof prevCount === 'number' && prevCount !== marketsCount);
        if (shouldEmit) {
          group.oddsCache.set(idStr, { odds: oddsArr, markets_count: marketsCount, fp, updatedAtMs: now });
          updates.push({ gameId: gid, odds: Array.isArray(oddsArr) ? oddsArr : null, markets_count: marketsCount });
        } else {
          group.oddsCache.set(idStr, { ...prev, updatedAtMs: now, markets_count: marketsCount });
        }
      }

      if (updates.length) {
        const payload = { sportId: group.sportId, updates };
        await this.broadcast(group.clients, encodeSseEvent('odds', payload));
      }

      this.maybeRebuildOddsSnapshot(group);
      
      // Clean expired cache entries to prevent memory exhaustion
      this.cleanOddsCache(group.oddsCache);
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
        lastGamesUpdateAtMs: 0,
        lastFp: '',
        lastOddsFp: '',
        lastGamesPayload: null,
        lastOddsPayload: null,
        lastOddsSnapshotAtMs: 0,
        oddsInFlight: false,
        oddsCursor: 0,
        oddsGameIds: [],
        oddsCache: new Map(),
        gamesSubid: null,
        gamesSubscribing: false,
        featuredOddsSubid: null,
        featuredOddsSubscribing: false,
        oddsSubid: null,
        oddsSubscribing: false,
        oddsTypePriority: null
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
    if (typeof (group as any).gamesSubid !== 'string') {
      (group as any).gamesSubid = null;
    }
    if (typeof (group as any).gamesSubscribing !== 'boolean') {
      (group as any).gamesSubscribing = false;
    }
    if (typeof (group as any).featuredOddsSubid !== 'string') {
      (group as any).featuredOddsSubid = null;
    }
    if (typeof (group as any).featuredOddsSubscribing !== 'boolean') {
      (group as any).featuredOddsSubscribing = false;
    }
    if (typeof (group as any).oddsSubid !== 'string') {
      (group as any).oddsSubid = null;
    }
    if (typeof (group as any).oddsSubscribing !== 'boolean') {
      (group as any).oddsSubscribing = false;
    }
    if (!Array.isArray((group as any).oddsTypePriority)) {
      (group as any).oddsTypePriority = null;
    }
    if (typeof (group as any).pollInFlight !== 'boolean') {
      (group as any).pollInFlight = false;
    }
    if (typeof (group as any).lastGamesUpdateAtMs !== 'number') {
      (group as any).lastGamesUpdateAtMs = 0;
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
              const gamesSid = (group as any).gamesSubid;
              (group as any).gamesSubid = null;
              (group as any).gamesSubscribing = false;
              const featuredSid = (group as any).featuredOddsSubid;
              (group as any).featuredOddsSubid = null;
              (group as any).featuredOddsSubscribing = false;
              const oddsSid = (group as any).oddsSubid;
              (group as any).oddsSubid = null;
              (group as any).oddsSubscribing = false;
              (group as any).oddsTypePriority = null;
              groups.delete(key);
              if (gamesSid) void this.unsubscribe(String(gamesSid));
              if (featuredSid) void this.unsubscribe(String(featuredSid));
              if (oddsSid) void this.unsubscribe(String(oddsSid));
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

      this.startCountsWatchdog();
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
    if (group.subid) return;
    if (group.subscribing) return;
    group.subscribing = true;
    setTimeout(() => {
      void (async () => {
        try {
          await this.ensureLiveGameSubscription(group);
        } catch (e) {
          await this.broadcast(group.clients, encodeSseEvent('error', { error: e instanceof Error ? e.message : String(e) }));
        } finally {
          group.subscribing = false;
        }
      })();
    }, 0);
  }

  private stopGameGroup(group: GameStreamGroup): void {
    if (group.timer == null) return;
    clearInterval(group.timer);
    group.timer = null;
  }

  private async ensureLiveGameSubscription(group: GameStreamGroup): Promise<void> {
    if (group.subid) return;
    await this.ensureConnection();

    const gidNum = Number(group.gameId);
    const whereId = Number.isFinite(gidNum) ? gidNum : String(group.gameId);

    const subid = await this.subscribeGet(
      {
        source: 'betting',
        what: {
          game: [
            'id',
            'stats',
            'info',
            'is_neutral_venue',
            'add_info_name',
            'text_info',
            'markets_count',
            'type',
            'start_ts',
            'is_stat_available',
            'team1_id',
            'team1_name',
            'team2_id',
            'team2_name',
            'last_event',
            'live_events',
            'match_length',
            'sport_alias',
            'sportcast_id',
            'region_alias',
            'is_blocked',
            'show_type',
            'game_number'
          ],
          market: [
            'id',
            'game_id',
            'group_id',
            'group_name',
            'group_order',
            'type',
            'name_template',
            'sequence',
            'point_sequence',
            'name',
            'order',
            'display_key',
            'display_sub_key',
            'col_count',
            'express_id',
            'extra_info',
            'cashout',
            'is_new',
            'has_early_payout',
            'prematch_express_id',
            'main_order',
            'base'
          ],
          event: [
            'id',
            'market_id',
            'type_1',
            'type',
            'price',
            'name',
            'base',
            'home_value',
            'away_value',
            'display_column',
            'order',
            'is_blocked'
          ]
        },
        where: { game: { id: whereId } }
      },
      (data) => {
        void this.handleLiveGameEmit(group, data);
      }
    );

    group.subid = subid;

    if (!group.lastPayload) {
      setTimeout(() => {
        void this.pollGameGroup(group);
      }, 0);
    }
  }

  private async handleLiveGameEmit(group: GameStreamGroup, rawData: unknown): Promise<void> {
    const data = unwrapSwarmData(rawData) as any;

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
    if (!game) {
      const parsed = parseGamesFromData(data as any, 'Unknown', null);
      if (Array.isArray(parsed) && parsed.length) {
        game = parsed.find((g) => g && String((g as any)?.id ?? (g as any)?.gameId) === String(group.gameId)) || null;
      }
    }
    if (!game) return;

    this.embedMarketsIntoGame(game, data, group.gameId);

    const fp = getGameFp(game) || (game ? getSportFp([game]) : '');
    if (fp === group.lastFp && group.lastPayload) return;
    group.lastFp = fp;

    const payload = { gameId: group.gameId, data: game, last_updated: new Date().toISOString() };
    group.lastPayload = payload;
    if (group.clients.size) {
      await this.broadcast(group.clients, encodeSseEvent('game', payload));
    }
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
            market: ['id', 'game_id', 'type', 'order', 'is_blocked', 'display_key', 'display_sub_key', 'main_order', 'base', 'name', 'name_template', 'express_id'],
            event: ['id', 'market_id', 'type', 'type_1', 'name', 'order', 'price', 'base', 'is_blocked']
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

      if (!game) {
        const parsed = parseGamesFromData(data as any, 'Unknown', null);
        if (Array.isArray(parsed) && parsed.length) {
          game = parsed.find((g) => g && String((g as any)?.id ?? (g as any)?.gameId) === String(group.gameId)) || null;
        }
      }

      if (!game) return;

      this.embedMarketsIntoGame(game, data, group.gameId);

      const fp = getGameFp(game) || (game ? getSportFp([game]) : '');
      if (fp === group.lastFp && group.lastPayload) return;
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
      group = {
        gameId: key,
        clients: new Map(),
        timer: null,
        pollInFlight: false,
        subid: null,
        subscribing: false,
        lastFp: '',
        lastPayload: null,
        cleanupTimer: null
      };
      this.liveGameGroups.set(key, group);
    }

    if (typeof (group as any).pollInFlight !== 'boolean') {
      (group as any).pollInFlight = false;
    }
    if (typeof (group as any).subid !== 'string' && (group as any).subid !== null) {
      (group as any).subid = null;
    }
    if (typeof (group as any).subscribing !== 'boolean') {
      (group as any).subscribing = false;
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
              const sid = (group as any).subid;
              (group as any).subid = null;
              (group as any).subscribing = false;
              group.lastPayload = null;
              group.lastFp = '';
              this.liveGameGroups.delete(key);
              if (sid) void this.unsubscribe(String(sid));
            }
          }, GROUP_GRACE_MS) as unknown as number;
        }
      }
    });

    const initialGamePayload = group.lastPayload;
    try {
      const parts: string[] = [];
      parts.push(`: ${' '.repeat(2048)}\n\n`);
      parts.push(`: ready ${Date.now()}\n\n`);
      if (initialGamePayload) {
        parts.push(`event: game\ndata: ${JSON.stringify(initialGamePayload)}\n\n`);
      }
      writer.write(encoder.encode(parts.join(''))).catch(() => null);
    } catch {
      // ignore
    }

    this.startGameGroup(group);

    if (!group.lastPayload) {
      setTimeout(() => {
        void this.pollGameGroup(group);
      }, 0);
    }

    return new Response(readable, { status: 200, headers: sseHeaders() });
  }

  private async getHierarchy(forceRefresh: boolean): Promise<unknown> {
    const cacheKey = 'hierarchy_cache';
    const ttlMs = 30 * 60 * 1000;
    const cached = await this.state.storage.get<HierarchyCache>(cacheKey);

    if (!forceRefresh && cached && typeof cached.cachedAtMs === 'number' && cached.data) {
      const h = (cached.data as any)?.data || cached.data;
      const sportsNode = h?.sport;
      const sportCount = sportsNode && typeof sportsNode === 'object'
        ? (Array.isArray(sportsNode) ? sportsNode.length : Object.keys(sportsNode).length)
        : 0;
      const cacheValid = Boolean(sportCount);

      const age = Date.now() - cached.cachedAtMs;
      if (age <= ttlMs) {
        if (cacheValid && !forceRefresh) {
          return { ...(cached.data as Record<string, unknown>), cached: true };
        }
      }

      if (cacheValid && !forceRefresh) {
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
    }

    const data = await this.refreshHierarchyCache(cacheKey);
    return { ...(data as Record<string, unknown>), cached: false };
  }

  private async refreshHierarchyCache(cacheKey: string): Promise<unknown> {
    await this.ensureConnection();
    const baseParams = {
      source: 'betting',
      what: {
        sport: ['id', 'name', 'alias', 'order'],
        region: ['id', 'name', 'alias', 'order'],
        competition: ['id', 'name', 'alias', 'order']
      }
    };

    let response = await this.sendRequest(
      'get',
      {
        ...baseParams,
        where: { sport: { type: { '@nin': [1, 4] } } }
      },
      60000
    );

    let data = unwrapSwarmData(response);

    let h = (data as any)?.data || data;
    let sportsNode = h?.sport;
    let sportCount = sportsNode && typeof sportsNode === 'object'
      ? (Array.isArray(sportsNode) ? sportsNode.length : Object.keys(sportsNode).length)
      : 0;

    if (!sportCount) {
      response = await this.sendRequest('get', baseParams, 60000);
      data = unwrapSwarmData(response);
      h = (data as any)?.data || data;
      sportsNode = h?.sport;
      sportCount = sportsNode && typeof sportsNode === 'object'
        ? (Array.isArray(sportsNode) ? sportsNode.length : Object.keys(sportsNode).length)
        : 0;
    }

    if (!sportCount) {
      const previous = await this.state.storage.get<HierarchyCache>(cacheKey);
      if (previous && previous.data) {
        const ph = (previous.data as any)?.data || previous.data;
        const ps = ph?.sport;
        const pc = ps && typeof ps === 'object' ? (Array.isArray(ps) ? ps.length : Object.keys(ps).length) : 0;
        if (pc) return previous.data;
      }
      throw new Error('Hierarchy refresh returned 0 sports');
    }

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

    if (request.method === 'GET' && url.pathname === '/api/competition-odds-stream') {
      return this.handleCompetitionOddsStream(request);
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
