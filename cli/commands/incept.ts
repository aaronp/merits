/**
 * incept Command
 *
 * Convenience command that performs the full user inception flow:
 * 1. Generate a new Ed25519 key pair
 * 2. Register the identity with the server
 * 3. Sign the registration challenge
 * 4. Confirm the challenge to obtain a session token
 *
 * Usage:
 *   merits incept
 *   merits incept --seed test123  # Deterministic (testing only)
 *
 * Output (RFC8785 canonicalized JSON):
 *   {
 *     "aid": "<CESR-encoded AID>",
 *     "keys": {
 *       "privateKey": "<base64url>",
 *       "publicKey": "<base64url>"
 *     },
 *     "challenge": {
 *       "challengeId": "<id>",
 *       "payload": {...}
 *     },
 *     "session": {
 *       "token": "<session-token>",
 *       "aid": "<aid>",
 *       "expiresAt": <timestamp>
 *     }
 *   }
 */

import { withGlobalOptions, normalizeFormat, type GlobalOptions } from "../lib/options";
import { generateKeyPair, createAID, signPayload, sha256 } from "../../core/crypto";
import * as ed from "@noble/ed25519";
import type { CLIContext } from "../lib/context";

export interface InceptOptions extends GlobalOptions {
  seed?: string; // Deterministic seed for testing
}

/**
 * Perform full user inception flow
 *
 * @param opts Command options
 */
export const incept = withGlobalOptions(async (opts: InceptOptions) => {
  const format = normalizeFormat(opts.format);
  const ctx = opts._ctx;

  // Step 1: Generate key pair
  let keys;
  if (opts.seed) {
    // Deterministic key generation for testing
    const seedBytes = new TextEncoder().encode(opts.seed);
    const seedHash = sha256(seedBytes);
    const publicKey = await ed.getPublicKeyAsync(seedHash);

    keys = {
      publicKey,
      privateKey: seedHash,
    };
  } else {
    // Random key generation
    keys = await generateKeyPair();
  }

  const aid = createAID(keys.publicKey);
  const publicKeyB64 = Buffer.from(keys.publicKey).toString("base64url");
  const privateKeyB64 = Buffer.from(keys.privateKey).toString("base64url");

  // Step 2: Register identity and get challenge
  const publicKeyBytes = Buffer.from(publicKeyB64, "base64url");

  // Register key state first
  await ctx.client.identityRegistry.registerIdentity({
    aid,
    publicKey: publicKeyBytes,
    ksn: 0,
  });

  // Issue challenge for user registration
  const args = { aid, publicKey: publicKeyB64 };
  const challenge = await ctx.client.identityAuth.issueChallenge({
    aid,
    purpose: "registerUser" as any,
    args,
    ttlMs: 120000, // 2 minutes
  });

  // Step 3: Sign the challenge
  const sigs = await signPayload(challenge.payloadToSign, keys.privateKey, 0);

  // Step 4: Register user and obtain session token
  const sessionResult = await ctx.client.registerUser({
    aid,
    publicKey: publicKeyB64,
    challengeId: challenge.challengeId,
    sigs,
    ksn: 0,
  });

  // Build output
  const output = {
    aid,
    keys: {
      privateKey: privateKeyB64,
      publicKey: publicKeyB64,
    },
    challenge: {
      challengeId: challenge.challengeId,
      payload: challenge.payloadToSign,
    },
    session: {
      token: sessionResult.token,
      aid: sessionResult.aid,
      expiresAt: sessionResult.expiresAt,
    },
  };

  // Output in requested format
  switch (format) {
    case "json":
      // RFC8785 canonicalized JSON for deterministic test snapshots
      console.log(canonicalizeJSON(output));
      break;
    case "pretty":
      console.log(JSON.stringify(output, null, 2));
      break;
    case "raw":
      console.log(JSON.stringify(output));
      break;
  }

  // Hint for next step (only in pretty mode)
  if (format === "pretty" && !opts.noBanner) {
    console.error("\n✅ User inception complete!");
    console.error("   Session token obtained and ready to use.");
    console.error("\nNext steps:");
    console.error("  Save your keys securely (especially privateKey)");
    console.error("  Use the session token for authenticated operations");
  }
});

/**
 * Canonicalize JSON according to RFC8785
 * - Sort object keys deterministically
 * - No whitespace
 */
function canonicalizeJSON(obj: any): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalizeJSON).join(",")}]`;
  }

  // Sort object keys
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map((key) => {
    return `${JSON.stringify(key)}:${canonicalizeJSON(obj[key])}`;
  });

  return `{${entries.join(",")}}`;
}
