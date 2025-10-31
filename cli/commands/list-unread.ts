/**
 * list-unread Command
 *
 * List unread message counts per sender/group.
 *
 * Usage:
 *   merits list-unread --token ${TOKEN}
 *   merits list-unread --token ${TOKEN} --from bob,sue
 *
 * Output (RFC8785 canonicalized JSON):
 *   { "bob": 4, "joe": 2, "<group-id>": 1 }
 */

import { withGlobalOptions, normalizeFormat, type GlobalOptions } from "../lib/options";
import { requireSessionToken } from "../lib/session";

export interface ListUnreadOptions extends GlobalOptions {
  from?: string; // Comma-separated list of sender AIDs to filter by
}

/**
 * List unread message counts
 *
 * @param opts Command options
 */
export const listUnread = withGlobalOptions(async (opts: ListUnreadOptions) => {
  const format = normalizeFormat(opts.format);
  const ctx = opts._ctx;

  // Load and validate session token
  const session = requireSessionToken(opts.token);

  // Parse sender filter if provided
  const senderFilter = opts.from
    ? opts.from.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  // Query backend for unread message counts
  // TODO: Implement backend query when available
  // For now, return mock data
  const unreadCounts: Record<string, number> = {
    bob: 4,
    joe: 2,
  };

  // Apply sender filter if specified
  let filteredCounts = unreadCounts;
  if (senderFilter && senderFilter.length > 0) {
    filteredCounts = {};
    for (const sender of senderFilter) {
      if (unreadCounts[sender]) {
        filteredCounts[sender] = unreadCounts[sender];
      }
    }
  }

  // Output in requested format
  switch (format) {
    case "json":
      // RFC8785 canonicalized JSON for deterministic test snapshots
      console.log(canonicalizeJSON(filteredCounts));
      break;
    case "pretty":
      console.log(JSON.stringify(filteredCounts, null, 2));
      // Add human-readable summary (to stderr, not stdout)
      if (!opts.noBanner) {
        const total = Object.values(filteredCounts).reduce((sum, count) => sum + count, 0);
        console.error(`\nTotal unread messages: ${total}`);
      }
      break;
    case "raw":
      console.log(JSON.stringify(filteredCounts));
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
