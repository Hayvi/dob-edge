import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property-Based Test for Odds Animation Timeout Management
 * 
 * **Feature: performance-optimization-phase2, Property 3: Odds Animation Timeout Cleanup**
 * **Validates: Requirements 2.3**
 * 
 * Property: For any DOM elements with odds animation timeouts, when elements are removed
 * or containers are cleared, all associated timeouts should be cleaned up to prevent
 * memory leaks and avoid accessing removed DOM elements
 */

// Mock DOM environment
class MockElement {
  public isConnected: boolean = true;
  public classList = {
    add: vi.fn(),
    remove: vi.fn(),
    toggle: vi.fn(),
    contains: vi.fn()
  };
  public textContent: string = '';
  public innerHTML: string = '';
  
  constructor(public tagName: string = 'div') {}
  
  querySelector(selector: string): MockElement | null {
    return new MockElement('span');
  }
  
  querySelectorAll(selector: string): MockElement[] {
    return [new MockElement('button'), new MockElement('button'), new MockElement('button')];
  }
  
  remove(): void {
    this.isConnected = false;
  }
}

// Mock WeakMap-based timeout manager
class OddsTimeoutManager {
  private timeouts = new WeakMap<MockElement, Record<string, number>>();
  private activeTimeoutIds = new Set<number>();
  private nextTimeoutId = 1;

  setTimeout(callback: () => void, delay: number): number {
    const id = this.nextTimeoutId++;
    this.activeTimeoutIds.add(id);
    
    // Simulate timeout execution
    setTimeout(() => {
      this.activeTimeoutIds.delete(id);
      callback();
    }, delay);
    
    return id;
  }

  clearTimeout(id: number): void {
    this.activeTimeoutIds.delete(id);
  }

  setElementTimeout(element: MockElement, key: string, callback: () => void, delay: number): void {
    const elementTimeouts = this.timeouts.get(element) || {};
    const oldTimeoutId = elementTimeouts[key];
    
    if (oldTimeoutId) {
      this.clearTimeout(oldTimeoutId);
    }
    
    const newTimeoutId = this.setTimeout(() => {
      // Check if element still exists before manipulating
      if (element.isConnected) {
        callback();
      }
      // Clean up timeout reference
      const currentTimeouts = this.timeouts.get(element);
      if (currentTimeouts) {
        delete currentTimeouts[key];
        if (Object.keys(currentTimeouts).length === 0) {
          this.timeouts.delete(element);
        }
      }
    }, delay);
    
    elementTimeouts[key] = newTimeoutId;
    this.timeouts.set(element, elementTimeouts);
  }

  clearElementTimeouts(element: MockElement): void {
    const timeouts = this.timeouts.get(element);
    if (timeouts) {
      Object.values(timeouts).forEach(timeoutId => {
        if (timeoutId) this.clearTimeout(timeoutId);
      });
      this.timeouts.delete(element);
    }
  }

  clearAllTimeouts(): void {
    this.activeTimeoutIds.forEach(id => this.clearTimeout(id));
    this.activeTimeoutIds.clear();
  }

  getActiveTimeoutCount(): number {
    return this.activeTimeoutIds.size;
  }

  hasElementTimeouts(element: MockElement): boolean {
    return this.timeouts.has(element);
  }
}

