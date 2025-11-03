/**
 * E2E Test: Role Upgrade (anon → user)
 *
 * Tests the role upgrade flow where admin grants elevated permissions.
 * Demonstrates RBAC enforcement and role-based capability progression.
 *
 * Scenario:
 * 1. Bootstrap system (admin with admin role)
 * 2. Create test user (Alice - starts with anon role)
 * 3. Verify Alice cannot create groups (anon limitation)
 * 4. Admin grants Alice the 'user' role
 * 5. Verify Alice can now create groups
 * 6. Alice creates a group and adds members
 *
 * Priority: P0 (core RBAC functionality)
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { runCliInProcess, assertSuccess, assertFailure } from "../helpers/exec";
import { ensureAdminInitialised, type AdminCredentials } from "../../helpers/admin-bootstrap";
import { mkMultiUserScenario } from "../helpers/workspace";

// Only run if CONVEX_URL and BOOTSTRAP_KEY are set
const CONVEX_URL = process.env.CONVEX_URL;
const BOOTSTRAP_KEY = process.env.BOOTSTRAP_KEY;

const shouldRun = CONVEX_URL && BOOTSTRAP_KEY;
const runTests = shouldRun ? describe : describe.skip;

runTests("E2E: Role Upgrade (anon → user)", () => {
  let scenario: ReturnType<typeof mkMultiUserScenario>;
  let admin: AdminCredentials;
  let aliceAid: string;
  let bobAid: string;

  beforeAll(async () => {
    // Initialize admin
    admin = await ensureAdminInitialised(CONVEX_URL!);
    console.log(`✓ Admin initialized: ${admin.aid}`);

    // Create workspace for alice and bob
    scenario = mkMultiUserScenario("role-upgrade", ["alice", "bob"]);

    // Incept Alice
    const aliceResult = await runCliInProcess(
      ["incept", "--seed", "alice-role-test"],
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
    console.log(`✓ Alice incepted: ${aliceAid}`);

    // Incept Bob
    const bobResult = await runCliInProcess(
      ["incept", "--seed", "bob-role-test"],
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
    console.log(`✓ Bob incepted: ${bobAid}`);
  });

  it("alice (anon role) should fail to create group", async () => {
    const result = await runCliInProcess(
      ["group", "create", "Alice Private Group"],
      {
        cwd: scenario.users.alice.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    // Should fail - anon users cannot create groups
    assertFailure(result);
    expect(result.stderr).toBeDefined();

    // Error should mention permission/role issue
    // (exact error message may vary based on backend implementation)
    console.log("✓ Alice (anon) correctly blocked from creating group");
  }, 15000);

  it("admin should grant 'user' role to alice", async () => {
    // Use stable action SAID for testing
    const actionSAID = "test-grant-alice-user-role-action";

    const result = await runCliInProcess(
      [
        "users",
        "grant-role",
        aliceAid,
        "user",
        "--adminAID",
        admin.aid,
        "--actionSAID",
        actionSAID,
      ],
      {
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    assertSuccess(result);
    expect(result.json).toBeDefined();

    console.log("✓ Admin granted 'user' role to Alice");
  }, 15000);

  it("alice (user role) should successfully create group", async () => {
    const result = await runCliInProcess(
      ["group", "create", "Alice Private Group"],
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
    expect(result.json.groupId).toBeDefined();

    console.log(`✓ Alice (user) successfully created group: ${result.json.groupId}`);
  }, 15000);

  it("alice should be able to list her groups", async () => {
    const result = await runCliInProcess(["group", "list"], {
      cwd: scenario.users.alice.root,
      env: {
        MERITS_VAULT_QUIET: "1",
        CONVEX_URL: CONVEX_URL!,
      },
    });

    assertSuccess(result);
    expect(result.json).toBeDefined();
    expect(Array.isArray(result.json.groups)).toBe(true);
    expect(result.json.groups.length).toBeGreaterThan(0);

    // Should include the group Alice created
    const aliceGroup = result.json.groups.find(
      (g: any) => g.name === "Alice Private Group"
    );
    expect(aliceGroup).toBeDefined();

    console.log(`✓ Alice can see ${result.json.groups.length} group(s)`);
  }, 15000);

  it("bob (anon role) should still fail to create group", async () => {
    const result = await runCliInProcess(
      ["group", "create", "Bob Private Group"],
      {
        cwd: scenario.users.bob.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    // Bob still has anon role, should fail
    assertFailure(result);

    console.log("✓ Bob (anon) still blocked from creating group");
  }, 15000);

  it("admin should be able to grant multiple roles", async () => {
    // Grant user role to Bob too
    const result = await runCliInProcess(
      [
        "users",
        "grant-role",
        bobAid,
        "user",
        "--adminAID",
        admin.aid,
        "--actionSAID",
        "test-grant-bob-user-role-action",
      ],
      {
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    assertSuccess(result);

    // Now Bob should be able to create groups
    const bobGroupResult = await runCliInProcess(
      ["group", "create", "Bob Private Group"],
      {
        cwd: scenario.users.bob.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    assertSuccess(bobGroupResult);
    expect(bobGroupResult.json.groupId).toBeDefined();

    console.log("✓ Bob can create groups after receiving 'user' role");
  }, 30000);
});

describe("E2E: Role Upgrade Edge Cases", () => {
  it("should fail gracefully when granting non-existent role", async () => {
    if (!CONVEX_URL || !BOOTSTRAP_KEY) return;

    const admin = await ensureAdminInitialised(CONVEX_URL!);

    const result = await runCliInProcess(
      [
        "users",
        "grant-role",
        "DTestAid123",
        "non-existent-role",
        "--adminAID",
        admin.aid,
        "--actionSAID",
        "test-invalid-role",
      ],
      {
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    // Should fail - role doesn't exist
    assertFailure(result);
  }, 15000);

  it("should fail when non-admin tries to grant role", async () => {
    if (!CONVEX_URL || !BOOTSTRAP_KEY) return;

    // Create a regular user (alice)
    const scenario = mkMultiUserScenario("role-edge", ["alice"]);
    const aliceResult = await runCliInProcess(
      ["incept", "--seed", "alice-edge-test"],
      {
        cwd: scenario.users.alice.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );
    assertSuccess(aliceResult);
    const aliceAid = aliceResult.json.aid;

    // Alice tries to grant a role (should fail - she's not admin)
    const result = await runCliInProcess(
      [
        "users",
        "grant-role",
        "DTestAid456",
        "user",
        "--adminAID",
        aliceAid, // Alice is not admin
        "--actionSAID",
        "test-unauthorized-grant",
      ],
      {
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    // Should fail - Alice doesn't have admin permissions
    assertFailure(result);

    scenario.cleanup();
  }, 30000);
});
