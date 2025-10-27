/**
 * E2E CLI Messaging Tests
 *
 * Tests CLI messaging flow with isolated data directories.
 * Uses --data-dir to create separate Alice and Bob environments.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { $ } from "bun";

// Test data directories
const TEST_ROOT = path.join(process.cwd(), "test-data-tmp");
const ALICE_DIR = path.join(TEST_ROOT, "alice");
const BOB_DIR = path.join(TEST_ROOT, "bob");

// Convex URL from environment
const CONVEX_URL = process.env.CONVEX_URL;
if (!CONVEX_URL) {
  throw new Error("CONVEX_URL environment variable required for E2E tests");
}

// Helper to run CLI command and parse JSON output
async function runCLI(
  args: string[],
  options: { dataDir?: string; expectJson?: boolean } = {}
): Promise<any> {
  const { dataDir, expectJson = true } = options;

  const cliArgs = ["run", "cli/index.ts"];
  if (dataDir) {
    cliArgs.push("--data-dir", dataDir);
  }
  cliArgs.push("--convex-url", CONVEX_URL);
  cliArgs.push(...args);

  // Suppress vault warnings for clean output
  const env = { ...process.env, MERITS_VAULT_QUIET: "1" };

  const result = await $`bun ${cliArgs}`.env(env).text();

  if (expectJson) {
    return JSON.parse(result.trim());
  }
  return result;
}

describe("E2E CLI Messaging", () => {
  beforeAll(() => {
    // Clean up any existing test data
    if (fs.existsSync(TEST_ROOT)) {
      fs.rmSync(TEST_ROOT, { recursive: true });
    }
    fs.mkdirSync(TEST_ROOT, { recursive: true });

    // NOTE: Full messaging test requires authorization pattern setup
    // See docs/setup-test-patterns.md for instructions
    // TL;DR: Add pattern ".*" to authPatterns table via Convex Dashboard
    // Otherwise, this test will be skipped
  });

  afterAll(() => {
    // Clean up test data
    if (fs.existsSync(TEST_ROOT)) {
      fs.rmSync(TEST_ROOT, { recursive: true });
    }
  });

  test.skip("alice sends message to bob", async () => {
    // SKIP: Requires manual authorization pattern setup
    // To enable: Add pattern ".*" to authPatterns table via Convex Dashboard
    // See docs/setup-test-patterns.md for details

    // 1. Create Alice's identity with TEST prefix
    const aliceResult = await runCLI(
      ["identity", "new", "TESTAlice", "--no-register", "--format", "json"],
      { dataDir: ALICE_DIR }
    );
    const aliceAid = aliceResult.aid;

    // Register Alice with backend
    await runCLI(["identity", "register", "TESTAlice"], { dataDir: ALICE_DIR, expectJson: false });

    // 2. Create Bob's identity with TEST prefix
    const bobResult = await runCLI(
      ["identity", "new", "TESTBob", "--no-register", "--format", "json"],
      { dataDir: BOB_DIR }
    );
    const bobAid = bobResult.aid;

    // Register Bob with backend
    await runCLI(["identity", "register", "TESTBob"], { dataDir: BOB_DIR, expectJson: false });

    // 3. Alice sends message to Bob
    const sendResult = await runCLI(
      ["send", bobAid, "--message", "Hello Bob!", "--from", "TESTAlice", "--format", "json"],
      { dataDir: ALICE_DIR }
    );

    expect(sendResult.messageId).toBeDefined();
    expect(sendResult.recipient).toBe(bobAid);

    // 4. Bob receives messages
    const receiveResult = await runCLI(
      ["receive", "--plaintext", "--from", "TESTBob", "--format", "json"],
      { dataDir: BOB_DIR }
    );

    expect(receiveResult).toBeArray();
    expect(receiveResult.length).toBeGreaterThan(0);

    const message = receiveResult.find((msg: any) => msg.id === sendResult.messageId);
    expect(message).toBeDefined();
    expect(message.plaintext).toBe("Hello Bob!");
    expect(message.from).toBe(aliceAid);
    expect(message.envelopeHash).toBeDefined();

    // 5. Bob acknowledges the message
    await runCLI(
      ["ack", message.id, "--envelope-hash", message.envelopeHash, "--from", "TESTBob"],
      { dataDir: BOB_DIR, expectJson: false }
    );

    // Success! E2E flow complete
  }, 30000); // 30s timeout for E2E test

  test("parallel test isolation", async () => {
    // Create two isolated environments
    const carol1Dir = path.join(TEST_ROOT, "carol1");
    const carol2Dir = path.join(TEST_ROOT, "carol2");

    // Both create identities with the same name "carol"
    const [carol1, carol2] = await Promise.all([
      runCLI(
        ["identity", "new", "carol", "--no-register", "--format", "json"],
        { dataDir: carol1Dir }
      ),
      runCLI(
        ["identity", "new", "carol", "--no-register", "--format", "json"],
        { dataDir: carol2Dir }
      ),
    ]);

    // Verify they have different AIDs (isolated state)
    expect(carol1.aid).toBeDefined();
    expect(carol2.aid).toBeDefined();
    expect(carol1.aid).not.toBe(carol2.aid);

    // Verify they both have their own vault files
    expect(fs.existsSync(path.join(carol1Dir, "identities.json"))).toBe(true);
    expect(fs.existsSync(path.join(carol2Dir, "identities.json"))).toBe(true);
    expect(fs.existsSync(path.join(carol1Dir, "keychain", "carol.key"))).toBe(true);
    expect(fs.existsSync(path.join(carol2Dir, "keychain", "carol.key"))).toBe(true);
  });

  test("data persistence across CLI invocations", async () => {
    const daveDir = path.join(TEST_ROOT, "dave");

    // Create identity
    const created = await runCLI(
      ["identity", "new", "dave", "--no-register", "--format", "json"],
      { dataDir: daveDir }
    );

    // List identities (separate CLI invocation)
    const listed = await runCLI(
      ["identity", "list", "--format", "json"],
      { dataDir: daveDir }
    );

    expect(listed).toBeArray();
    expect(listed.length).toBe(1);
    expect(listed[0].name).toBe("dave");
    expect(listed[0].aid).toBe(created.aid);

    // Show identity (third CLI invocation)
    const shown = await runCLI(
      ["identity", "show", "dave", "--format", "json"],
      { dataDir: daveDir }
    );

    expect(shown.aid).toBe(created.aid);
    expect(shown.name).toBe("dave");
  });
});
