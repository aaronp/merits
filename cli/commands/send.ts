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
import { normalizeFormat, type GlobalOptions } from "../lib/options";
import { encryptForGroup, type GroupMessage } from "../lib/crypto-group";

export interface SendOptions extends GlobalOptions {
  message?: string;
  ct?: string;
  encryptFor?: string;
  from?: string;
  ttl?: number;
  typ?: string;
  ek?: string;
  alg?: string;
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

  const format = normalizeFormat(opts.format || ctx.config.outputFormat);
  
  // Silent in JSON mode
  if (format === "json" || format === "pretty" || format === "raw") {
    // Silent for JSON formats
  } else {
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
  const output = {
    messageId,
    recipient: recipientAid,
    sentAt: Date.now(),
  };

  if (format === "json") {
    // Canonicalized JSON (RFC8785)
    const canonical = JSON.stringify(output, Object.keys(output).sort());
    console.log(canonical);
  } else if (format === "pretty") {
    console.log(JSON.stringify(output, null, 2));
  } else if (format === "raw") {
    console.log(JSON.stringify(output));
  } else {
    // Fallback to pretty
    console.log(JSON.stringify(output, null, 2));
  }
}

/**
 * Send group message with end-to-end encryption
 * Uses X25519 ECDH + AES-256-GCM for group encryption
 */
async function sendGroupMessage(
  ctx: CLIContext,
  identity: any,
  groupId: string,
  fromIdentity: string,
  opts: SendOptions
): Promise<void> {
  // Get message content
  let plaintext: string | undefined;

  if (opts.ct) {
    throw new Error("Group messages do not support pre-encrypted content (--ct). Use --message instead.");
  } else if (opts.message) {
    plaintext = opts.message;
  } else {
    plaintext = await readStdin();
  }

  if (!plaintext) {
    throw new Error("No message content provided");
  }

  const format = normalizeFormat(opts.format || ctx.config.outputFormat);

  // Silent in JSON mode
  if (format !== "json" && format !== "pretty" && format !== "raw") {
    console.log(`Encrypting message for group ${groupId}...`);
  }

  // Step 1: Get group members with their public keys
  const senderAid = identity.aid || identity.prefix;
  const membersResponse = await ctx.client.query(ctx.api.groups.getMembers, {
    groupChatId: groupId,
    callerAid: senderAid,
  });

  if (!membersResponse || !membersResponse.members || membersResponse.members.length === 0) {
    throw new Error(`No members found for group ${groupId}`);
  }

  // Convert members to the format expected by encryptForGroup
  const members: Record<string, string> = {};
  for (const member of membersResponse.members) {
    if (!member.publicKey) {
      throw new Error(`Member ${member.aid} has no public key`);
    }
    members[member.aid] = member.publicKey; // Ed25519 public keys in base64url
  }

  if (format !== "json" && format !== "pretty" && format !== "raw") {
    console.log(`Found ${Object.keys(members).length} members, encrypting...`);
  }

  // Step 2: Get sender's private key
  const senderPrivateKey = await ctx.vault.getPrivateKey(fromIdentity);

  // Step 3: Encrypt message for all group members using group encryption
  const groupMessage: GroupMessage = await encryptForGroup(
    plaintext,
    members,
    senderPrivateKey,
    groupId,
    senderAid
  );

  // Step 4: Create auth proof for sending
  // Bind to a hash of the encrypted content for integrity
  const contentHash = groupMessage.encryptedContent.substring(0, 32);
  const auth = await getAuthProof({
    client: ctx.client,
    vault: ctx.vault,
    identityName: fromIdentity,
    purpose: "sendGroupMessage",
    args: {
      groupChatId: groupId,
      contentHash,
    },
  });

  if (format !== "json" && format !== "pretty" && format !== "raw") {
    console.log(`Sending encrypted message to group...`);
  }

  // Step 5: Send encrypted GroupMessage to backend
  const result = await ctx.client.mutation(ctx.api.groups.sendGroupMessage, {
    groupChatId: groupId,
    groupMessage,
    auth,
  });

  // Output result
  const output = {
    groupId,
    messageId: result.messageId,
    seqNo: result.seqNo,
    sentAt: result.sentAt || Date.now(),
  };

  if (format === "json") {
    // Canonicalized JSON (RFC8785)
    const canonical = JSON.stringify(output, Object.keys(output).sort());
    console.log(canonical);
  } else if (format === "pretty") {
    console.log(JSON.stringify(output, null, 2));
  } else if (format === "raw") {
    console.log(JSON.stringify(output));
  } else {
    // Fallback to pretty
    console.log(JSON.stringify(output, null, 2));
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
