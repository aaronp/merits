/**
 * Key-For Command (Phase 7.1)
 *
 * Fetch the public key for a given AID from the backend.
 *
 * Usage:
 *   merits key-for <aid>
 *   merits key-for <aid> --format json
 *
 * Output (RFC8785 canonicalized JSON):
 *   {
 *     "aid": "<aid>",
 *     "publicKey": "<base64url-encoded-Ed25519-public-key>",
 *     "ksn": <key-sequence-number>,
 *     "updatedAt": <timestamp>
 *   }
 *
 * Use Cases:
 * - Verify someone's public key before encrypting
 * - Export key for sharing with others
 * - Validate AID registration status
 * - Check key rotation status (via ksn)
 *
 * @see convex/auth.ts getPublicKey() for backend implementation
 */

import { withGlobalOptions, normalizeFormat, type GlobalOptions } from "../lib/options";

export interface KeyForOptions extends GlobalOptions {
  // No additional options - uses global format option
}

/**
 * Fetch public key for an AID
 *
 * @param aid - AID to lookup
 * @param opts - Command options
 */
export const keyFor = withGlobalOptions(async (aid: string, opts: KeyForOptions) => {
  const format = normalizeFormat(opts.format);
  const ctx = opts._ctx;

  if (!aid) {
    throw new Error("AID is required. Usage: merits key-for <aid>");
  }

  // Validate AID format (basic check)
  if (!aid.startsWith("D") && !aid.startsWith("E")) {
    console.error(`⚠️  Warning: AID should start with 'D' or 'E' (CESR format)`);
    console.error(`   Provided: ${aid}`);
  }

  try {
    // Call backend API to fetch public key
    const result = await ctx.client.query(ctx.api.auth.getPublicKey, { aid });

    // Output result
    const output = {
      aid: result.aid,
      publicKey: result.publicKey,
      ksn: result.ksn,
      updatedAt: result.updatedAt,
    };

    switch (format) {
      case "json":
        // RFC8785 canonicalized JSON for deterministic output
        console.log(canonicalizeJSON(output));
        break;
      case "pretty":
        console.log(JSON.stringify(output, null, 2));
        if (!opts.noBanner) {
          console.error(`\n📋 Public Key Information`);
          console.error(`   AID: ${result.aid}`);
          console.error(`   Key Sequence: ${result.ksn}`);
          console.error(`   Last Updated: ${new Date(result.updatedAt).toISOString()}`);
          console.error(`\nPublic Key (base64url):`);
          console.error(`   ${result.publicKey}`);
        }
        break;
      case "raw":
        console.log(JSON.stringify(output));
        break;
    }
  } catch (err: any) {
    if (err.message?.includes("User not found")) {
      console.error(`❌ Error: No user found for AID: ${aid}`);
      console.error(`   This AID is not registered in the system.`);
      console.error(`   Use 'merits create-user' to register a new user.`);
      process.exit(1);
    }
    throw err;
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
