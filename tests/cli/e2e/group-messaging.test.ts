/**
 * E2E Test: Group Messaging (Cohort) - Token-Based
 *
 * Tests zero-knowledge group messaging with token-based authentication.
 * Backend handles all encryption/decryption.
 *
 * Scenario:
 * 1. Bootstrap system (admin with admin role)
 * 2. Create test users (Alice, Bob with user role)
 * 3. Admin grants user roles
 * 4. Alice creates a cohort group
 * 5. Alice adds Bob as member
 * 6. Alice sends group message
 * 7. Bob receives group message (decrypted by backend)
 * 8. Bob sends reply
 * 9. Alice receives reply
 * 10. Alice removes Bob from group
 *
 * Priority: P0 (core group messaging functionality)
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { runCliInProcess, assertSuccess } from "../helpers/exec";
import {
  ensureAdminInitialised,
  getAdminSessionToken,
  getSessionToken,
  type AdminCredentials
} from "../../helpers/admin-bootstrap";
import { mkMultiUserScenario } from "../helpers/workspace";
import { writeFileSync } from "fs";
import { join } from "path";
import { base64UrlToUint8Array } from "../../../core/crypto";

// Only run if CONVEX_URL and BOOTSTRAP_KEY are set
const CONVEX_URL = process.env.CONVEX_URL;
const BOOTSTRAP_KEY = process.env.BOOTSTRAP_KEY;

const shouldRun = CONVEX_URL && BOOTSTRAP_KEY;
const runTests = shouldRun ? describe : describe.skip;

runTests("E2E: Group Messaging (Cohort) - Token-Based", () => {
  let scenario: ReturnType<typeof mkMultiUserScenario>;
  let admin: AdminCredentials;
  let adminToken: { token: string; aid: string; ksn: number; expiresAt: number };
  let aliceAid: string;
  let aliceIdentityPath: string;
  let bobAid: string;
  let bobIdentityPath: string;
  let groupId: string;

  beforeAll(async () => {
    // Initialize admin and get admin session token
    admin = await ensureAdminInitialised(CONVEX_URL!);
    adminToken = await getAdminSessionToken(CONVEX_URL!, admin, { ttlMs: 60000 });
    console.log(`✓ Admin initialized: ${admin.aid}`);

    // Create workspace for alice and bob
    scenario = mkMultiUserScenario("group-messaging-token", ["alice", "bob"]);

    // Use unique timestamp to avoid conflicts with previous test runs
    const timestamp = Date.now();

    // === Alice Setup ===
    // 1. Incept Alice (creates identity with keys and session token)
    const aliceResult = await runCliInProcess(
      ["incept", "--seed", `alice-group-token-test-${timestamp}`],
      {
        cwd: scenario.users.alice.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );
    assertSuccess(aliceResult);

    // Save Alice's identity file
    aliceIdentityPath = join(scenario.users.alice.root, "identity.json");
    writeFileSync(aliceIdentityPath, JSON.stringify(aliceResult.json, null, 2));
    aliceAid = aliceResult.json.aid;
    console.log(`✓ Alice incepted: ${aliceAid}`);

    // 2. Admin grants Alice user role (using admin token)
    // Save admin token to temp file for CLI use
    const adminTokenPath = join(scenario.users.alice.root, "admin-token.json");
    writeFileSync(adminTokenPath, JSON.stringify(adminToken, null, 2));

    const grantAliceResult = await runCliInProcess(
      [
        "users",
        "grant-role",
        aliceAid,
        "user",
        "--token",
        adminTokenPath,
      ],
      {
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );
    assertSuccess(grantAliceResult);
    console.log(`✓ Alice granted user role`);

    // === Bob Setup ===
    // 1. Incept Bob
    const bobResult = await runCliInProcess(
      ["incept", "--seed", `bob-group-token-test-${timestamp}`],
      {
        cwd: scenario.users.bob.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );
    assertSuccess(bobResult);

    // Save Bob's identity file
    bobIdentityPath = join(scenario.users.bob.root, "identity.json");
    writeFileSync(bobIdentityPath, JSON.stringify(bobResult.json, null, 2));
    bobAid = bobResult.json.aid;
    console.log(`✓ Bob incepted: ${bobAid}`);

    // 2. Admin grants Bob user role
    const bobAdminTokenPath = join(scenario.users.bob.root, "admin-token.json");
    writeFileSync(bobAdminTokenPath, JSON.stringify(adminToken, null, 2));

    const grantBobResult = await runCliInProcess(
      [
        "users",
        "grant-role",
        bobAid,
        "user",
        "--token",
        bobAdminTokenPath,
      ],
      {
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );
    assertSuccess(grantBobResult);
    console.log(`✓ Bob granted user role`);
  }, 60000);

  it("alice should create a cohort group", async () => {
    const result = await runCliInProcess(
      ["group", "create", "Intro Cohort A", "--token", aliceIdentityPath],
      {
        cwd: scenario.users.alice.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    assertSuccess(result);
    expect(result.json).toBeDefined();
    expect(result.json.groupId).toBeString();
    expect(result.json.name).toBe("Intro Cohort A");

    groupId = result.json.groupId;
    console.log(`✓ Alice created group: ${groupId}`);
  }, 15000);

  it("alice should add bob to the group", async () => {
    const result = await runCliInProcess(
      ["group", "add", groupId, bobAid, "--token", aliceIdentityPath],
      {
        cwd: scenario.users.alice.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    assertSuccess(result);
    console.log(`✓ Alice added Bob to group`);
  }, 15000);

  it("should show both alice and bob in group info", async () => {
    const result = await runCliInProcess(
      ["group", "info", groupId, "--token", aliceIdentityPath],
      {
        cwd: scenario.users.alice.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    assertSuccess(result);
    expect(result.json).toBeDefined();
    expect(result.json.group).toBeDefined();
    expect(result.json.group.name).toBe("Intro Cohort A");
    expect(Array.isArray(result.json.members)).toBe(true);

    // Should have both Alice (owner) and Bob (member)
    expect(result.json.members.length).toBeGreaterThanOrEqual(2);

    const aliceMember = result.json.members.find((m: any) => m.aid === aliceAid);
    const bobMember = result.json.members.find((m: any) => m.aid === bobAid);

    expect(aliceMember).toBeDefined();
    expect(bobMember).toBeDefined();

    console.log(`✓ Group has ${result.json.members.length} members`);
  }, 15000);

  it("alice should send group message", async () => {
    const result = await runCliInProcess(
      ["send", groupId, "--message", "Hello cohort! Welcome to the group.", "--token", aliceIdentityPath],
      {
        cwd: scenario.users.alice.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    assertSuccess(result);
    expect(result.json).toBeDefined();
    expect(result.json.messageId).toBeDefined();
    expect(result.json.recipient).toBe(groupId);

    console.log(`✓ Alice sent group message: ${result.json.messageId}`);
  }, 15000);

  it("bob should receive alice's group message (backend-decrypted)", async () => {
    // Wait a moment for message propagation
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const result = await runCliInProcess(
      ["unread", "--token", bobIdentityPath],
      {
        cwd: scenario.users.bob.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    assertSuccess(result);
    expect(result.json).toBeDefined();
    expect(Array.isArray(result.json)).toBe(true);

    // Find the group message from Alice
    const groupMsg = result.json.find(
      (m: any) => m.groupId === groupId && m.from === aliceAid
    );

    expect(groupMsg).toBeDefined();
    expect(groupMsg.isGroupMessage).toBe(true);
    // Backend decrypts, so we should have plaintext message
    expect(groupMsg.message).toBe("Hello cohort! Welcome to the group.");

    console.log(`✓ Bob received backend-decrypted group message`);
    console.log(`  Content: "${groupMsg.message}"`);
  }, 15000);

  it("bob should send reply to group", async () => {
    const result = await runCliInProcess(
      ["send", groupId, "--message", "Thanks Alice! Happy to be here.", "--token", bobIdentityPath],
      {
        cwd: scenario.users.bob.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    assertSuccess(result);
    expect(result.json.messageId).toBeDefined();

    console.log(`✓ Bob sent reply to group`);
  }, 15000);

  it("alice should receive bob's reply (backend-decrypted)", async () => {
    // Wait for message propagation
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const result = await runCliInProcess(
      ["unread", "--token", aliceIdentityPath],
      {
        cwd: scenario.users.alice.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    assertSuccess(result);

    // Find Bob's reply
    const bobReply = result.json.find(
      (m: any) => m.groupId === groupId && m.from === bobAid
    );

    expect(bobReply).toBeDefined();
    expect(bobReply.isGroupMessage).toBe(true);
    expect(bobReply.message).toBe("Thanks Alice! Happy to be here.");

    console.log(`✓ Alice received Bob's reply (backend-decrypted)`);
  }, 15000);

  it("alice should be able to remove bob from group", async () => {
    const result = await runCliInProcess(
      ["group", "remove", groupId, bobAid, "--token", aliceIdentityPath],
      {
        cwd: scenario.users.alice.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    assertSuccess(result);
    console.log(`✓ Alice removed Bob from group`);

    // Verify Bob is no longer in group
    const infoResult = await runCliInProcess(
      ["group", "info", groupId, "--token", aliceIdentityPath],
      {
        cwd: scenario.users.alice.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    assertSuccess(infoResult);

    const bobMember = infoResult.json.members.find((m: any) => m.aid === bobAid);
    expect(bobMember).toBeUndefined();

    console.log(`✓ Verified Bob is no longer in group`);
  }, 30000);
});

describe("E2E: Group Messaging Edge Cases - Token-Based", () => {
  it("should fail when non-member tries to send group message", async () => {
    if (!CONVEX_URL || !BOOTSTRAP_KEY) return;

    // Use unique timestamp to avoid conflicts
    const timestamp = Date.now();
    const scenario = mkMultiUserScenario("group-edge-token", ["alice", "charlie"]);
    const admin = await ensureAdminInitialised(CONVEX_URL!);
    const adminToken = await getAdminSessionToken(CONVEX_URL!, admin, { ttlMs: 60000 });

    // Create Alice with user role
    const aliceResult = await runCliInProcess(
      ["incept", "--seed", `alice-edge-group-token-${timestamp}`],
      {
        cwd: scenario.users.alice.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );
    assertSuccess(aliceResult);

    const aliceIdentityPath = join(scenario.users.alice.root, "identity.json");
    writeFileSync(aliceIdentityPath, JSON.stringify(aliceResult.json, null, 2));
    const aliceAid = aliceResult.json.aid;

    // Grant Alice user role
    const adminTokenPath = join(scenario.users.alice.root, "admin-token.json");
    writeFileSync(adminTokenPath, JSON.stringify(adminToken, null, 2));

    await runCliInProcess(
      ["users", "grant-role", aliceAid, "user", "--token", adminTokenPath],
      { env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! } }
    );

    // Create Charlie (no user role granted)
    const charlieResult = await runCliInProcess(
      ["incept", "--seed", `charlie-edge-group-token-${timestamp}`],
      {
        cwd: scenario.users.charlie.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );
    assertSuccess(charlieResult);

    const charlieIdentityPath = join(scenario.users.charlie.root, "identity.json");
    writeFileSync(charlieIdentityPath, JSON.stringify(charlieResult.json, null, 2));

    // Alice creates group
    const groupResult = await runCliInProcess(
      ["group", "create", "Alice Only Group", "--token", aliceIdentityPath],
      {
        cwd: scenario.users.alice.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );
    assertSuccess(groupResult);
    const groupId = groupResult.json.groupId;

    // Charlie tries to send message (should fail - not a member)
    const sendResult = await runCliInProcess(
      ["send", groupId, "--message", "Can I join?", "--token", charlieIdentityPath],
      {
        cwd: scenario.users.charlie.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    // Should fail
    expect(sendResult.code).not.toBe(0);

    scenario.cleanup();
  }, 60000);
});
