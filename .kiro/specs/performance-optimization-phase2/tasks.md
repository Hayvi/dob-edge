# Implementation Plan: Performance Optimization Phase 2

## Overview

This implementation plan addresses the remaining high-priority performance issues and memory leaks through systematic fixes to EventSource listeners, timer management, WebSocket connections, and resource optimization. The approach prioritizes defensive programming and comprehensive cleanup to achieve full production readiness.

## Tasks

- [ ] 1. Fix remaining EventSource listener leaks
- [x] 1.1 Fix liveGameStream.js EventSource listener cleanup
  - Implement listener tracking array similar to countsStream.js and liveStream.js
  - Add proper listener removal before EventSource close
  - _Requirements: 1.1, 1.3, 1.5_

- [x] 1.2 Write property test for EventSource listener cleanup
  - **Property 1: EventSource Listener Cleanup Completeness**
  - **Validates: Requirements 1.1, 1.2, 1.3, 1.5**

- [x] 1.3 Fix prematchStream.js EventSource listener cleanup
  - Implement listener tracking and cleanup mechanism
  - Ensure no duplicate listeners on reconnection
  - _Requirements: 1.2, 1.3, 1.5_

- [x] 1.4 Add centralized EventSource cleanup to page unload
  - Extend existing cleanup function in events.js
  - Add prematchStream and liveGameStream cleanup calls
  - _Requirements: 1.4_

- [x] 2. Fix remaining timer leaks
- [x] 2.1 Fix liveStream interval cleanup on all code paths
  - Ensure odds polling and details refresh intervals are cleared on mode changes
  - Add cleanup to all error paths and state transitions
  - _Requirements: 2.1, 2.2_

- [x] 2.2 Write property test for timer lifecycle management
  - **Property 2: Timer Lifecycle Management**
  - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

- [ ] 2.3 Fix odds animation timeout accumulation in mainMarketHydration.js
  - Replace DOM element timeout storage with WeakMap or AbortController
  - Ensure timeouts are cleaned up when elements are removed
  - _Requirements: 2.3_

- [ ] 2.4 Fix heartbeat timer cleanup in SwarmHubDO and LiveTrackerDO
  - Ensure heartbeat timers are cleared on all error paths
  - Add try-catch blocks around timer cleanup operations
  - _Requirements: 2.4, 2.5_

- [ ] 3. Implement WebSocket connection timeouts
- [ ] 3.1 Add connection timeout to SwarmHubDO WebSocket creation
  - Implement 30-second timeout for WebSocket connection attempts
  - Add proper cleanup on timeout
  - _Requirements: 3.1, 3.4_

- [ ] 3.2 Write property test for WebSocket timeout enforcement
  - **Property 3: WebSocket Connection Timeout Enforcement**
  - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

- [ ] 3.3 Add connection timeout to LiveTrackerDO upstream WebSocket
  - Implement 30-second timeout for upstream connections
  - Ensure cleanup on all error paths
  - _Requirements: 3.2, 3.3_

- [ ] 3.4 Implement exponential backoff for WebSocket reconnections
  - Add backoff logic to both SwarmHubDO and LiveTrackerDO
  - Use jitter to prevent thundering herd
  - _Requirements: 3.5_

- [ ] 4. Fix HealthMetricsDO memory leaks
- [ ] 4.1 Replace buckets array with circular buffer
  - Implement CircularBuffer class for metrics storage
  - Replace filter operations with circular buffer operations
  - _Requirements: 4.1, 4.4, 4.5_

- [ ] 4.2 Write property test for HealthMetrics bounded growth
  - **Property 4: HealthMetrics Bounded Growth**
  - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

- [ ] 4.3 Implement bounded leases map with LRU eviction
  - Add max 10,000 leases limit
  - Implement LRU eviction when limit exceeded
  - Add aggressive pruning mechanism
  - _Requirements: 4.2, 4.3_

- [ ] 5. Optimize resource management
- [ ] 5.1 Reduce grace period from 30 seconds to 5 seconds
  - Update GROUP_GRACE_MS constant in SwarmHubDO
  - Test that groups are cleaned up more quickly
  - _Requirements: 5.1_

- [ ] 5.2 Write property test for resource limit enforcement
  - **Property 5: Resource Limit Enforcement**
  - **Validates: Requirements 5.2, 5.3, 5.4, 5.5**

- [ ] 5.3 Implement max retry limits for broadcast operations
  - Add max 3 retry attempts for failed client writes
  - Clean up dead clients after max retries exceeded
  - _Requirements: 5.2_

- [ ] 5.4 Add max concurrent games limit (1000)
  - Implement limit check in liveGameGroups
  - Return 429 status when limit exceeded
  - _Requirements: 5.3_

- [ ] 5.5 Implement exponential backoff for polling operations
  - Add backoff to odds polling and details refresh
  - Implement rate limiting to prevent server overload
  - _Requirements: 5.4, 5.5_

- [ ] 6. Implement heartbeat-based client detection
- [ ] 6.1 Add heartbeat response tracking to SwarmHubDO
  - Track last heartbeat response time for each client
  - Implement 30-second timeout for client responses
  - _Requirements: 6.1, 6.5_

