# dob-edge

Monorepo:

- `ui/`: static frontend (Cloudflare Pages)
- `workers/`: API + SSE endpoints (Cloudflare Workers + Durable Objects)

## API (Workers)

The Worker serves only `/api/*`.

SSE endpoints (EventSource):

- `/api/counts-stream`
- `/api/live-stream?sportId=...`
- `/api/prematch-stream?sportId=...`
- `/api/live-game-stream?gameId=...`

Other endpoints:

- `/api/hierarchy`
- `/api/health`
- `/api/live-tracker?gameId=...`
- `/api/results/*`

## Deploy via Cloudflare dashboard (GitHub)

### 1) Deploy the Worker (`workers/`)

In Cloudflare Dashboard:

- **Workers & Pages** -> **Workers** -> **Create** -> **Import a repository**
- Select this repo
- Set **Root directory** to `workers`

Durable Objects bindings are defined in `workers/wrangler.toml`:

- `SWARM_HUB` (class `SwarmHubDO`)
- `LIVE_TRACKER` (class `LiveTrackerDO`)
- `HEALTH_METRICS` (class `HealthMetricsDO`)

On first deploy, the migration `v1` will create these DO classes.

#### Worker environment variables (Dashboard -> Worker -> Settings -> Variables)

All are optional (defaults exist in code), but you typically want to set them explicitly:

- `SWARM_WS_URL`
  - default: `wss://eu-swarm-newm.vmemkhhgjigrjefb.com`
- `SWARM_PARTNER_ID`
  - default: `1777`

Live tracker upstream WS:

- `LIVE_TRACKER_WS_URL`
  - default: `wss://animation.ml.bcua.io/animation_json_v2`
- `LIVE_TRACKER_PARTNER_ID`
  - default: `1777`
- `LIVE_TRACKER_SITE_REF`
  - default: `https://sportsbook.forzza1x2.com/`

### 2) Deploy the UI (`ui/`) on Pages

In Cloudflare Dashboard:

- **Workers & Pages** -> **Pages** -> **Create** -> **Connect to Git**
- Select this repo
- Set **Root directory** to `ui`
- **Build command**: none
- **Build output directory**: `/` (root)

### 3) Route `/api/*` from Pages to the Worker

The UI calls the API via same-origin paths like `/api/counts-stream`.

Recommended setup:

- Attach a **custom domain** to your Pages project (e.g. `app.example.com`).
- In **Workers** -> your Worker -> **Triggers** -> **Routes**, add:
  - `app.example.com/api/*` -> Worker `dob-api`

This keeps the UI and API on the same origin (required for EventSource without extra CORS work).

## Local dev

Worker:

- `npm run dev` (in `workers/`)

UI:

- open `ui/index.html` (or serve `ui/` with any static server)

Note: the UI expects `/api/*` to exist on the same origin, so for local dev you’ll typically use a reverse proxy or run both under the same dev origin.
