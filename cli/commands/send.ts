/**
 * Send Command - Send encrypted message to recipient
 *
 * Usage:
 *   merits send <recipient> --message "Hello"
 *   echo "Hello" | merits send <recipient>
 *   merits send <recipient> --ct <base64-ciphertext>
 */

import { getAuthProof } from "../lib/getAuthProof";
import { sha256Hex } from "../../core/crypto";
import type { CLIContext } from "../lib/context";

export interface SendOptions {
  message?: string;
  ct?: string;
  encryptFor?: string;
  from?: string;
  ttl?: number;
  typ?: string;
  ek?: string;
  alg?: string;
  format?: "json" | "text" | "compact";
  _ctx: CLIContext;
}

export async function sendMessage(
  recipient: string,
  opts: SendOptions
): Promise<void> {
  const ctx = opts._ctx;

  // Resolve sender identity
  const fromIdentity = opts.from || ctx.config.defaultIdentity;
  if (!fromIdentity) {
    throw new Error(
      "No default identity set. Use --from or: merits identity set-default <name>"
    );
  }

  const identity = await ctx.vault.getIdentity(fromIdentity);

  // Get message content
  let plaintext: string | undefined;
  let ct: string | undefined;

  if (opts.ct) {
    // Pre-encrypted mode
    ct = opts.ct;
  } else if (opts.message) {
    plaintext = opts.message;
  } else {
    // Read from stdin
    plaintext = await readStdin();
  }

  // Encrypt if plaintext provided
  if (plaintext) {
    const encryptionTarget = opts.encryptFor || recipient;

    // Get recipient's public key
    const recipientPublicKey = await fetchPublicKeyFor(ctx, encryptionTarget);

    // Encrypt message (STUB for Phase 3)
    ct = await encryptMessage(plaintext, recipientPublicKey);
  }

  if (!ct) {
    throw new Error("No message content provided");
  }

  // Compute content hash using core crypto (NOT ctx.client.computeCtHash!)
  const ctHash = sha256Hex(new TextEncoder().encode(ct));

  const ttlMs = opts.ttl ?? 24 * 60 * 60 * 1000;

  // Create auth proof (SINGLE proof for entire send operation)
  // IMPORTANT: Args MUST match backend verification exactly!
  const auth = await getAuthProof({
    client: ctx.client,
    vault: ctx.vault,
    identityName: fromIdentity,
    purpose: "send",
    args: {
      recpAid: recipient, // Match backend: recpAid not 'to'
      ctHash,
      ttl: ttlMs, // Match backend: ttl not 'ttlMs'
      alg: opts.alg ?? "",
      ek: opts.ek ?? "",
    },
  });

  // Silent in JSON mode
  if (!(opts.format === "json" || ctx.config.outputFormat === "json")) {
    console.log(`Sending message to ${recipient}...`);
  }

  // Send via backend-agnostic transport interface
  // IMPORTANT: Interface expects { to, ct, ttlMs, auth } and returns { messageId }
  const result = await ctx.client.transport.sendMessage({
    to: recipient, // NOT recpAid!
    ct,
    typ: opts.typ,
    ek: opts.ek,
    alg: opts.alg,
    ttlMs, // NOT ttl!
    auth,
  });

  const messageId = result.messageId;

  // Output result
  if (opts.format === "json" || ctx.config.outputFormat === "json") {
    console.log(
      JSON.stringify({ messageId, recipient, sentAt: Date.now() }, null, 2)
    );
  } else {
    console.log(`✅ Message sent successfully!`);
    console.log(`   Message ID: ${messageId}`);
  }
}

/**
 * Fetch public key for a recipient
 * STUB: Only supports local identities for Phase 3
 */
async function fetchPublicKeyFor(
  ctx: CLIContext,
  aid: string
): Promise<Uint8Array> {
  // Check if it's a local identity first
  try {
    return await ctx.vault.getPublicKey(aid);
  } catch {
    // Not local, fetch from backend
    try {
      const result = await ctx.client.identityRegistry.getPublicKey(aid);
      return result.publicKey;
    } catch (err: any) {
      throw new Error(
        `Failed to fetch public key for ${aid}: ${err.message}`
      );
    }
  }
}

/**
 * Encrypt message for recipient
 * STUB: Phase 3 uses base64 encoding (NOT SECURE!)
 * Real encryption deferred to Phase 4
 */
async function encryptMessage(
  plaintext: string,
  publicKey: Uint8Array
): Promise<string> {
  // TODO: Implement ECDH-ES + AES-GCM encryption in Phase 4
  // For now, just base64 encode (NOT SECURE!)
  return Buffer.from(plaintext).toString("base64");
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
