/**
 * Convex Implementation of MeritsClient
 *
 * Adapts the Convex backend to the backend-agnostic MeritsClient interface
 */

import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { ConvexIdentityAuth } from "../adapters/ConvexIdentityAuth";
import { ConvexTransport } from "../adapters/ConvexTransport";
import { ConvexGroupApi } from "../adapters/ConvexGroupApi";
import { AdminApi } from "./admin";
import { GroupApi } from "./group-api";
import { createMessageRouter } from "../../core/runtime/router";
import { computeArgsHash, signPayload, sha256Hex } from "../../core/crypto";
import type { MeritsClient, IdentityRegistry, AuthCredentials } from "./types";
import type { AuthProof } from "../../core/types";
import type { Credentials } from "../../cli/lib/credentials";

/**
 * Convex-specific implementation of IdentityRegistry
 */
class ConvexIdentityRegistry implements IdentityRegistry {
  constructor(private convex: ConvexClient) {}

  async registerIdentity(req: {
    aid: string;
    publicKey: Uint8Array;
    ksn: number;
  }): Promise<void> {
    // In our testing setup, AID === public key with 'D' prefix
    // So we just use the AID directly (it's already in CESR format)
    await this.convex.mutation(api.auth.registerKeyState, {
      aid: req.aid,
      ksn: req.ksn,
      keys: [req.aid], // AID is the public key in CESR format
      threshold: "1",
      lastEvtSaid: "", // Empty for initial registration
    });
  }

  async rotateKeys(req: {
    aid: string;
    oldKsn: number;
    newKsn: number;
    newPublicKey: Uint8Array;
    rotationProofSigs: string[];
  }): Promise<void> {
    // Convert new public key to CESR format
    const publicKeyBase64url = this.uint8ArrayToBase64Url(req.newPublicKey);
    const publicKeyCESR = `B${publicKeyBase64url}`;

    // Call rotation mutation (to be implemented on Convex backend)
    await this.convex.mutation(api.auth.rotateKeyState, {
      aid: req.aid,
      oldKsn: req.oldKsn,
      newKsn: req.newKsn,
      newKeys: [publicKeyCESR],
      threshold: "1",
      rotationProofSigs: req.rotationProofSigs,
    });
  }

  async getPublicKey(aid: string): Promise<{ publicKey: Uint8Array; ksn: number }> {
    // Query the key state from backend
    const keyState = await this.convex.query(api.auth.getKeyState, { aid });

    if (!keyState) {
      throw new Error(`Identity not found: ${aid}`);
    }

    // In our testing setup, AID === public key with 'D' prefix
    // The key is stored as the AID itself
    const publicKeyCESR = keyState.keys[0];
    if (!publicKeyCESR || !publicKeyCESR.startsWith("D")) {
      throw new Error(`Invalid public key format for ${aid}`);
    }

    const publicKeyBase64url = publicKeyCESR.slice(1); // Remove 'D' prefix
    const publicKey = this.base64UrlToUint8Array(publicKeyBase64url);

    return {
      publicKey,
      ksn: keyState.ksn,
    };
  }

