# Requirements Document

## Introduction

This specification addresses the remaining high-priority performance issues and memory leaks identified in the comprehensive audit. While critical issues have been resolved in Phase 1, several high-priority issues remain that could impact production stability and performance under load.

## Glossary

- **EventSource**: Browser API for server-sent events that can accumulate listeners if not properly cleaned up
- **WebSocket**: Persistent connection protocol that requires proper timeout and cleanup handling
- **Heartbeat**: Periodic ping mechanism to detect dead connections
- **Grace Period**: Time to keep resources alive after clients disconnect
- **HealthMetricsDO**: Durable Object responsible for health monitoring and metrics collection
- **LiveTrackerDO**: Durable Object that tracks live game events and manages upstream connections
- **Circular Buffer**: Fixed-size buffer that overwrites old data, preventing unbounded growth

## Requirements

### Requirement 1: Complete EventSource Listener Cleanup

**User Story:** As a system administrator, I want all EventSource connections to properly clean up their listeners, so that frontend memory leaks are completely eliminated.

#### Acceptance Criteria

1. WHEN liveGameStream.js EventSource is closed, THE System SHALL remove all event listeners before closing
2. WHEN prematchStream.js EventSource is closed, THE System SHALL remove all event listeners before closing  
3. WHEN any EventSource reconnects, THE System SHALL not accumulate duplicate listeners
4. WHEN page navigation occurs, THE System SHALL clean up all active EventSource listeners
5. THE System SHALL track all EventSource listeners in arrays for proper cleanup

### Requirement 2: Fix Remaining Timer Leaks

**User Story:** As a developer, I want all timers and intervals to be properly managed, so that timer leaks don't cause memory accumulation and CPU waste.

#### Acceptance Criteria

1. WHEN liveStream odds polling intervals are created, THE System SHALL ensure cleanup on all code paths
2. WHEN liveStream details refresh intervals are created, THE System SHALL ensure cleanup on all code paths
3. WHEN odds animation timeouts are created, THE System SHALL use AbortController or WeakMap for cleanup
4. WHEN heartbeat timers are created in SwarmHubDO, THE System SHALL ensure cleanup on all error paths
5. WHEN heartbeat timers are created in LiveTrackerDO, THE System SHALL ensure cleanup on all error paths

### Requirement 3: Implement WebSocket Connection Timeouts

**User Story:** As a system operator, I want WebSocket connections to have proper timeouts and cleanup, so that orphaned connections don't exhaust system resources.

#### Acceptance Criteria

1. WHEN SwarmHubDO creates WebSocket connections, THE System SHALL implement 30-second connection timeout
2. WHEN LiveTrackerDO creates upstream WebSocket connections, THE System SHALL implement 30-second connection timeout
3. WHEN WebSocket connections fail to close properly, THE System SHALL ensure cleanup on all error paths
4. WHEN WebSocket connection attempts hang, THE System SHALL timeout and clean up resources
5. THE System SHALL implement exponential backoff for failed WebSocket reconnections

### Requirement 4: Fix HealthMetricsDO Memory Leaks

**User Story:** As a system administrator, I want the health metrics system to have bounded memory usage, so that long-running deployments don't exhaust memory.

#### Acceptance Criteria

1. WHEN HealthMetricsDO buckets array grows, THE System SHALL use circular buffer instead of filter operations
2. WHEN HealthMetricsDO leases accumulate, THE System SHALL implement max 10,000 leases limit
3. WHEN HealthMetricsDO leases exceed limit, THE System SHALL use aggressive pruning with LRU eviction
4. WHEN HealthMetricsDO processes metrics, THE System SHALL avoid creating new arrays on every update
5. THE System SHALL implement fixed-size data structures for health metrics storage

### Requirement 5: Optimize Resource Management

**User Story:** As a performance engineer, I want system resources to be efficiently managed, so that unnecessary resource consumption is minimized.

#### Acceptance Criteria

1. WHEN groups have no active clients, THE System SHALL reduce grace period from 30 seconds to 5 seconds
2. WHEN broadcast operations fail, THE System SHALL implement max 3 retry attempts before giving up
3. WHEN concurrent game streams exceed reasonable limits, THE System SHALL implement max 1000 concurrent games
4. WHEN polling operations occur, THE System SHALL implement exponential backoff on failures
5. THE System SHALL implement rate limiting for polling operations to prevent server overload

### Requirement 6: Implement Heartbeat-Based Client Detection

**User Story:** As a system administrator, I want dead clients to be automatically detected and cleaned up, so that memory leaks from stale connections are prevented.

#### Acceptance Criteria

1. WHEN clients receive heartbeat pings, THE System SHALL expect responses within 30 seconds
2. WHEN clients fail to respond to heartbeats, THE System SHALL remove them from active client lists
3. WHEN heartbeat timeouts occur, THE System SHALL clean up all associated resources
4. THE System SHALL implement heartbeat-based detection for both SwarmHubDO and LiveTrackerDO
5. THE System SHALL track heartbeat response times for monitoring purposes

### Requirement 7: Add DOM Event Listener Management

**User Story:** As a frontend developer, I want DOM event listeners to be properly managed, so that memory leaks from stale event handlers are prevented.

#### Acceptance Criteria

1. WHEN window resize listeners are added, THE System SHALL store references for later removal
2. WHEN scroll listeners are added, THE System SHALL remove old listeners before adding new ones
3. WHEN modal click listeners are added, THE System SHALL remove listeners when modals are destroyed
4. WHEN game row click handlers are added, THE System SHALL remove old handlers before adding new ones
5. THE System SHALL implement a centralized event listener management system

### Requirement 8: Implement Connection Monitoring and Alerting

**User Story:** As a system operator, I want comprehensive monitoring of connection health, so that issues can be detected and resolved proactively.

#### Acceptance Criteria

1. THE System SHALL track memory usage per Durable Object
2. THE System SHALL monitor client count per group with alerting at 8,000 clients
3. THE System SHALL track cache hit/miss rates for performance optimization
4. THE System SHALL monitor WebSocket connection count and failure rates
5. THE System SHALL alert when connection failures exceed 10% threshold

### Requirement 9: Implement Graceful Error Handling

**User Story:** As a system administrator, I want all error conditions to be handled gracefully, so that partial failures don't cascade into system-wide issues.

#### Acceptance Criteria

1. WHEN WebSocket close operations fail, THE System SHALL continue with cleanup operations
2. WHEN EventSource close operations fail, THE System SHALL still remove listeners
3. WHEN timer cleanup fails, THE System SHALL log errors but continue operation
4. WHEN client cleanup fails, THE System SHALL remove clients from tracking maps
5. THE System SHALL implement comprehensive error logging for debugging

### Requirement 10: Optimize Performance-Critical Operations

**User Story:** As a performance engineer, I want performance-critical operations to be optimized, so that system responsiveness is maintained under load.

#### Acceptance Criteria

1. WHEN large JSON payloads are parsed, THE System SHALL use Web Workers for payloads > 100KB
2. WHEN large DOM updates occur, THE System SHALL use requestAnimationFrame for batching
3. WHEN game lookups occur frequently, THE System SHALL use Map with gameId keys instead of linear search
4. WHEN UI updates are needed, THE System SHALL batch operations to prevent jank
5. THE System SHALL implement efficient data structures for hot code paths