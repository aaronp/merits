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

  // Detect recipient type: AID (starts with 'D' or 'E') vs group ID
  const isDirectMessage = isValidAID(recipient);

  if (isDirectMessage) {
    await sendDirectMessage(ctx, identity, recipient, fromIdentity, opts);
  } else {
    await sendGroupMessage(ctx, identity, recipient, fromIdentity, opts);
  }
}

/**
 * Send direct message to an AID
 */
async function sendDirectMessage(
  ctx: CLIContext,
  identity: any,
  recipientAid: string,
  fromIdentity: string,
  opts: SendOptions
): Promise<void> {
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
    const encryptionTarget = opts.encryptFor || recipientAid;

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
      recpAid: recipientAid, // Match backend: recpAid not 'to'
      ctHash,
      ttl: ttlMs, // Match backend: ttl not 'ttlMs'
      alg: opts.alg ?? "",
      ek: opts.ek ?? "",
    },
  });

  // Silent in JSON mode
  if (!(opts.format === "json" || ctx.config.outputFormat === "json")) {
    console.log(`Sending message to ${recipientAid}...`);
  }

  // Send via backend-agnostic transport interface
  // IMPORTANT: Interface expects { to, ct, ttlMs, auth } and returns { messageId }
  const result = await ctx.client.transport.sendMessage({
    to: recipientAid, // NOT recpAid!
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
      JSON.stringify({ messageId, recipient: recipientAid, sentAt: Date.now() }, null, 2)
    );
  } else {
    console.log(`✅ Message sent successfully!`);
    console.log(`   Message ID: ${messageId}`);
  }
}

/**
 * Send group message (Phase 4)
 * Backend handles fanout to all members
 */
async function sendGroupMessage(
  ctx: CLIContext,
  identity: any,
  groupId: string,
  fromIdentity: string,
  opts: SendOptions
): Promise<void> {
  // Get message content (same as direct send)
  let plaintext: string | undefined;
  let ct: string | undefined;

  if (opts.ct) {
    ct = opts.ct;
  } else if (opts.message) {
    plaintext = opts.message;
  } else {
    plaintext = await readStdin();
  }

  // For group messages, we encrypt with placeholder key
  // Backend will re-encrypt for each member
  if (plaintext) {
    // Use sender's own public key as placeholder
    const recipientPublicKey = await ctx.vault.getPublicKey(fromIdentity);
    ct = await encryptMessage(plaintext, recipientPublicKey);
  }

  if (!ct) {
    throw new Error("No message content provided");
  }

  const ctHash = sha256Hex(new TextEncoder().encode(ct));
  const ttlMs = opts.ttl ?? 24 * 60 * 60 * 1000;

  // Auth proof with purpose "sendGroup" (Phase 4)
  const auth = await getAuthProof({
    client: ctx.client,
    vault: ctx.vault,
    identityName: fromIdentity,
    purpose: "sendGroup",
    args: {
      groupId,
      ctHash,
      ttl: ttlMs,
    },
  });

  // Silent in JSON mode
  if (!(opts.format === "json" || ctx.config.outputFormat === "json")) {
    console.log(`Sending message to group ${groupId}...`);
  }

  // Send via GroupApi interface
  const result = await ctx.client.group.sendGroupMessage({
    groupId,
    ct,
    typ: opts.typ,
    ttlMs,
    auth,
  });

  // Output result
  if (opts.format === "json" || ctx.config.outputFormat === "json") {
    console.log(
      JSON.stringify({ messageId: result.messageId, groupId, sentAt: Date.now() }, null, 2)
    );
  } else {
    console.log(`✅ Message sent to group!`);
    console.log(`   Message ID: ${result.messageId}`);
  }
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
