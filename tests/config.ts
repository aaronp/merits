/**
 * Test Configuration
 *
 * Centralized configuration for all test timeouts and thresholds.
 * This ensures consistency across the test suite and makes it easy
 * to tune performance.
 */

export const TEST_CONFIG = {
  /**
   * Default timeout for eventually() assertions (5s)
   * Used when waiting for async operations to complete
   */
  EVENTUALLY_TIMEOUT: 5000,

  /**
   * Poll interval for eventually() (100ms)
   * How often to check conditions in polling loops
   */
  EVENTUALLY_INTERVAL: 100,

  /**
   * Fast eventually timeout for negative assertions (300ms)
   * Used for "should NOT receive message" type tests
   * Quick enough to fail fast but allows for network latency
   */
  NEGATIVE_ASSERTION_TIMEOUT: 300,

  /**
   * Message delivery max time (100ms)
   * Expected maximum time for a message to be delivered
   * Used to calculate negative assertion timeouts
   */
  MESSAGE_DELIVERY_MAX: 100,

  /**
   * Default test suite timeout (20s)
   * Maximum time for individual test cases
   */
  TEST_TIMEOUT: 20000,

  /**
   * Long-running test timeout (60s)
   * For tests that legitimately need more time (e2e workflows)
   */
  TEST_TIMEOUT_LONG: 60000,

  /**
   * Session token TTL for tests (60s)
   * Maximum allowed by backend
   */
  SESSION_TOKEN_TTL: 60000,

  /**
   * Bootstrap operations timeout (30s)
   * Time allowed for system bootstrap
   */
  BOOTSTRAP_TIMEOUT: 30000,
} as const;

/**
 * Type-safe access to test config
 */
export type TestConfig = typeof TEST_CONFIG;