- [ ] 6.2 Write property test for heartbeat-based client management
  - **Property 6: Heartbeat-Based Client Management**
  - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

- [ ] 6.3 Implement dead client cleanup mechanism
  - Remove clients that don't respond to heartbeats within timeout
  - Clean up all associated resources (subscriptions, timers)
  - _Requirements: 6.2, 6.3_

- [ ] 6.4 Add heartbeat response tracking to LiveTrackerDO
  - Implement same heartbeat mechanism as SwarmHubDO
  - Ensure consistent behavior across both DOs
  - _Requirements: 6.4_

- [ ] 7. Fix DOM event listener management
- [ ] 7.1 Fix window resize listener in treeRender.js
  - Store listener reference for proper removal
  - Remove old listener before adding new one
  - _Requirements: 7.1_

- [ ] 7.2 Write property test for DOM event listener management
  - **Property 7: DOM Event Listener Management**
  - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

- [ ] 7.3 Fix scroll listener accumulation in treeRender.js
  - Remove old scroll listeners before adding new ones
  - Implement listener reference tracking
  - _Requirements: 7.2_

- [ ] 7.4 Fix modal click listener in events.js
  - Remove listener when modal is destroyed
  - Add proper cleanup mechanism
  - _Requirements: 7.3_

- [ ] 7.5 Fix game row click handler accumulation in treeRender.js
  - Remove old click handlers before adding new ones
  - Implement centralized event listener management
  - _Requirements: 7.4, 7.5_

- [ ] 8. Checkpoint - Test all cleanup mechanisms
- Ensure all tests pass, verify no memory leaks remain, ask the user if questions arise.

- [ ] 9. Implement connection monitoring and alerting
- [ ] 9.1 Add memory usage tracking per Durable Object
  - Implement memory usage metrics collection
  - Add periodic reporting mechanism
  - _Requirements: 8.1_

- [ ] 9.2 Write property test for monitoring and alerting
  - **Property 8: Monitoring and Alerting Thresholds**
  - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**

- [ ] 9.3 Add client count monitoring with 8,000 client alerting
  - Track client count per group
  - Implement alerting when threshold exceeded
  - _Requirements: 8.2_

- [ ] 9.4 Add cache hit/miss rate tracking
  - Implement cache performance metrics
  - Add reporting for optimization insights
  - _Requirements: 8.3_

- [ ] 9.5 Add WebSocket connection monitoring
  - Track connection count and failure rates
  - Alert when connection failures exceed 10% threshold
  - _Requirements: 8.4, 8.5_

- [ ] 10. Implement graceful error handling
- [ ] 10.1 Add comprehensive error handling for WebSocket operations
  - Ensure cleanup continues even if close operations fail
  - Add proper error logging for debugging
  - _Requirements: 9.1, 9.5_

- [ ] 10.2 Write property test for graceful error handling
  - **Property 9: Error Handling Graceful Degradation**
  - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**

- [ ] 10.3 Add error handling for EventSource operations
  - Continue with listener removal even if close fails
  - Log errors but don't stop cleanup process
  - _Requirements: 9.2, 9.5_

- [ ] 10.4 Add error handling for timer cleanup
  - Log timer cleanup failures but continue operation
  - Implement fallback cleanup mechanisms
  - _Requirements: 9.3, 9.5_

- [ ] 10.5 Add error handling for client cleanup
  - Remove clients from tracking maps even if cleanup fails
  - Ensure partial failures don't prevent other cleanups
  - _Requirements: 9.4, 9.5_

- [ ] 11. Implement performance optimizations
- [ ] 11.1 Add Web Workers for large JSON parsing
  - Implement Web Worker for payloads > 100KB
  - Add fallback to synchronous parsing for smaller payloads
  - _Requirements: 10.1_

- [ ] 11.2 Write property test for performance optimizations
  - **Property 10: Performance Optimization Implementation**
  - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5**

- [ ] 11.3 Implement requestAnimationFrame for DOM updates
  - Batch large DOM updates using requestAnimationFrame
  - Prevent UI jank during heavy rendering
  - _Requirements: 10.2, 10.4_

- [ ] 11.4 Replace linear search with Map-based lookups
  - Convert game lookups to use Map with gameId keys
  - Optimize hot code paths for better performance
  - _Requirements: 10.3, 10.5_

- [ ] 12. Final checkpoint and testing
- [ ] 12.1 Run comprehensive test suite
  - Execute all property-based tests
  - Run integration tests for cleanup mechanisms
  - Verify no memory leaks remain

- [ ] 12.2 Performance validation
  - Test under high load conditions
  - Verify resource limits are enforced
  - Confirm monitoring and alerting work correctly

- [ ] 12.3 Update memory leak audit documentation
  - Mark remaining issues as fixed
  - Update deployment recommendation
  - Document performance improvements achieved

## Notes

- All tasks are required for comprehensive testing and full production readiness
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation and user feedback
- Property tests validate universal correctness properties
- Focus on defensive programming and comprehensive cleanup
- All fixes should maintain backward compatibility
- Error handling should be graceful and non-blocking