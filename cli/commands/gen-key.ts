/**
 * gen-key Command
 *
 * Generate a new Ed25519 key pair for use with Merits.
 *
 * Usage:
 *   merits gen-key > keys.json
 *   merits gen-key --seed 1234 > test-keys.json  # Deterministic (testing only)
 *
 * Output (RFC8785 canonicalized JSON):
 *   {
 *     "privateKey": "<base64url>",
 *     "publicKey": "<base64url>"
 *   }
 */

import { withGlobalOptions, normalizeFormat, type GlobalOptions } from "../lib/options";
import { generateKeyPair } from "../../core/crypto";
import { sha256 } from "../../core/crypto";
import * as ed from "@noble/ed25519";

export interface GenKeyOptions extends GlobalOptions {
  seed?: string; // Deterministic seed for testing
}

/**
 * Generate Ed25519 key pair
 *
 * @param opts Command options
 */
export const genKey = withGlobalOptions(async (opts: GenKeyOptions) => {
  const format = normalizeFormat(opts.format);

  let keys;

  if (opts.seed) {
    // Deterministic key generation for testing
    // Hash the seed to get 32 bytes
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

  // Convert to base64url for output
  const output = {
    privateKey: Buffer.from(keys.privateKey).toString("base64url"),
    publicKey: Buffer.from(keys.publicKey).toString("base64url"),
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
