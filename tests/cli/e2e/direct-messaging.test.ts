/**
 * E2E Test: Direct Messaging Flow
 *
 * Tests peer-to-peer encrypted direct messaging between users.
 * Verifies encryption, decryption, and bidirectional communication.
 *
 * Scenario:
 * 1. Create two users (alice, bob with user role)
 * 2. Alice sends encrypted DM to Bob
 * 3. Bob receives and decrypts message
 * 4. Bob replies to Alice
 * 5. Alice receives Bob's reply
 * 6. Test message content preservation
 * 7. Test special characters and unicode
 *
 * Priority: P1 (core messaging functionality)
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { runCliInProcess, assertSuccess } from "../helpers/exec";
import { ensureAdminInitialised, getAdminSessionToken, type AdminCredentials } from "../../helpers/admin-bootstrap";
import { mkMultiUserScenario } from "../helpers/workspace";
import { join } from "node:path";

// Only run if CONVEX_URL and BOOTSTRAP_KEY are set
const CONVEX_URL = process.env.CONVEX_URL;
const BOOTSTRAP_KEY = process.env.BOOTSTRAP_KEY;

const shouldRun = CONVEX_URL && BOOTSTRAP_KEY;
const runTests = shouldRun ? describe : describe.skip;

runTests("E2E: Direct Messaging Flow", () => {
  let scenario: ReturnType<typeof mkMultiUserScenario>;
  let admin: AdminCredentials;
  let adminSessionPath: string;
  let aliceAid: string;
  let bobAid: string;

  beforeAll(async () => {
    // Initialize admin
    admin = await ensureAdminInitialised(CONVEX_URL!);
    console.log(`✓ Admin initialized: ${admin.aid}`);

    // Create workspace
    scenario = mkMultiUserScenario("direct-messaging", ["alice", "bob"]);

    // Get admin session token (90 seconds should be enough for the test)
    adminSessionPath = join(scenario.root, "admin-session.json");
    await getAdminSessionToken(CONVEX_URL!, admin, {
      ttlMs: 90000,
      saveTo: adminSessionPath,
    });
    console.log(`✓ Admin session token created`);

    // Incept Alice
    const aliceResult = await runCliInProcess(
      ["incept", "--seed", "alice-dm-test"],
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
        "grant-alice-user-dm",
      ],
      { env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! } }
    );
    console.log(`✓ Alice incepted: ${aliceAid}`);

    // Incept Bob
    const bobResult = await runCliInProcess(
      ["incept", "--seed", "bob-dm-test"],
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
        "grant-bob-user-dm",
      ],
      { env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! } }
    );
    console.log(`✓ Bob incepted: ${bobAid}`);
  }, 90000);

  it("alice sends encrypted DM to bob", async () => {
    const result = await runCliInProcess(
      ["send", bobAid, "--message", "Hello Bob, this is Alice!"],
      {
        cwd: scenario.users.alice.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(result);
    expect(result.json).toBeDefined();
    expect(result.json.messageId).toBeString();
    expect(result.json.recipient).toBe(bobAid);
    expect(result.json.sentAt).toBeNumber();

    console.log(`✓ Alice sent DM to Bob`);
    console.log(`  Message ID: ${result.json.messageId}`);
  }, 15000);

  it("bob receives and decrypts alice's message", async () => {
    // Wait for propagation
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const result = await runCliInProcess(["unread"], {
      cwd: scenario.users.bob.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(result);
    expect(Array.isArray(result.json.messages)).toBe(true);

    // Find Alice's message
    const aliceMsg = result.json.messages.find(
      (m: any) => m.sender === aliceAid
    );

    expect(aliceMsg).toBeDefined();
    expect(aliceMsg.typ).toBe("encrypted");
    expect(aliceMsg.content).toBe("Hello Bob, this is Alice!");
    expect(aliceMsg.id).toBeString();
    expect(aliceMsg.sentAt).toBeNumber();

    console.log(`✓ Bob received and decrypted Alice's message`);
    console.log(`  Content: "${aliceMsg.content}"`);
  }, 15000);

  it("bob replies to alice", async () => {
    const result = await runCliInProcess(
      ["send", aliceAid, "--message", "Hi Alice! Great to hear from you."],
      {
        cwd: scenario.users.bob.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(result);
    expect(result.json.messageId).toBeDefined();
    expect(result.json.recipient).toBe(aliceAid);

    console.log(`✓ Bob sent reply to Alice`);
  }, 15000);

  it("alice receives bob's reply", async () => {
    // Wait for propagation
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const result = await runCliInProcess(["unread"], {
      cwd: scenario.users.alice.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(result);

    // Find Bob's message
    const bobMsg = result.json.messages.find(
      (m: any) => m.sender === bobAid
    );

    expect(bobMsg).toBeDefined();
    expect(bobMsg.typ).toBe("encrypted");
    expect(bobMsg.content).toBe("Hi Alice! Great to hear from you.");

    console.log(`✓ Alice received Bob's reply`);
  }, 15000);

  it("alice sends message with special characters", async () => {
    const specialMessage = 'Test: !@#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~';

    const sendResult = await runCliInProcess(
      ["send", bobAid, "--message", specialMessage],
      {
        cwd: scenario.users.alice.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(sendResult);

    // Wait for propagation
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Bob retrieves message
    const recvResult = await runCliInProcess(["unread"], {
      cwd: scenario.users.bob.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(recvResult);

    // Find message with special characters
    const specialMsg = recvResult.json.messages.find(
      (m: any) => m.content === specialMessage
    );

    expect(specialMsg).toBeDefined();
    expect(specialMsg.content).toBe(specialMessage);

    console.log(`✓ Special characters preserved through encryption`);
  }, 30000);

  it("alice sends message with unicode", async () => {
    const unicodeMessage = "Hello 世界! 🌍🚀💬 Testing unicode: café, naïve, 日本語";

    const sendResult = await runCliInProcess(
      ["send", bobAid, "--message", unicodeMessage],
      {
        cwd: scenario.users.alice.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(sendResult);

    // Wait for propagation
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Bob retrieves message
    const recvResult = await runCliInProcess(["unread"], {
      cwd: scenario.users.bob.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(recvResult);

    // Find unicode message
    const unicodeMsg = recvResult.json.messages.find(
      (m: any) => m.content.includes("世界")
    );

    expect(unicodeMsg).toBeDefined();
    expect(unicodeMsg.content).toBe(unicodeMessage);

    console.log(`✓ Unicode characters preserved through encryption`);
  }, 30000);

  it("alice sends long message", async () => {
    const longMessage = "A".repeat(1000) + " This is a long message test.";

    const sendResult = await runCliInProcess(
      ["send", bobAid, "--message", longMessage],
      {
        cwd: scenario.users.alice.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(sendResult);

    // Wait for propagation
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Bob retrieves message
    const recvResult = await runCliInProcess(["unread"], {
      cwd: scenario.users.bob.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(recvResult);

    // Find long message
    const longMsg = recvResult.json.messages.find(
      (m: any) => m.content === longMessage
    );

    expect(longMsg).toBeDefined();
    expect(longMsg.content.length).toBe(longMessage.length);

    console.log(`✓ Long message (${longMessage.length} chars) preserved`);
  }, 30000);

  it("alice sends multiline message", async () => {
    const multilineMessage = "Line 1\nLine 2\nLine 3\n\nLine 5 (with blank line above)";

    const sendResult = await runCliInProcess(
      ["send", bobAid, "--message", multilineMessage],
      {
        cwd: scenario.users.alice.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(sendResult);

    // Wait for propagation
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Bob retrieves message
    const recvResult = await runCliInProcess(["unread"], {
      cwd: scenario.users.bob.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(recvResult);

    // Find multiline message
    const multilineMsg = recvResult.json.messages.find(
      (m: any) => m.content.includes("Line 1\nLine 2")
    );

    expect(multilineMsg).toBeDefined();
    expect(multilineMsg.content).toBe(multilineMessage);

    console.log(`✓ Multiline message preserved`);
  }, 30000);

  it("bidirectional messaging works simultaneously", async () => {
    // Both send messages at roughly the same time
    const alicePromise = runCliInProcess(
      ["send", bobAid, "--message", "Message from Alice"],
      {
        cwd: scenario.users.alice.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    const bobPromise = runCliInProcess(
      ["send", aliceAid, "--message", "Message from Bob"],
      {
        cwd: scenario.users.bob.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    const [aliceResult, bobResult] = await Promise.all([alicePromise, bobPromise]);

    assertSuccess(aliceResult);
    assertSuccess(bobResult);

    console.log(`✓ Bidirectional simultaneous messaging works`);
  }, 30000);
});

describe("E2E: Direct Messaging Edge Cases", () => {
  it("should fail when sending to non-existent recipient", async () => {
    if (!CONVEX_URL || !BOOTSTRAP_KEY) return;

    const scenario = mkMultiUserScenario("dm-edge", ["alice"]);
    const admin = await ensureAdminInitialised(CONVEX_URL!);

    // Get admin session token
    const adminSessionPath = join(scenario.root, "admin-session.json");
    await getAdminSessionToken(CONVEX_URL!, admin, {
      ttlMs: 60000,
      saveTo: adminSessionPath,
    });

    const aliceResult = await runCliInProcess(
      ["incept", "--seed", "alice-dm-edge"],
      {
        cwd: scenario.users.alice!.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );
    assertSuccess(aliceResult);

    await runCliInProcess(
      [
        "users",
        "grant-role",
        aliceResult.json.aid,
        "user",
        "--token",
        adminSessionPath,
        "--actionSAID",
        "grant-alice-edge",
      ],
      { env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! } }
    );

    // Try to send to non-existent AID
    const result = await runCliInProcess(
      ["send", "DNonExistentAid123", "--message", "test"],
      {
        cwd: scenario.users.alice!.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    // Should fail
    expect(result.code).not.toBe(0);

    scenario.cleanup();
  }, 60000);

  it("should handle empty message gracefully", async () => {
    if (!CONVEX_URL || !BOOTSTRAP_KEY) return;

    const scenario = mkMultiUserScenario("empty-msg", ["alice", "bob"]);
    const admin = await ensureAdminInitialised(CONVEX_URL!);

    // Get admin session token
    const adminSessionPath = join(scenario.root, "admin-session.json");
    await getAdminSessionToken(CONVEX_URL!, admin, {
      ttlMs: 60000,
      saveTo: adminSessionPath,
    });

    const aliceResult = await runCliInProcess(
      ["incept", "--seed", "alice-empty"],
      {
        cwd: scenario.users.alice!.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );
    assertSuccess(aliceResult);

    await runCliInProcess(
      [
        "users",
        "grant-role",
        aliceResult.json.aid,
        "user",
        "--token",
        adminSessionPath,
        "--actionSAID",
        "grant-alice-empty",
      ],
      { env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! } }
    );

    const bobResult = await runCliInProcess(
      ["incept", "--seed", "bob-empty"],
      {
        cwd: scenario.users.bob!.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );
    assertSuccess(bobResult);

    await runCliInProcess(
      [
        "users",
        "grant-role",
        bobResult.json.aid,
        "user",
        "--token",
        adminSessionPath,
        "--actionSAID",
        "grant-bob-empty",
      ],
      { env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! } }
    );

    // Send empty message
    const result = await runCliInProcess(
      ["send", bobResult.json.aid, "--message", ""],
      {
        cwd: scenario.users.alice!.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    // Should either succeed or fail gracefully
    // Implementation dependent
    expect(result.code).toBeOneOf([0, 1]);

    scenario.cleanup();
  }, 90000);
});
