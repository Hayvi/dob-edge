# dob-edge Codebase Architecture Analysis

## Executive Summary

**dob-edge** is a real-time sports betting data aggregation platform built on Cloudflare's edge computing infrastructure. It provides live and prematch sports data through a modern web interface with real-time streaming capabilities.

### Technology Stack
- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3
- **Backend**: Cloudflare Workers + Durable Objects (TypeScript)
- **Hosting**: Cloudflare Pages (UI) + Cloudflare Workers (API)
- **Real-time**: Server-Sent Events (SSE) for streaming data
- **External APIs**: Swarm API (betting data), Animation ML (live tracking)

---

## Architecture Overview

### Deployment Model
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Cloudflare     │    │  Cloudflare      │    │  External APIs  │
│  Pages          │    │  Workers         │    │                 │
│  (Static UI)    │◄──►│  (API Backend)   │◄──►│  Swarm API      │
│  /ui/           │    │  /workers/       │    │  Animation ML   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Data Flow Architecture
```
External APIs → Durable Objects → SSE Streams → Frontend UI
     ↓               ↓              ↓            ↓
Swarm API    → SwarmHubDO     → /api/live-stream → Live Games
Animation ML → LiveTrackerDO  → /api/live-game   → Game Details
             → HealthMetricsDO → /api/health      → System Status
```

---

## Frontend Structure (`/ui/`)

### Core Architecture
- **Entry Point**: `index.html` - Main application layout
- **Module Loading**: 30+ JavaScript modules loaded in dependency order
- **State Management**: Global state in `js/state.js`
- **Real-time**: Multiple SSE streams for live data updates

### Key Modules

#### 1. State Management (`js/state.js`)
```javascript
// Global application state
let hierarchy = null;              // Sport/region/competition taxonomy
let currentSport = null;           // Selected sport
let currentCompetition = null;     // Selected competition
let currentGames = [];             // Games in current view
let selectedGame = null;           // Game in details panel
let currentMode = 'prematch';      // 'prematch', 'live', 'results'

// Real-time counts
let sportsWithLiveGames = null;    // Set of sports with live games
let sportsCountsLive = null;       // Map of sport → live game count
let sportsCountsPrematch = null;   // Map of sport → prematch game count
```

#### 2. Real-time Streaming (`js/api/`)

**Counts Stream** (`countsStream.js`)
- **Purpose**: Always-active stream of game counts per sport
- **Endpoint**: `/api/counts-stream`
- **Events**: `live_counts`, `prematch_counts`
- **Updates**: Sport lists with game counts

**Live Stream** (`liveStream.js`)
- **Purpose**: Real-time games and odds for selected sport
- **Endpoint**: `/api/live-stream?sportId=...`
- **Events**: `games`, `odds`, `counts`
- **Fallback**: Polling every 6 seconds if SSE fails

**Live Game Stream** (`liveGameStream.js`)
- **Purpose**: Real-time updates for selected game
- **Endpoint**: `/api/live-game-stream?gameId=...`
- **Events**: `game`, `error`
- **Updates**: Game details, scores, markets

#### 3. Rendering Pipeline

**Game Rendering** (`renderGames.js`)
```javascript
// Hierarchical game display
Sport → Region → Competition → Games
  ↓       ↓         ↓          ↓
Icons   Flags   Collapsible  Odds+Status
```

**Sports List** (`renderSports.js`)
- Filters sports by active games in current mode
- Shows game counts and sport icons
- Handles mode switching (prematch/live/results)

#### 4. Market Processing (`markets.js`)
```javascript
// Main market selection priority
1. Display key: 'winner', '1x2', 'w1xw2'
2. Market type: 'matchresult', '1x2'
3. Market name: 'match winner', 'winner'
4. Draw detection: 3-outcome markets
5. Fallback: 2-outcome markets
```

### UI Components
- **Header**: Logo, refresh, bulk scrape, health buttons
- **Sidebar**: Sports list with search and mode tabs
- **Content**: Games grouped by region/competition
- **Details Panel**: Selected game markets, stats, live tracker
- **Modals**: Health status, loading overlays, toast notifications

---

## Backend Structure (`/workers/`)

### Entry Point (`src/index.ts`)
```typescript
// Main request router
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Route /api/* to appropriate handlers
    // Apply CORS headers
    // Delegate to Durable Objects
  }
}
```

### API Endpoints

