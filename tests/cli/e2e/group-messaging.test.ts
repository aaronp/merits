/**
 * E2E Test: Group Messaging (Cohort)
 *
 * Tests zero-knowledge group messaging where admin creates a cohort group
 * and members can send/receive encrypted group messages.
 *
 * Scenario:
 * 1. Bootstrap system (admin with admin role)
 * 2. Create test users (Alice, Bob with user role)
 * 3. Admin creates a cohort group
 * 4. Admin adds Alice and Bob as members
 * 5. Alice sends group message
 * 6. Bob receives and decrypts group message
 * 7. Verify group info shows all members
 *
 * Priority: P0 (core group messaging functionality)
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { runCliInProcess, assertSuccess } from "../helpers/exec";
import { ensureAdminInitialised, type AdminCredentials } from "../../helpers/admin-bootstrap";
import { mkMultiUserScenario } from "../helpers/workspace";

// Only run if CONVEX_URL and BOOTSTRAP_KEY are set
const CONVEX_URL = process.env.CONVEX_URL;
const BOOTSTRAP_KEY = process.env.BOOTSTRAP_KEY;

const shouldRun = CONVEX_URL && BOOTSTRAP_KEY;
const runTests = shouldRun ? describe : describe.skip;

runTests("E2E: Group Messaging (Cohort)", () => {
  let scenario: ReturnType<typeof mkMultiUserScenario>;
  let admin: AdminCredentials;
  let aliceAid: string;
  let bobAid: string;
  let groupId: string;

  beforeAll(async () => {
    // Initialize admin
    admin = await ensureAdminInitialised(CONVEX_URL!);
    console.log(`✓ Admin initialized: ${admin.aid}`);

    // Create workspace for alice and bob
    scenario = mkMultiUserScenario("group-messaging", ["alice", "bob"]);

    // Incept Alice
    const aliceResult = await runCliInProcess(
      ["incept", "--seed", "alice-group-test"],
      {
        cwd: scenario.users.alice.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
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
        "--adminAID",
        admin.aid,
        "--actionSAID",
        "grant-alice-user-group-test",
      ],
      {
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );
    console.log(`✓ Alice incepted and granted user role: ${aliceAid}`);

    // Incept Bob
    const bobResult = await runCliInProcess(
      ["incept", "--seed", "bob-group-test"],
      {
        cwd: scenario.users.bob.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
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
        "--adminAID",
        admin.aid,
        "--actionSAID",
        "grant-bob-user-group-test",
      ],
      {
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );
    console.log(`✓ Bob incepted and granted user role: ${bobAid}`);
  }, 60000);

  it("alice should create a cohort group", async () => {
    const result = await runCliInProcess(
      ["group", "create", "Intro Cohort A"],
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
      ["group", "add", groupId, bobAid, "--role", "member"],
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
    const result = await runCliInProcess(["group", "info", groupId], {
      cwd: scenario.users.alice.root,
      env: {
        MERITS_VAULT_QUIET: "1",
        CONVEX_URL: CONVEX_URL!,
      },
    });

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
      ["send", groupId, "--message", "Hello cohort! Welcome to the group."],
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
    expect(result.json.groupId).toBe(groupId);

    console.log(`✓ Alice sent group message: ${result.json.messageId}`);
  }, 15000);

  it("bob should receive and decrypt alice's group message", async () => {
    // Wait a moment for message propagation
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const result = await runCliInProcess(["unread"], {
      cwd: scenario.users.bob.root,
      env: {
        MERITS_VAULT_QUIET: "1",
        CONVEX_URL: CONVEX_URL!,
      },
    });

    assertSuccess(result);
    expect(result.json).toBeDefined();
    expect(Array.isArray(result.json.messages)).toBe(true);

    // Find the group message from Alice
    const groupMsg = result.json.messages.find(
      (m: any) => m.groupId === groupId && m.sender === aliceAid
    );

    expect(groupMsg).toBeDefined();
    expect(groupMsg.typ).toBe("group-encrypted");
    expect(groupMsg.content).toBe("Hello cohort! Welcome to the group.");

    console.log(`✓ Bob received and decrypted group message`);
    console.log(`  Content: "${groupMsg.content}"`);
  }, 15000);

  it("bob should send reply to group", async () => {
    const result = await runCliInProcess(
      ["send", groupId, "--message", "Thanks Alice! Happy to be here."],
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

  it("alice should receive bob's reply", async () => {
    // Wait for message propagation
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const result = await runCliInProcess(["unread"], {
      cwd: scenario.users.alice.root,
      env: {
        MERITS_VAULT_QUIET: "1",
        CONVEX_URL: CONVEX_URL!,
      },
    });

    assertSuccess(result);

    // Find Bob's reply
    const bobReply = result.json.messages.find(
      (m: any) => m.groupId === groupId && m.sender === bobAid
    );

    expect(bobReply).toBeDefined();
    expect(bobReply.typ).toBe("group-encrypted");
    expect(bobReply.content).toBe("Thanks Alice! Happy to be here.");

    console.log(`✓ Alice received Bob's reply`);
  }, 15000);

  it("alice should be able to remove bob from group", async () => {
    const result = await runCliInProcess(
      ["group", "remove", groupId, bobAid],
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
    const infoResult = await runCliInProcess(["group", "info", groupId], {
      cwd: scenario.users.alice.root,
      env: {
        MERITS_VAULT_QUIET: "1",
        CONVEX_URL: CONVEX_URL!,
      },
    });

    assertSuccess(infoResult);

    const bobMember = infoResult.json.members.find((m: any) => m.aid === bobAid);
    expect(bobMember).toBeUndefined();

    console.log(`✓ Verified Bob is no longer in group`);
  }, 30000);
});

describe("E2E: Group Messaging Edge Cases", () => {
  it("should fail when non-member tries to send group message", async () => {
    if (!CONVEX_URL || !BOOTSTRAP_KEY) return;

    const scenario = mkMultiUserScenario("group-edge", ["alice", "charlie"]);
    const admin = await ensureAdminInitialised(CONVEX_URL!);

    // Create Alice with user role
    const aliceResult = await runCliInProcess(
      ["incept", "--seed", "alice-edge-group"],
      {
        cwd: scenario.users.alice.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );
    assertSuccess(aliceResult);
    const aliceAid = aliceResult.json.aid;

    await runCliInProcess(
      [
        "users",
        "grant-role",
        aliceAid,
        "user",
        "--adminAID",
        admin.aid,
        "--actionSAID",
        "grant-alice-edge",
      ],
      { env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! } }
    );

    // Create Charlie
    const charlieResult = await runCliInProcess(
      ["incept", "--seed", "charlie-edge-group"],
      {
        cwd: scenario.users.charlie.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );
    assertSuccess(charlieResult);

    // Alice creates group
    const groupResult = await runCliInProcess(
      ["group", "create", "Alice Only Group"],
      {
        cwd: scenario.users.alice.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );
    assertSuccess(groupResult);
    const groupId = groupResult.json.groupId;

    // Charlie tries to send message (should fail - not a member)
    const sendResult = await runCliInProcess(
      ["send", groupId, "--message", "Can I join?"],
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
