/**
 * E2E Test: Unread Message Pipeline
 *
 * Tests the complete unread message workflow including listing, reading,
 * marking as read, and message extraction utilities.
 *
 * Scenario:
 * 1. Create users (alice, bob with user role)
 * 2. Send multiple direct messages from alice to bob
 * 3. List unread counts (list-unread command)
 * 4. Retrieve and decrypt unread messages
 * 5. Extract message IDs
 * 6. Mark specific messages as read
 * 7. Verify messages are removed after marking
 *
 * Priority: P2 (message pipeline features)
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { runCliInProcess, assertSuccess } from "../helpers/exec";
import { ensureAdminInitialised, getAdminSessionToken, type AdminCredentials } from "../../helpers/admin-bootstrap";
import { mkMultiUserScenario, writeJSON } from "../helpers/workspace";
import { join } from "node:path";

// Only run if CONVEX_URL and BOOTSTRAP_KEY are set
const CONVEX_URL = process.env.CONVEX_URL;
const BOOTSTRAP_KEY = process.env.BOOTSTRAP_KEY;

const shouldRun = CONVEX_URL && BOOTSTRAP_KEY;
const runTests = shouldRun ? describe : describe.skip;

runTests("E2E: Unread Message Pipeline", () => {
  let scenario: ReturnType<typeof mkMultiUserScenario>;
  let admin: AdminCredentials;
  let adminSessionPath: string;
  let aliceAid: string;
  let bobAid: string;
  let messageIds: string[] = [];

  beforeAll(async () => {
    // Initialize admin
    admin = await ensureAdminInitialised(CONVEX_URL!);
    console.log(`✓ Admin initialized: ${admin.aid}`);

    // Create workspace
    scenario = mkMultiUserScenario("unread-pipeline", ["alice", "bob"]);

    // Get admin session token
    adminSessionPath = join(scenario.root, "admin-session.json");
    await getAdminSessionToken(CONVEX_URL!, admin, {
      ttlMs: 90000,
      saveTo: adminSessionPath,
    });
    console.log(`✓ Admin session token created`);

    // Incept Alice
    const aliceResult = await runCliInProcess(
      ["incept", "--seed", "alice-unread-test"],
      {
        cwd: scenario.users.alice.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );
    assertSuccess(aliceResult);
    aliceAid = aliceResult.json.aid;

    // Grant Alice user role
    await runCliInProcess(
      [
        "users",
        "grant-role",
        aliceAid,
        "user",
        "--token",
        adminSessionPath,
        "--actionSAID",
        "grant-alice-user-unread",
      ],
      { env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! } }
    );
    console.log(`✓ Alice incepted: ${aliceAid}`);

    // Incept Bob
    const bobResult = await runCliInProcess(
      ["incept", "--seed", "bob-unread-test"],
      {
        cwd: scenario.users.bob.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );
    assertSuccess(bobResult);
    bobAid = bobResult.json.aid;

    // Grant Bob user role
    await runCliInProcess(
      [
        "users",
        "grant-role",
        bobAid,
        "user",
        "--token",
        adminSessionPath,
        "--actionSAID",
        "grant-bob-user-unread",
      ],
      { env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! } }
    );
    console.log(`✓ Bob incepted: ${bobAid}`);
  }, 90000);

  it("alice sends multiple messages to bob", async () => {
    const messages = [
      "First message",
      "Second message",
      "Third message with some longer content",
      "Fourth message",
    ];

    for (const msg of messages) {
      const result = await runCliInProcess(
        ["send", bobAid, "--message", msg],
        {
          cwd: scenario.users.alice.root,
          env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
        }
      );

      assertSuccess(result);
      messageIds.push(result.json.messageId);
    }

    console.log(`✓ Alice sent ${messages.length} messages to Bob`);
  }, 60000);

  it("bob should list unread message counts", async () => {
    // Wait for propagation
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const result = await runCliInProcess(["list-unread"], {
      cwd: scenario.users.bob.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(result);
    expect(result.json).toBeDefined();
    expect(Array.isArray(result.json.senders)).toBe(true);

    // Should show Alice with 4 unread messages
    const aliceEntry = result.json.senders.find((s: any) => s.sender === aliceAid);
    expect(aliceEntry).toBeDefined();
    expect(aliceEntry.count).toBeGreaterThanOrEqual(4);

    console.log(`✓ Bob has ${aliceEntry.count} unread message(s) from Alice`);
  }, 15000);

  it("bob should list unread filtered by alice", async () => {
    const result = await runCliInProcess(["list-unread", "--from", aliceAid], {
      cwd: scenario.users.bob.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(result);
    expect(result.json.senders.length).toBeGreaterThanOrEqual(1);

    const aliceEntry = result.json.senders.find((s: any) => s.sender === aliceAid);
    expect(aliceEntry).toBeDefined();

    console.log("✓ Filtered unread list shows only Alice");
  }, 15000);

  it("bob retrieves all unread messages", async () => {
    const result = await runCliInProcess(["unread"], {
      cwd: scenario.users.bob.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(result);
    expect(result.json).toBeDefined();
    expect(Array.isArray(result.json.messages)).toBe(true);

    // Filter messages from Alice
    const aliceMessages = result.json.messages.filter(
      (m: any) => m.sender === aliceAid
    );

    expect(aliceMessages.length).toBeGreaterThanOrEqual(4);

    // Verify message content
    const contents = aliceMessages.map((m: any) => m.content);
    expect(contents).toContain("First message");
    expect(contents).toContain("Second message");
    expect(contents).toContain("Third message with some longer content");
    expect(contents).toContain("Fourth message");

    // All should be encrypted direct messages
    aliceMessages.forEach((m: any) => {
      expect(m.typ).toBe("encrypted");
      expect(m.id).toBeString();
    });

    console.log(`✓ Bob retrieved ${aliceMessages.length} message(s) from Alice`);
  }, 15000);

  it("bob filters unread by sender", async () => {
    const result = await runCliInProcess(["unread", "--from", aliceAid], {
      cwd: scenario.users.bob.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(result);

    // All messages should be from Alice
    const allFromAlice = result.json.messages.every(
      (m: any) => m.sender === aliceAid
    );
    expect(allFromAlice).toBe(true);

    console.log("✓ Filtered unread retrieval works");
  }, 15000);

  it("bob saves messages to file and extracts IDs", async () => {
    // Get unread messages
    const unreadResult = await runCliInProcess(["unread"], {
      cwd: scenario.users.bob.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(unreadResult);

    // Save to file
    const messagesFile = `${scenario.users.bob.dataDir}/messages.json`;
    writeJSON(messagesFile, unreadResult.json);

    // Extract IDs
    const extractResult = await runCliInProcess(
      ["extract-ids", "--file", messagesFile],
      {
        cwd: scenario.users.bob.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(extractResult);
    expect(Array.isArray(extractResult.json.ids)).toBe(true);
    expect(extractResult.json.ids.length).toBeGreaterThanOrEqual(4);

    console.log(`✓ Extracted ${extractResult.json.ids.length} message ID(s)`);
  }, 15000);

  it("bob marks first two messages as read", async () => {
    // Get current messages
    const unreadResult = await runCliInProcess(["unread"], {
      cwd: scenario.users.bob.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    const aliceMessages = unreadResult.json.messages.filter(
      (m: any) => m.sender === aliceAid
    );

    // Mark first two as read
    const idsToMark = aliceMessages.slice(0, 2).map((m: any) => m.id);

    const result = await runCliInProcess(
      ["mark-as-read", "--ids", idsToMark.join(",")],
      {
        cwd: scenario.users.bob.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(result);
    expect(result.json).toBeDefined();

    console.log(`✓ Marked ${idsToMark.length} message(s) as read`);
  }, 15000);

  it("bob should have fewer unread messages after marking", async () => {
    // Wait for propagation
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const result = await runCliInProcess(["unread"], {
      cwd: scenario.users.bob.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(result);

    const aliceMessages = result.json.messages.filter(
      (m: any) => m.sender === aliceAid
    );

    // Should have at least 2 fewer messages (marked as read and deleted)
    expect(aliceMessages.length).toBeLessThanOrEqual(2);

    console.log(`✓ Bob now has ${aliceMessages.length} unread message(s) from Alice`);
  }, 15000);

  it("bob marks remaining messages using IDs from file", async () => {
    // Get current messages
    const unreadResult = await runCliInProcess(["unread"], {
      cwd: scenario.users.bob.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(unreadResult);

    // Save to file
    const messagesFile = `${scenario.users.bob.dataDir}/remaining.json`;
    writeJSON(messagesFile, unreadResult.json);

    // Extract IDs
    const extractResult = await runCliInProcess(
      ["extract-ids", "--file", messagesFile],
      {
        cwd: scenario.users.bob.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(extractResult);

    // Save IDs to file
    const idsFile = `${scenario.users.bob.dataDir}/ids.json`;
    writeJSON(idsFile, { ids: extractResult.json.ids });

    // Mark using file
    const markResult = await runCliInProcess(
      ["mark-as-read", "--ids-data", idsFile],
      {
        cwd: scenario.users.bob.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(markResult);

    console.log(`✓ Marked remaining messages using IDs from file`);
  }, 30000);

  it("bob should have no unread messages from alice", async () => {
    // Wait for propagation
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const result = await runCliInProcess(["unread", "--from", aliceAid], {
      cwd: scenario.users.bob.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(result);

    // Should have no messages from Alice
    expect(result.json.messages.length).toBe(0);

    console.log("✓ All messages from Alice marked as read");
  }, 15000);
});

describe("E2E: Unread Pipeline Edge Cases", () => {
  it("should handle empty unread list gracefully", async () => {
    if (!CONVEX_URL || !BOOTSTRAP_KEY) return;

    const scenario = mkMultiUserScenario("unread-edge", ["user"]);
    const admin = await ensureAdminInitialised(CONVEX_URL!);

    const userResult = await runCliInProcess(
      ["incept", "--seed", "user-unread-edge"],
      {
        cwd: scenario.users.user.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );
    assertSuccess(userResult);

    // Get admin session token for this edge case test
    const edgeAdminSessionPath = join(scenario.users.user.root, "admin-session.json");
    await getAdminSessionToken(CONVEX_URL!, admin, {
      ttlMs: 60000,
      saveTo: edgeAdminSessionPath,
    });

    await runCliInProcess(
      [
        "users",
        "grant-role",
        userResult.json.aid,
        "user",
        "--token",
        edgeAdminSessionPath,
        "--actionSAID",
        "grant-user-edge",
      ],
      { env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! } }
    );

    // List unread (should be empty)
    const result = await runCliInProcess(["list-unread"], {
      cwd: scenario.users.user.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(result);
    expect(result.json.senders.length).toBe(0);

    console.log("✓ Empty unread list handled gracefully");

    scenario.cleanup();
  }, 60000);

  it("should handle marking non-existent message IDs", async () => {
    if (!CONVEX_URL || !BOOTSTRAP_KEY) return;

    const scenario = mkMultiUserScenario("mark-edge", ["user"]);

    await runCliInProcess(["incept", "--seed", "user-mark-edge"], {
      cwd: scenario.users.user.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    // Try to mark fake message ID
    const result = await runCliInProcess(
      ["mark-as-read", "--ids", "fake-id-123"],
      {
        cwd: scenario.users.user.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    // Should either succeed (idempotent) or fail gracefully
    // Implementation dependent
    expect(result.code).toBeOneOf([0, 1]);

    scenario.cleanup();
  }, 30000);
});
