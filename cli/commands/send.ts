/**
 * Send Command - Send encrypted message to recipient (direct or group)
 *
 * End-to-end encrypted messaging with RBAC enforcement.
 *
 * Direct Messages:
 * - Recipient format: AID starting with 'D' or 'E' (CESR-encoded)
 * - Uses X25519-XChaCha20-Poly1305 encryption
 *
 * Group Messages:
 * - Recipient format: Group ID (not starting with 'D' or 'E')
 * - Uses ephemeral AES-256-GCM group encryption
 * - Zero-knowledge: Backend cannot decrypt
 *
 * Usage:
 *   # Direct message
 *   merits send <AID> --message "Hello" --credentials identity.json
 *
 *   # Group message
 *   merits send <group-id> --message "Hello team" --credentials identity.json
 *
 *   # Pre-encrypted (direct only)
 *   merits send <AID> --raw <base64url-ciphertext> --alg "x25519-xsalsa20poly1305"
 */

import { requireCredentials } from '../lib/credentials';
import type { GlobalOptions } from '../lib/options';

export interface SendOptions extends GlobalOptions {
  message?: string;
  raw?: string; // Pre-encrypted ciphertext (base64url)
  credentials?: string;
  typ?: string; // Message type for routing/authorization
  alg?: string; // Algorithm identifier (for raw mode)
  ek?: string; // Ephemeral key (for raw mode)
  ttl?: number; // TTL in milliseconds
}

export async function sendMessage(recipient: string, opts: SendOptions): Promise<void> {
  const _ctx = opts._ctx;

  try {
    // Load credentials
    const creds = requireCredentials(opts.credentials);

    // Detect recipient type: AID (starts with 'D' or 'E') vs group ID
    const isDirectMessage = isValidAID(recipient);

    if (isDirectMessage) {
      // DIRECT MESSAGE: Send to an AID
      await sendDirectMessage(recipient, creds, opts);
    } else {
      // GROUP MESSAGE: Send to a group
      await sendGroupMessage(recipient, creds, opts);
    }
  } catch (error: any) {
    // Handle permission/RBAC errors
    // Convex sometimes returns generic "Server Error" for permission denials
    if (
      error.message?.includes('Not permitted') ||
      error.message?.includes('permission') ||
      error.message?.includes('Cannot send message') ||
      error.message?.includes('Server Error')
    ) {
      // Standardize error message for RBAC/permission denials
      throw new Error('Role denied');
    }

    // Re-throw other errors to be handled by the global error handler
    throw error;
  }
}

/**
 * Send direct message to an AID
 */
async function sendDirectMessage(recipient: string, creds: any, opts: SendOptions): Promise<void> {
  const ctx = opts._ctx;
  let messageId: string;

  if (opts.raw) {
    // RAW MODE: Send pre-encrypted ciphertext as-is
    if (!opts.alg) {
      throw new Error('--alg is required when using --raw mode');
    }

    messageId = await ctx.client.sendRawMessage(recipient, opts.raw, creds, {
      typ: opts.typ,
      alg: opts.alg,
      ek: opts.ek,
      ttl: opts.ttl,
    });
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
      throw new Error('No message provided (use --message or pipe to stdin)');
    }

    // Use high-level API that handles encryption
    messageId = await ctx.client.sendMessage(recipient, message, creds, {
      typ: opts.typ,
      ttl: opts.ttl,
    });
  }

  // Output result as JSON
  console.log(
    JSON.stringify({
      messageId,
      recipient,
      sentAt: Date.now(),
    }),
  );
}

/**
 * Send encrypted group message
 *
 * Implements zero-knowledge group encryption where the backend cannot decrypt messages.
 * Uses ephemeral AES-256-GCM keys with per-member key distribution via X25519 ECDH.
 */
async function sendGroupMessage(groupId: string, creds: any, opts: SendOptions): Promise<void> {
  const ctx = opts._ctx;

  // Group messages don't support raw/pre-encrypted mode
  if (opts.raw) {
    throw new Error('Group messages do not support pre-encrypted content (--raw). Use --message instead.');
  }

  // Get message content
  let plaintext: string;
  if (opts.message) {
    plaintext = opts.message;
  } else {
    plaintext = await readStdin();
  }

  if (!plaintext) {
    throw new Error('No message provided (use --message or pipe to stdin)');
  }

  // Use high-level API that handles encryption and authentication
  const result = await ctx.client.sendGroupMessage(groupId, plaintext, creds, {
    typ: opts.typ,
  });

  // Output result as JSON
  console.log(
    JSON.stringify({
      groupId,
      messageId: result.messageId,
      seqNo: result.seqNo,
      sentAt: result.sentAt,
    }),
  );
}

/**
 * Check if recipient is a valid AID (CESR-encoded identifier)
 * AIDs typically start with 'D' (SHA256 digest) or 'E' (Ed25519 public key)
 */
function isValidAID(recipient: string): boolean {
  // KERI AIDs are CESR-encoded and typically start with 'D' or 'E'
  // Basic check: starts with capital letter and is ~44 chars (base64url)
  return /^[DE][A-Za-z0-9_-]{42,}$/.test(recipient);
}

/**
 * Read from stdin
 */
async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8').trim();
}
