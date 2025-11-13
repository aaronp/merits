/**
 * extract-ids Command
 *
 * Extract message IDs from a message list (utility for piping to mark-as-read).
 *
 * Usage:
 *   merits extract-ids --file all-unread.json > message-ids.json
 *
 * Input format (messages.json):
 *   [
 *     { "id": "msg_1", "from": "bob", ... },
 *     { "id": "msg_2", "from": "joe", ... }
 *   ]
 *
 * Output (RFC8785 canonicalized JSON):
 *   ["msg_1", "msg_2"]
 */

import { readFileSync } from 'node:fs';
import { type GlobalOptions, normalizeFormat, withGlobalOptions } from '../lib/options';

export interface ExtractIdsOptions extends GlobalOptions {
  file: string; // Path to messages file
}

/**
 * Extract message IDs from message list
 *
 * @param opts Command options
 */
export const extractIds = withGlobalOptions(async (opts: ExtractIdsOptions) => {
  const format = normalizeFormat(opts.format);

  if (!opts.file) {
    throw new Error('--file is required');
  }

  // Load messages from file
  const fileContent = readFileSync(opts.file, 'utf-8');
  const messages = JSON.parse(fileContent);

  // Validate that we have an array
  if (!Array.isArray(messages)) {
    throw new Error('Invalid messages file format. Expected JSON array of messages.');
  }

  // Extract IDs
  const ids: string[] = [];
  for (const msg of messages) {
    if (msg.id) {
      ids.push(msg.id);
    } else {
      console.warn(`Warning: Message missing 'id' field: ${JSON.stringify(msg)}`);
    }
  }

  if (ids.length === 0) {
    console.error('Warning: No message IDs found in file');
  }

  // Output in requested format
  switch (format) {
    case 'json':
      // RFC8785 canonicalized JSON for deterministic test snapshots
      console.log(canonicalizeJSON(ids));
      break;
    case 'pretty':
      console.log(JSON.stringify(ids, null, 2));
      break;
    case 'raw':
      console.log(JSON.stringify(ids));
      break;
  }
});

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
