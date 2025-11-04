/**
 * ConvexTransport - Convex implementation of Transport interface
 *
 * Provides message send/receive/ack plus real-time subscribe functionality.
 */

import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type {
  Transport,
  MessageSendRequest,
  EncryptedMessage,
  SubscribeOptions,
} from "../../core/interfaces/Transport";
import { AuthProof, SignedRequest } from "../../core/types";
import { sha256Hex } from "../../core/crypto";
import { signMutationArgs } from "../../core/signatures";

/**
 * Convex implementation of Transport interface
 */
export class ConvexTransport implements Transport {
  constructor(private client: ConvexClient) { }

  async sendMessage(req: MessageSendRequest): Promise<{ messageId: string }> {
    // Compute ctHash client-side for binding
    const ctHash = this.computeCtHash(req.ct);

    const messageId = await this.client.mutation(api.messages.send, {
      recpAid: req.to,
      ct: req.ct,
      typ: req.typ,
      ek: req.ek,
      alg: req.alg,
      ttl: req.ttlMs,
      auth: {
        challengeId: req.auth.challengeId ? (req.auth.challengeId as Id<"challenges">) : undefined,
        sigs: req.auth.sigs,
        ksn: req.auth.ksn,
      },
    });

    return { messageId };
  }

  async receiveMessages(req: {
    for: string;
    auth?: AuthProof;
    sig?: SignedRequest;
  }): Promise<EncryptedMessage[]> {
    const messages = await this.client.mutation(api.messages.receive, {
      recpAid: req.for,
      auth: req.auth ? {
        challengeId: req.auth.challengeId ? (req.auth.challengeId as Id<"challenges">) : undefined,
        sigs: req.auth.sigs,
        ksn: req.auth.ksn,
      } : undefined,
      sig: req.sig,
    });

    return messages.map((m: any) => this.toEncryptedMessage(m, req.for));
  }

  async ackMessage(req: {
    messageId: string;
    auth?: AuthProof;
    sig?: SignedRequest;
    receiptSig?: string[];
  }): Promise<void> {
    await this.client.mutation(api.messages.acknowledge, {
      messageId: req.messageId as Id<"messages">,
      receipt: req.receiptSig ?? [],
      auth: req.auth
        ? {
            challengeId: req.auth.challengeId ? (req.auth.challengeId as Id<"challenges">) : undefined,
            sigs: req.auth.sigs,
            ksn: req.auth.ksn,
          }
        : undefined,
      sig: req.sig,
    });
  }

  /**
   * Subscribe to live message feed using Convex's reactive queries
   *
   * Uses the messages.list query with onUpdate to get real-time pushes.
   * Auto-acknowledges messages when onMessage returns true OR autoAck is set.
   * Generates signatures for each ack using provided credentials.
   */
  async subscribe(opts: SubscribeOptions): Promise<() => void> {
    // Track which messages we've already processed to avoid duplicates
    const processedIds = new Set<string>();

    // Subscribe to the reactive query
    const unsubscribe = this.client.onUpdate(
      api.messages.list,
      { recpAid: opts.for },
      async (messages: any[]) => {
        for (const msg of messages) {
          const id = msg._id ?? msg.id;
          // Skip already-processed messages
          if (processedIds.has(id)) {
            continue;
          }

          processedIds.add(id);

          try {
            const encryptedMsg = this.toEncryptedMessage(msg, opts.for);

            // Call user's handler
            const shouldAck = await opts.onMessage(encryptedMsg);

            // Auto-ack if handler returned true OR autoAck option is true
            const doAck = opts.autoAck !== undefined ? opts.autoAck : shouldAck;

            if (doAck) {
              // Generate signature for ack using credentials
              const ackArgs = {
                messageId: id,
                receipt: [],
              };
              const sig = await signMutationArgs(
                ackArgs,
                opts.credentials.privateKey,
                opts.credentials.aid
              );

              await this.ackMessage({
                messageId: id,
                sig,
              });

              // Remove from processed set after ack (message won't appear again)
              processedIds.delete(id);
            }
          } catch (err) {
            if (opts.onError) {
              opts.onError(err as Error);
            } else {
              throw err;
            }
          }
        }
      }
    );

    // Return cancel function
    return () => {
      unsubscribe();
      if (opts.onClose) {
        opts.onClose();
      }
    };
  }

  /**
   * Convert Convex message format to EncryptedMessage interface
   */
  private toEncryptedMessage(msg: any, recpAid: string): EncryptedMessage {
    return {
      id: msg._id ?? msg.id,
      from: msg.senderAid,
      to: recpAid,
      ct: msg.ct,
      ek: msg.ek,
      alg: msg.alg,
      typ: msg.typ,
      createdAt: msg.createdAt,
      expiresAt: msg.expiresAt,
      envelopeHash: msg.envelopeHash,
      senderProof: {
        sigs: msg.senderSig,
        ksn: msg.senderKsn,
        evtSaid: msg.senderEvtSaid,
      },
    };
  }

  /**
   * Compute SHA-256 hash of ciphertext
   */
  private computeCtHash(ct: string): string {
    const encoder = new TextEncoder();
    const data = encoder.encode(ct);
    return sha256Hex(data);
  }
}
