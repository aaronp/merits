/**
 * Send Command - Send message to recipient
 *
 * Simplified token-based messaging. Backend handles all encryption/decryption.
 *
 * Usage:
 *   merits send <recipient> --message "Hello" --token identity.json
 *   echo "Hello" | merits send <recipient> --token identity.json
 */

import { requireSessionToken } from "../lib/session";
import type { GlobalOptions } from "../lib/options";

export interface SendOptions extends GlobalOptions {
  message?: string;
  token?: string;
}

export async function sendMessage(
  recipient: string,
  opts: SendOptions
): Promise<void> {
  const ctx = opts._ctx;

  // Load session token
  const session = requireSessionToken(opts.token);

  // Get message content
  let message: string;
  if (opts.message) {
    message = opts.message;
  } else {
    // Read from stdin
    message = await readStdin();
  }

  if (!message) {
    throw new Error("No message content provided");
  }

  // Send via backend (backend handles encryption)
  const result = await ctx.client.transport.sendMessage({
    token: session.token,
    to: recipient,
    message,
  });

  // Output result as JSON
  console.log(JSON.stringify({
    messageId: result.messageId,
    recipient,
    sentAt: Date.now(),
  }));
}

/**
 * Read from stdin
 */
async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}
