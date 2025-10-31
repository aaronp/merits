/**
 * whoami Command
 *
 * Display information about the current authenticated session.
 *
 * Usage:
 *   merits whoami
 *   merits whoami --token /path/to/session.json
 *
 * Output (RFC8785 canonicalized JSON):
 *   {
 *     "aid": "<user-aid>",
 *     "expiresAt": <timestamp>,
 *     "ksn": <key-sequence-number>,
 *     "roles": ["role1", "role2"]  // Optional, if available
 *   }
 */

import { withGlobalOptions, normalizeFormat, type GlobalOptions } from "../lib/options";
import { requireSessionToken } from "../lib/session";

export interface WhoamiOptions extends GlobalOptions {
  // No additional options - uses global --token option
}

/**
 * Display current session information
 *
 * @param opts Command options
 */
export const whoami = withGlobalOptions(async (opts: WhoamiOptions) => {
  const format = normalizeFormat(opts.format);

  // Load and validate session token
  const session = requireSessionToken(opts.token);

  // Build output
  const output: any = {
    aid: session.aid,
    expiresAt: session.expiresAt,
  };

  if (session.ksn !== undefined) {
    output.ksn = session.ksn;
  }

  // Calculate time until expiry
  const now = Date.now();
  const expiresIn = session.expiresAt - now;
  const expiresInSec = Math.floor(expiresIn / 1000);

  // TODO: Fetch roles from backend if available
  // For now, we don't have roles in the session token

  // Output in requested format
  switch (format) {
    case "json":
      // RFC8785 canonicalized JSON for deterministic test snapshots
      console.log(canonicalizeJSON(output));
      break;
    case "pretty":
      console.log(JSON.stringify(output, null, 2));
      // Add human-readable info (to stderr, not stdout)
      if (!opts.noBanner) {
        console.error(`\nSession expires in: ${expiresInSec}s`);
        if (expiresInSec < 10) {
          console.error("⚠ Session will expire soon!");
        }
      }
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
