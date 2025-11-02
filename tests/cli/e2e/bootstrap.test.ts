/**
 * E2E Test: Bootstrap Onboarding
 *
 * Tests the bootstrap process that creates initial roles and permissions.
 * Uses ensureAdminInitialised() helper for persistent admin user.
 *
 * Scenario:
 * 1. Initialize admin user with ensureAdminInitialised()
 * 2. Run bootstrap command to create roles (anon, user, admin)
 * 3. Verify admin has admin role assigned
 * 4. Verify bootstrap is idempotent (can run multiple times)
 * 5. Verify onboarding group exists
 *
 * Priority: P1 (system initialization)
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { runCliInProcess, assertSuccess } from "../helpers/exec";
import { ensureAdminInitialised, type AdminCredentials } from "../../helpers/admin-bootstrap";

// Only run if CONVEX_URL and BOOTSTRAP_KEY are set
const CONVEX_URL = process.env.CONVEX_URL;
const BOOTSTRAP_KEY = process.env.BOOTSTRAP_KEY;

// Skip tests if no backend configured or bootstrap disabled
const shouldRun = CONVEX_URL && BOOTSTRAP_KEY;
const runTests = shouldRun ? describe : describe.skip;

runTests("E2E: Bootstrap Onboarding", () => {
  let admin: AdminCredentials;

  beforeAll(async () => {
    // Ensure admin is initialized (uses .admin-seed file)
    admin = await ensureAdminInitialised(CONVEX_URL!);
    console.log(`✓ Admin initialized: ${admin.aid}`);
  });

  it("should bootstrap system with admin assignment", async () => {
    const result = await runCliInProcess(
      ["rbac:bootstrap-onboarding", "--admin-aid", admin.aid],
      {
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
          BOOTSTRAP_KEY: BOOTSTRAP_KEY!,
        },
      }
    );

    assertSuccess(result);

    // Verify response structure
    expect(result.json).toBeDefined();
    expect(result.json.ok).toBe(true);
    expect(result.json.message).toBeString();

    // Should have created roles and group
    expect(result.json.onboardingGroupId).toBeDefined();
    expect(result.json.anonRoleId).toBeDefined();
    expect(result.json.userRoleId).toBeDefined();
    expect(result.json.adminRoleId).toBeDefined();
    expect(result.json.adminAid).toBe(admin.aid);

    console.log("✓ Bootstrap completed successfully");
    console.log(`  Onboarding Group: ${result.json.onboardingGroupId}`);
    console.log(`  Admin Role: ${result.json.adminRoleId}`);
    console.log(`  User Role: ${result.json.userRoleId}`);
    console.log(`  Anon Role: ${result.json.anonRoleId}`);
  }, 15000);

  it("should be idempotent (safe to run multiple times)", async () => {
    // Run bootstrap again
    const result = await runCliInProcess(
      ["rbac:bootstrap-onboarding", "--admin-aid", admin.aid],
      {
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
          BOOTSTRAP_KEY: BOOTSTRAP_KEY!,
        },
      }
    );

    assertSuccess(result);

    // Should return already:true
    expect(result.json.ok).toBe(true);
    expect(result.json.already).toBe(true);
    expect(result.json.message).toContain("already bootstrapped");

    console.log("✓ Bootstrap is idempotent");
  }, 15000);

  it("should fail without BOOTSTRAP_KEY", async () => {
    const result = await runCliInProcess(
      ["rbac:bootstrap-onboarding", "--admin-aid", admin.aid],
      {
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
          // BOOTSTRAP_KEY not set
        },
      }
    );

    // Should fail
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("BOOTSTRAP_DISABLED");

    console.log("✓ Bootstrap correctly requires BOOTSTRAP_KEY");
  }, 10000);

  it("should allow bootstrap without admin-aid parameter", async () => {
    // Bootstrap can be called without admin-aid (just creates roles, no assignment)
    // This should still work since system is already bootstrapped (idempotent)
    const result = await runCliInProcess(["rbac:bootstrap-onboarding"], {
      env: {
        MERITS_VAULT_QUIET: "1",
        CONVEX_URL: CONVEX_URL!,
        BOOTSTRAP_KEY: BOOTSTRAP_KEY!,
      },
    });

    assertSuccess(result);
    expect(result.json.ok).toBe(true);

    console.log("✓ Bootstrap works without admin-aid parameter");
  }, 15000);
});

describe("E2E: Bootstrap Edge Cases", () => {
  it("should fail gracefully with invalid CONVEX_URL", async () => {
    if (!BOOTSTRAP_KEY) return;

    const result = await runCliInProcess(["rbac:bootstrap-onboarding"], {
      env: {
        MERITS_VAULT_QUIET: "1",
        CONVEX_URL: "https://invalid.example.com",
        BOOTSTRAP_KEY: BOOTSTRAP_KEY!,
      },
    });

    // Should fail with network error
    expect(result.code).not.toBe(0);
  }, 10000);

  it("should show helpful error when backend is misconfigured", async () => {
    if (!BOOTSTRAP_KEY) return;

    const result = await runCliInProcess(["rbac:bootstrap-onboarding"], {
      env: {
        MERITS_VAULT_QUIET: "1",
        CONVEX_URL: "http://localhost:99999", // Invalid port
        BOOTSTRAP_KEY: BOOTSTRAP_KEY!,
      },
    });

    // Should fail
    expect(result.code).not.toBe(0);
    expect(result.stderr).toBeDefined();
  }, 10000);
});
