/**
 * Convex Transport Implementation
 *
 * Implements Transport interface with:
 * - Challenge-response authentication
 * - Message SAID computation
 * - Automatic signature generation
 * - WebSocket subscriptions with cursor management
 * - At-least-once + idempotent delivery
 */

import { ConvexClient } from 'convex/browser';
import type { AID, Channel, Message, SAID, Signature, Signer, Transport, TransportConfig } from './types';

/**
 * ConvexTransport - KERI message transport over Convex
 */
export class ConvexTransport implements Transport {
  private client: ConvexClient;
  private config: TransportConfig;

  constructor(config: TransportConfig) {
    this.config = config;
    this.client = new ConvexClient(config.convexUrl);
  }

  /**
   * Send a message
   * 1. Compute bodyHash
   * 2. Compute envelope SAID
   * 3. Sign envelope SAID
   * 4. Challenge-response authentication
   * 5. Submit to Convex (idempotent by SAID)
   */
  async send(msg: Omit<Message, 'id' | 'sigs'>): Promise<SAID> {
    // 1. Compute bodyHash
    const bodyHash = await this.computeHash(msg.body);

    // 2. Compute envelope SAID
    const envelope = {
      from: msg.from,
      to: msg.to,
      typ: msg.typ,
      refs: msg.refs,
      dt: msg.dt,
      bodyHash,
    };
    const messageId = await this.computeSAID(envelope);

    // 3. Sign envelope SAID
    const encoder = new TextEncoder();
    const signature = await this.config.signer.sign(encoder.encode(messageId));
    const _sigs: Signature[] = [{ ksn: this.config.ksn, sig: signature }];

    // 4. Challenge-response (TODO: implement with actual Convex mutations)
    // const argsHash = await this.computeArgsHash({ messageId, to: msg.to });
    // const { challengeId, payload } = await this.issueChallenge('sendMessage', argsHash);
    // const challengeSig = await this.config.signer.sign(encoder.encode(JSON.stringify(payload)));

    // 5. Submit message (idempotent by messageId)
    // await this.client.mutation(api.messages.send, {
    //   message: { ...msg, id: messageId, sigs },
    //   challengeId,
    //   signature: challengeSig
    // });

    // TODO: Replace with actual Convex call
    console.log('ConvexTransport.send:', { messageId, to: msg.to, typ: msg.typ });

    return messageId;
  }

  /**
   * Get channel for receiving messages
   * Uses WebSocket subscription with cursor management
   */
  channel(aid: AID): Channel {
    const _cursor = Date.now();

    return {
      subscribe: (_onMessage) => {
        // TODO: Implement with Convex subscription
        // const unwatch = this.client.onUpdate(
        //   api.messages.subscribeToAid,
        //   { aid, since: cursor },
        //   (messages) => {
        //     messages.forEach(onMessage);
        //     if (messages.length > 0) {
        //       cursor = Math.max(...messages.map(m => m.createdAt));
        //     }
        //   }
        // );
        // return unwatch;

        console.log('ConvexTransport.channel.subscribe:', { aid });
        return () => {
          console.log('ConvexTransport.channel.unsubscribe:', { aid });
        };
      },
    };
  }

  /**
   * Read unread messages (poll-based)
   */
  async readUnread(aid: AID, limit: number = 100): Promise<Message[]> {
    // TODO: Implement with Convex query
    // return await this.client.query(api.messages.getUnread, { aid, limit });
    console.log('ConvexTransport.readUnread:', { aid, limit });
    return [];
  }

  /**
   * Acknowledge messages (idempotent)
   */
  async ack(aid: AID, messageIds: SAID[]): Promise<void> {
    // TODO: Implement with Convex mutation + challenge-response
    // const argsHash = await this.computeArgsHash({ aid, messageIds });
    // const { challengeId, payload } = await this.issueChallenge('ackMessages', argsHash);
    // const signature = await this.config.signer.sign(...);
    // await this.client.mutation(api.messages.ack, { aid, messageIds, challengeId, signature });
    console.log('ConvexTransport.ack:', { aid, count: messageIds.length });
  }

  /**
   * Close transport
   */
  close(): void {
    this.client.close();
  }

  // ========== Helper Methods ==========

  /**
   * Compute hash of data (SHA-256)
   */
  private async computeHash(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Compute SAID of object
   * Uses canonical JSON serialization
   */
  private async computeSAID(obj: any): Promise<SAID> {
    const canonical = JSON.stringify(obj, Object.keys(obj).sort());
    const encoder = new TextEncoder();
    const data = encoder.encode(canonical);
    return await this.computeHash(data);
  }
}

/**
 * Register key state before creating transport
 * Must be called once per AID before using transport
 */
export async function registerKeyState(
  convexUrl: string,
  registration: {
    aid: AID;
    ksn: number;
    verfer: string;
    estEventSaid: SAID;
    signer: Signer;
  },
): Promise<void> {
  const client = new ConvexClient(convexUrl);

  try {
    // TODO: Implement with Convex mutation + challenge-response
    // const argsHash = await computeHash({ aid, ksn, verfer, estEventSaid });
    // const { challengeId, payload } = await client.mutation(api.auth.issueChallenge, ...);
    // const signature = await registration.signer.sign(...);
    // await client.mutation(api.auth.registerKeyState, {
    //   aid: registration.aid,
    //   ksn: registration.ksn,
    //   verfer: registration.verfer,
    //   estEventSaid: registration.estEventSaid,
    //   challengeId,
    //   signature
    // });

    console.log('registerKeyState:', {
      aid: registration.aid,
      ksn: registration.ksn,
      verfer: `${registration.verfer.slice(0, 10)}...`,
    });
  } finally {
    client.close();
  }
}