| Endpoint | Handler | Purpose | Method |
|----------|---------|---------|---------|
| `/api/counts-stream` | SwarmHubDO | SSE stream of game counts | GET |
| `/api/live-stream?sportId=...` | SwarmHubDO | SSE stream of live games/odds | GET |
| `/api/prematch-stream?sportId=...` | SwarmHubDO | SSE stream of prematch games/odds | GET |
| `/api/live-game-stream?gameId=...` | LiveTrackerDO | SSE stream of game details | GET |
| `/api/competition-odds-stream` | SwarmHubDO | SSE stream of competition odds | GET |
| `/api/live-tracker?gameId=...` | LiveTrackerDO | Live game tracking | GET |
| `/api/health` | HealthMetricsDO | System health metrics | GET |
| `/api/hierarchy` | SwarmHubDO | Sport/region/competition taxonomy | GET |
| `/api/results/*` | SwarmHubDO | Historical results | GET |

### Durable Objects

#### 1. SwarmHubDO (`src/durable/SwarmHubDO.ts`)
**Purpose**: Central hub managing WebSocket connections to Swarm API

**Key Responsibilities**:
- Maintains persistent WebSocket connection to Swarm API
- Manages subscriptions to Swarm data feeds
- Broadcasts data to multiple SSE clients
- Handles odds caching and chunking
- Manages client lifecycle and cleanup

**Internal State**:
```typescript
type SwarmHubDO = {
  ws: WebSocket;                    // Connection to Swarm API
  sessionId: string;                // Swarm session ID
  subscriptions: Map<string, SubscriptionEntry>;
  countsClients: Map<string, Client>;
  liveGroups: Map<string, SportStreamGroup>;
  prematchGroups: Map<string, SportStreamGroup>;
  liveGameGroups: Map<string, GameStreamGroup>;
  competitionOddsGroups: Map<string, CompetitionOddsGroup>;
}
```

**Data Flow**:
1. Client connects to `/api/live-stream?sportId=123`
2. SwarmHubDO creates/reuses sport stream group
3. Subscribes to Swarm API for sport's games
4. Swarm sends updates via WebSocket
5. SwarmHubDO broadcasts to all clients via SSE

**Optimizations**:
- **Fingerprinting**: Detects unchanged data using content hashes
- **Odds Chunking**: Sends odds in 30-game batches
- **Subscription Reuse**: Multiple clients share single Swarm subscription
- **Grace Period**: Keeps subscriptions 30 seconds after last client

#### 2. LiveTrackerDO (`src/durable/LiveTrackerDO.ts`)
**Purpose**: Manages real-time game tracking from Animation ML

**Key Responsibilities**:
- Maintains WebSocket connection to Animation ML
- Broadcasts live game events to SSE clients
- Reports metrics to HealthMetricsDO
- Handles per-game tracking sessions

**Internal State**:
```typescript
type LiveTrackerDO = {
  clients: Map<string, Client>;
  upstream: WebSocket;              // Connection to Animation ML
  upstreamConnected: boolean;
  pendingMessagesDelta: number;
  pendingParseErrorsDelta: number;
  lastMessageAtIso: string;
}
```

#### 3. HealthMetricsDO (`src/durable/HealthMetricsDO.ts`)
**Purpose**: Aggregates system health metrics

**Key Responsibilities**:
- Tracks WebSocket message counts and parse errors
- Maintains leases for active games (with TTL)
- Builds rollup statistics for health endpoint
- Persists metrics to Durable Object storage

**Metrics Tracked**:
```typescript
type HealthMetrics = {
  active_games: number;
  active_sse_clients: number;
  upstream_ws_connected_games: number;
  ws_messages_total: number;
  ws_messages_last_60s: number;
  ws_parse_errors_total: number;
  last_message_at: string;
}
```

### Library Modules

#### Data Processing (`src/lib/`)

**parseGamesFromData.ts**
- Transforms Swarm API responses into normalized game objects
- Handles nested data structures and references
- Adds metadata (sport, region, competition)

**odds.ts**
- Extracts and prioritizes market odds
- Implements sport-specific market selection logic
- Builds 1X2 odds arrays from market data

**fingerprints.ts**
- Generates content hashes to detect changes
- Prevents duplicate SSE events
- Functions: `getGameFp()`, `getSportFp()`, `getCountsFp()`

---

## Data Flow Patterns

