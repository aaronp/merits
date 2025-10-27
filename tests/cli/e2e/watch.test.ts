/**
 * E2E Watch Command Tests (Phase 4)
 *
 * Tests real-time message streaming with session tokens.
 * Demonstrates:
 * - Session token creation & usage
 * - Real-time message delivery via watch
 * - Auto-ack functionality
 * - Graceful shutdown
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { eventually, eventuallyValue } from "../../helpers/eventually";

// Test data directories
const TEST_ROOT = path.join(process.cwd(), "test-data-tmp/watch");
const ALICE_DIR = path.join(TEST_ROOT, "alice");
const BOB_DIR = path.join(TEST_ROOT, "bob");

// Convex URL from environment
const CONVEX_URL = process.env.CONVEX_URL;
if (!CONVEX_URL) {
  throw new Error(
    "CONVEX_URL environment variable required for E2E tests.\n" +
      "Run with: make test-e2e\n" +
      "Or set manually: export CONVEX_URL=https://your-deployment.convex.cloud"
  );
}

// Helper to run CLI command and parse JSON output
async function runCLI(
  args: string[],
  options: { dataDir?: string; expectJson?: boolean } = {}
): Promise<any> {
  const { dataDir, expectJson = true } = options;

  const cliArgs = ["bun", "run", "cli/index.ts"];
  if (dataDir) {
    cliArgs.push("--data-dir", dataDir);
  }
  cliArgs.push("--convex-url", CONVEX_URL);
  cliArgs.push(...args);

  // Suppress vault warnings for clean output
  const env = { ...process.env, MERITS_VAULT_QUIET: "1" };

  const proc = Bun.spawn(cliArgs, { env, stdout: "pipe", stderr: "pipe" });
  const result = await proc.exited;

  if (result !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`CLI command failed: ${stderr}`);
  }

  const stdout = await new Response(proc.stdout).text();

  if (expectJson) {
    return JSON.parse(stdout.trim());
  }
  return stdout;
}

/**
 * Spawn watch command in background and collect output to a temp file
 */
function spawnWatch(dataDir: string, identity: string): {
  process: any;
  getOutput: () => string;
  outputFile: string;
} {
  const outputFile = path.join(TEST_ROOT, `watch-output-${Date.now()}.txt`);

  // Use shell to redirect output
  const command = `bun run cli/index.ts --data-dir ${dataDir} --convex-url ${CONVEX_URL} watch --from ${identity} --plaintext --format json > ${outputFile} 2>&1`;

  const env = { ...process.env, MERITS_VAULT_QUIET: "1" };

  const proc = Bun.spawn(["sh", "-c", command], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    process: proc,
    outputFile,
    getOutput: () => {
      try {
        return fs.readFileSync(outputFile, "utf-8");
      } catch (e) {
        return "";
      }
    },
  };
}

