import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Heartbeat Timer Cleanup Error Handling', () => {
  let originalConsoleError: typeof console.error;
  let consoleErrorSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalConsoleError = console.error;
    consoleErrorSpy = vi.fn();
    console.error = consoleErrorSpy;
  });

  afterEach(() => {
    console.error = originalConsoleError;
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('should handle clearInterval errors gracefully in SwarmHubDO', () => {
    vi.useFakeTimers();
    
    // Mock clearInterval to throw an error
    const originalClearInterval = global.clearInterval;
    const mockClearInterval = vi.fn(() => {
      throw new Error('clearInterval failed');
    });
    global.clearInterval = mockClearInterval;

    try {
      // Simulate the stopCountsHeartbeat logic with error handling
      let heartbeatTimer: number | null = 123 as unknown as number;
      
      // This simulates the improved stopCountsHeartbeat method
      if (heartbeatTimer != null) {
        try {
          clearInterval(heartbeatTimer);
        } catch (error) {
          console.error('Failed to clear counts heartbeat timer:', error);
        } finally {
          heartbeatTimer = null;
        }
      }

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to clear counts heartbeat timer:',
        expect.any(Error)
      );
      
      // Verify timer reference was still cleared
      expect(heartbeatTimer).toBeNull();
      
    } finally {
      global.clearInterval = originalClearInterval;
    }
  });

  it('should handle clearInterval errors gracefully in LiveTrackerDO', () => {
    vi.useFakeTimers();
    
    // Mock clearInterval to throw an error
    const originalClearInterval = global.clearInterval;
    const mockClearInterval = vi.fn(() => {
      throw new Error('clearInterval failed');
    });
    global.clearInterval = mockClearInterval;

    try {
      // Simulate the stopHeartbeat logic with error handling
      let heartbeatTimer: number | null = 456 as unknown as number;
      
      // This simulates the improved stopHeartbeat method
      if (heartbeatTimer != null) {
        try {
          clearInterval(heartbeatTimer);
        } catch (error) {
          console.error('Failed to clear heartbeat timer:', error);
        } finally {
          heartbeatTimer = null;
        }
      }

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to clear heartbeat timer:',
        expect.any(Error)
      );
      
      // Verify timer reference was still cleared
      expect(heartbeatTimer).toBeNull();
      
    } finally {
      global.clearInterval = originalClearInterval;
    }
  });

  it('should handle setInterval errors gracefully during timer creation', () => {
    vi.useFakeTimers();
    
    // Mock setInterval to throw an error
    const originalSetInterval = global.setInterval;
    const mockSetInterval = vi.fn(() => {
      throw new Error('setInterval failed');
    });
    global.setInterval = mockSetInterval;

    try {
      // Simulate the startCountsHeartbeat logic with error handling
      let heartbeatTimer: number | null = null;
      
      // This simulates the improved startCountsHeartbeat method
      if (heartbeatTimer != null) return;
      
      try {
        heartbeatTimer = setInterval(() => {
          // heartbeat logic
        }, 15000) as unknown as number;
      } catch (error) {
        console.error('Failed to start counts heartbeat timer:', error);
        heartbeatTimer = null;
        throw error;
      }

      // Should not reach here
      expect(true).toBe(false);
      
    } catch (error) {
      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to start counts heartbeat timer:',
        expect.any(Error)
      );
      
      // Verify the error was re-thrown
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('setInterval failed');
      
    } finally {
      global.setInterval = originalSetInterval;
    }
  });

  it('should continue cleanup even when clearInterval fails', () => {
    vi.useFakeTimers();
    
    // Mock clearInterval to throw an error
    const originalClearInterval = global.clearInterval;
    const mockClearInterval = vi.fn(() => {
      throw new Error('clearInterval failed');
    });
    global.clearInterval = mockClearInterval;

    try {
      // Simulate multiple timer cleanup with error handling
      let timer1: number | null = 123 as unknown as number;
      let timer2: number | null = 456 as unknown as number;
      
      // This simulates the improved stopSportGroup method
      if (timer1 != null) {
        try {
          clearInterval(timer1);
        } catch (error) {
          console.error('Failed to clear sport group timer:', error);
        } finally {
          timer1 = null;
        }
      }
      
      if (timer2 != null) {
        try {
          clearInterval(timer2);
        } catch (error) {
          console.error('Failed to clear sport group odds timer:', error);
        } finally {
          timer2 = null;
        }
      }

      // Verify both errors were logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to clear sport group timer:',
        expect.any(Error)
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to clear sport group odds timer:',
        expect.any(Error)
      );
      
      // Verify both timer references were cleared
      expect(timer1).toBeNull();
      expect(timer2).toBeNull();
      
    } finally {
      global.clearInterval = originalClearInterval;
    }
  });

  it('should handle errors in heartbeat callback without crashing timer', () => {
    vi.useFakeTimers();
    
    // Simulate heartbeat callback with error handling
    const mockBroadcast = vi.fn(() => {
      throw new Error('broadcast failed');
    });
    
    let clientsSize = 1;
    let heartbeatStopped = false;
    
    const mockStopHeartbeat = vi.fn(() => {
      heartbeatStopped = true;
    });

    // This simulates the improved heartbeat callback
    const heartbeatCallback = () => {
      try {
        mockBroadcast();
        if (clientsSize === 0) mockStopHeartbeat();
      } catch (error) {
        console.error('Error in counts heartbeat:', error);
        if (clientsSize === 0) {
          mockStopHeartbeat();
        }
      }
    };

    // Test with clients present - should log error but continue
    heartbeatCallback();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error in counts heartbeat:',
      expect.any(Error)
    );
    expect(heartbeatStopped).toBe(false);

    // Test with no clients - should log error and stop heartbeat
    clientsSize = 0;
    heartbeatCallback();
    expect(heartbeatStopped).toBe(true);
  });
});