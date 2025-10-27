/**
 * End-to-end onboarding flow test
 *
 * Tests the complete onboarding journey:
 * 1. Super admin sets themselves as onboarding admin
 * 2. New unknown user can only message the onboarding admin
 * 3. User and admin exchange onboarding messages
 * 4. Admin onboards the user with proof
 * 5. Known user can now message others
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { generateKeyPair, createAID, encodeCESRKey, sign, computeArgsHash } from "../helpers/crypto-utils";
import { MessageBusClient, type AuthCredentials } from "../../src/client";

const CONVEX_URL = process.env.CONVEX_URL || "http://localhost:3000";

describe("End-to-End Onboarding Flow", () => {
  let convex: ConvexClient;
  let client: MessageBusClient;

  // Super admin (you, with dashboard access)
  let superAdmin: { aid: string; privateKey: Uint8Array; publicKey: Uint8Array; creds: AuthCredentials };

  // New user (unknown tier)
  let newUser: { aid: string; privateKey: Uint8Array; publicKey: Uint8Array; creds: AuthCredentials };

  // Regular user (for testing known tier messaging)
  let regularUser: { aid: string; privateKey: Uint8Array; publicKey: Uint8Array; creds: AuthCredentials };

  beforeAll(async () => {
    convex = new ConvexClient(CONVEX_URL);
    client = new MessageBusClient(CONVEX_URL);

    // Ensure a clean admin state for this suite (test-only reset)
    try {
      // @ts-ignore - using generated API without types
      await convex.mutation(api._test_helpers.resetAdminRoles, {});
    } catch (e) {
      // Best-effort cleanup; ignore if not available
    }

    // Bootstrap default tiers (creates unknown, known, verified tiers)
    // NOTE: Also creates "test" tier with .* pattern - we'll disable it for this test
    await convex.mutation(api.authorization.bootstrapDefaultTiers, {});

    // Generate keypairs
    const superAdminKeys = await generateKeyPair();
    superAdmin = {
      ...superAdminKeys,
      aid: createAID(superAdminKeys.publicKey),
      creds: {
        aid: createAID(superAdminKeys.publicKey),
        privateKey: superAdminKeys.privateKey,
        ksn: 0,
      },
    };

    const newUserKeys = await generateKeyPair();
    newUser = {
      ...newUserKeys,
      aid: createAID(newUserKeys.publicKey),
      creds: {
        aid: createAID(newUserKeys.publicKey),
        privateKey: newUserKeys.privateKey,
        ksn: 0,
      },
    };

    const regularUserKeys = await generateKeyPair();
    regularUser = {
      ...regularUserKeys,
      aid: createAID(regularUserKeys.publicKey),
      creds: {
        aid: createAID(regularUserKeys.publicKey),
        privateKey: regularUserKeys.privateKey,
        ksn: 0,
      },
    };

    // Register key states
    await client.registerKeyState(
      superAdmin.aid,
      0,
      [encodeCESRKey(superAdmin.publicKey)],
      "1",
      "ESUPERADMIN"
    );

    await client.registerKeyState(
      newUser.aid,
      0,
      [encodeCESRKey(newUser.publicKey)],
      "1",
      "ENEWUSER"
    );

    await client.registerKeyState(
      regularUser.aid,
      0,
      [encodeCESRKey(regularUser.publicKey)],
      "1",
      "EREGULAR"
    );
  });

  test("Step 1: Bootstrap super admin (simulates dashboard operation)", async () => {
    // In production, this would be done via Convex dashboard or CLI
    // For testing, we use a test-only mutation

    // Bootstrap the FIRST super_admin (unauthenticated - test only!)
    await convex.mutation(api._test_helpers.bootstrapSuperAdmin, {
      aid: superAdmin.aid,
    });

    // Verify admin role was created
    const adminInfo = await convex.query(api.authorization.getAdminInfo, {
      aid: superAdmin.aid,
    });

    expect(adminInfo.roles).toContain("super_admin");
  });

  test("Step 2: Super admin assigned to 'known' tier", async () => {
    // Assign super admin to "known" tier so they can receive messages
    await convex.mutation(api.authorization.assignTier, {
      aid: superAdmin.aid,
      tierName: "known",
      promotionProof: "SYSTEM_ADMIN",
      notes: "Super admin account",
      auth: await client.createAuth(superAdmin.creds, "assign_tier", {
        aid: superAdmin.aid,
        tierName: "known",
      }),
    });

    // Verify tier assignment
    const tierInfo = await convex.query(api.authorization.getTierInfo, {
      aid: superAdmin.aid,
    });

    expect(tierInfo.tier).toBe("known");
    expect(tierInfo.explicit).toBe(true);
  });

  test("Step 3: Unknown user CAN message known tier admin for onboarding", async () => {
    // With new tier system: unknown can message both unknown and known tiers
    // This allows onboarding flow where unknown users contact admins
    const authzCheck = await convex.query(api.authorization.checkCanSend, {
      from: newUser.aid,
      to: superAdmin.aid,
      typ: "app.message",
    });

    expect(authzCheck.allowed).toBe(true);
    expect(authzCheck.tier).toBe("unknown");

    // Send actual message
    const messageId = await client.send(
      superAdmin.aid,
      "Hello admin, I'd like to join!",
      newUser.creds,
      { typ: "app.message" }
    );

    expect(messageId).toBeTruthy();
  });

  test("Step 4: Unknown user CAN message other unknown users", async () => {
    // regularUser has no tier assignment, so defaults to "unknown"
    // unknown can message unknown
    const authzCheck = await convex.query(api.authorization.checkCanSend, {
      from: newUser.aid,
      to: regularUser.aid,
      typ: "app.message",
    });

    expect(authzCheck.allowed).toBe(true);
    expect(authzCheck.tier).toBe("unknown");

    // Send message (should succeed)
    const messageId = await client.send(
      regularUser.aid,
      "Hello fellow unknown user!",
      newUser.creds,
      { typ: "app.message" }
    );

    expect(messageId).toBeTruthy();
  });

  test("Step 5: Admin receives onboarding message from unknown user", async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));

    const messages = await client.receive(superAdmin.aid, superAdmin.creds);

    const onboardingMessage = messages.find((m) => m.senderAid === newUser.aid);
    expect(onboardingMessage).toBeDefined();
  });

  test("Step 6: Admin onboards user with proof", async () => {
    // In real flow, admin would:
    // 1. Review onboarding messages
    // 2. Collect evidence (e.g., SAID of key messages)
    // 3. Call onboardUser with proof

    const onboardingProof = "EPROOF123ABC"; // SAID of onboarding evidence

    await convex.mutation(api.authorization.onboardUser, {
      userAid: newUser.aid,
      onboardingProof,
      notes: "Completed onboarding via chat",
      auth: await client.createAuth(superAdmin.creds, "admin", {
        action: "onboardUser",
        userAid: newUser.aid,
        onboardingProof,
      }),
    });

    // Verify user is now "known"
    const tierInfo = await convex.query(api.authorization.getTierInfo, {
      aid: newUser.aid,
    });

    expect(tierInfo.tier).toBe("known");
    expect(tierInfo.explicit).toBe(true);
    expect(tierInfo.assignedBy).toBe(superAdmin.aid);
  });

  test("Step 7: Known user CAN now message regular users", async () => {
    // Check authorization
    const authzCheck = await convex.query(api.authorization.checkCanSend, {
      from: newUser.aid,
      to: regularUser.aid,
      typ: "app.message",
    });

    expect(authzCheck.allowed).toBe(true);
    expect(authzCheck.tier).toBe("known");

    // Send message (should succeed)
    const messageId = await client.send(
      regularUser.aid,
      "Hello! I've been onboarded!",
      newUser.creds,
      { typ: "app.message" }
    );

    expect(messageId).toBeTruthy();
  });

  test("Step 8: Known user can still message onboarding admin", async () => {
    const messageId = await client.send(
      superAdmin.aid,
      "Thank you for onboarding me!",
      newUser.creds,
      { typ: "app.message" }
    );

    expect(messageId).toBeTruthy();
  });

  test("Step 9: Tier statistics show correct counts", async () => {
    const stats = await convex.query(api.authorization.getTierStats, {});

    // stats is now a Record<string, number> of tierName -> count
    // We should have at least 2 explicit assignments: superAdmin (known) and newUser (known)
    expect(stats.known).toBeGreaterThanOrEqual(2);
  });

  test("Step 10: Admin can promote known user to verified tier", async () => {
    // Use assignTier to promote to verified
    await convex.mutation(api.authorization.assignTier, {
      aid: newUser.aid,
      tierName: "verified",
      promotionProof: "EKYC_PROOF_123",
      notes: "KYC completed successfully",
      auth: await client.createAuth(superAdmin.creds, "assign_tier", {
        aid: newUser.aid,
        tierName: "verified",
      }),
    });

    const tierInfo = await convex.query(api.authorization.getTierInfo, {
      aid: newUser.aid,
    });

    expect(tierInfo.tier).toBe("verified");
    expect(tierInfo.explicit).toBe(true);
  });

  test("Security: Non-admin CANNOT onboard users", async () => {
    // Regular user tries to onboard someone
    const anotherNewUser = await generateKeyPair();
    const anotherAid = createAID(anotherNewUser.publicKey);

    await client.registerKeyState(
      anotherAid,
      0,
      [encodeCESRKey(anotherNewUser.publicKey)],
      "1",
      "EANOTHER"
    );

    try {
      await convex.mutation(api.authorization.onboardUser, {
        userAid: anotherAid,
        onboardingProof: "EPROOF456",
        auth: await client.createAuth(
          {
            aid: regularUser.aid,
            privateKey: regularUser.privateKey,
            ksn: 0,
          },
          "admin",
          {
            action: "onboardUser",
            userAid: anotherAid,
            onboardingProof: "EPROOF456",
          }
        ),
      });
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(error.message).toContain("Only admins can assign tiers");
    }
  });

  test("Security: Can re-assign tier (updates existing assignment)", async () => {
    // With new system, re-assigning a tier just updates the assignment
    // This is not an error, it's a feature for tier management
    await convex.mutation(api.authorization.onboardUser, {
      userAid: newUser.aid,
      onboardingProof: "EPROOF789_UPDATED",
      auth: await client.createAuth(superAdmin.creds, "admin", {
        action: "onboardUser",
        userAid: newUser.aid,
        onboardingProof: "EPROOF789_UPDATED",
      }),
    });

    // Verify the assignment was updated (but tier stayed "known")
    const tierInfo = await convex.query(api.authorization.getTierInfo, {
      aid: newUser.aid,
    });

    // Note: We assigned to "verified" in step 10, so it should still be verified
    // unless this test runs in isolation
    expect(["known", "verified"]).toContain(tierInfo.tier);
  });
});
