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
 * - Uses CLI commands: All operations go through CLI → Merits API → Backend
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runCliInProcess } from "../cli/helpers/exec";
import { sha256 } from "../../core/crypto";
import * as ed from "@noble/ed25519";
import { bootstrapOnboardingCmd } from "../../cli/commands/rbac";

/**
 * Admin credentials returned by ensureAdminInitialised
 */
export interface AdminCredentials {
  /**
   * Did we boostrap the system?
   */
  created: boolean;
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

const convexUrl = () => {
  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    throw new Error("CONVEX_URL is required for admin initialization. Update your .env file");
  }
  return convexUrl;
}

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
export async function ensureAdminInitialised(): Promise<AdminCredentials> {


  const bootstrapKey = process.env.BOOTSTRAP_KEY;


  // Check BOOTSTRAP_KEY environment variable
  if (!bootstrapKey) {
    throw new Error("BOOTSTRAP_KEY is required for admin initialization. Update your .env file");
  }

  // Determine seed to use
  const seed = DEFAULT_ADMIN_SEED;

  // Step 1: Use CLI incept command to create admin user
  const inceptResult = await runCliInProcess(["incept", "--seed", seed], {
    env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: convexUrl() },
    expectSuccess: false,
  });

  // Check if incept succeeded (could fail if user already exists)
  // let aid: string;
  // let privateKey: string;
  // let publicKey: string;
  // let privateKeyBytes: Uint8Array;
  // let publicKeyBytes: Uint8Array;

  if (inceptResult.code === 0 && inceptResult.json) {
    // Success - user incepted
    const aid = inceptResult.json.aid;
    const privateKey = inceptResult.json.keys.privateKey;
    const publicKey = inceptResult.json.keys.publicKey;
    const privateKeyBytes = Buffer.from(privateKey, "base64url");
    const publicKeyBytes = Buffer.from(publicKey, "base64url");
    console.log(`✅ Admin user incepted: ${aid}, bootstraping system...`);


    // Step 2: Bootstrap system if needed
    const result = await bootstrapOnboardingCmd(convexUrl(), aid)

    console.log(`✅ System bootstrapped: ${JSON.stringify(result)}`);
    return {
      created: true,
      aid,
      privateKey,
      publicKey,
      privateKeyBytes,
      publicKeyBytes,
      seed
    };

  } else if (
    inceptResult.stderr?.includes("already exists") ||
    inceptResult.stderr?.includes("ALREADY_EXISTS") ||
    inceptResult.stderr?.includes("AlreadyExistsError") ||
    inceptResult.stdout?.includes("already exists") ||
    inceptResult.stdout?.includes("ALREADY_EXISTS") ||
    // Sometimes Convex returns generic "Server Error" for already-exists cases
    (inceptResult.stderr?.includes("Server Error") && inceptResult.code !== 0)
  ) {
    // User already exists - generate keys from seed to get credentials
    console.log(`✅ Admin user already exists, deriving keys from seed`);
    const seedBytes = new TextEncoder().encode(seed);
    const seedHash = sha256(seedBytes);
    const publicKeyBytes = await ed.getPublicKeyAsync(seedHash);
    const privateKeyBytes = seedHash;

    // Import createAID from core/crypto
    const { createAID } = await import("../../core/crypto");
    const aid = createAID(publicKeyBytes);
    const privateKey = Buffer.from(privateKeyBytes).toString("base64url");
    const publicKey = Buffer.from(publicKeyBytes).toString("base64url");
    console.log(`Using existing admin AID: ${aid}`);

    return {
      created: false,
      aid,
      privateKey,
      publicKey,
      privateKeyBytes,
      publicKeyBytes,
      seed
    };
  } else {
    // Real error
    throw new Error(`Failed to incept admin: ${inceptResult.stderr || inceptResult.stdout}`);
  }

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
