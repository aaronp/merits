/**
 * Example test demonstrating ensureAdminInitialised() usage
 *
 * This is a reference implementation showing how to use the admin bootstrap helper
 * in your tests. Copy this pattern to your test files.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { ensureAdminInitialised, resetAdminSeed, getCurrentAdminSeed, type AdminCredentials } from "./admin-bootstrap";

// Only run this test if CONVEX_URL is set
const CONVEX_URL = process.env.CONVEX_URL;

if (CONVEX_URL) {
  describe("Admin Bootstrap Helper (Example)", () => {
  let admin: AdminCredentials;

  beforeAll(async () => {
    // This is the main pattern - call this once in beforeAll
    admin = await ensureAdminInitialised(CONVEX_URL!);
  });

  it("should initialize admin with valid credentials", () => {
    expect(admin.aid).toBeString();
    expect(admin.aid).toStartWith("D"); // CESR encoding
    expect(admin.privateKey).toBeString();
    expect(admin.publicKey).toBeString();
    expect(admin.privateKeyBytes).toBeInstanceOf(Uint8Array);
    expect(admin.publicKeyBytes).toBeInstanceOf(Uint8Array);
    expect(admin.seed).toBeString();
  });

  it("should use consistent AID across calls", async () => {
    // Call again - should return same admin
    const admin2 = await ensureAdminInitialised(CONVEX_URL!);
    expect(admin2.aid).toBe(admin.aid);
    expect(admin2.privateKey).toBe(admin.privateKey);
    expect(admin2.publicKey).toBe(admin.publicKey);
  });

  it("should read seed from .admin-seed file", () => {
    const currentSeed = getCurrentAdminSeed();
    expect(currentSeed).toBe(admin.seed);
  });

  it("should bootstrap system idempotently", async () => {
    // Multiple calls should be safe
    const admin1 = await ensureAdminInitialised(CONVEX_URL!);
    const admin2 = await ensureAdminInitialised(CONVEX_URL!);
    const admin3 = await ensureAdminInitialised(CONVEX_URL!);

    expect(admin1.aid).toBe(admin2.aid);
    expect(admin2.aid).toBe(admin3.aid);
  });
});

describe("Admin Bootstrap Helper - Advanced Usage", () => {
  it("can use custom seed", async () => {
    const customAdmin = await ensureAdminInitialised(CONVEX_URL!, {
      seed: "custom-test-seed-12345",
      skipBootstrap: true, // Skip backend calls for this test
    });

    expect(customAdmin.seed).toBe("custom-test-seed-12345");
    expect(customAdmin.aid).toBeString();
  });

  it("can skip bootstrap for unit tests", async () => {
    // For pure unit tests that don't need backend
    const admin = await ensureAdminInitialised(CONVEX_URL!, {
      skipBootstrap: true,
    });

    // Still get valid credentials, just no backend calls
    expect(admin.aid).toBeString();
    expect(admin.privateKeyBytes.length).toBe(32);
  });
});

// Uncomment to test reset functionality (destructive!)
// describe("Admin Reset", { skip: !shouldRun }, () => {
//   it("can reset admin seed", async () => {
//     const admin1 = await ensureAdminInitialised(CONVEX_URL!);
//     const seed1 = admin1.seed;
//
//     // Reset will delete .admin-seed file
//     resetAdminSeed();
//
//     // Next call will generate new admin
//     const admin2 = await ensureAdminInitialised(CONVEX_URL!, { force: true });
//     const seed2 = admin2.seed;
//
//     // Seeds should be the same (default seed), but you could generate random
//     expect(seed2).toBe(seed1); // Both use DEFAULT_ADMIN_SEED
//   });
// });

/**
 * Real-world usage examples
 */
describe("Real-World Patterns", () => {
  it("Pattern 1: Admin creates a role", async () => {
    const admin = await ensureAdminInitialised(CONVEX_URL!);

    // Now you can use admin credentials to:
    // - Create roles
    // - Grant permissions
    // - Assign roles to users
    // - Any admin-level operation

    expect(admin.aid).toBeString();
    // In real test: call your mutations/queries with admin.aid, admin.privateKeyBytes, etc.
  });

  it("Pattern 2: Admin + Regular Users", async () => {
    const admin = await ensureAdminInitialised(CONVEX_URL!);

    // Create regular test users
    // const alice = await createTestUser("alice-test-seed");
    // const bob = await createTestUser("bob-test-seed");

    // Admin can grant roles
    // await grantRole(admin, alice.aid, "user");
    // await grantRole(admin, bob.aid, "user");

    expect(admin.aid).toBeString();
  });

  it("Pattern 3: Integration tests with admin setup", async () => {
    // Typical integration test structure:
    // 1. Initialize admin
    const admin = await ensureAdminInitialised(CONVEX_URL!);

    // 2. Set up test data (groups, permissions, etc.)
    // await createTestGroup(admin, "test-group");

    // 3. Run test scenarios
    // await testGroupMessaging(admin, testGroup);

    // 4. Clean up (optional, or use separate test DB)
    // await cleanupTestData();

    expect(admin.aid).toBeString();
  });
});
}
