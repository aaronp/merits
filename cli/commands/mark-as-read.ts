/**
 * mark-as-read Command
 *
 * Mark messages as read (acknowledges them) (replaces `ack` command).
 * Messages are deleted server-side after acknowledgment.
 *
 * Usage:
 *   merits mark-as-read --credentials ${CREDENTIALS} --ids abc,def
 *   merits mark-as-read --credentials ${CREDENTIALS} --ids-data ./message-ids.json
 *
 * Output (RFC8785 canonicalized JSON):
 *   {
 *     "markedAsRead": ["msg_1", "msg_2"],
 *     "deleted": ["msg_1", "msg_2"]
 *   }
 */

import { readFileSync } from 'node:fs';
import { requireCredentials } from '../lib/credentials';
import { type GlobalOptions, normalizeFormat } from '../lib/options';

export interface MarkAsReadOptions extends GlobalOptions {
  ids?: string; // Comma-separated message IDs
  idsData?: string; // Path to JSON file with message IDs
}

/**
 * Mark messages as read
 *
 * @param positionalIds Positional message IDs (from [ids...] in command definition)
 * @param opts Command options
 */
export async function markAsRead(positionalIds: string[], opts: MarkAsReadOptions): Promise<void> {
  const format = normalizeFormat(opts.format);
  const ctx = opts._ctx;

  // Load and validate credentials
  const creds = requireCredentials(opts.credentials);

  // Parse message IDs from positional args, --ids, or --ids-data
  let messageIds: string[];

  if (positionalIds && positionalIds.length > 0) {
    // Use positional arguments
    messageIds = positionalIds;
  } else if (opts.ids) {
    // Parse comma-separated IDs
    messageIds = opts.ids
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  } else if (opts.idsData) {
    // Load IDs from JSON file
    const fileContent = readFileSync(opts.idsData, 'utf-8');
    const parsed = JSON.parse(fileContent);

    // Support both array format and object with ids field
    if (Array.isArray(parsed)) {
      messageIds = parsed;
    } else if (parsed.ids && Array.isArray(parsed.ids)) {
      messageIds = parsed.ids;
    } else {
      throw new Error("Invalid ids-data file format. Expected JSON array or object with 'ids' field.");
    }
  } else {
    throw new Error('Either positional IDs, --ids, or --ids-data is required');
  }

  if (messageIds.length === 0) {
    throw new Error('No message IDs provided');
  }

  // Mark messages as read via transport API
  const { signMutationArgs } = await import('../../core/signatures');
  const { base64UrlToUint8Array } = await import('../../core/crypto');

  const privateKeyBytes = base64UrlToUint8Array(creds.privateKey);

  // Acknowledge each message
  const markedAsRead: string[] = [];
  for (const messageId of messageIds) {
    try {
      const args = { messageId, receipt: [] };
      const sig = await signMutationArgs(args, privateKeyBytes, creds.aid);

      await ctx.client.transport.ackMessage({
        messageId,
        sig,
        receiptSig: [],
      });

      markedAsRead.push(messageId);
    } catch (err) {
      // Continue on errors but log them
      if (!opts.noBanner) {
        console.error(`Warning: Failed to mark message ${messageId} as read: ${(err as Error).message}`);
      }
    }
  }

  const result = {
    markedAsRead,
    deleted: markedAsRead, // Messages are deleted after acknowledgment
  };

  // Output in requested format
  switch (format) {
    case 'json':
      // RFC8785 canonicalized JSON for deterministic test snapshots
      console.log(canonicalizeJSON(result));
      break;
    case 'pretty':
      console.log(JSON.stringify(result, null, 2));
      // Add human-readable summary (to stderr, not stdout)
      if (!opts.noBanner) {
        console.error(`\n✓ Marked ${messageIds.length} messages as read`);
        console.error('  Messages have been deleted from the server');
      }
      break;
    case 'raw':
      console.log(JSON.stringify(result));
      break;
  }
}

/**
 * Canonicalize JSON according to RFC8785
 * - Sort object keys deterministically
 * - No whitespace
 */
function canonicalizeJSON(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalizeJSON).join(',')}]`;
  }

  // Sort object keys
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map((key) => {
    return `${JSON.stringify(key)}:${canonicalizeJSON(obj[key])}`;
  });

  return `{${entries.join(',')}}`;
}