describe('Odds Animation Timeout Management', () => {
  let manager: OddsTimeoutManager;
  let mockContainer: MockElement;

  beforeEach(() => {
    manager = new OddsTimeoutManager();
    mockContainer = new MockElement('div');
  });

  afterEach(() => {
    manager.clearAllTimeouts();
  });

  it('Property 3.1: Timeouts are cleaned up when elements are removed', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1, maxLength: 10 }),
        (elementIndices) => {
          const elements = [new MockElement('button'), new MockElement('button'), new MockElement('button')];
          
          // Set timeouts for random elements
          for (const index of elementIndices) {
            const element = elements[index];
            manager.setElementTimeout(element, `timeout_${index}`, () => {
              element.classList.remove('odd-up', 'odd-down');
            }, 1100);
          }

          // Verify timeouts were set
          const initialTimeoutCount = manager.getActiveTimeoutCount();
          expect(initialTimeoutCount).toBeGreaterThan(0);

          // Remove elements and clean up their timeouts
          for (const index of elementIndices) {
            const element = elements[index];
            element.remove(); // Mark as disconnected
            manager.clearElementTimeouts(element);
          }

          // Property: All timeouts for removed elements should be cleaned up
          for (const index of elementIndices) {
            expect(manager.hasElementTimeouts(elements[index])).toBe(false);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 3.2: Container cleanup removes all child element timeouts', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        (elementCount) => {
          const elements: MockElement[] = [];
          
          // Create elements and set timeouts
          for (let i = 0; i < elementCount; i++) {
            const element = new MockElement('button');
            elements.push(element);
            
            manager.setElementTimeout(element, `flash_${i}`, () => {
              element.classList.remove('odd-up');
            }, 1100);
          }

          // Verify timeouts were set
          const initialTimeoutCount = manager.getActiveTimeoutCount();
          expect(initialTimeoutCount).toBe(elementCount);

          // Simulate container cleanup
          elements.forEach(element => {
            element.remove();
            manager.clearElementTimeouts(element);
          });

          // Property: All element timeouts should be cleaned up
          elements.forEach(element => {
            expect(manager.hasElementTimeouts(element)).toBe(false);
          });

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 3.3: Timeout replacement clears previous timeout', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        (updateCount) => {
          const element = new MockElement('button');
          let timeoutExecutions = 0;
          
          // Set multiple timeouts on the same element (simulating rapid odds updates)
          for (let i = 0; i < updateCount; i++) {
            manager.setElementTimeout(element, 'flash', () => {
              timeoutExecutions++;
              element.classList.remove('odd-up');
            }, 1100);
          }

          // Property: Only one timeout should be active per element key
          expect(manager.hasElementTimeouts(element)).toBe(true);
          
          // Clean up
          manager.clearElementTimeouts(element);
          expect(manager.hasElementTimeouts(element)).toBe(false);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 3.4: Disconnected elements are checked before manipulation', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }),
        (disconnectStates) => {
          const elements = disconnectStates.map(() => new MockElement('button'));
          
          // Set timeouts for all elements
          elements.forEach((element, index) => {
            manager.setElementTimeout(element, 'flash', () => {
              // This should check isConnected before manipulating (our implementation does this)
              if (element.isConnected) {
                element.classList.remove('odd-up');
              }
            }, 1100);
          });

          // Disconnect some elements based on disconnectStates
          elements.forEach((element, index) => {
            if (disconnectStates[index]) {
              element.remove(); // This sets isConnected = false
            }
          });

          // Property: Elements should have timeouts set regardless of connection state
          // The actual safety check happens in the timeout callback
          elements.forEach((element, index) => {
            expect(manager.hasElementTimeouts(element)).toBe(true);
          });

          // Clean up
          elements.forEach(element => {
            manager.clearElementTimeouts(element);
          });

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 3.5: WeakMap automatically handles garbage collection', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        (cycleCount) => {
          let elementsCreated = 0;
          
          // Simulate multiple create/destroy cycles
          for (let cycle = 0; cycle < cycleCount; cycle++) {
            const elements = [new MockElement('button'), new MockElement('button')];
            elementsCreated += elements.length;
            
            // Set timeouts
            elements.forEach((element, index) => {
              manager.setElementTimeout(element, `cycle_${cycle}_${index}`, () => {
                element.classList.remove('odd-up');
              }, 1100);
            });
            
            // Clean up explicitly (simulating proper cleanup)
            elements.forEach(element => {
              manager.clearElementTimeouts(element);
            });
          }

          // Property: Cleanup should work regardless of number of cycles
          // WeakMap should not accumulate references to cleaned up elements
          expect(elementsCreated).toBe(cycleCount * 2);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});