### Pattern 1: User Selects Sport (Live Mode)
```
User clicks sport
  ↓
setMode('live') → startLiveStream(sportId)
  ↓
Frontend: new EventSource('/api/live-stream?sportId=123')
  ↓
Worker: Routes to SwarmHubDO.fetch()
  ↓
SwarmHubDO: Creates/reuses liveGroups[sportId]
  ↓
SwarmHubDO: Subscribes to Swarm API for sport games
  ↓
Swarm API: Sends game updates via WebSocket
  ↓
SwarmHubDO: Receives updates, fingerprints, broadcasts to all clients
  ↓
Frontend: Receives 'games' event, updates currentGames
  ↓
renderGames() → Groups by region/competition → Renders tree
```

### Pattern 2: Real-time Odds Updates
```
SwarmHubDO receives odds from Swarm
  ↓
Chunks odds into 30-game batches
  ↓
Generates fingerprint to detect changes
  ↓
Broadcasts 'odds' event to all sport clients
  ↓
Frontend receives odds, updates game.__mainOdds
  ↓
updateGameRowOdds() highlights changed odds
```

### Pattern 3: Game Details Selection
```
User clicks game
  ↓
selectedGame = game
  ↓
startLiveGameStream(gameId)
  ↓
Frontend: new EventSource('/api/live-game-stream?gameId=456')
  ↓
Worker: Routes to LiveTrackerDO.fetch()
  ↓
LiveTrackerDO: Creates upstream connection to Animation ML
  ↓
Animation ML: Sends game events (scores, stats, markets)
  ↓
LiveTrackerDO: Broadcasts to all clients via SSE
  ↓
Frontend: Updates selectedGame, renders details panel
```

---

## External Service Integrations

### 1. Swarm API
- **Type**: WebSocket-based betting data API
- **Connection**: SwarmHubDO maintains persistent connection
- **Authentication**: Partner ID (default: 1777)
- **Data**: Sports hierarchy, games, markets, odds, counts
- **Subscriptions**: Live/prematch games, odds, counts, results

### 2. Animation ML (Live Tracker)
- **Type**: WebSocket-based live game tracking
- **Connection**: LiveTrackerDO creates per-game connection
- **Authentication**: Partner ID, Site Ref
- **Data**: Real-time game events, scores, statistics
- **Format**: JSON events with game state updates

### 3. Cloudflare Infrastructure
- **Pages**: Hosts static UI from `/ui/` directory
- **Workers**: Runs API backend from `/workers/` directory
- **Durable Objects**: Stateful backend components
- **Storage**: Persists metrics and cache data

---

## Configuration & Environment

### Frontend Configuration
```javascript
// API base URL detection
const apiUrl = window.DOB_API_BASE || 
  (window.location.origin.includes('pages.dev') ? 
   window.location.origin : 
   'http://localhost:8787');
```

### Backend Environment Variables
```typescript
interface Env {
  // Durable Object bindings
  SWARM_HUB: DurableObjectNamespace;
  LIVE_TRACKER: DurableObjectNamespace;
  HEALTH_METRICS: DurableObjectNamespace;
  
  // Swarm API configuration
  SWARM_WS_URL?: string;           // Default: wss://eu-swarm-newm.vmemkhhgjigrjefb.com
  SWARM_PARTNER_ID?: string;       // Default: 1777
  
  // Live tracker configuration
  LIVE_TRACKER_WS_URL?: string;    // Default: wss://animation.ml.bcua.io/animation_json_v2
  LIVE_TRACKER_PARTNER_ID?: string;
  LIVE_TRACKER_SITE_REF?: string;
}
```

### Deployment Configuration (`wrangler.toml`)
```toml
name = "dob-edge"
main = "src/index.ts"
compatibility_date = "2026-01-01"

[durable_objects]
bindings = [
  { name = "SWARM_HUB", class_name = "SwarmHubDO" },
  { name = "LIVE_TRACKER", class_name = "LiveTrackerDO" },
  { name = "HEALTH_METRICS", class_name = "HealthMetricsDO" }
]
```

---

## Performance Optimizations

### Frontend Optimizations
- **Virtualization**: Large game lists with viewport-based rendering
- **Odds Caching**: Maintains cache of odds per sport/mode
- **Polling Fallback**: Falls back to polling if SSE fails
- **Debouncing**: Search input debounced to reduce renders
- **Mobile Optimization**: Responsive layout with touch-friendly UI

