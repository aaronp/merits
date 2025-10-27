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
import { sha256Hex } from "../../core/crypto";

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
    auth?: AuthProof;
    sessionToken?: string;
    receiptSig?: string[];
  }): Promise<void> {
    await this.client.mutation(api.messages.acknowledge, {
      messageId: req.messageId as Id<"messages">,
      receipt: req.receiptSig ?? [],
      auth: req.auth
        ? {
            challengeId: req.auth.challengeId as Id<"challenges">,
            sigs: req.auth.sigs,
            ksn: req.auth.ksn,
          }
        : undefined,
      sessionToken: req.sessionToken,
    });
  }

  /**
   * Subscribe to live message feed using Convex's reactive queries
   *
   * Phase 4: Supports both auth proof and session token
   *
   * Uses the messages.list query with onUpdate to get real-time pushes.
   * Auto-acknowledges messages when onMessage returns true OR autoAck is set.
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
              // Phase 4: Use session token if provided, otherwise auth proof
              await this.ackMessage({
                messageId: id,
                auth: opts.auth,
                sessionToken: opts.sessionToken,
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
   * Phase 4: Open authenticated session for streaming operations
   */
  async openSession(req: {
    aid: string;
    scopes: ("receive" | "ack")[];
    ttlMs: number;
    auth: AuthProof;
  }): Promise<{ token: string; expiresAt: number }> {
    const result = await this.client.mutation(api.sessions.openSession, {
      aid: req.aid,
      scopes: req.scopes,
      ttlMs: req.ttlMs,
      auth: {
        challengeId: req.auth.challengeId as Id<"challenges">,
        sigs: req.auth.sigs,
        ksn: req.auth.ksn,
      },
    });

    return {
      token: result.token,
      expiresAt: result.expiresAt,
    };
  }

  /**
   * Phase 4: Refresh session token for active subscription
   */
  async refreshSessionToken(req: {
    for: string;
    sessionToken: string;
  }): Promise<void> {
    await this.client.mutation(api.sessions.refreshSessionToken, {
      forAid: req.for,
      sessionToken: req.sessionToken,
    });
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
