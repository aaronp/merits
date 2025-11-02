/**
 * E2E Test: User Inception Flow
 *
 * Tests the complete user inception workflow using deterministic seeds.
 * Creates admin, alice, and bob users via the `incept` command.
 *
 * Scenario:
 * 1. Admin inception with deterministic seed
 * 2. Alice inception with deterministic seed
 * 3. Bob inception with deterministic seed
 * 4. Verify all users have valid AIDs, keys, and session tokens
 * 5. Verify whoami works for each user
 *
 * Priority: P0 (fundamental user creation flow)
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { runCliInProcess, assertSuccess } from "../helpers/exec";
import { mkMultiUserScenario } from "../helpers/workspace";

// Only run if CONVEX_URL is set
const CONVEX_URL = process.env.CONVEX_URL;

// Skip tests if no backend configured
const runTests = CONVEX_URL ? describe : describe.skip;

runTests("E2E: User Inception", () => {
  let scenario: ReturnType<typeof mkMultiUserScenario>;
  let adminAid: string;
  let aliceAid: string;
  let bobAid: string;

  beforeAll(() => {
    scenario = mkMultiUserScenario("incept-users", ["admin", "alice", "bob"]);
  });

  it("should incept admin user with deterministic seed", async () => {
    const result = await runCliInProcess(
      ["incept", "--seed", "admin-e2e-seed"],
      {
        cwd: scenario.users.admin.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    assertSuccess(result);

    // Verify response structure
    expect(result.json).toBeDefined();
    expect(result.json.aid).toBeString();
    expect(result.json.keys).toBeDefined();
    expect(result.json.keys.privateKey).toBeString();
    expect(result.json.keys.publicKey).toBeString();
    expect(result.json.challenge).toBeDefined();
    expect(result.json.session).toBeDefined();
    expect(result.json.session.token).toBeString();
    expect(result.json.session.aid).toBe(result.json.aid);

    // AID should start with 'D' or 'E' (CESR encoding)
    expect(result.json.aid).toMatch(/^[DE]/);

    // Save for later tests
    adminAid = result.json.aid;

    console.log(`✓ Admin AID: ${adminAid}`);
  }, 15000);

  it("should verify admin session with whoami", async () => {
    const result = await runCliInProcess(["whoami"], {
      cwd: scenario.users.admin.root,
      env: {
        MERITS_VAULT_QUIET: "1",
        CONVEX_URL: CONVEX_URL!,
      },
    });

    assertSuccess(result);

    expect(result.json).toBeDefined();
    expect(result.json.session).toBeDefined();
    expect(result.json.session.active).toBe(true);
    expect(result.json.session.aid).toBe(adminAid);
  }, 10000);

  it("should incept alice user with deterministic seed", async () => {
    const result = await runCliInProcess(
      ["incept", "--seed", "alice-e2e-seed"],
      {
        cwd: scenario.users.alice.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    assertSuccess(result);

    // Verify response structure
    expect(result.json).toBeDefined();
    expect(result.json.aid).toBeString();
    expect(result.json.aid).toMatch(/^[DE]/);
    expect(result.json.keys).toBeDefined();
    expect(result.json.session).toBeDefined();
    expect(result.json.session.token).toBeString();

    // Should have different AID than admin
    expect(result.json.aid).not.toBe(adminAid);

    aliceAid = result.json.aid;
    console.log(`✓ Alice AID: ${aliceAid}`);
  }, 15000);

  it("should verify alice session with whoami", async () => {
    const result = await runCliInProcess(["whoami"], {
      cwd: scenario.users.alice.root,
      env: {
        MERITS_VAULT_QUIET: "1",
        CONVEX_URL: CONVEX_URL!,
      },
    });

    assertSuccess(result);

    expect(result.json.session.active).toBe(true);
    expect(result.json.session.aid).toBe(aliceAid);
  }, 10000);

  it("should incept bob user with deterministic seed", async () => {
    const result = await runCliInProcess(
      ["incept", "--seed", "bob-e2e-seed"],
      {
        cwd: scenario.users.bob.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    assertSuccess(result);

    // Verify response structure
    expect(result.json).toBeDefined();
    expect(result.json.aid).toBeString();
    expect(result.json.aid).toMatch(/^[DE]/);
    expect(result.json.keys).toBeDefined();
    expect(result.json.session).toBeDefined();
    expect(result.json.session.token).toBeString();

    // Should have different AID than admin and alice
    expect(result.json.aid).not.toBe(adminAid);
    expect(result.json.aid).not.toBe(aliceAid);

    bobAid = result.json.aid;
    console.log(`✓ Bob AID: ${bobAid}`);
  }, 15000);

  it("should verify bob session with whoami", async () => {
    const result = await runCliInProcess(["whoami"], {
      cwd: scenario.users.bob.root,
      env: {
        MERITS_VAULT_QUIET: "1",
        CONVEX_URL: CONVEX_URL!,
      },
    });

    assertSuccess(result);

    expect(result.json.session.active).toBe(true);
    expect(result.json.session.aid).toBe(bobAid);
  }, 10000);

  it("should produce same AIDs when using same seeds", async () => {
    // Create second admin with same seed
    const result = await runCliInProcess(
      ["incept", "--seed", "admin-e2e-seed"],
      {
        cwd: scenario.root, // Use root directory (different from admin's)
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    assertSuccess(result);

    // Should produce same AID as first admin
    expect(result.json.aid).toBe(adminAid);

    console.log("✓ Deterministic key generation confirmed");
  }, 15000);

  it("should fetch public keys for all users", async () => {
    // Admin fetches Alice's public key
    const aliceKeyResult = await runCliInProcess(["key-for", aliceAid], {
      cwd: scenario.users.admin.root,
      env: {
        MERITS_VAULT_QUIET: "1",
        CONVEX_URL: CONVEX_URL!,
      },
    });

    assertSuccess(aliceKeyResult);
    expect(aliceKeyResult.json.aid).toBe(aliceAid);
    expect(aliceKeyResult.json.publicKey).toBeString();
    expect(aliceKeyResult.json.ksn).toBeDefined();

    // Bob fetches Admin's public key
    const adminKeyResult = await runCliInProcess(["key-for", adminAid], {
      cwd: scenario.users.bob.root,
      env: {
        MERITS_VAULT_QUIET: "1",
        CONVEX_URL: CONVEX_URL!,
      },
    });

    assertSuccess(adminKeyResult);
    expect(adminKeyResult.json.aid).toBe(adminAid);
    expect(adminKeyResult.json.publicKey).toBeString();

    console.log("✓ Public key fetching works");
  }, 10000);
});

describe("E2E: User Inception Edge Cases", () => {
  it("should fail gracefully with invalid CONVEX_URL", async () => {
    const result = await runCliInProcess(
      ["incept", "--seed", "test-seed"],
      {
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: "https://invalid.example.com",
        },
      }
    );

    // Should fail
    expect(result.code).not.toBe(0);
    expect(result.stderr).toBeDefined();
  }, 10000);

  it("should handle empty seed gracefully", async () => {
    if (!CONVEX_URL) return;

    const result = await runCliInProcess(
      ["incept", "--seed", ""],
      {
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    // Empty seed should still work (produces deterministic but different keys)
    assertSuccess(result);
    expect(result.json.aid).toBeDefined();
  }, 15000);
});