### Backend Optimizations
- **Fingerprinting**: Detects unchanged data, prevents duplicate broadcasts
- **Subscription Reuse**: Multiple clients share single Swarm subscription
- **Odds Chunking**: Sends odds in 30-game batches to avoid payload limits
- **Client Cleanup**: Removes disconnected clients, unsubscribes when empty
- **Grace Period**: Keeps subscriptions alive 30 seconds after last client
- **Connection Pooling**: Reuses WebSocket connections across requests

### Network Optimizations
- **SSE Streaming**: Real-time updates without polling overhead
- **CORS Optimization**: Allows same-origin requests
- **Compression**: Cloudflare automatic compression
- **Caching**: Strategic no-store headers for dynamic data

---

## Error Handling & Resilience

### Frontend Resilience
- **Stream Disconnection**: Automatic retry with exponential backoff
- **Parse Errors**: Safe JSON parsing with fallback values
- **Toast Notifications**: User-friendly error messages
- **Fallback Polling**: Switches to polling if SSE fails
- **Connection Status**: Visual indicators for stream health

### Backend Resilience
- **WebSocket Reconnection**: Automatic reconnection on disconnect
- **Subscription Recovery**: Resubscribes after connection loss
- **Client Cleanup**: Removes dead clients on write failure
- **Timeout Handling**: 15-60 second timeouts on requests
- **Circuit Breaker**: Prevents cascade failures

### Monitoring & Health
- **Health Endpoint**: `/api/health` provides system metrics
- **Metrics Collection**: Tracks messages, errors, connections
- **Lease Management**: TTL-based cleanup of stale resources
- **Performance Tracking**: Response times, cache hit rates

---

## Reusable Components

### Frontend Components
1. **State Management**: Global state with mode switching
2. **SSE Streaming**: Reusable EventSource wrappers with retry logic
3. **DOM Utilities**: Element selection, manipulation, event binding
4. **Market Processing**: Odds extraction and prioritization
5. **Rendering Pipeline**: Hierarchical data display
6. **Mobile Support**: Responsive layout and touch handling

### Backend Components
1. **Durable Objects**: Stateful WebSocket management
2. **SSE Broadcasting**: Multi-client streaming infrastructure
3. **Data Processing**: Parsing, normalization, fingerprinting
4. **Health Monitoring**: Metrics collection and reporting
5. **Connection Management**: WebSocket lifecycle handling

---

## Potential Issues & Recommendations

### Current Issues
1. **No TypeScript in Frontend**: JavaScript codebase lacks type safety
2. **Global State**: No formal state management library
3. **Manual Module Loading**: 30+ script tags in specific order
4. **Limited Error Boundaries**: Basic error handling
5. **No Automated Testing**: No test suite visible

### Maintainability Recommendations

#### Short-term (Low Risk)
1. **Add TypeScript**: Migrate frontend to TypeScript for type safety
2. **Bundle Frontend**: Use build tool (Vite, Webpack) to bundle modules
3. **Add Linting**: ESLint/Prettier for code consistency
4. **Error Boundaries**: Implement comprehensive error handling
5. **Add Tests**: Unit tests for critical functions

#### Medium-term (Moderate Risk)
1. **State Management**: Implement Redux/Zustand for predictable state
2. **Component Framework**: Consider React/Vue for better structure
3. **API Client**: Centralized API client with retry/caching logic
4. **Performance Monitoring**: Add client-side performance tracking
5. **Documentation**: API documentation and developer guides

#### Long-term (High Impact)
1. **Microservices**: Split monolithic SwarmHubDO into focused services
2. **Database Layer**: Add persistent storage for historical data
3. **Caching Strategy**: Implement Redis/KV for distributed caching
4. **Load Testing**: Performance testing under high load
5. **Security Audit**: Comprehensive security review

### Architecture Strengths
1. **Serverless**: Scales automatically with Cloudflare Workers
2. **Real-time**: Efficient SSE streaming for live updates
3. **Edge Computing**: Low latency with global distribution
4. **Stateful Backend**: Durable Objects provide persistent connections
5. **Cost Effective**: Pay-per-use pricing model

---

## Summary

**dob-edge** is a well-architected real-time sports data platform that effectively leverages Cloudflare's edge computing capabilities. The separation of concerns between frontend UI and backend API, combined with real-time streaming and stateful Durable Objects, creates a scalable and responsive system.

The codebase demonstrates solid engineering practices with clear module boundaries, efficient data processing, and robust error handling. While there are opportunities for improvement in type safety and testing, the core architecture provides a strong foundation for continued development and scaling.