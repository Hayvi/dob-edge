import { HealthMetricsDO } from './durable/HealthMetricsDO.js';
import { LiveTrackerDO } from './durable/LiveTrackerDO.js';
import { SwarmHubDO } from './durable/SwarmHubDO.js';
import type { Env } from './env.js';

type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

function json(data: JsonValue, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function isAllowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  const o = String(origin);
  if (o.includes('dob-edge') && o.endsWith('.pages.dev')) return o;
  return null;
}

function withCors(request: Request, response: Response): Response {
  const origin = request.headers.get('Origin');
  const allowed = isAllowedOrigin(origin);

  const headers = new Headers(response.headers);
  if (allowed) {
    headers.set('Access-Control-Allow-Origin', allowed);
    headers.append('Vary', 'Origin');
  }
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Max-Age', '86400');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function badRequest(message: string): Response {
  return json({ error: message }, { status: 400 });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return withCors(request, new Response(null, { status: 204 }));
    }

    if (!url.pathname.startsWith('/api/')) {
      return withCors(request, new Response('Not found', { status: 404 }));
    }

    if (url.pathname === '/api/live-tracker') {
      const gameId = url.searchParams.get('gameId');
      if (!gameId) return withCors(request, badRequest('gameId is required'));

      const id = env.LIVE_TRACKER.idFromName(String(gameId));
      const stub = env.LIVE_TRACKER.get(id);
      const resp = await stub.fetch(request);
      return withCors(request, resp);
    }

    if (url.pathname === '/api/health') {
      const id = env.HEALTH_METRICS.idFromName('global');
      const stub = env.HEALTH_METRICS.get(id);
      const rollupsResp = await stub.fetch('https://internal/live-tracker-rollups');
      const liveTracker = rollupsResp.ok ? ((await rollupsResp.json()) as JsonValue) : null;

      const swarmId = env.SWARM_HUB.idFromName('global');
      const swarmStub = env.SWARM_HUB.get(swarmId);
      const swarmResp = await swarmStub.fetch('https://internal/internal/metrics');
      const swarmWs = swarmResp.ok ? ((await swarmResp.json()) as JsonValue) : null;

      return withCors(
        request,
        json({
        status: 'ok',
        live_tracker: liveTracker,
        swarm_ws: swarmWs
        })
      );
    }

    if (url.pathname === '/api/game-stats') {
      return withCors(request, json({ error: 'No stats available' }));
    }

    if (url.pathname === '/api/fetch-all-sports') {
      return withCors(request, json({ count: 0, errors: ['Not supported'] }));
    }

    if (
      url.pathname === '/api/counts-stream' ||
      url.pathname === '/api/live-stream' ||
      url.pathname === '/api/prematch-stream' ||
      url.pathname === '/api/live-game-stream'
    ) {
      const swarmId = env.SWARM_HUB.idFromName('global');
      const swarmStub = env.SWARM_HUB.get(swarmId);
      const resp = await swarmStub.fetch(request);
      return withCors(request, resp);
    }

    if (url.pathname.startsWith('/api/results/')) {
      const swarmId = env.SWARM_HUB.idFromName('global');
      const swarmStub = env.SWARM_HUB.get(swarmId);
      const resp = await swarmStub.fetch(request);
      return withCors(request, resp);
    }

    if (url.pathname === '/api/hierarchy') {
      const swarmId = env.SWARM_HUB.idFromName('global');
      const swarmStub = env.SWARM_HUB.get(swarmId);
      const resp = await swarmStub.fetch(request);
      return withCors(request, resp);
    }

    return withCors(request, new Response('Not found', { status: 404 }));
  }
} satisfies ExportedHandler<Env>;

export { HealthMetricsDO, LiveTrackerDO, SwarmHubDO };
