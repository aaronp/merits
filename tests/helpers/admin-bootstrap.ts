/**
 * Admin Bootstrap Test Helper
 *
 * Provides `ensureAdminInitialised()` for dev and test environments.
 * Creates a deterministic admin user that persists across test runs via `.admin-seed` file.
 *
 * Usage:
 *   const admin = await ensureAdminInitialised();
 *   // admin.aid, admin.privateKey, admin.publicKey available
 *
 * Features:
 * - Idempotent: safe to call multiple times
 * - Deterministic: uses seed from .admin-seed file
 * - Auto-bootstrap: creates roles, permissions, and assigns admin
 * - Git-ignored: .admin-seed is not committed
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { generateKeyPair, createAID, signPayload, sha256 } from "../../core/crypto";
import * as ed from "@noble/ed25519";

/**
 * Admin credentials returned by ensureAdminInitialised
 */
export interface AdminCredentials {
  /** Admin AID (CESR-encoded) */
  aid: string;
  /** Private key (base64url) */
  privateKey: string;
  /** Public key (base64url) */
  publicKey: string;
  /** Private key bytes (for signing) */
  privateKeyBytes: Uint8Array;
  /** Public key bytes */
  publicKeyBytes: Uint8Array;
  /** Seed used to generate keys (for reference) */
  seed: string;
}

/**
 * Project root directory (parent of tests/)
 */
const PROJECT_ROOT = join(__dirname, "../..");

/**
 * Path to .admin-seed file
 */
const ADMIN_SEED_PATH = join(PROJECT_ROOT, ".admin-seed");

/**
 * Default admin seed for dev environments
 * This is used if .admin-seed doesn't exist and no seed is provided
 */
const DEFAULT_ADMIN_SEED = "admin-dev-seed-default";

/**
 * Ensure admin user is initialized and bootstrapped
 *
 * This function:
 * 1. Checks for .admin-seed file
 * 2. If not found, uses default seed and saves to .admin-seed
 * 3. Generates keys from seed (deterministic)
 * 4. Calls backend bootstrap if needed (idempotent)
 * 5. Returns admin credentials
 *
 * Safe to call multiple times - idempotent.
 *
 * @param convexUrl - Convex backend URL (required)
 * @param options - Optional configuration
 * @returns Admin credentials
 *
 * @example
 * ```typescript
 * import { ensureAdminInitialised } from "./helpers/admin-bootstrap";
 *
 * describe("Admin tests", () => {
 *   let admin: AdminCredentials;
 *
 *   beforeAll(async () => {
 *     admin = await ensureAdminInitialised(process.env.CONVEX_URL!);
 *   });
 *
 *   it("admin can create roles", async () => {
 *     // Use admin.aid, admin.privateKey, etc.
 *   });
 * });
 * ```
 */
export async function ensureAdminInitialised(
  convexUrl: string,
  options: {
    /** Force regeneration of admin seed (useful for reset) */
    force?: boolean;
    /** Custom seed to use (overrides .admin-seed file) */
    seed?: string;
    /** Skip bootstrap call (only generate keys) */
    skipBootstrap?: boolean;
  } = {}
): Promise<AdminCredentials> {
  if (!convexUrl) {
    throw new Error("CONVEX_URL is required for admin initialization");
  }

  // Check BOOTSTRAP_KEY environment variable
  if (!process.env.BOOTSTRAP_KEY && !options.skipBootstrap) {
    console.warn(
      "⚠️  BOOTSTRAP_KEY not set. Setting to default dev value.\n" +
      "   For production, set: export BOOTSTRAP_KEY='your-secret-key'"
    );
    process.env.BOOTSTRAP_KEY = "dev-only-secret";
  }

  // Determine seed to use
  let seed: string;

  if (options.seed) {
    // Use provided seed
    seed = options.seed;
  } else if (options.force || !existsSync(ADMIN_SEED_PATH)) {
    // Generate new seed or use default
    seed = DEFAULT_ADMIN_SEED;

    // Create .admin-seed file
    try {
      writeFileSync(ADMIN_SEED_PATH, seed, "utf-8");
      console.log(`✅ Created .admin-seed file with seed: ${seed}`);
    } catch (err) {
      console.warn(`⚠️  Could not write .admin-seed file:`, err);
    }
  } else {
    // Read existing seed
    seed = readFileSync(ADMIN_SEED_PATH, "utf-8").trim();
    console.log(`✅ Using existing admin seed from .admin-seed`);
  }

  // Generate deterministic keys from seed
  const seedBytes = new TextEncoder().encode(seed);
  const seedHash = sha256(seedBytes);
  const publicKeyBytes = await ed.getPublicKeyAsync(seedHash);
  const privateKeyBytes = seedHash;

  const aid = createAID(publicKeyBytes);
  const privateKey = Buffer.from(privateKeyBytes).toString("base64url");
  const publicKey = Buffer.from(publicKeyBytes).toString("base64url");

  console.log(`✅ Admin AID: ${aid}`);

  // Bootstrap backend if needed
  if (!options.skipBootstrap) {
    const convex = new ConvexClient(convexUrl);

    try {
      // Step 1: Register key state
      await convex.mutation(api.auth.registerKeyState, {
        aid,
        ksn: 0,
        keys: [aid], // AID is the public key in CESR format
        threshold: "1",
        lastEvtSaid: "",
      });
      console.log(`✅ Registered key state for admin`);
    } catch (err: any) {
      // Ignore if already exists
      if (!err.message?.includes("already exists")) {
        console.warn(`⚠️  Key state registration warning:`, err.message);
      }
    }

    try {
      // Step 2: Register user (get challenge and sign)
      const args = { aid, publicKey };

      // Compute args hash on server to ensure consistency
      const argsHash = await convex.query(api.auth.computeHash, { args });

      // Issue challenge
      const challenge = await convex.mutation(api.auth.issueChallenge, {
        aid,
        purpose: "registerUser",
        argsHash,
        ttl: 120000,
      });

      // Sign the payload (signPayload handles serialization internally)
      const sigs = await signPayload(challenge.payload, privateKeyBytes, 0);

      // Register user
      await convex.mutation(api.auth.registerUser, {
        aid,
        publicKey,
        auth: {
          challengeId: challenge.challengeId as any,
          sigs,
          ksn: 0,
        },
      });
      console.log(`✅ Registered admin user`);
    } catch (err: any) {
      // Ignore if already registered
      if (!err.message?.includes("already registered") && !err.message?.includes("already exists")) {
        console.warn(`⚠️  User registration warning:`, err.message);
      }
    }

    try {
      // Step 3: Bootstrap system (creates roles, permissions, assigns admin)
      const bootstrapResult = await convex.mutation(
        api.authorization_bootstrap.bootstrapOnboarding,
        { adminAid: aid } as any
      );

      if (bootstrapResult.already) {
        console.log(`✅ System already bootstrapped (idempotent check passed)`);
      } else {
        console.log(`✅ System bootstrapped successfully`);
        console.log(`   - Created roles: anon, user, admin`);
        console.log(`   - Created onboarding group`);
        console.log(`   - Assigned admin role to ${aid}`);
      }
    } catch (err: any) {
      console.error(`❌ Bootstrap failed:`, err.message);
      throw err;
    }

    convex.close();
  }

  return {
    aid,
    privateKey,
    publicKey,
    privateKeyBytes,
    publicKeyBytes,
    seed,
  };
}

