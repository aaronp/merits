/**
 * Send Command - Send encrypted message to recipient
 *
 * End-to-end encrypted messaging with RBAC enforcement.
 *
 * Two modes:
 * 1. Normal mode (--message): Encrypts message with recipient's public key
 * 2. Raw mode (--raw): Sends pre-encrypted ciphertext as-is
 *
 * Usage:
 *   merits send <recipient> --message "Hello" --credentials identity.json
 *   merits send <recipient> --message "Hello" --typ "chat.text" --credentials identity.json
 *   echo "Hello" | merits send <recipient> --credentials identity.json
 *   merits send <recipient> --raw <base64url-ciphertext> --alg "x25519-xsalsa20poly1305"
 */

import { requireCredentials } from "../lib/credentials";
import type { GlobalOptions } from "../lib/options";

export interface SendOptions extends GlobalOptions {
  message?: string;
  raw?: string; // Pre-encrypted ciphertext (base64url)
  credentials?: string;
  typ?: string; // Message type for routing/authorization
  alg?: string; // Algorithm identifier (for raw mode)
  ek?: string; // Ephemeral key (for raw mode)
  ttl?: number; // TTL in milliseconds
}

export async function sendMessage(
  recipient: string,
  opts: SendOptions
): Promise<void> {
  const ctx = opts._ctx;

  try {
    // Load credentials
    const creds = requireCredentials(opts.credentials);

    let messageId: string;

    if (opts.raw) {
      // RAW MODE: Send pre-encrypted ciphertext as-is
      if (!opts.alg) {
        throw new Error("--alg is required when using --raw mode");
      }

      messageId = await ctx.client.sendRawMessage(
        recipient,
        opts.raw,
        creds,
        {
          typ: opts.typ,
          alg: opts.alg,
          ek: opts.ek,
          ttl: opts.ttl,
        }
      );
    } else {
      // NORMAL MODE: Encrypt message with recipient's public key
      let message: string;
      if (opts.message) {
        message = opts.message;
      } else {
        // Try reading from stdin
        message = await readStdin();
      }

      if (!message) {
        throw new Error("No message provided (use --message or pipe to stdin)");
      }

      // Use high-level API that handles encryption
      messageId = await ctx.client.sendMessage(
        recipient,
        message,
        creds,
        {
          typ: opts.typ,
          ttl: opts.ttl,
        }
      );
    }

    // Output result as JSON
    console.log(JSON.stringify({
      messageId,
      recipient,
      sentAt: Date.now(),
    }));
  } catch (error: any) {
    // Handle permission/RBAC errors
    // Convex sometimes returns generic "Server Error" for permission denials
    if (error.message?.includes("Not permitted") ||
        error.message?.includes("permission") ||
        error.message?.includes("Cannot send message") ||
        error.message?.includes("Server Error")) {
      // Standardize error message for RBAC/permission denials
      throw new Error("Role denied");
    }

    // Re-throw other errors to be handled by the global error handler
    throw error;
  }
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
