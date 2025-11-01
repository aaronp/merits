/**
 * Unread Command - Retrieve and decrypt unread messages
 *
 * Fetches all unread messages from the unified inbox (direct + group messages)
 * and decrypts group messages client-side.
 *
 * Features:
 * - Unified inbox: Both direct and group messages
 * - Client-side decryption: Group messages decrypted using user's private key
 * - Filtering: By sender (--from) or timestamp (--since)
 * - Multiple formats: json, pretty, raw
 * - Watch mode: Real-time streaming (coming soon)
 *
 * Message Types:
 * 1. Direct Messages:
 *    - typ: "encrypted"
 *    - ct: Ciphertext string (not decrypted in this command)
 *    - isGroupMessage: false
 *
 * 2. Group Messages:
 *    - typ: "group-encrypted"
 *    - ct: GroupMessage object with encryptedContent and encryptedKeys
 *    - Automatically decrypted using recipient's private key
 *    - message: Decrypted plaintext added to output
 *    - isGroupMessage: true
 *
 * Group Message Decryption:
 * 1. Extract encrypted key for this recipient from GroupMessage
 * 2. Perform ECDH with sender's public key to derive shared secret
 * 3. Decrypt ephemeral group key using shared secret
 * 4. Decrypt message content using ephemeral group key
 * 5. Return plaintext in "message" field
 *
 * Usage Examples:
 *   # Get all unread messages
 *   merits unread --token $TOKEN
 *
 *   # Filter by sender
 *   merits unread --token $TOKEN --from alice
 *
 *   # Replay messages after downtime
 *   merits unread --token $TOKEN --since 1730476800000
 *
 *   # Output formats
 *   merits unread --token $TOKEN --format json   # RFC8785 canonical
 *   merits unread --token $TOKEN --format pretty # Pretty-printed
 *
 *   # Watch mode (real-time streaming - coming soon)
 *   merits unread --token $TOKEN --watch
 *
 * Output Format (RFC8785 canonicalized JSON):
 *   [
 *     {
 *       "id": "<message-id>",
 *       "from": "alice-aid",
 *       "to": "bob-aid",
 *       "typ": "group-encrypted",
 *       "createdAt": 1730476800000,
 *       "isGroupMessage": true,
 *       "groupId": "group-123",
 *       "seqNo": 42,
 *       "message": "Hello team!"  // Decrypted plaintext
 *     },
 *     ...
 *   ]
 *
 * @see fetchMessages() for message retrieval and decryption logic
 * @see decryptGroupMessage() in crypto-group.ts for group decryption
 * @see messages.getUnread() backend API
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
 * Fetch and decrypt unread messages (one-time fetch)
 *
 * Retrieves all unread messages from the backend and decrypts group messages client-side.
 * Direct messages are returned as-is (ciphertext) since direct message decryption
 * is handled separately.
 *
 * Message Processing:
 * 1. Call backend messages.getUnread() for unified inbox
 * 2. Apply filters (--from sender, --since timestamp)
 * 3. For each group message:
 *    - Extract GroupMessage structure from ct field
 *    - Get recipient's private key from vault
 *    - Call decryptGroupMessage() to decrypt
 *    - Add decrypted plaintext to "message" field
 * 4. Return all messages in requested format
 *
 * Error Handling:
 * - If group message decryption fails, returns message with error field
 * - Direct messages are never decrypted (returned as-is)
 * - Missing sender public keys cause decryption error
 *
 * Output Formats:
 * - json: RFC8785 canonicalized JSON (deterministic, sorted keys, no whitespace)
 * - pretty: Pretty-printed JSON with 2-space indentation and summary
 * - raw: Minified JSON (no formatting)
 *
 * @param opts - Command options including filters and format
 * @param session - Session token with user AID and identity
 * @param ctx - CLI context with client and vault access
 * @param format - Output format (json, pretty, or raw)
 *
 * @see messages.getUnread() backend API for message retrieval
 * @see decryptGroupMessage() in crypto-group.ts for decryption
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
