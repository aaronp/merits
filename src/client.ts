import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { ConvexIdentityAuth } from "../convex/adapters/ConvexIdentityAuth";
import { ConvexTransport } from "../convex/adapters/ConvexTransport";
import { ConvexGroupApi } from "../convex/adapters/ConvexGroupApi";
import type { IdentityAuth } from "../core/interfaces/IdentityAuth";
import type { Transport } from "../core/interfaces/Transport";
import type { GroupApi } from "../core/interfaces/GroupApi";
import { MessageRouter, createMessageRouter } from "../core/runtime/router";
import { computeArgsHash, signPayload, sha256Hex } from "../core/crypto";
import type { AuthProof } from "../core/types";

export interface Message {
  id: Id<"messages">;
  senderAid: string;
  ct: string;
  ctHash: string;
  ek?: string;
  alg?: string;
  createdAt: number;
  expiresAt: number;
  senderSig: string[];
  senderKsn: number;
  senderEvtSaid: string;
  envelopeHash: string;
}

export interface SendOptions {
  ttl?: number; // Time to live in milliseconds
}

export interface AuthCredentials {
  aid: string;
  privateKey: Uint8Array;
  ksn: number;
}

export class MessageBusClient {
  private client: ConvexClient;

  constructor(convexUrl: string) {
    this.client = new ConvexClient(convexUrl);
  }

  /**
   * Register key state for an AID (setup)
   */
  async registerKeyState(
    aid: string,
    ksn: number,
    keys: string[],
    threshold: string,
    lastEvtSaid: string
  ): Promise<Id<"keyStates">> {
    return await this.client.mutation(api.auth.registerKeyState, {
      aid,
      ksn,
      keys,
      threshold,
      lastEvtSaid,
    });
  }

  /**
   * Issue a challenge for authentication
   */
  async issueChallenge(
    aid: string,
    purpose: string,
    argsHash: string
  ): Promise<{ challengeId: Id<"challenges">; payload: any }> {
    return await this.client.mutation(api.auth.issueChallenge, {
      aid,
      purpose,
      argsHash,
    });
  }

  /**
   * Compute args hash (helper)
   */
  async computeArgsHash(args: Record<string, any>): Promise<string> {
    return await this.client.query(api.auth.computeHash, { args });
  }

  /**
   * Send a message to a recipient (authenticated)
   */
  async send(
    recpAid: string,
    ct: string,
    credentials: AuthCredentials,
    options?: SendOptions & { ek?: string; alg?: string; typ?: string }
  ): Promise<Id<"messages">> {
    const ttl = options?.ttl ?? 24 * 60 * 60 * 1000;

    // Compute ctHash (server will verify this)
    const ctHash = await this.computeCtHash(ct);

    // Compute args hash - binds to ctHash, NOT ct!
    // Use ttl (not expiresAt) to match server computation
    const argsHash = await this.computeArgsHash({
      recpAid,
      ctHash,
      ttl, // Use ttl, not expiresAt
      alg: options?.alg ?? "",
      ek: options?.ek ?? "",
    });

    // Issue challenge
    const { challengeId, payload } = await this.issueChallenge(
      credentials.aid,
      "send",
      argsHash
    );

    // Sign payload
    const sigs = await this.signPayload(payload, credentials.privateKey, 0);

    // Send message
    const messageId = await this.client.mutation(api.messages.send, {
      recpAid,
      ct,
      typ: options?.typ,
      ek: options?.ek,
      alg: options?.alg,
      ttl,
      auth: {
        challengeId,
        sigs,
        ksn: credentials.ksn,
      },
    });
    return messageId;
  }

  /**
   * Compute ctHash (helper)
   */
  private async computeCtHash(ct: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(ct);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Receive messages for a recipient (authenticated)
   */
  async receive(
    recpAid: string,
    credentials: AuthCredentials
  ): Promise<Message[]> {
    // Compute args hash - binds to recpAid only
    const argsHash = await this.computeArgsHash({ recpAid });

    // Issue challenge
    const { challengeId, payload } = await this.issueChallenge(
      credentials.aid,
      "receive",
      argsHash
    );

    // Sign payload
    const sigs = await this.signPayload(payload, credentials.privateKey, 0);

    // Receive messages
    const messages = await this.client.mutation(api.messages.receive, {
      recpAid,
      auth: {
        challengeId,
        sigs,
        ksn: credentials.ksn,
      },
    });
    return messages;
  }

  /**
   * Subscribe to messages (not yet authenticated - would need session tokens)
   */
  subscribe(
    recipientDid: string,
    callback: (messages: Message[]) => void
  ): () => void {
    throw new Error("Subscribe not yet implemented with authentication");
  }

  /**
   * Acknowledge receipt of a message (authenticated)
   */
  async acknowledge(
    messageId: Id<"messages">,
    recpAid: string,
    envelopeHash: string,
    credentials: AuthCredentials
  ): Promise<void> {
    // Compute args hash - binds to recpAid + messageId
    const argsHash = await this.computeArgsHash({ recpAid, messageId });

    // Issue challenge
    const { challengeId, payload } = await this.issueChallenge(
      credentials.aid,
      "ack",
      argsHash
    );

    // Sign payload (for authentication)
    const sigs = await this.signPayload(payload, credentials.privateKey, 0);

    // Sign envelopeHash for receipt (non-repudiation)
    const receiptPayload = {
      envelopeHash,
      aud: "https://merits-convex.app",
    };
    const receipt = await this.signPayload(receiptPayload, credentials.privateKey, 0);

    // Acknowledge
    await this.client.mutation(api.messages.acknowledge, {
      messageId,
      receipt,
      auth: {
        challengeId,
        sigs,
        ksn: credentials.ksn,
      },
    });
  }

  /**
   * Sign payload with private key (creates indexed signature)
   */
  private async signPayload(
    payload: any,
    privateKey: Uint8Array,
    keyIndex: number
  ): Promise<string[]> {
    // Canonicalize payload (sort keys deterministically)
    const sortedKeys = Object.keys(payload).sort();
    const sorted: Record<string, any> = {};
    for (const key of sortedKeys) {
      sorted[key] = payload[key];
    }
    const canonical = JSON.stringify(sorted);
    const encoder = new TextEncoder();
    const data = encoder.encode(canonical);

    // Import private key for signing
    const pkcs8 = this.reconstructPKCS8(privateKey);
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pkcs8,
      {
        name: "Ed25519",
        namedCurve: "Ed25519",
      },
      false,
      ["sign"]
    );

    // Sign
    const signatureBuffer = await crypto.subtle.sign("Ed25519", key, data);
    const signature = new Uint8Array(signatureBuffer);

    // Create indexed signature
    const sigBase64 = this.uint8ArrayToBase64Url(signature);
    return [`${keyIndex}-${sigBase64}`];
  }

