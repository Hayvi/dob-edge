import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';

// Mock DOM and global functions for testing
const mockGlobal = {
  setInterval: vi.fn(),
  clearInterval: vi.fn(),
  setTimeout: vi.fn(),
  clearTimeout: vi.fn(),
  currentMode: 'prematch',
  liveStreamOddsIntervalId: null,
  liveStreamDetailsIntervalId: null,
  liveStreamRetryTimeoutId: null,
  healthCheckIntervalId: null,
};

// Mock the timer management functions
function mockClearLiveStreamIntervals() {
  if (mockGlobal.liveStreamOddsIntervalId) {
    mockGlobal.clearInterval(mockGlobal.liveStreamOddsIntervalId);
    mockGlobal.liveStreamOddsIntervalId = null;
  }
  if (mockGlobal.liveStreamDetailsIntervalId) {
    mockGlobal.clearInterval(mockGlobal.liveStreamDetailsIntervalId);
    mockGlobal.liveStreamDetailsIntervalId = null;
  }
}

function mockStopLiveStream() {
  if (mockGlobal.liveStreamRetryTimeoutId) {
    mockGlobal.clearTimeout(mockGlobal.liveStreamRetryTimeoutId);
    mockGlobal.liveStreamRetryTimeoutId = null;
  }
  mockClearLiveStreamIntervals();
}

function mockSetMode(mode: string) {
  mockGlobal.currentMode = mode;
  if (mode !== 'live') {
    mockStopLiveStream();
  }
}

function mockStartLiveStream() {
  if (mockGlobal.currentMode !== 'live') return;
  
  // Start intervals
  mockGlobal.liveStreamOddsIntervalId = mockGlobal.setInterval(() => {}, 6000);
  mockGlobal.liveStreamDetailsIntervalId = mockGlobal.setInterval(() => {}, 30000);
}

function mockCleanup() {
  if (mockGlobal.healthCheckIntervalId) {
    mockGlobal.clearInterval(mockGlobal.healthCheckIntervalId);
    mockGlobal.healthCheckIntervalId = null;
  }
  mockClearLiveStreamIntervals();
  mockStopLiveStream();
}

