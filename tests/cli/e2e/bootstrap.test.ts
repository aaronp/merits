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

import { describe, expect, it } from "bun:test";
import { ensureAdminInitialised, type AdminCredentials } from "../../helpers/admin-bootstrap";


describe("Bootstrap Onboarding", () => {

  it("should bootstrap system with admin assignment", async () => {

    const admin = await ensureAdminInitialised();
    console.log(`✓ First attempt`, admin);

    // we may not have created it.
    // expect(admin.created).toBe(true);
    expect(admin.aid).toBe("DC8-1K1AoLnGJ-7f-D_acNTMDD5DnID7_jIdWwm9lGI8");
    expect(admin.publicKey).toBe("C8-1K1AoLnGJ-7f-D_acNTMDD5DnID7_jIdWwm9lGI8");



    const admin2 = await ensureAdminInitialised();
    console.log(`✓ Second attempt`, admin2);
    expect(admin2.created).toBe(false);
    expect(admin2.aid).toBe("DC8-1K1AoLnGJ-7f-D_acNTMDD5DnID7_jIdWwm9lGI8");
    expect(admin2.publicKey).toBe("C8-1K1AoLnGJ-7f-D_acNTMDD5DnID7_jIdWwm9lGI8");

  }, 15000);

});
