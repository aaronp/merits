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
 *       "ct": "<ciphertext>" | GroupMessage,
 *       "typ": "encrypted" | "group-encrypted",
 *       "createdAt": <timestamp>,
 *       "isGroupMessage": false | true,
 *       "groupId": "<group-id>" (if group message),
 *       "message": "<decrypted-plaintext>" (if decrypted)
 *     },
 *     ...
 *   ]
 */

import { withGlobalOptions, normalizeFormat, type GlobalOptions } from "../lib/options";
import { requireSessionToken } from "../lib/session";
import { decryptGroupMessage, type GroupMessage } from "../lib/crypto-group";

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
  // Query backend for unread messages (both direct and group)
  const response = await ctx.client.query(ctx.api.messages.getUnread, {
    aid: session.aid,
    includeGroupMessages: true,
  });

  if (!response || !response.messages) {
    console.log(format === "json" ? "[]" : JSON.stringify([], null, 2));
    return;
  }

  let messages = response.messages;

  // Apply sender filter if specified
  if (opts.from) {
    messages = messages.filter((msg: any) => msg.from === opts.from);
  }

  // Apply since filter if specified
  if (opts.since) {
    messages = messages.filter((msg: any) => msg.createdAt >= opts.since!);
  }

  // Process messages: decrypt group messages
  const processedMessages = await Promise.all(
    messages.map(async (msg: any) => {
      // Check if it's a group message
      if (msg.isGroupMessage && msg.typ === "group-encrypted") {
        try {
          // Get recipient's private key for decryption
          const identityName = session.identityName || ctx.config.defaultIdentity;
          if (!identityName) {
            throw new Error("No default identity set for decryption");
          }

          const recipientPrivateKey = await ctx.vault.getPrivateKey(identityName);
          const recipientAid = session.aid;

          // Decrypt the group message
          const groupMessage: GroupMessage = msg.ct;
          const senderPublicKey = msg.senderPublicKey;

          if (!senderPublicKey) {
            throw new Error(`No sender public key for group message ${msg.id}`);
          }

          // Convert base64url sender public key to Uint8Array
          const senderPublicKeyBytes = base64UrlToUint8Array(senderPublicKey);

          const decryptedMessage = await decryptGroupMessage(
            groupMessage,
            recipientPrivateKey,
            recipientAid,
            senderPublicKey
          );

          return {
            id: msg.id,
            from: msg.from,
            to: msg.to,
            typ: msg.typ,
            createdAt: msg.createdAt,
            isGroupMessage: true,
            groupId: msg.groupId,
            seqNo: msg.seqNo,
            message: decryptedMessage, // Decrypted plaintext
          };
        } catch (err: any) {
          // Return message with error if decryption fails
          return {
            id: msg.id,
            from: msg.from,
            to: msg.to,
            typ: msg.typ,
            createdAt: msg.createdAt,
            isGroupMessage: true,
            groupId: msg.groupId,
            seqNo: msg.seqNo,
            error: `Decryption failed: ${err.message}`,
          };
        }
      } else {
        // Direct message - return as-is (decryption can be added later)
        return {
          id: msg.id,
          from: msg.from,
          to: msg.to,
          ct: msg.ct,
          typ: msg.typ,
          createdAt: msg.createdAt,
          isGroupMessage: false,
        };
      }
    })
  );

  // Output in requested format
  switch (format) {
    case "json":
      // RFC8785 canonicalized JSON for deterministic test snapshots
      console.log(canonicalizeJSON(processedMessages));
      break;
    case "pretty":
      console.log(JSON.stringify(processedMessages, null, 2));
      // Add human-readable summary (to stderr, not stdout)
      if (!opts.noBanner) {
        const groupCount = processedMessages.filter((m: any) => m.isGroupMessage).length;
        const directCount = processedMessages.length - groupCount;
        console.error(`\nRetrieved ${processedMessages.length} unread messages (${directCount} direct, ${groupCount} group)`);
      }
      break;
    case "raw":
      console.log(JSON.stringify(processedMessages));
      break;
  }
}

/**
 * Helper: Convert base64url to Uint8Array
 */
function base64UrlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = base64 + padding;
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
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