describe("E2E Watch Command (Phase 4)", () => {
  let aliceAid: string;
  let bobAid: string;

  beforeAll(async () => {
    // Clean up any existing test data
    if (fs.existsSync(TEST_ROOT)) {
      fs.rmSync(TEST_ROOT, { recursive: true });
    }
    fs.mkdirSync(TEST_ROOT, { recursive: true });

    // Create and register Alice
    const aliceResult = await runCLI(
      ["identity", "new", "alice", "--no-register", "--format", "json"],
      { dataDir: ALICE_DIR }
    );
    aliceAid = aliceResult.aid;
    await runCLI(["identity", "register", "alice"], {
      dataDir: ALICE_DIR,
      expectJson: false,
    });

    // Create and register Bob
    const bobResult = await runCLI(
      ["identity", "new", "bob", "--no-register", "--format", "json"],
      { dataDir: BOB_DIR }
    );
    bobAid = bobResult.aid;
    await runCLI(["identity", "register", "bob"], {
      dataDir: BOB_DIR,
      expectJson: false,
    });

    // Wait for registrations to propagate
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterAll(() => {
    // Clean up test data
    if (fs.existsSync(TEST_ROOT)) {
      fs.rmSync(TEST_ROOT, { recursive: true });
    }
  });

  test("watch receives message in real-time with auto-ack", async () => {
    // Start Bob watching in background
    const watch = spawnWatch(BOB_DIR, "bob");

    try {
      // Give watch time to initialize session and establish subscription
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Alice sends message to Bob
      const sendResult = await runCLI(
        [
          "send",
          bobAid,
          "--message",
          "Hello from watch test!",
          "--from",
          "alice",
          "--format",
          "json",
        ],
        { dataDir: ALICE_DIR }
      );

      expect(sendResult.messageId).toBeDefined();

      // Watch should receive and display the message (with eventual consistency)
      const message = await eventuallyValue(
        () => {
          const output = watch.getOutput();
          // Look for JSON message in output
          const jsonMatches = output.match(/\{[^}]*"plaintext"[^}]*\}/g);
          if (jsonMatches) {
            for (const match of jsonMatches) {
              try {
                const parsed = JSON.parse(match);
                if (
                  parsed.plaintext === "Hello from watch test!" &&
                  parsed.from === aliceAid
                ) {
                  return parsed;
                }
              } catch {
                // Not valid JSON, continue
              }
            }
          }
          return undefined;
        },
        {
          timeout: 10000,
          interval: 200,
          message: "Waiting for watch to receive message",
        }
      );

      expect(message).toBeDefined();
      expect(message.plaintext).toBe("Hello from watch test!");
      expect(message.from).toBe(aliceAid);
      expect(message.to).toBe(bobAid);
      expect(message.id).toBeDefined();

      // Verify message was auto-acked (should not appear in receive)
      // Wait a bit for ack to process
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const receivedMessages = await runCLI(
        ["receive", "--from", "bob", "--format", "json"],
        { dataDir: BOB_DIR }
      );

      // Message should be marked as retrieved (acked)
      const unackedMessage = receivedMessages.find(
        (m: any) => m.id === message.id
      );
      expect(unackedMessage).toBeUndefined(); // Should be acked and not appear
    } finally {
      // Cleanup: Kill watch process
      watch.process.kill("SIGINT");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }, 30000); // 30s timeout for full flow

  test("watch with --no-auto-ack leaves messages unread", async () => {
    // Start Bob watching WITHOUT auto-ack
    const outputFile = path.join(TEST_ROOT, `watch-noack-${Date.now()}.txt`);
    const command = `bun run cli/index.ts --data-dir ${BOB_DIR} --convex-url ${CONVEX_URL} watch --from bob --no-auto-ack --plaintext --format json > ${outputFile} 2>&1`;

    const env = { ...process.env, MERITS_VAULT_QUIET: "1" };
    const proc = Bun.spawn(["sh", "-c", command], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const getOutput = () => {
      try {
        return fs.readFileSync(outputFile, "utf-8");
      } catch (e) {
        return "";
      }
    };

    try {
      // Wait for watch to initialize
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Alice sends message
      const sendResult = await runCLI(
        [
          "send",
          bobAid,
          "--message",
          "Test no-auto-ack",
          "--from",
          "alice",
          "--format",
          "json",
        ],
        { dataDir: ALICE_DIR }
      );

      const messageId = sendResult.messageId;

      // Wait for watch to receive
      await eventually(
        () => {
          const allOutput = getOutput();
          return allOutput.includes("Test no-auto-ack");
        },
        { timeout: 10000, interval: 200, message: "Waiting for message" }
      );

      // Stop watch
      proc.kill("SIGINT");
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Message should still be unread (NOT auto-acked)
      const receivedMessages = await runCLI(
        ["receive", "--from", "bob", "--plaintext", "--format", "json"],
        { dataDir: BOB_DIR }
      );

      const unackedMessage = receivedMessages.find(
        (m: any) => m.id === messageId
      );
      expect(unackedMessage).toBeDefined(); // Should still be there
      expect(unackedMessage.plaintext).toBe("Test no-auto-ack");

      // Clean up: Ack the message
      await runCLI(
        [
          "ack",
          messageId,
          "--envelope-hash",
          unackedMessage.envelopeHash,
          "--from",
          "bob",
        ],
        { dataDir: BOB_DIR, expectJson: false }
      );
    } finally {
      proc.kill("SIGKILL");
    }
  }, 30000);

  test("watch handles multiple messages in sequence", async () => {
    // Start Bob watching
    const watch = spawnWatch(BOB_DIR, "bob");

    try {
      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Send multiple messages
      const messages = ["Message 1", "Message 2", "Message 3"];
      const sentIds: string[] = [];

      for (const msg of messages) {
        const result = await runCLI(
          ["send", bobAid, "--message", msg, "--from", "alice", "--format", "json"],
          { dataDir: ALICE_DIR }
        );
        sentIds.push(result.messageId);
        // Small delay between messages
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Wait for all messages to be received
      await eventually(
        () => {
          const output = watch.getOutput();
          return (
            output.includes("Message 1") &&
            output.includes("Message 2") &&
            output.includes("Message 3")
          );
        },
        {
          timeout: 15000,
          interval: 300,
          message: "Waiting for all 3 messages",
        }
      );

      const output = watch.getOutput();
      expect(output).toContain("Message 1");
      expect(output).toContain("Message 2");
      expect(output).toContain("Message 3");
    } finally {
      watch.process.kill("SIGINT");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }, 40000);

  test("watch gracefully handles SIGINT", async () => {
    // Start Bob watching
    const watch = spawnWatch(BOB_DIR, "bob");

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Send SIGINT
    watch.process.kill("SIGINT");

    // Wait for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Process should have exited
    expect(watch.process.killed || watch.process.exitCode !== null).toBe(true);
  }, 10000);
});
