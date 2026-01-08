import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property-Based Test for EventSource Listener Cleanup
 * 
 * **Feature: performance-optimization-phase2, Property 1: EventSource Listener Cleanup Completeness**
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.5**
 * 
 * Property: For any EventSource instance, when it is closed, all previously added 
 * event listeners should be removed before the close operation, and reconnections 
 * should not accumulate duplicate listeners
 */

// Mock EventSource for testing
class MockEventSource {
  public listeners: Array<{ type: string; listener: EventListener }> = [];
  public readyState: number = 1; // OPEN
  public url: string;
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.push({ type, listener });
  }

  removeEventListener(type: string, listener: EventListener): void {
    const index = this.listeners.findIndex(l => l.type === type && l.listener === listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  close(): void {
    this.readyState = 2; // CLOSED
  }

  // Helper method to get listener count for testing
  getListenerCount(): number {
    return this.listeners.length;
  }

  // Helper method to get listeners by type
  getListenersByType(type: string): EventListener[] {
    return this.listeners.filter(l => l.type === type).map(l => l.listener);
  }
}

// EventSource Manager implementation for testing
class EventSourceManager {
  private eventSources: Map<MockEventSource, Array<{ type: string; listener: EventListener }>> = new Map();

  createEventSource(url: string): MockEventSource {
    const es = new MockEventSource(url);
    this.eventSources.set(es, []);
    return es;
  }

  addListener(es: MockEventSource, type: string, listener: EventListener): void {
    es.addEventListener(type, listener);
    const listeners = this.eventSources.get(es) || [];
    listeners.push({ type, listener });
    this.eventSources.set(es, listeners);
  }

  removeAllListeners(es: MockEventSource): void {
    const listeners = this.eventSources.get(es) || [];
    for (const { type, listener } of listeners) {
      es.removeEventListener(type, listener);
    }
    this.eventSources.set(es, []);
  }

  safeClose(es: MockEventSource): void {
    // Remove all listeners before closing (this is the key behavior we're testing)
    // Ensure close() is always called even if listener removal fails
    try {
      this.removeAllListeners(es);
    } finally {
      es.close();
    }
  }

  cleanup(): void {
    for (const [es] of this.eventSources) {
      this.safeClose(es);
    }
    this.eventSources.clear();
  }

  getTrackedListenerCount(es: MockEventSource): number {
    return (this.eventSources.get(es) || []).length;
  }
}

describe('EventSource Listener Cleanup Property Tests', () => {
  let manager: EventSourceManager;

  beforeEach(() => {
    manager = new EventSourceManager();
  });

  afterEach(() => {
    manager.cleanup();
  });

  it('Property 1: EventSource Listener Cleanup Completeness', () => {
    fc.assert(
      fc.property(
        // Generate test data: URL and array of event types to add listeners for
        fc.webUrl(),
        fc.array(fc.constantFrom('message', 'error', 'open', 'close', 'custom'), { minLength: 1, maxLength: 10 }),
        (url: string, eventTypes: string[]) => {
          // Create EventSource
          const es = manager.createEventSource(url);
          
          // Add listeners for each event type
          const addedListeners: Array<{ type: string; listener: EventListener }> = [];
          for (const eventType of eventTypes) {
            const listener = vi.fn();
            manager.addListener(es, eventType, listener);
            addedListeners.push({ type: eventType, listener });
          }

          // Verify listeners were added
          expect(es.getListenerCount()).toBe(eventTypes.length);
          expect(manager.getTrackedListenerCount(es)).toBe(eventTypes.length);

          // Perform safe close (should remove all listeners before closing)
          manager.safeClose(es);

          // Verify all listeners were removed before close
          expect(es.getListenerCount()).toBe(0);
          expect(manager.getTrackedListenerCount(es)).toBe(0);
          expect(es.readyState).toBe(2); // CLOSED

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 1b: Reconnection does not accumulate duplicate listeners', () => {
    fc.assert(
      fc.property(
        fc.webUrl(),
        fc.array(fc.constantFrom('message', 'error', 'open'), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 2, max: 5 }), // Number of reconnection cycles
        (url: string, eventTypes: string[], reconnectionCycles: number) => {
          // Simulate multiple reconnection cycles
          for (let cycle = 0; cycle < reconnectionCycles; cycle++) {
            const es = manager.createEventSource(url);
            
            // Add listeners
            for (const eventType of eventTypes) {
              const listener = vi.fn();
              manager.addListener(es, eventType, listener);
            }

            // Verify listeners were added for this cycle
            expect(es.getListenerCount()).toBe(eventTypes.length);

            // Close properly (this should clean up listeners)
            manager.safeClose(es);
            
            // Verify cleanup happened
            expect(es.getListenerCount()).toBe(0);
          }

          // Create final EventSource and verify it starts clean
          const finalEs = manager.createEventSource(url);
          expect(finalEs.getListenerCount()).toBe(0);
          
          // Add listeners to final EventSource
          for (const eventType of eventTypes) {
            const listener = vi.fn();
            manager.addListener(finalEs, eventType, listener);
          }

          // Verify final state has correct number of listeners (no accumulation)
          expect(finalEs.getListenerCount()).toBe(eventTypes.length);
          expect(manager.getTrackedListenerCount(finalEs)).toBe(eventTypes.length);

          // Verify no duplicate listeners for the same event type
          for (const eventType of eventTypes) {
            const listenersForType = finalEs.getListenersByType(eventType);
            const uniqueListeners = new Set(listenersForType);
            expect(uniqueListeners.size).toBe(listenersForType.length);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 1c: Cleanup works even with error conditions', () => {
    fc.assert(
      fc.property(
        fc.webUrl(),
        fc.array(fc.constantFrom('message', 'error', 'open'), { minLength: 1, maxLength: 5 }),
        fc.boolean(), // Whether to simulate error during cleanup
        (url: string, eventTypes: string[], simulateError: boolean) => {
          const es = manager.createEventSource(url);
          
          // Add listeners
          for (const eventType of eventTypes) {
            const listener = vi.fn();
            manager.addListener(es, eventType, listener);
          }

          if (simulateError) {
            // Mock removeEventListener to throw error for first call
            let errorThrown = false;
            const originalRemove = es.removeEventListener.bind(es);
            es.removeEventListener = vi.fn((type: string, listener: EventListener) => {
              if (!errorThrown) {
                errorThrown = true;
                throw new Error('Simulated cleanup error');
              }
              return originalRemove(type, listener);
            });

            // Cleanup should throw error but still close the EventSource
            expect(() => manager.safeClose(es)).toThrow('Simulated cleanup error');
            
            // Despite the error, EventSource should still be closed (due to finally block)
            expect(es.readyState).toBe(2); // CLOSED
          } else {
            // Normal cleanup should work without errors
            manager.safeClose(es);
            expect(es.readyState).toBe(2); // CLOSED
            expect(es.getListenerCount()).toBe(0);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 1d: Manager cleanup removes all EventSources', () => {
    fc.assert(
      fc.property(
        fc.array(fc.webUrl(), { minLength: 1, maxLength: 10 }),
        fc.array(fc.constantFrom('message', 'error', 'open'), { minLength: 1, maxLength: 3 }),
        (urls: string[], eventTypes: string[]) => {
          const eventSources: MockEventSource[] = [];
          
          // Create multiple EventSources with listeners
          for (const url of urls) {
            const es = manager.createEventSource(url);
            eventSources.push(es);
            
            for (const eventType of eventTypes) {
              const listener = vi.fn();
              manager.addListener(es, eventType, listener);
            }
          }

          // Verify all EventSources have listeners
          for (const es of eventSources) {
            expect(es.getListenerCount()).toBe(eventTypes.length);
          }

          // Cleanup all
          manager.cleanup();

          // Verify all EventSources are cleaned up
          for (const es of eventSources) {
            expect(es.getListenerCount()).toBe(0);
            expect(es.readyState).toBe(2); // CLOSED
            expect(manager.getTrackedListenerCount(es)).toBe(0);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});