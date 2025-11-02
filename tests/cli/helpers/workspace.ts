/**
 * Test Workspace Helpers
 *
 * Provides utilities for creating isolated test environments with temporary directories,
 * session tokens, and cleanup. Ensures tests don't interfere with each other or user data.
 *
 * Usage:
 *   const scenario = mkScenario("my-test");
 *   // ... run test with scenario.root, scenario.dataDir, etc. ...
 *   scenario.cleanup(); // or use afterEach/afterAll hooks
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TestScenario {
  /** Root directory for this test scenario */
  root: string;
  /** .merits data directory */
  dataDir: string;
  /** Session token file path */
  sessionPath: string;
  /** Keys storage path */
  keysPath: string;
  /** Cleanup function - removes all test files */
  cleanup: () => void;
}

/**
 * Create an isolated test workspace
 *
 * Creates a temporary directory structure for a single test scenario:
 * ```
 * /tmp/merits-{name}-{random}/
 *   ├── .merits/
 *   │   ├── session.json
 *   │   └── keys.json
 *   └── ... (test-specific files)
 * ```
 *
 * @param name - Test scenario name (e.g., "incept-users")
 * @returns TestScenario with paths and cleanup function
 *
 * @example
 * ```typescript
 * import { mkScenario } from "./helpers/workspace";
 *
 * describe("User inception", () => {
 *   let scenario: TestScenario;
 *
 *   beforeEach(() => {
 *     scenario = mkScenario("incept");
 *   });
 *
 *   afterEach(() => {
 *     scenario.cleanup();
 *   });
 *
 *   it("creates deterministic keys", async () => {
 *     // Test uses scenario.root, scenario.dataDir, etc.
 *   });
 * });
 * ```
 */
export function mkScenario(name: string): TestScenario {
  // Create unique temporary directory
  const root = mkdtempSync(join(tmpdir(), `merits-${name}-`));

  // Create .merits data directory
  const dataDir = join(root, ".merits");
  mkdirSync(dataDir, { recursive: true });

  // Define paths for common files
  const sessionPath = join(dataDir, "session.json");
  const keysPath = join(dataDir, "keys.json");

  // Cleanup function
  const cleanup = () => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (err) {
      console.warn(`Failed to cleanup test directory ${root}:`, err);
    }
  };

  return {
    root,
    dataDir,
    sessionPath,
    keysPath,
    cleanup,
  };
}

/**
 * Write JSON to a file
 *
 * @param path - File path
 * @param obj - Object to serialize as JSON
 */
export function writeJSON(path: string, obj: any): void {
  writeFileSync(path, JSON.stringify(obj, null, 2), "utf-8");
}

/**
 * Read JSON from a file
 *
 * @param path - File path
 * @returns Parsed JSON object
 */
export function readJSON(path: string): any {
  const content = readFileSync(path, "utf-8");
  return JSON.parse(content);
}

/**
 * Write session token to standard location
 *
 * @param scenario - Test scenario
 * @param token - Session token object
 */
export function writeSessionToken(scenario: TestScenario, token: {
  token: string;
  aid: string;
  expiresAt: number;
  ksn: number;
}): void {
  writeJSON(scenario.sessionPath, token);
}

/**
 * Read session token from standard location
 *
 * @param scenario - Test scenario
 * @returns Session token object
 */
export function readSessionToken(scenario: TestScenario): {
  token: string;
  aid: string;
  expiresAt: number;
  ksn: number;
} {
  return readJSON(scenario.sessionPath);
}

/**
 * Write keys to standard location
 *
 * @param scenario - Test scenario
 * @param keys - Key pair object
 */
export function writeKeys(scenario: TestScenario, keys: {
  aid: string;
  privateKey: string;
  publicKey: string;
}): void {
  writeJSON(scenario.keysPath, keys);
}

/**
 * Read keys from standard location
 *
 * @param scenario - Test scenario
 * @returns Key pair object
 */
export function readKeys(scenario: TestScenario): {
  aid: string;
  privateKey: string;
  publicKey: string;
} {
  return readJSON(scenario.keysPath);
}

/**
 * Create a multi-user test scenario
 *
 * Creates a directory structure with separate directories for multiple users:
 * ```
 * /tmp/merits-{name}-{random}/
 *   ├── admin/
 *   │   └── .merits/
 *   ├── alice/
 *   │   └── .merits/
 *   └── bob/
 *       └── .merits/
 * ```
 *
 * @param name - Test scenario name
 * @param users - Array of user names to create directories for
 * @returns Object with root and user-specific scenarios
 *
 * @example
 * ```typescript
 * const { root, users, cleanup } = mkMultiUserScenario("group-test", ["admin", "alice", "bob"]);
 *
 * // Each user has their own isolated workspace
 * await runCliInProcess(["gen-key"], { cwd: users.admin.root });
 * await runCliInProcess(["gen-key"], { cwd: users.alice.root });
 *
 * cleanup(); // Clean up all user directories
 * ```
 */
export function mkMultiUserScenario(name: string, userNames: string[]): {
  root: string;
  users: Record<string, TestScenario>;
  cleanup: () => void;
} {
  // Create root directory
  const root = mkdtempSync(join(tmpdir(), `merits-${name}-`));

  // Create scenario for each user
  const users: Record<string, TestScenario> = {};
  for (const userName of userNames) {
    const userRoot = join(root, userName);
    mkdirSync(userRoot, { recursive: true });

    const dataDir = join(userRoot, ".merits");
    mkdirSync(dataDir, { recursive: true });

    users[userName] = {
      root: userRoot,
      dataDir,
      sessionPath: join(dataDir, "session.json"),
      keysPath: join(dataDir, "keys.json"),
      cleanup: () => {}, // Handled by parent cleanup
    };
  }

  // Cleanup function removes entire root
  const cleanup = () => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (err) {
      console.warn(`Failed to cleanup test directory ${root}:`, err);
    }
  };

  return {
    root,
    users,
    cleanup,
  };
}
