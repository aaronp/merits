/**
 * Unread Command - Retrieve unread messages
 *
 * Simplified credentials-based message retrieval. Backend handles all decryption.
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

  // Use signed request authentication via transport API
  const { signMutationArgs } = await import("../../core/signatures");
  const { base64UrlToUint8Array } = await import("../../core/crypto");
  const privateKeyBytes = base64UrlToUint8Array(creds.privateKey);

  // Sign the request
  const args = { recpAid: creds.aid };
  const sig = await signMutationArgs(args, privateKeyBytes, creds.aid);

  // Fetch messages via transport API
  const encryptedMessages = await ctx.client.transport.receiveMessages({
    for: creds.aid,
    sig,
  });

  // TODO: Decrypt messages client-side
  // For now, return messages with encrypted content
  const messages = encryptedMessages.map((m: any) => ({
    messageId: m.id,
    senderAid: m.from,
    ct: m.ct,
    alg: m.alg,
    typ: m.typ,
    createdAt: m.timestamp,
    expiresAt: m.expiresAt,
    // Add placeholder for decrypted content
    decryptedContent: "[Encrypted - decryption not yet implemented]",
  }));

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
        const groupCount = filteredMessages.filter((m: any) => m.typ?.includes("group")).length;
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
