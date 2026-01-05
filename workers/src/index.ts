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

function badRequest(message: string): Response {
  return json({ error: message }, { status: 400 });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 });
    }

    if (url.pathname === '/api/live-tracker') {
      const gameId = url.searchParams.get('gameId');
      if (!gameId) return badRequest('gameId is required');

      const id = env.LIVE_TRACKER.idFromName(String(gameId));
      const stub = env.LIVE_TRACKER.get(id);
      return stub.fetch(request);
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

      return json({
        status: 'ok',
        live_tracker: liveTracker,
        swarm_ws: swarmWs
      });
    }

    if (
      url.pathname === '/api/counts-stream' ||
      url.pathname === '/api/live-stream' ||
      url.pathname === '/api/prematch-stream' ||
      url.pathname === '/api/live-game-stream'
    ) {
      return json({ error: 'Not implemented in workers yet' }, { status: 501 });
    }

    if (url.pathname.startsWith('/api/results/')) {
      const swarmId = env.SWARM_HUB.idFromName('global');
      const swarmStub = env.SWARM_HUB.get(swarmId);
      return swarmStub.fetch(request);
    }

    if (url.pathname === '/api/hierarchy') {
      const swarmId = env.SWARM_HUB.idFromName('global');
      const swarmStub = env.SWARM_HUB.get(swarmId);
      return swarmStub.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  }
} satisfies ExportedHandler<Env>;

export { HealthMetricsDO, LiveTrackerDO, SwarmHubDO };