  /**
   * Reconstruct PKCS8 format from raw 32-byte Ed25519 private key
   */
  private reconstructPKCS8(rawPrivateKey: Uint8Array): Uint8Array {
    const pkcs8Header = new Uint8Array([
      0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
      0x04, 0x22, 0x04, 0x20,
    ]);
    const result = new Uint8Array(pkcs8Header.length + rawPrivateKey.length);
    result.set(pkcs8Header, 0);
    result.set(rawPrivateKey, pkcs8Header.length);
    return result;
  }

  /**
   * Base64url encoding
   */
  private uint8ArrayToBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  /**
   * Create authentication for admin operations
   */
  async createAuth(
    credentials: AuthCredentials,
    purpose: string,
    args: Record<string, any>
  ): Promise<{
    challengeId: Id<"challenges">;
    sigs: string[];
    ksn: number;
  }> {
    const argsHash = await this.computeArgsHash(args);
    const { challengeId, payload } = await this.issueChallenge(
      credentials.aid,
      purpose,
      argsHash
    );
    const sigs = await this.signPayload(payload, credentials.privateKey, 0);

    return {
      challengeId,
      sigs,
      ksn: credentials.ksn,
    };
  }

  /**
   * Clean up expired messages
   */
  async cleanupExpired(): Promise<{ deleted: number }> {
    const result = await this.client.mutation(api.messages.cleanupExpired, {});
    return result;
  }

  /**
   * Close the client connection
   */
  close(): void {
    this.client.close();
  }
}

/**
 * Mock encryption helper (for testing without real crypto)
 */
export function mockEncrypt(plaintext: string): string {
  return Buffer.from(plaintext).toString("base64");
}

/**
 * Mock decryption helper (for testing without real crypto)
 */
export function mockDecrypt(ciphertext: string): string {
  return Buffer.from(ciphertext, "base64").toString("utf-8");
}

/**
 * Unified Merits Client
 *
 * Provides a single entry point for all Merits operations:
 * - identity: Challenge/response authentication
 * - transport: Message send/receive/ack/subscribe
 * - group: Group management and messaging
 * - router: Application-level message routing
 * - helpers: Common operations (createAuth, computeArgsHash)
 */
export interface MeritsClient {
  /** Identity authentication (challenge/response) */
  identity: IdentityAuth;

  /** Message transport (send/receive/ack/subscribe) */
  transport: Transport;

  /** Group management and messaging */
  group: GroupApi;

  /** Message router for application-level dispatch */
  router: MessageRouter;

  /** Helper: Create authenticated proof for operations */
  createAuth(
    credentials: AuthCredentials,
    purpose: string,
    args: Record<string, any>
  ): Promise<AuthProof>;

  /** Helper: Compute args hash (deterministic) */
  computeArgsHash(args: Record<string, any>): string;

  /** Helper: Compute content hash */
  computeCtHash(ct: string): string;

  /** Close the client connection */
  close(): void;
}

/**
 * Create a unified Merits client
 *
 * @param convexUrl - Convex deployment URL
 * @returns MeritsClient with all interfaces and helpers
 *
 * @example
 * ```typescript
 * const client = createMeritsClient(process.env.CONVEX_URL);
 *
 * // Use interfaces directly
 * const challenge = await client.identity.issueChallenge({...});
 * await client.transport.sendMessage({...});
 * await client.group.createGroup({...});
 *
 * // Or use helpers
 * const auth = await client.createAuth(credentials, "send", {...});
 * ```
 */
export function createMeritsClient(convexUrl: string): MeritsClient {
  const convex = new ConvexClient(convexUrl);
  const identity = new ConvexIdentityAuth(convex);
  const transport = new ConvexTransport(convex);
  const group = new ConvexGroupApi(convex);
  const router = createMessageRouter();

  return {
    identity,
    transport,
    group,
    router,

    async createAuth(
      credentials: AuthCredentials,
      purpose: string,
      args: Record<string, any>
    ): Promise<AuthProof> {
      const argsHash = computeArgsHash(args);
      const challenge = await identity.issueChallenge({
        aid: credentials.aid,
        purpose: purpose as any,
        args,
      });
      const sigs = await signPayload(
        challenge.payloadToSign,
        credentials.privateKey,
        0
      );

      return {
        challengeId: challenge.challengeId,
        sigs,
        ksn: credentials.ksn,
      };
    },

    computeArgsHash(args: Record<string, any>): string {
      return computeArgsHash(args);
    },

    computeCtHash(ct: string): string {
      const encoder = new TextEncoder();
      const data = encoder.encode(ct);
      return sha256Hex(data);
    },

    close() {
      convex.close();
    },
  };
}