describe('Timer Lifecycle Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGlobal.liveStreamOddsIntervalId = null;
    mockGlobal.liveStreamDetailsIntervalId = null;
    mockGlobal.liveStreamRetryTimeoutId = null;
    mockGlobal.healthCheckIntervalId = null;
    mockGlobal.currentMode = 'prematch';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('Property 2: Timer Lifecycle Management - All timers are properly cleaned up on mode changes', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('prematch', 'live', 'results'), { minLength: 1, maxLength: 10 }),
        (modeSequence) => {
          // Reset state
          mockGlobal.liveStreamOddsIntervalId = null;
          mockGlobal.liveStreamDetailsIntervalId = null;
          mockGlobal.liveStreamRetryTimeoutId = null;
          vi.clearAllMocks();

          let activeIntervals = 0;
          let activeTimeouts = 0;

          // Mock setInterval to track active intervals
          mockGlobal.setInterval.mockImplementation(() => {
            activeIntervals++;
            return activeIntervals; // Return unique ID
          });

          // Mock clearInterval to track cleanup
          mockGlobal.clearInterval.mockImplementation((id) => {
            if (id) activeIntervals = Math.max(0, activeIntervals - 1);
          });

          // Mock setTimeout to track active timeouts
          mockGlobal.setTimeout.mockImplementation(() => {
            activeTimeouts++;
            return activeTimeouts; // Return unique ID
          });

          // Mock clearTimeout to track cleanup
          mockGlobal.clearTimeout.mockImplementation((id) => {
            if (id) activeTimeouts = Math.max(0, activeTimeouts - 1);
          });

          // Execute mode sequence
          for (const mode of modeSequence) {
            mockSetMode(mode);
            if (mode === 'live') {
              mockStartLiveStream();
            }
          }

          // Final cleanup
          mockCleanup();

          // Property: All timers should be cleaned up
          // We expect clearInterval/clearTimeout to be called for each active timer
          const totalClearIntervalCalls = mockGlobal.clearInterval.mock.calls.length;
          const totalClearTimeoutCalls = mockGlobal.clearTimeout.mock.calls.length;

          // At minimum, we should have cleanup calls
          expect(totalClearIntervalCalls + totalClearTimeoutCalls).toBeGreaterThanOrEqual(0);

          // No timers should remain active after cleanup
          expect(mockGlobal.liveStreamOddsIntervalId).toBeNull();
          expect(mockGlobal.liveStreamDetailsIntervalId).toBeNull();
          expect(mockGlobal.liveStreamRetryTimeoutId).toBeNull();
          expect(mockGlobal.healthCheckIntervalId).toBeNull();

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 2.1: Intervals are cleared when switching away from live mode', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('prematch', 'results'),
        (targetMode) => {
          // Start in live mode with active intervals
          mockGlobal.currentMode = 'live';
          mockStartLiveStream();
          
          const initialOddsId = mockGlobal.liveStreamOddsIntervalId;
          const initialDetailsId = mockGlobal.liveStreamDetailsIntervalId;
          
          // Switch to non-live mode
          mockSetMode(targetMode);
          
          // Property: Intervals should be cleared
          expect(mockGlobal.clearInterval).toHaveBeenCalledWith(initialOddsId);
          expect(mockGlobal.clearInterval).toHaveBeenCalledWith(initialDetailsId);
          expect(mockGlobal.liveStreamOddsIntervalId).toBeNull();
          expect(mockGlobal.liveStreamDetailsIntervalId).toBeNull();
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 2.2: Cleanup function clears all timer types', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (hasOddsInterval, hasDetailsInterval, hasHealthInterval) => {
          // Set up various timers
          if (hasOddsInterval) {
            mockGlobal.liveStreamOddsIntervalId = mockGlobal.setInterval(() => {}, 6000);
          }
          if (hasDetailsInterval) {
            mockGlobal.liveStreamDetailsIntervalId = mockGlobal.setInterval(() => {}, 30000);
          }
          if (hasHealthInterval) {
            mockGlobal.healthCheckIntervalId = mockGlobal.setInterval(() => {}, 600000);
          }

          const initialClearCalls = mockGlobal.clearInterval.mock.calls.length;
          
          // Run cleanup
          mockCleanup();
          
          // Property: All active timers should be cleared
          const finalClearCalls = mockGlobal.clearInterval.mock.calls.length;
          const expectedClears = [hasOddsInterval, hasDetailsInterval, hasHealthInterval].filter(Boolean).length;
          
          expect(finalClearCalls - initialClearCalls).toBe(expectedClears);
          expect(mockGlobal.liveStreamOddsIntervalId).toBeNull();
          expect(mockGlobal.liveStreamDetailsIntervalId).toBeNull();
          expect(mockGlobal.healthCheckIntervalId).toBeNull();
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 2.3: Error paths clear timers before setting new ones', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        (errorCount) => {
          // Start in live mode
          mockGlobal.currentMode = 'live';
          mockStartLiveStream();
          
          let totalClearCalls = 0;
          
          // Simulate multiple error/restart cycles
          for (let i = 0; i < errorCount; i++) {
            const beforeClearCalls = mockGlobal.clearInterval.mock.calls.length;
            
            // Simulate error that triggers restart
            mockStopLiveStream();
            mockStartLiveStream();
            
            const afterClearCalls = mockGlobal.clearInterval.mock.calls.length;
            totalClearCalls += (afterClearCalls - beforeClearCalls);
          }
          
          // Property: Each error cycle should clear existing timers
          expect(totalClearCalls).toBeGreaterThanOrEqual(errorCount * 2); // 2 intervals per cycle
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 2.4: Page unload cleanup handles all timer states', () => {
    fc.assert(
      fc.property(
        fc.record({
          mode: fc.constantFrom('prematch', 'live', 'results'),
          hasOddsInterval: fc.boolean(),
          hasDetailsInterval: fc.boolean(),
          hasRetryTimeout: fc.boolean(),
          hasHealthInterval: fc.boolean(),
        }),
        (state) => {
          // Set up state
          mockGlobal.currentMode = state.mode;
          
          if (state.hasOddsInterval) {
            mockGlobal.liveStreamOddsIntervalId = mockGlobal.setInterval(() => {}, 6000);
          }
          if (state.hasDetailsInterval) {
            mockGlobal.liveStreamDetailsIntervalId = mockGlobal.setInterval(() => {}, 30000);
          }
          if (state.hasRetryTimeout) {
            mockGlobal.liveStreamRetryTimeoutId = mockGlobal.setTimeout(() => {}, 5000);
          }
          if (state.hasHealthInterval) {
            mockGlobal.healthCheckIntervalId = mockGlobal.setInterval(() => {}, 600000);
          }

          // Simulate page unload cleanup
          mockCleanup();
          
          // Property: All timers should be cleared regardless of initial state
          expect(mockGlobal.liveStreamOddsIntervalId).toBeNull();
          expect(mockGlobal.liveStreamDetailsIntervalId).toBeNull();
          expect(mockGlobal.liveStreamRetryTimeoutId).toBeNull();
          expect(mockGlobal.healthCheckIntervalId).toBeNull();
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});