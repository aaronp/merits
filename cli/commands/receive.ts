/**
 * Receive Command - Retrieve and display messages
 *
 * Usage:
 *   merits receive
 *   merits receive --plaintext
 *   merits receive --plaintext --mark-read
 *   merits receive --format json
 */

import { getAuthProof } from "../lib/getAuthProof";
import type { CLIContext } from "../lib/context";
import chalk from "chalk";

export interface ReceiveOptions {
  from?: string;
  markRead?: boolean;
  format?: "json" | "text" | "compact";
  limit?: number;
  plaintext?: boolean;
  _ctx: CLIContext;
}

export async function receiveMessages(opts: ReceiveOptions): Promise<void> {
  const ctx = opts._ctx;

  // Resolve recipient identity
  const identityName = opts.from || ctx.config.defaultIdentity;
  if (!identityName) {
    throw new Error(
      "No default identity set. Use --from or: merits identity set-default <name>"
    );
  }

  const identity = await ctx.vault.getIdentity(identityName);

  // Create auth proof for receive operation
  const auth = await getAuthProof({
    client: ctx.client,
    vault: ctx.vault,
    identityName,
    purpose: "receive",
    args: {
      recpAid: identity.aid, // Backend expects recpAid, not 'for'
    },
  });

  // Silent in JSON mode
  if (!(opts.format === "json" || ctx.config.outputFormat === "json")) {
    console.log(`Retrieving messages for ${identityName}...`);
  }

  // Receive via backend-agnostic transport interface
  const messages = await ctx.client.transport.receiveMessages({
    for: identity.aid,
    auth,
  });

  if (messages.length === 0) {
    if (!(opts.format === "json" || ctx.config.outputFormat === "json")) {
      console.log(chalk.gray("No new messages."));
    } else {
      console.log(JSON.stringify([], null, 2));
    }
    return;
  }

  if (!(opts.format === "json" || ctx.config.outputFormat === "json")) {
    console.log(`Received ${messages.length} message(s)\n`);
  }

  // Decrypt if requested
  const displayMessages = [];
  for (const msg of messages) {
    let plaintext: string | undefined;

    if (opts.plaintext) {
      try {
        plaintext = await decryptMessage(ctx, identityName, msg.ct);
      } catch (err) {
        plaintext = `[Decryption failed: ${(err as Error).message}]`;
      }
    }

    displayMessages.push({
      id: msg.id,
      from: msg.from, // IMPORTANT: Use msg.from not msg.senderAid
      ct: msg.ct,
      plaintext,
      receivedAt: msg.createdAt,
      envelopeHash: msg.envelopeHash,
    });
  }

  // Format output
  if (opts.format === "json" || ctx.config.outputFormat === "json") {
    console.log(JSON.stringify(displayMessages, null, 2));
  } else if (opts.format === "compact") {
    for (const msg of displayMessages) {
      console.log(
        `${msg.id} | ${msg.from} | ${msg.plaintext || msg.ct.slice(0, 20) + "..."}`
      );
    }
  } else {
    // Text format (default)
    for (const msg of displayMessages) {
      console.log(chalk.bold(`Message ID: ${msg.id}`));
      console.log(`  From: ${msg.from}`);
      console.log(`  Time: ${new Date(msg.receivedAt).toLocaleString()}`);

      if (msg.plaintext) {
        console.log(`  Message: ${chalk.cyan(msg.plaintext)}`);
      } else {
        console.log(`  Ciphertext: ${msg.ct.slice(0, 50)}...`);
      }
      console.log();
    }
  }

  // Acknowledge if requested (combined operation optimization)
  // NOTE: This still does N+1 proofs (1 receive + N acks). A future optimization
  // would be a single receiveAndAck mutation with one proof.
  if (opts.markRead) {
    if (!(opts.format === "json" || ctx.config.outputFormat === "json")) {
      console.log(chalk.gray("Marking messages as read..."));
    }

    for (const msg of messages) {
      // Create receipt signature: sign ONLY the envelopeHash, not a JSON payload
      const receiptSig = await ctx.vault.signIndexed(
        identityName,
        new TextEncoder().encode(msg.envelopeHash)
      );

      // Get ack auth proof
      const ackAuth = await getAuthProof({
        client: ctx.client,
        vault: ctx.vault,
        identityName,
        purpose: "ack",
        args: {
          messageId: msg.id,
          recpAid: identity.aid, // Backend expects recpAid
        },
      });

      // Acknowledge via backend-agnostic interface
      // IMPORTANT: Field is 'receiptSig' not 'receipt'
      await ctx.client.transport.ackMessage({
        messageId: msg.id,
        receiptSig, // NOT 'receipt'!
        auth: ackAuth,
      });
    }

    if (!(opts.format === "json" || ctx.config.outputFormat === "json")) {
      console.log(chalk.green(`✅ Marked ${messages.length} message(s) as read`));
    }
  }
}

/**
 * Decrypt message using vault
 * STUB: Phase 3 uses base64 decoding (matches stub encryption)
 */
async function decryptMessage(
  ctx: CLIContext,
  identityName: string,
  ct: string
): Promise<string> {
  // TODO: Implement real decryption in Phase 4
  // For now, just base64 decode (matches stub encryption)
  return Buffer.from(ct, "base64").toString("utf-8");
}
