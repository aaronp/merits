/**
 * unread Command
 *
 * Retrieve unread messages (replaces `receive` command).
 *
 * Usage:
 *   merits unread --token ${TOKEN} > all-unread.json
 *   merits unread --token ${TOKEN} --from bob > bob-unread.json
 *   merits unread --token ${TOKEN} --watch  # Real-time streaming
 *   merits unread --token ${TOKEN} --since <timestamp>  # Replay after downtime
 *
 * Output (RFC8785 canonicalized JSON):
 *   [
 *     {
 *       "id": "<message-id>",
 *       "from": "bob",
 *       "to": "alice",
 *       "ct": "<ciphertext>",
 *       "typ": "encrypted",
 *       "createdAt": <timestamp>
 *     },
 *     ...
 *   ]
 */

import { withGlobalOptions, normalizeFormat, type GlobalOptions } from "../lib/options";
import { requireSessionToken } from "../lib/session";

export interface UnreadOptions extends GlobalOptions {
  from?: string; // Optional sender filter
  watch?: boolean; // Real-time streaming mode
  since?: number; // Replay messages after this timestamp
}

/**
 * Retrieve unread messages
 *
 * @param opts Command options
 */
export const unread = withGlobalOptions(async (opts: UnreadOptions) => {
  const format = normalizeFormat(opts.format);
  const ctx = opts._ctx;

  // Load and validate session token
  const session = requireSessionToken(opts.token);

  if (opts.watch) {
    // Watch mode: stream messages in real-time
    await watchMessages(opts, session, ctx, format);
  } else {
    // One-time fetch: retrieve unread messages
    await fetchMessages(opts, session, ctx, format);
  }
});

/**
 * Fetch unread messages (one-time)
 */
async function fetchMessages(
  opts: UnreadOptions,
  session: any,
  ctx: any,
  format: "json" | "pretty" | "raw"
): Promise<void> {
  // Query backend for unread messages
  // TODO: Implement backend query when available
  // For now, return mock data
  const messages = [
    {
      id: "msg_1",
      from: "bob",
      to: session.aid,
      ct: "encrypted_content_1",
      typ: "encrypted",
      createdAt: Date.now() - 3600000, // 1 hour ago
    },
    {
      id: "msg_2",
      from: "joe",
      to: session.aid,
      ct: "encrypted_content_2",
      typ: "encrypted",
      createdAt: Date.now() - 1800000, // 30 minutes ago
    },
  ];

  // Apply sender filter if specified
  let filteredMessages = messages;
  if (opts.from) {
    filteredMessages = messages.filter((msg) => msg.from === opts.from);
  }

  // Apply since filter if specified
  if (opts.since) {
    filteredMessages = filteredMessages.filter((msg) => msg.createdAt >= opts.since!);
  }

  // Output in requested format
  switch (format) {
    case "json":
      // RFC8785 canonicalized JSON for deterministic test snapshots
      console.log(canonicalizeJSON(filteredMessages));
      break;
    case "pretty":
      console.log(JSON.stringify(filteredMessages, null, 2));
      // Add human-readable summary (to stderr, not stdout)
      if (!opts.noBanner) {
        console.error(`\nRetrieved ${filteredMessages.length} unread messages`);
      }
      break;
    case "raw":
      console.log(JSON.stringify(filteredMessages));
      break;
  }
}

/**
 * Watch messages in real-time (streaming mode)
 */
async function watchMessages(
  opts: UnreadOptions,
  session: any,
  ctx: any,
  format: "json" | "pretty" | "raw"
): Promise<void> {
  // Watch mode banner (only in pretty mode)
  if (format === "pretty" && !opts.noBanner) {
    console.error("Watching for new messages... (Press Ctrl+C to stop)");
    console.error("");
  }

  // TODO: Implement real-time streaming when backend supports it
  // For now, just print a message
  console.error("Watch mode not yet implemented. Coming in Phase 4!");
  console.error("Will use session tokens for authentication and poll/stream from backend.");

  // Placeholder: would set up a subscription or polling loop here
  // Example:
  // while (true) {
  //   const newMessages = await ctx.client.queryUnread({ aid: session.aid, from: opts.from });
  //   for (const msg of newMessages) {
  //     // Output each message as it arrives
  //     console.log(format === "pretty" ? JSON.stringify(msg, null, 2) : canonicalizeJSON(msg));
  //   }
  //   await sleep(1000); // Poll every second
  // }
}

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
