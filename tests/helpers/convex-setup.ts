/**
 * Shared Convex setup utilities for integration tests
 */

import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { generateKeyPair, createAID, encodeCESRKey } from "./crypto-utils";

export interface TestUser {
  aid: string;
  keys: {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  };
  credentials: {
    aid: string;
    privateKey: Uint8Array;
    ksn: number;
  };
}

export interface ConvexTestContext {
  convex: ConvexClient;
  alice: TestUser;
  bob: TestUser;
  cleanup: () => void;
}

/**
 * Bootstrap a test environment with Convex and two test users (Alice and Bob)
 */
export async function setupConvexTest(): Promise<ConvexTestContext> {
  const convexUrl = process.env.CONVEX_URL;

  if (!convexUrl) {
    throw new Error("CONVEX_URL environment variable is not set");
  }

  const convex = new ConvexClient(convexUrl);

  // Generate keypairs for test users
  const aliceKeys = await generateKeyPair();
  const bobKeys = await generateKeyPair();

  const aliceAid = createAID(aliceKeys.publicKey);
  const bobAid = createAID(bobKeys.publicKey);

  // Register key states
  await convex.mutation(api.auth.registerKeyState, {
    aid: aliceAid,
    ksn: 0,
    keys: [encodeCESRKey(aliceKeys.publicKey)],
    threshold: "1",
    lastEvtSaid: "EAAA",
  });

  await convex.mutation(api.auth.registerKeyState, {
    aid: bobAid,
    ksn: 0,
    keys: [encodeCESRKey(bobKeys.publicKey)],
    threshold: "1",
    lastEvtSaid: "EBBB",
  });

  // Setup test helpers (reset admin roles, bootstrap super admin)
  await convex.mutation(api._test_helpers.resetAdminRoles, {});
  await convex.mutation(api._test_helpers.bootstrapSuperAdmin, {
    aid: aliceAid,
  });

  const alice: TestUser = {
    aid: aliceAid,
    keys: aliceKeys,
    credentials: {
      aid: aliceAid,
      privateKey: aliceKeys.privateKey,
      ksn: 0,
    },
  };

  const bob: TestUser = {
    aid: bobAid,
    keys: bobKeys,
    credentials: {
      aid: bobAid,
      privateKey: bobKeys.privateKey,
      ksn: 0,
    },
  };

  return {
    convex,
    alice,
    bob,
    cleanup: () => convex.close(),
  };
}

/**
 * Sleep utility for tests
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
