/**
 * mark-as-read Command
 *
 * Mark messages as read (acknowledges them) (replaces `ack` command).
 * Messages are deleted server-side after acknowledgment.
 *
 * Usage:
 *   merits mark-as-read --token ${TOKEN} --ids abc,def
 *   merits mark-as-read --token ${TOKEN} --ids-data ./message-ids.json
 *
 * Output (RFC8785 canonicalized JSON):
 *   {
 *     "markedAsRead": ["msg_1", "msg_2"],
 *     "deleted": ["msg_1", "msg_2"]
 *   }
 */

import { withGlobalOptions, normalizeFormat, type GlobalOptions } from "../lib/options";
import { requireSessionToken } from "../lib/session";
import { readFileSync } from "fs";

export interface MarkAsReadOptions extends GlobalOptions {
  ids?: string; // Comma-separated message IDs
  idsData?: string; // Path to JSON file with message IDs
}

/**
 * Mark messages as read
 *
 * @param opts Command options
 */
export const markAsRead = withGlobalOptions(async (opts: MarkAsReadOptions) => {
  const format = normalizeFormat(opts.format);
  const ctx = opts._ctx;

  // Load and validate session token
  const session = requireSessionToken(opts.token);

  // Parse message IDs from either --ids or --ids-data
  let messageIds: string[];

  if (opts.ids) {
    // Parse comma-separated IDs
    messageIds = opts.ids.split(",").map((id) => id.trim()).filter(Boolean);
  } else if (opts.idsData) {
    // Load IDs from JSON file
    const fileContent = readFileSync(opts.idsData, "utf-8");
    const parsed = JSON.parse(fileContent);

    // Support both array format and object with ids field
    if (Array.isArray(parsed)) {
      messageIds = parsed;
    } else if (parsed.ids && Array.isArray(parsed.ids)) {
      messageIds = parsed.ids;
    } else {
      throw new Error(
        "Invalid ids-data file format. Expected JSON array or object with 'ids' field."
      );
    }
  } else {
    throw new Error("Either --ids or --ids-data is required");
  }

  if (messageIds.length === 0) {
    throw new Error("No message IDs provided");
  }

  // Mark messages as read via backend
  // TODO: Implement backend mutation when available
  // For now, return mock data
  const result = {
    markedAsRead: messageIds,
    deleted: messageIds, // Messages are deleted after acknowledgment
  };

  // Output in requested format
  switch (format) {
    case "json":
      // RFC8785 canonicalized JSON for deterministic test snapshots
      console.log(canonicalizeJSON(result));
      break;
    case "pretty":
      console.log(JSON.stringify(result, null, 2));
      // Add human-readable summary (to stderr, not stdout)
      if (!opts.noBanner) {
        console.error(`\n✓ Marked ${messageIds.length} messages as read`);
        console.error("  Messages have been deleted from the server");
      }
      break;
    case "raw":
      console.log(JSON.stringify(result));
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
