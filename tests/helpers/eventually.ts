/**
 * Eventually - Retry assertions until they pass or timeout
 *
 * Useful for testing async operations where we know something will
 * eventually be true, but don't know exactly when.
 *
 * Instead of sleep(), we poll at regular intervals.
 */

import { TEST_CONFIG } from '../config';

export interface EventuallyOptions {
  /** Timeout in milliseconds (default: from TEST_CONFIG.EVENTUALLY_TIMEOUT) */
  timeout?: number;

  /** Interval between checks in milliseconds (default: from TEST_CONFIG.EVENTUALLY_INTERVAL) */
  interval?: number;

  /** Error message prefix (optional) */
  message?: string;
}

/**
 * Retry a condition function until it returns true or timeout
 *
 * @param condition - Function that returns true when condition is met
 * @param options - Timeout and interval options
 *
 * @example
 * await eventually(() => messages.length > 0);
 * await eventually(() => messages.length > 0, { timeout: 3000, interval: 50 });
 * await eventually(() => messages.length > 0, { timeout: TEST_CONFIG.NEGATIVE_ASSERTION_TIMEOUT });
 */
export async function eventually(
  condition: () => boolean | Promise<boolean>,
  options: EventuallyOptions = {},
): Promise<void> {
  const { timeout = TEST_CONFIG.EVENTUALLY_TIMEOUT, interval = TEST_CONFIG.EVENTUALLY_INTERVAL, message } = options;

  const startTime = Date.now();

  while (true) {
    const result = await condition();

    if (result) {
      return; // Success!
    }

    const elapsed = Date.now() - startTime;

    if (elapsed >= timeout) {
      const msg = message ? `${message} (timeout after ${timeout}ms)` : `Condition not met within ${timeout}ms`;
      throw new Error(msg);
    }

    // Wait before next check
    await sleep(interval);
  }
}

/**
 * Eventually with an assertion function
 *
 * @param assertion - Function that throws if condition not met
 * @param options - Timeout and interval options
 *
 * @example
 * await eventuallyAssert(() => {
 *   expect(messages.length).toBeGreaterThan(0);
 * });
 */
export async function eventuallyAssert(
  assertion: () => void | Promise<void>,
  options: EventuallyOptions = {},
): Promise<void> {
  const { timeout = TEST_CONFIG.EVENTUALLY_TIMEOUT, interval = TEST_CONFIG.EVENTUALLY_INTERVAL, message } = options;

  const startTime = Date.now();
  let lastError: Error | undefined;

  while (true) {
    try {
      await assertion();
      return; // Success!
    } catch (error) {
      lastError = error as Error;

      const elapsed = Date.now() - startTime;

      if (elapsed >= timeout) {
        const msg = message ? `${message} (timeout after ${timeout}ms)` : `Assertion failed after ${timeout}ms`;

        // Throw with original error details
        throw new Error(`${msg}\n\nLast error: ${lastError.message}`);
      }

      // Wait before next check
      await sleep(interval);
    }
  }
}

/**
 * Wait for a value to be defined/truthy
 *
 * @param getValue - Function that returns the value to check
 * @param options - Timeout and interval options
 * @returns The value once it's defined
 *
 * @example
 * const msg = await eventuallyValue(() => messages.find(m => m.id === targetId));
 */
export async function eventuallyValue<T>(
  getValue: () => T | undefined | null | Promise<T | undefined | null>,
  options: EventuallyOptions = {},
): Promise<T> {
  const { timeout = TEST_CONFIG.EVENTUALLY_TIMEOUT, interval = TEST_CONFIG.EVENTUALLY_INTERVAL, message } = options;

  const startTime = Date.now();

  while (true) {
    const value = await getValue();

    if (value !== undefined && value !== null) {
      return value;
    }

    const elapsed = Date.now() - startTime;

    if (elapsed >= timeout) {
      const msg = message ? `${message} (timeout after ${timeout}ms)` : `Value not defined within ${timeout}ms`;
      throw new Error(msg);
    }

    // Wait before next check
    await sleep(interval);
  }
}

/**
 * Helper sleep function
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
