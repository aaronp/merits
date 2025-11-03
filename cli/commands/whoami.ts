/**
 * whoami Command
 *
 * Display information about the current authenticated credentials.
 *
 * Usage:
 *   merits whoami
 *   merits whoami --credentials /path/to/identity.json
 *
 * Output (RFC8785 canonicalized JSON):
 *   {
 *     "aid": "<user-aid>",
 *     "ksn": <key-sequence-number>
 *   }
 */

import { withGlobalOptions, normalizeFormat, type GlobalOptions } from "../lib/options";
import { requireCredentials } from "../lib/credentials";

export interface WhoamiOptions extends GlobalOptions {
  // No additional options - uses global --token option
}

/**
 * Display current credentials information
 *
 * @param opts Command options
 */
export const whoami = withGlobalOptions(async (opts: WhoamiOptions) => {
  const format = normalizeFormat(opts.format);

  // Load and validate credentials
  const creds = requireCredentials(opts.credentials);

  // Build output
  const output: any = {
    aid: creds.aid,
    ksn: creds.ksn,
  };

  // TODO: Fetch roles from backend if available

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