/**
 * Reset admin seed (useful for testing clean state)
 *
 * Deletes .admin-seed file and clears any cached admin state.
 * Next call to ensureAdminInitialised will generate a new admin.
 */
export function resetAdminSeed(): void {
  try {
    if (existsSync(ADMIN_SEED_PATH)) {
      const fs = require("fs");
      fs.unlinkSync(ADMIN_SEED_PATH);
      console.log(`✅ Reset admin seed (.admin-seed file deleted)`);
    }
  } catch (err) {
    console.warn(`⚠️  Could not delete .admin-seed file:`, err);
  }
}

/**
 * Get current admin seed without initializing
 *
 * Returns null if .admin-seed doesn't exist.
 */
export function getCurrentAdminSeed(): string | null {
  try {
    if (existsSync(ADMIN_SEED_PATH)) {
      return readFileSync(ADMIN_SEED_PATH, "utf-8").trim();
    }
  } catch (err) {
    console.warn(`⚠️  Could not read .admin-seed file:`, err);
  }
  return null;
}

/**
 * Sign in as admin and get a session token
 *
 * This creates a session token with "admin" scope for the admin user.
 * The token can be used for admin operations like creating roles, granting permissions, etc.
 *
 * @param convexUrl - Convex backend URL
 * @param admin - Admin credentials from ensureAdminInitialised()
 * @param options - Optional configuration
 * @returns Session token object with token, aid, ksn, and expiresAt
 */
export async function getAdminSessionToken(
  convexUrl: string,
  admin: AdminCredentials,
  options: {
    /** Token lifetime in milliseconds (default: 60000ms = 1 minute) */
    ttlMs?: number;
    /** Path to save session token file (optional) */
    saveTo?: string;
  } = {}
): Promise<{ token: string; aid: string; ksn: number; expiresAt: number }> {
  const ttlMs = options.ttlMs ?? 60000;
  const convex = new ConvexClient(convexUrl);

  try {
    // Compute args hash on server to ensure consistency
    const args = { scopes: ["admin"], ttlMs };
    const argsHash = await convex.query(api.auth.computeHash, { args });

    // Issue challenge
    const challenge = await convex.mutation(api.auth.issueChallenge, {
      aid: admin.aid,
      purpose: "openSession",
      argsHash,
      ttl: 120000,
    });

    // Sign the payload (signPayload handles serialization internally)
    const sigs = await signPayload(challenge.payload, admin.privateKeyBytes, 0);

    // Open session
    const session = await convex.mutation(api.sessions.openSession, {
      aid: admin.aid,
      scopes: ["admin"],
      ttlMs,
      auth: {
        challengeId: challenge.challengeId as any,
        sigs,
        ksn: 0,
      },
    });

    const sessionData = {
      token: session.token,
      aid: admin.aid,
      ksn: 0,
      expiresAt: session.expiresAt,
    };

    // Save to file if requested
    if (options.saveTo) {
      writeFileSync(options.saveTo, JSON.stringify(sessionData, null, 2), "utf-8");
      console.log(`✅ Admin session saved to ${options.saveTo}`);
    }

    console.log(`✅ Admin session token created (expires in ${ttlMs}ms)`);
    return sessionData;
  } finally {
    convex.close();
  }
}
