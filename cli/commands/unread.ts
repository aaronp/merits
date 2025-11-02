/**
 * Unread Command - Retrieve unread messages
 *
 * Simplified token-based message retrieval. Backend handles all decryption.
 *
 * Usage:
 *   merits unread --token identity.json
 *   merits unread --token identity.json --from alice
 *   merits unread --token identity.json --since 1730476800000
 *   merits unread --token identity.json --format pretty
 */

import { withGlobalOptions, normalizeFormat, type GlobalOptions } from "../lib/options";
import { requireSessionToken } from "../lib/session";

export interface UnreadOptions extends GlobalOptions {
  from?: string; // Optional sender filter
  since?: number; // Replay messages after this timestamp
  watch?: boolean; // Real-time streaming (not yet implemented)
}

/**
 * Retrieve unread messages
 */
export const unread = withGlobalOptions(async (opts: UnreadOptions) => {
  const format = normalizeFormat(opts.format);
  const ctx = opts._ctx;

  // Load session token
  const session = requireSessionToken(opts.token);

  if (opts.watch) {
    console.error("Watch mode not yet implemented. Coming in Phase 4!");
    return;
  }

  // Fetch messages from backend (backend handles decryption)
  const response = await ctx.client.query(ctx.api.messages.getUnread, {
    token: session.token,
    from: opts.from,
    since: opts.since,
  });

  const messages = response?.messages || [];

  // Output in requested format
  switch (format) {
    case "json":
      // RFC8785 canonicalized JSON for deterministic test snapshots
      console.log(canonicalizeJSON(messages));
      break;
    case "pretty":
      console.log(JSON.stringify(messages, null, 2));
      // Add human-readable summary (to stderr, not stdout)
      if (!opts.noBanner && messages.length > 0) {
        const groupCount = messages.filter((m: any) => m.isGroupMessage).length;
        const directCount = messages.length - groupCount;
        console.error(`\nRetrieved ${messages.length} unread messages (${directCount} direct, ${groupCount} group)`);
      }
      break;
    case "raw":
      console.log(JSON.stringify(messages));
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
