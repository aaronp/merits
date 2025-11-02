/**
 * E2E Test: Allow/Deny List Precedence
 *
 * Tests the allow-list and deny-list functionality for message access control.
 * Verifies precedence rules: deny-list always wins, allow-list enables default-deny.
 *
 * Scenario:
 * 1. Bootstrap system, create users (alice, bob, charlie with user role)
 * 2. Test default behavior (all users can message each other)
 * 3. Alice adds Bob to allow-list → activates default-deny mode
 * 4. Alice can receive from Bob, but not Charlie
 * 5. Alice adds Bob to deny-list → denies even though on allow-list
 * 6. Alice removes Bob from deny-list → works again
 * 7. Test list management (list, clear)
 *
 * Priority: P2 (access control features)
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

runTests("E2E: Allow/Deny List Precedence", () => {
  let scenario: ReturnType<typeof mkMultiUserScenario>;
  let admin: AdminCredentials;
  let aliceAid: string;
  let bobAid: string;
  let charlieAid: string;

  beforeAll(async () => {
    // Initialize admin
    admin = await ensureAdminInitialised(CONVEX_URL!);
    console.log(`✓ Admin initialized: ${admin.aid}`);

    // Create workspace
    scenario = mkMultiUserScenario("allow-deny", ["alice", "bob", "charlie"]);

    // Incept all users and grant them 'user' role
    for (const [name, user] of Object.entries(scenario.users)) {
      const result = await runCliInProcess(
        ["incept", "--seed", `${name}-allow-deny-test`],
        {
          cwd: user.root,
          env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
        }
      );
      assertSuccess(result);

      const aid = result.json.aid;

      // Grant user role
      await runCliInProcess(
        [
          "users",
          "grant-role",
          aid,
          "user",
          "--adminAID",
          admin.aid,
          "--actionSAID",
          `grant-${name}-user-allow-deny`,
        ],
        {
          env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
        }
      );

      if (name === "alice") aliceAid = aid;
      if (name === "bob") bobAid = aid;
      if (name === "charlie") charlieAid = aid;

      console.log(`✓ ${name} incepted and granted user role: ${aid}`);
    }
  }, 90000);

  it("alice should receive messages from bob and charlie (default: allow all)", async () => {
    // Bob sends to Alice
    const bobResult = await runCliInProcess(
      ["send", aliceAid, "--message", "Hi Alice from Bob"],
      {
        cwd: scenario.users.bob.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );
    assertSuccess(bobResult);

    // Charlie sends to Alice
    const charlieResult = await runCliInProcess(
      ["send", aliceAid, "--message", "Hi Alice from Charlie"],
      {
        cwd: scenario.users.charlie.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );
    assertSuccess(charlieResult);

    console.log("✓ Default behavior: Alice receives messages from all users");
  }, 30000);

  it("alice adds bob to allow-list (activates default-deny)", async () => {
    const result = await runCliInProcess(
      ["access", "allow", bobAid, "--note", "trusted friend"],
      {
        cwd: scenario.users.alice.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(result);
    expect(result.json).toBeDefined();

    console.log("✓ Alice added Bob to allow-list");
  }, 15000);

  it("alice should list allow-list and see bob", async () => {
    const result = await runCliInProcess(["access", "list", "--allow"], {
      cwd: scenario.users.alice.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(result);
    expect(result.json).toBeDefined();
    expect(Array.isArray(result.json.entries)).toBe(true);
    expect(result.json.active).toBe(true); // Allow-list is now active

    // Bob should be in the list
    const bobEntry = result.json.entries.find((e: any) => e.aid === bobAid);
    expect(bobEntry).toBeDefined();
    expect(bobEntry.note).toBe("trusted friend");

    console.log(`✓ Allow-list shows ${result.json.entries.length} entry(ies)`);
  }, 15000);

  it("charlie should now fail to send to alice (not on allow-list)", async () => {
    const result = await runCliInProcess(
      ["send", aliceAid, "--message", "Hello from Charlie again"],
      {
        cwd: scenario.users.charlie.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    // Should fail - Charlie is not on allow-list (default-deny active)
    assertFailure(result);

    console.log("✓ Charlie (not on allow-list) blocked from messaging Alice");
  }, 15000);

  it("bob should still succeed sending to alice (on allow-list)", async () => {
    const result = await runCliInProcess(
      ["send", aliceAid, "--message", "Another message from Bob"],
      {
        cwd: scenario.users.bob.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(result);

    console.log("✓ Bob (on allow-list) can still message Alice");
  }, 15000);

  it("alice adds bob to deny-list (deny takes precedence)", async () => {
    const result = await runCliInProcess(
      ["access", "deny", bobAid, "--note", "changed my mind"],
      {
        cwd: scenario.users.alice.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(result);

    console.log("✓ Alice added Bob to deny-list");
  }, 15000);

  it("bob should now fail to send to alice (deny-list takes precedence)", async () => {
    const result = await runCliInProcess(
      ["send", aliceAid, "--message", "Can I still message?"],
      {
        cwd: scenario.users.bob.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    // Should fail - Bob is on deny-list (even though also on allow-list)
    assertFailure(result);

    console.log("✓ Bob (on deny-list) blocked even though on allow-list");
  }, 15000);

  it("alice should list deny-list and see bob", async () => {
    const result = await runCliInProcess(["access", "list", "--deny"], {
      cwd: scenario.users.alice.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(result);
    expect(Array.isArray(result.json.entries)).toBe(true);

    const bobEntry = result.json.entries.find((e: any) => e.aid === bobAid);
    expect(bobEntry).toBeDefined();
    expect(bobEntry.note).toBe("changed my mind");

    console.log("✓ Deny-list shows Bob");
  }, 15000);

  it("alice removes bob from deny-list", async () => {
    const result = await runCliInProcess(
      ["access", "remove", bobAid, "--deny"],
      {
        cwd: scenario.users.alice.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(result);

    console.log("✓ Alice removed Bob from deny-list");
  }, 15000);

  it("bob should now succeed again (removed from deny, still on allow)", async () => {
    const result = await runCliInProcess(
      ["send", aliceAid, "--message", "Can I message now?"],
      {
        cwd: scenario.users.bob.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(result);

    console.log("✓ Bob can message again after deny removal");
  }, 15000);

  it("alice clears allow-list (returns to allow-all mode)", async () => {
    const result = await runCliInProcess(["access", "clear", "--allow"], {
      cwd: scenario.users.alice.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(result);

    console.log("✓ Alice cleared allow-list");
  }, 15000);

  it("charlie should now succeed (allow-list cleared, default-deny off)", async () => {
    const result = await runCliInProcess(
      ["send", aliceAid, "--message", "Can I message now?"],
      {
        cwd: scenario.users.charlie.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(result);

    console.log("✓ Charlie can message after allow-list cleared");
  }, 15000);

  it("alice should verify allow-list is empty and inactive", async () => {
    const result = await runCliInProcess(["access", "list", "--allow"], {
      cwd: scenario.users.alice.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(result);
    expect(result.json.entries.length).toBe(0);
    expect(result.json.active).toBe(false); // Allow-list is inactive

    console.log("✓ Allow-list is empty and inactive");
  }, 15000);
});

describe("E2E: Allow/Deny List Edge Cases", () => {
  it("should handle adding same AID to allow-list twice", async () => {
    if (!CONVEX_URL || !BOOTSTRAP_KEY) return;

    const scenario = mkMultiUserScenario("allow-edge", ["alice", "bob"]);
    const admin = await ensureAdminInitialised(CONVEX_URL!);

    // Create and setup users
    const aliceResult = await runCliInProcess(
      ["incept", "--seed", "alice-allow-edge"],
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

    const bobResult = await runCliInProcess(
      ["incept", "--seed", "bob-allow-edge"],
      {
        cwd: scenario.users.bob.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );
    assertSuccess(bobResult);
    const bobAid = bobResult.json.aid;

    // Add Bob to allow-list
    await runCliInProcess(["access", "allow", bobAid], {
      cwd: scenario.users.alice.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    // Add Bob again (should handle gracefully)
    const result = await runCliInProcess(["access", "allow", bobAid, "--note", "updated note"], {
      cwd: scenario.users.alice.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    // Should succeed (either update or idempotent)
    assertSuccess(result);

    console.log("✓ Duplicate allow-list add handled gracefully");

    scenario.cleanup();
  }, 60000);

  it("should fail when trying to list without --allow or --deny flag", async () => {
    if (!CONVEX_URL) return;

    const scenario = mkMultiUserScenario("list-edge", ["alice"]);

    await runCliInProcess(["incept", "--seed", "alice-list-edge"], {
      cwd: scenario.users.alice.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    // Try to list without specifying which list
    const result = await runCliInProcess(["access", "list"], {
      cwd: scenario.users.alice.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    // Should fail - must specify --allow or --deny
    assertFailure(result);

    scenario.cleanup();
  }, 30000);
});
