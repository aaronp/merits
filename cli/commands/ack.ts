/**
 * Ack Command - Acknowledge message receipt
 *
 * Usage:
 *   merits ack <message-id> --envelope-hash <hash>
 *   merits ack <message-id> --envelope-hash <hash> --from alice
 */

import { getAuthProof } from "../lib/getAuthProof";
import type { CLIContext } from "../lib/context";

export interface AckOptions {
  envelopeHash: string; // REQUIRED: Envelope hash to sign
  from?: string;
  _ctx: CLIContext;
}

export async function ackMessage(
  messageId: string,
  opts: AckOptions
): Promise<void> {
  const ctx = opts._ctx;

  if (!opts.envelopeHash) {
    throw new Error("--envelope-hash is required for ack command");
  }

  const identityName = opts.from || ctx.config.defaultIdentity;
  if (!identityName) {
    throw new Error(
      "No default identity set. Use --from or: merits identity set-default <name>"
    );
  }

  const identity = await ctx.vault.getIdentity(identityName);

  // Create receipt signature: sign ONLY the envelopeHash, not a JSON payload
  const receiptSig = await ctx.vault.signIndexed(
    identityName,
    new TextEncoder().encode(opts.envelopeHash)
  );

  // Get ack auth proof
  const auth = await getAuthProof({
    client: ctx.client,
    vault: ctx.vault,
    identityName,
    purpose: "ack",
    args: {
      messageId,
      for: identity.aid,
    },
  });

  // Acknowledge via backend-agnostic interface
  // IMPORTANT: Field is 'receiptSig' not 'receipt'
  await ctx.client.transport.ackMessage({
    messageId,
    receiptSig, // NOT 'receipt'!
    auth,
  });

  console.log(`✅ Message ${messageId} acknowledged`);
}
