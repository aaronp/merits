/**
 * Unread Command - Retrieve unread messages (direct + group)
 *
 * Fetches a unified inbox containing both:
 * - Direct messages (peer-to-peer encrypted)
 * - Group messages (zero-knowledge group encrypted)
 *
 * Messages are returned sorted by timestamp (newest first).
 *
 * Usage:
 *   merits unread --credentials identity.json
 *   merits unread --credentials identity.json --from alice
 *   merits unread --credentials identity.json --since 1730476800000
 *   merits unread --credentials identity.json --format pretty
 */

import { withGlobalOptions, normalizeFormat, type GlobalOptions } from "../lib/options";
import { requireCredentials } from "../lib/credentials";

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

  // Load credentials
  const creds = requireCredentials(opts.credentials);

  if (opts.watch) {
    console.error("Watch mode not yet implemented. Coming in Phase 4!");
    return;
  }

  // Fetch unified unread messages (direct + group) from backend
  // This query returns both message types, already sorted by timestamp (newest first)
  const { api } = await import("../../convex/_generated/api");
  const result = await ctx.client.connection.query(api.messages.getUnread, {
    aid: creds.aid,
    includeGroupMessages: true,
  });

  // TODO: Decrypt messages client-side
  // For now, return messages with encrypted content
  const messages = result.messages.map((m: any) => {
    const msg: any = {
      messageId: m.id,
      senderAid: m.from,
      ct: m.ct,
      typ: m.typ,
      createdAt: m.createdAt,
      isGroupMessage: m.isGroupMessage ?? false,
      decryptedContent: "[Encrypted - decryption not yet implemented]",
    };

    // Only include optional fields if they're defined
    if (m.alg !== undefined) msg.alg = m.alg;
    if (m.groupId !== undefined) msg.groupId = m.groupId;

    return msg;
  });

  // Filter by sender if requested
  const filteredMessages = opts.from
    ? messages.filter((m: any) => m.senderAid === opts.from)
    : messages;

  // Output in requested format
  switch (format) {
    case "json":
      // RFC8785 canonicalized JSON for deterministic test snapshots
      console.log(canonicalizeJSON(filteredMessages));
      break;
    case "pretty":
      console.log(JSON.stringify(filteredMessages, null, 2));
      // Add human-readable summary (to stderr, not stdout)
      if (!opts.noBanner && filteredMessages.length > 0) {
        const groupCount = filteredMessages.filter((m: any) => m.isGroupMessage).length;
        const directCount = filteredMessages.length - groupCount;
        console.error(`\nRetrieved ${filteredMessages.length} unread messages (${directCount} direct, ${groupCount} group)`);
      }
      break;
    case "raw":
      console.log(JSON.stringify(filteredMessages));
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
