# Fix Plan: Post-Deployment Game List Issues

## Problem
After every deployment, game lists disappear temporarily showing "0 games" due to cold start delays and stream connection issues.

## Root Causes
1. **Cold Start Delays** - Workers/Durable Objects need warm-up time
2. **Stream Connection Lag** - EventSource streams take time to establish
3. **Poor Loading States** - Shows "0 games" instead of "connecting" status
4. **No Retry Logic** - Frontend doesn't handle initial connection failures gracefully

## Solutions

### 1. Improve Loading States (Frontend) ✅
- [x] Show "Connecting..." instead of "0 games" during initial load
- [x] Add connection status indicator
- [x] Better error messages for failed connections

### 2. Add Warm-up Logic (Worker) ✅
- [x] Create `/api/warmup` endpoint to initialize DOs
- [x] Auto-call warmup after detecting cold start
- [x] Pre-establish upstream WebSocket connections

### 3. Enhanced Retry Logic (Frontend) ✅
- [x] Reduce retry intervals from 5s to 2s for initial connections
- [x] Add exponential backoff for persistent failures
- [x] Implement connection health checks

### 4. Connection Resilience (Worker)
- [ ] Keep upstream WebSocket connections alive longer
- [ ] Add connection pooling for multiple sports
- [ ] Implement graceful degradation

## Implementation Priority
1. **Quick Win**: Fix loading states (5 min)
2. **Medium**: Add warmup endpoint (15 min) 
3. **Long-term**: Enhanced retry logic (20 min)

## Success Criteria
- No more "0 games" flash after deployments
- Clear connection status for users
- Faster recovery from cold starts
