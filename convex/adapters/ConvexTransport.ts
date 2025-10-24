/**
 * ConvexTransport - Convex implementation of Transport interface
 *
 * Provides message send/receive/ack plus real-time subscribe functionality.
 */

import { ConvexClient } from "convex/browser";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  Transport,
  MessageSendRequest,
  EncryptedMessage,
  SubscribeOptions,
} from "../../core/interfaces/Transport";
import { AuthProof } from "../../core/types";

/**
 * Convex implementation of Transport interface
 */
export class ConvexTransport implements Transport {
  constructor(private client: ConvexClient) { }

  async sendMessage(req: MessageSendRequest): Promise<{ messageId: string }> {
    // Compute ctHash client-side for binding
    const ctHash = await this.computeCtHash(req.ct);

    const messageId = await this.client.mutation(api.messages.send, {
      recpAid: req.to,
      ct: req.ct,
      typ: req.typ,
      ek: req.ek,
      alg: req.alg,
      ttl: req.ttlMs,
      auth: {
        challengeId: req.auth.challengeId as Id<"challenges">,
        sigs: req.auth.sigs,
        ksn: req.auth.ksn,
      },
    });

    return { messageId };
  }

  async receiveMessages(req: {
    for: string;
    auth: AuthProof;
  }): Promise<EncryptedMessage[]> {
    const messages = await this.client.mutation(api.messages.receive, {
      recpAid: req.for,
      auth: {
        challengeId: req.auth.challengeId as Id<"challenges">,
        sigs: req.auth.sigs,
        ksn: req.auth.ksn,
      },
    });

    return messages.map((m: any) => this.toEncryptedMessage(m, req.for));
  }

  async ackMessage(req: {
    messageId: string;
    auth: AuthProof;
    receiptSig?: string[];
  }): Promise<void> {
    await this.client.mutation(api.messages.acknowledge, {
      messageId: req.messageId as Id<"messages">,
      receipt: req.receiptSig ?? [],
      auth: {
        challengeId: req.auth.challengeId as Id<"challenges">,
        sigs: req.auth.sigs,
        ksn: req.auth.ksn,
      },
    });
  }

  /**
   * Subscribe to live message feed using Convex's reactive queries
   *
   * Uses the messages.list query with onUpdate to get real-time pushes.
   * Auto-acknowledges messages when onMessage returns true.
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

            // Auto-ack if handler returned true
            if (shouldAck) {
              await this.ackMessage({
                messageId: id,
                auth: opts.auth,
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
    return () => unsubscribe();
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
  private async computeCtHash(ct: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(ct);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
}