  private uint8ArrayToBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  private base64UrlToUint8Array(base64url: string): Uint8Array {
    // Convert base64url back to standard base64
    const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
    // Add padding if needed
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

/**
 * Convex implementation of MeritsClient
 */
export class ConvexMeritsClient implements MeritsClient {
  private convex: ConvexClient;
  public identityAuth: ConvexIdentityAuth;
  public transport: ConvexTransport;
  public group: ConvexGroupApi;
  public identityRegistry: IdentityRegistry;
  public router: ReturnType<typeof createMessageRouter>;

  constructor(convexUrl: string) {
    this.convex = new ConvexClient(convexUrl);
    this.identityAuth = new ConvexIdentityAuth(this.convex);
    this.transport = new ConvexTransport(this.convex);
    this.group = new ConvexGroupApi(this.convex);
    this.identityRegistry = new ConvexIdentityRegistry(this.convex);
    this.router = createMessageRouter();
  }

  /** Get access to the underlying Convex client for direct mutations/queries */
  get connection(): ConvexClient {
    return this.convex;
  }

  /**
   * Create an authenticated admin API client
   *
   * @param credentials - Admin credentials for signing requests
   * @returns AdminApi instance that handles all signing internally
   *
   * @example
   * ```typescript
   * const admin = client.createAdminApi(credentials);
   * await admin.createRole("user", actionSAID);
   * await admin.grantRoleToUser(userAid, "user", actionSAID);
   * ```
   */
  createAdminApi(credentials: Credentials): AdminApi {
    return new AdminApi(this.convex, credentials);
  }

  /**
   * Create an authenticated group API client
   *
   * @param credentials - User credentials for signing requests
   * @returns GroupApi instance that handles all signing internally
   *
   * @example
   * ```typescript
   * const groups = client.createGroupApi(credentials);
   * await groups.createGroup("My Group");
   * const myGroups = await groups.listGroups();
   * ```
   */
  createGroupApi(credentials: Credentials): GroupApi {
    return new GroupApi(this.convex, credentials);
  }

  async createAuth(
    credentials: AuthCredentials,
    purpose: string,
    args: Record<string, any>
  ): Promise<AuthProof> {
    const argsHash = computeArgsHash(args);
    const challenge = await this.identityAuth.issueChallenge({
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
  }

  computeArgsHash(args: Record<string, any>): string {
    return computeArgsHash(args);
  }

  computeCtHash(ct: string): string {
    const encoder = new TextEncoder();
    const data = encoder.encode(ct);
    return sha256Hex(data);
  }

  async registerUser(req: {
    aid: string;
    publicKey: string;
    challengeId: string;
    sigs: string[];
    ksn: number;
  }): Promise<import("./types").SessionToken> {
    // Call backend registerUser mutation
    await this.convex.mutation(api.auth.registerUser, {
      aid: req.aid,
      publicKey: req.publicKey,
      auth: {
        challengeId: req.challengeId as any,
        sigs: req.sigs,
        ksn: req.ksn,
      },
    });

    // TODO: Backend should return actual session token
    // For now, generate placeholder until session token system is implemented
    return {
      token: `session_${req.aid}_${Date.now()}`,
      aid: req.aid,
      expiresAt: Date.now() + 3600000, // 1 hour
      ksn: req.ksn,
    };
  }

  async getUserStatus(aid: string): Promise<import("./types").UserStatus> {
    // Query user status from backend
    const status = await this.convex.query(api.userStatus.getUserStatus, { aid });
    return status;
  }

  /**
   * Send an encrypted message to a recipient
   *
   * High-level API that handles encryption and authentication internally.
   *
   * @param recipient - Recipient's AID
   * @param plaintext - Message content (will be encrypted)
   * @param credentials - Sender's credentials
   * @param options - Optional message type and TTL
   * @returns Message ID
   *
   * @example
   * ```typescript
   * const messageId = await client.sendMessage(
   *   recipientAid,
   *   "Hello, World!",
   *   senderCredentials,
   *   { typ: "chat.text" }
   * );
   * ```
   */
  async sendMessage(
    recipient: string,
    plaintext: string,
    credentials: Credentials,
    options?: { typ?: string; ttl?: number }
  ): Promise<string> {
    // Import libsodium
    const libsodiumModule = await import("libsodium-wrappers-sumo");
    const libsodium = libsodiumModule.default;
    await libsodium.ready;

    // Get recipient's public key
    const recipientKeyState = await this.identityRegistry.getPublicKey(recipient);

    // Convert Ed25519 → X25519 for encryption
    const recipientX25519Key = libsodium.crypto_sign_ed25519_pk_to_curve25519(
      Uint8Array.from(recipientKeyState.publicKey)
    );

    // Encrypt with sealed box
    const messageBytes = new TextEncoder().encode(plaintext);
    const cipherBytes = libsodium.crypto_box_seal(messageBytes, recipientX25519Key);

    // Encode as base64url
    const ct = Buffer.from(cipherBytes).toString("base64url");

    // Send the encrypted message
    return this.sendRawMessage(recipient, ct, credentials, {
      ...options,
      alg: "x25519-xsalsa20poly1305",
    });
  }

  /**
   * Send a pre-encrypted (raw) message to a recipient
   *
   * Lower-level API for sending already-encrypted ciphertext.
   * Use this when you've encrypted the message yourself or need custom encryption.
   *
   * @param recipient - Recipient's AID
   * @param ciphertext - Already-encrypted message (base64url)
   * @param credentials - Sender's credentials
   * @param options - Optional message type, algorithm, and TTL
   * @returns Message ID
   *
   * @example
   * ```typescript
   * const messageId = await client.sendRawMessage(
   *   recipientAid,
   *   encryptedData,
   *   senderCredentials,
   *   { typ: "chat.text", alg: "x25519-xsalsa20poly1305" }
   * );
   * ```
   */
  async sendRawMessage(
    recipient: string,
    ciphertext: string,
    credentials: Credentials,
    options?: { typ?: string; alg?: string; ek?: string; ttl?: number }
  ): Promise<string> {
    const { signMutationArgs } = await import("../../core/signatures");
    const { base64UrlToUint8Array } = await import("../../core/crypto");

    // Build mutation args
    const ttl = options?.ttl ?? 24 * 60 * 60 * 1000; // Default 24 hours
    const sendArgs = {
      recpAid: recipient,
      ct: ciphertext,
      typ: options?.typ,
      ttl,
      alg: options?.alg ?? "",
      ek: options?.ek ?? "",
    };

    // Sign the request
    const privateKeyBytes = base64UrlToUint8Array(credentials.privateKey);
    const sig = await signMutationArgs(sendArgs, privateKeyBytes, credentials.aid);

    // Send with signed request
    const messageId = await this.convex.mutation(api.messages.send, {
      ...sendArgs,
      sig,
    });

    return messageId;
  }

  close(): void {
    this.convex.close();
  }
}
