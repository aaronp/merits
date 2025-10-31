/**
 * confirm-challenge Command
 *
 * Confirm a signed challenge and obtain a session token.
 *
 * Usage:
 *   merits confirm-challenge --file challenge-response.json > session-token.json
 *
 * Input format (challenge-response.json):
 *   {
 *     "challengeId": "<id>",
 *     "payload": {...},
 *     "signature": ["0-<base64url>"],
 *     "purpose": "registerUser",
 *     "args": { "aid": "...", "publicKey": "..." }
 *   }
 *
 * Output (RFC8785 canonicalized JSON):
 *   {
 *     "token": "<session-token>",
 *     "expiresAt": <timestamp>,
 *     "aid": "<user-aid>",
 *     "ksn": <key-sequence-number>
 *   }
 *
 * Side effects:
 * - Stores session token to .merits/session.json (or --token path) with 0600 permissions
 */

import { withGlobalOptions, normalizeFormat, type GlobalOptions } from "../lib/options";
import { saveSessionToken, type SessionToken } from "../lib/session";
import { readFileSync } from "fs";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export interface ConfirmChallengeOptions extends GlobalOptions {
  file: string; // Path to signed challenge response file
}

/**
 * Confirm signed challenge and obtain session token
 *
 * @param opts Command options
 */
export const confirmChallenge = withGlobalOptions(async (opts: ConfirmChallengeOptions) => {
  const format = normalizeFormat(opts.format);
  const ctx = opts._ctx;

  if (!opts.file) {
    throw new Error("--file is required");
  }

  // Load signed challenge response
  const responseContent = readFileSync(opts.file, "utf-8");
  const response = JSON.parse(responseContent);

  if (!response.challengeId || !response.signature || !response.purpose || !response.args) {
    throw new Error(
      "Invalid challenge response file: missing challengeId, signature, purpose, or args"
    );
  }

  const { challengeId, signature, purpose, args } = response;

  // Determine the action based on purpose
  let sessionToken: SessionToken;

  if (purpose === "registerUser") {
    // Register new user
    const result = await ctx.client.connection.mutation(api.auth.registerUser, {
      aid: args.aid,
      publicKey: args.publicKey,
      auth: {
        challengeId: challengeId as Id<"challenges">,
        sigs: signature,
        ksn: 0, // Initial key sequence number
      },
    });

    // Create session token
    // TODO: Backend should return actual session token. For now, we create a placeholder.
    sessionToken = {
      token: `session_${args.aid}_${Date.now()}`,
      expiresAt: Date.now() + 60000, // 60 seconds
      aid: args.aid,
      ksn: 0,
    };
  } else if (purpose === "signIn") {
    // Sign in existing user
    // TODO: Implement sign-in flow when backend supports it
    throw new Error("Sign-in purpose not yet implemented");
  } else if (purpose === "rotateKey") {
    // Rotate user key
    // TODO: Implement key rotation when backend supports it
    throw new Error("Key rotation purpose not yet implemented");
  } else {
    throw new Error(`Unknown challenge purpose: ${purpose}`);
  }

  // Store session token to file
  saveSessionToken(sessionToken, opts.token);

  // Output session token in requested format
  switch (format) {
    case "json":
      // RFC8785 canonicalized JSON for deterministic test snapshots
      console.log(canonicalizeJSON(sessionToken));
      break;
    case "pretty":
      console.log(JSON.stringify(sessionToken, null, 2));
      break;
    case "raw":
      console.log(JSON.stringify(sessionToken));
      break;
  }

  // Success message (only in pretty mode)
  if (format === "pretty" && !opts.noBanner) {
    const tokenPath = opts.token || ".merits/session.json";
    console.error(`\n✓ Session token saved to ${tokenPath}`);
    console.error(`  Expires at: ${new Date(sessionToken.expiresAt).toISOString()}`);
    console.error(`\nYou can now use authenticated commands:`);
    console.error(`  merits whoami --token ${tokenPath}`);
    console.error(`  merits send --to <recipient> --message "hello" --token ${tokenPath}`);
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
