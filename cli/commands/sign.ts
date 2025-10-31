/**
 * sign Command
 *
 * Sign a challenge with a private key.
 *
 * Usage:
 *   merits sign --file challenge.json --keys alice-keys.json > challenge-response.json
 *
 * Input format (challenge.json):
 *   {
 *     "challengeId": "<id>",
 *     "payload": {...},
 *     "purpose": "registerUser",
 *     "args": {...}
 *   }
 *
 * Input format (keys.json):
 *   {
 *     "privateKey": "<base64url>",
 *     "publicKey": "<base64url>"
 *   }
 *
 * Output (RFC8785 canonicalized JSON):
 *   {
 *     "challengeId": "<id>",
 *     "payload": {...},
 *     "signature": ["0-<base64url>"],
 *     "purpose": "registerUser",
 *     "args": {...}
 *   }
 */

import { withGlobalOptions, normalizeFormat, type GlobalOptions } from "../lib/options";
import { readFileSync } from "fs";
import { signPayload, base64UrlToUint8Array } from "../../core/crypto";

export interface SignOptions extends GlobalOptions {
  file: string; // Path to challenge file
  keys: string; // Path to keys file
}

/**
 * Sign a challenge with a private key
 *
 * @param opts Command options
 */
export const sign = withGlobalOptions(async (opts: SignOptions) => {
  const format = normalizeFormat(opts.format);

  if (!opts.file || !opts.keys) {
    throw new Error("Both --file and --keys are required");
  }

  // Load challenge file
  const challengeContent = readFileSync(opts.file, "utf-8");
  const challenge = JSON.parse(challengeContent);

  if (!challenge.payload || !challenge.challengeId) {
    throw new Error("Invalid challenge file: missing payload or challengeId");
  }

  // Load keys file
  const keysContent = readFileSync(opts.keys, "utf-8");
  const keys = JSON.parse(keysContent);

  if (!keys.privateKey) {
    throw new Error("Invalid keys file: missing privateKey");
  }

  // Convert base64url private key to Uint8Array
  const privateKey = base64UrlToUint8Array(keys.privateKey);

  // Sign the payload (using index 0 for single-sig)
  const signature = await signPayload(challenge.payload, privateKey, 0);

  // Create signed response
  const output = {
    challengeId: challenge.challengeId,
    payload: challenge.payload,
    signature,
    purpose: challenge.purpose,
    args: challenge.args,
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
    console.error("\nNext step:");
    console.error("  merits confirm-challenge --file challenge-response.json > session-token.json");
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
