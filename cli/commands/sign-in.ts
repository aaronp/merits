/**
 * sign-in Command
 *
 * Create a sign-in challenge for an existing user.
 *
 * Usage:
 *   merits sign-in --id alice > challenge.json
 *   merits sign --file challenge.json --keys alice-keys.json > challenge-response.json
 *   merits confirm-challenge --file challenge-response.json > session-token.json
 *
 * Output (RFC8785 canonicalized JSON):
 *   {
 *     "challengeId": "<id>",
 *     "payload": {...},
 *     "purpose": "signIn"
 *   }
 */

import { withGlobalOptions, normalizeFormat, type GlobalOptions } from "../lib/options";

export interface SignInOptions extends GlobalOptions {
  id: string; // User AID
}

/**
 * Create sign-in challenge for existing user
 *
 * @param opts Command options
 */
export const signIn = withGlobalOptions(async (opts: SignInOptions) => {
  const format = normalizeFormat(opts.format);
  const ctx = opts._ctx;

  if (!opts.id) {
    throw new Error("--id is required");
  }

  // TODO: Fetch the user's public key from backend
  // For now, we'll issue a challenge without requiring the public key upfront
  // The backend should look up the registered key for this AID

  const args = { aid: opts.id };

  // Issue challenge for sign-in
  const challenge = await ctx.client.identityAuth.issueChallenge({
    aid: opts.id,
    purpose: "signIn" as any,
    args,
    ttlMs: 120000, // 2 minutes to complete challenge
  });

  const output = {
    challengeId: challenge.challengeId,
    payload: challenge.payloadToSign,
    purpose: "signIn",
    args,
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
    console.error("\nNext steps:");
    console.error("  1. Sign the challenge:");
    console.error(`     merits sign --file challenge.json --keys ${opts.id}-keys.json > challenge-response.json`);
    console.error("  2. Confirm the challenge:");
    console.error("     merits confirm-challenge --file challenge-response.json > session-token.json");
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
