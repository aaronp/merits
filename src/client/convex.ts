/**
 * Convex Implementation of MeritsClient
 *
 * Adapts the Convex backend to the backend-agnostic MeritsClient interface
 */

import { ConvexClient } from 'convex/browser';
import type { Credentials } from '../../cli/lib/credentials';
import { api } from '../../convex/_generated/api';
import { computeArgsHash, sha256Hex, signPayload, signPayloadWithSigner } from '../../core/crypto';
import { createMessageRouter } from '../../core/runtime/router';
import type { AuthProof, SignedRequest } from '../../core/types';
import { ConvexGroupApi } from '../adapters/ConvexGroupApi';
import { ConvexIdentityAuth } from '../adapters/ConvexIdentityAuth';
import { ConvexTransport } from '../adapters/ConvexTransport';
import { AdminApi } from './admin';
import { GroupApi } from './group-api';
import type { AuthCredentials, IdentityRegistry, MeritsClient, Signer } from './types';

/**
 * Convex-specific implementation of IdentityRegistry
 */
class ConvexIdentityRegistry implements IdentityRegistry {
  constructor(private convex: ConvexClient) {}

  async registerIdentity(req: {
    aid: string;
    publicKey: Uint8Array;
    ksn: number;
    publicKeyCESR?: string; // Optional: if provided, use this directly instead of re-encoding
  }): Promise<void> {
    // Use provided CESR string if available, otherwise convert bytes to CESR format
    // IMPORTANT: We use encodeCESRKey from merits/core/crypto which creates simple D+base64url
    // This matches what Convex can decode with simple base64url decode (not codex's proper CESR)
    let publicKeyCESR: string;
    if (req.publicKeyCESR) {
      // If codex CESR is provided, we need to convert it to simple base64url format
      // that Convex can decode. Extract the raw bytes and re-encode with encodeCESRKey
      const { decodeKey } = await import('@kv4/codex');
      const decoded = decodeKey(req.publicKeyCESR);
      const { encodeCESRKey } = await import('../../core/crypto');
      publicKeyCESR = encodeCESRKey(decoded.raw);
    } else {
      // Convert public key to CESR format using merits encodeCESRKey (simple base64url)
      const { encodeCESRKey } = await import('../../core/crypto');
      publicKeyCESR = encodeCESRKey(req.publicKey);
    }

    await this.convex.mutation(api.auth.registerKeyState, {
      aid: req.aid,
      ksn: req.ksn,
      keys: [publicKeyCESR], // Use the actual public key, not the AID
      threshold: '1',
      lastEvtSaid: '', // Empty for initial registration
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
      threshold: '1',
      rotationProofSigs: req.rotationProofSigs,
    });
  }

  async getPublicKey(aid: string): Promise<{ publicKey: Uint8Array; ksn: number }> {
    // Query the key state from backend
    const keyState = await this.convex.query(api.auth.getKeyState, { aid });

    if (!keyState) {
      throw new Error(`Identity not found: ${aid}`);
    }

    // Extract the public key from the key state
    // Keys are stored in CESR format (e.g., "D<base64url>")
    const publicKeyCESR = keyState.keys[0];
    if (!publicKeyCESR || !publicKeyCESR.startsWith('D')) {
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
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  private base64UrlToUint8Array(base64url: string): Uint8Array {
    // Convert base64url back to standard base64
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding if needed
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
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
  private privateKeyBytes: Uint8Array; // Stored for encryption operations (X25519 ECDH)
  public readonly aid: string;
  public readonly signer: Signer;
  public readonly ksn: number;
  public identityAuth: ConvexIdentityAuth;
  public transport: ConvexTransport;
  public group: ConvexGroupApi;
  public identityRegistry: IdentityRegistry;
  public router: ReturnType<typeof createMessageRouter>;

  constructor(convexUrl: string, aid: string, signer: Signer, privateKeyBytes: Uint8Array, ksn: number = 0) {
    this.convex = new ConvexClient(convexUrl);
    this.aid = aid;
    this.signer = signer;
    this.privateKeyBytes = privateKeyBytes;
    this.ksn = ksn;
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

  async createAuth(credentials: AuthCredentials, purpose: string, args: Record<string, any>): Promise<AuthProof> {
    const _argsHash = computeArgsHash(args);
    const challenge = await this.identityAuth.issueChallenge({
      aid: credentials.aid,
      purpose: purpose as any,
      args,
    });
    const sigs = await signPayload(challenge.payloadToSign, credentials.privateKey, 0);

    return {
      challengeId: challenge.challengeId,
      sigs,
      ksn: credentials.ksn,
    };
  }

  /**
   * Create authenticated proof using stored signer
   *
   * Preferred method over createAuth() as it uses the client's stored signer.
   * Automatically uses the client's AID and signer without passing credentials.
   *
   * @param purpose - Purpose of the authentication (e.g., "sendMessage")
   * @param args - Arguments to authenticate
   * @returns Authentication proof
   */
  async createAuthWithSigner(purpose: string, args: Record<string, any>): Promise<AuthProof> {
    const _argsHash = computeArgsHash(args);
    const challenge = await this.identityAuth.issueChallenge({
      aid: this.aid,
      purpose: purpose as any,
      args,
    });
    const sigs = await signPayloadWithSigner(challenge.payloadToSign, this.signer, 0);

    return {
      challengeId: challenge.challengeId,
      sigs,
      ksn: this.ksn,
    };
  }

  computeArgsHash(args: Record<string, any>): string {
    return computeArgsHash(args);
  }

  /**
   * Create a signed request for use with the transport API
   *
   * Uses the client's stored signer to create a SignedRequest for mutation args.
   * This is the proper way to create signatures for transport.sendMessage().
   *
   * @param args - Mutation arguments to sign (without 'sig' field)
   * @returns SignedRequest with signature and metadata
   */
  async createSignedRequest(args: Record<string, any>): Promise<SignedRequest> {
    const { signMutationArgsWithSigner } = await import('../../core/signatures');
    return await signMutationArgsWithSigner(args, this.signer, this.aid);
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
  }): Promise<import('./types').SessionToken> {
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

  async getUserStatus(aid: string): Promise<import('./types').UserStatus> {
    // Query user status from backend
    const status = await this.convex.query(api.userStatus.getUserStatus, { aid });
    return status;
  }

  /**
   * Send an encrypted message to a recipient
   *
   * High-level API that handles encryption and authentication internally.
   * Uses the client's stored signer for authentication.
   *
   * @param recipient - Recipient's AID
   * @param plaintext - Message content (will be encrypted)
   * @param options - Optional message type and TTL
   * @returns Message ID
   *
   * @example
   * ```typescript
   * const messageId = await client.sendMessage(
   *   recipientAid,
   *   "Hello, World!",
   *   { typ: "chat.text" }
   * );
   * ```
   */
  async sendMessage(recipient: string, plaintext: string, options?: { typ?: string; ttl?: number }): Promise<string> {
    // Import libsodium
    const libsodiumModule = await import('libsodium-wrappers-sumo');
    const libsodium = libsodiumModule.default;
    await libsodium.ready;

    // Get recipient's public key
    const recipientKeyState = await this.identityRegistry.getPublicKey(recipient);

    // Convert Ed25519 → X25519 for encryption
    const recipientX25519Key = libsodium.crypto_sign_ed25519_pk_to_curve25519(
      Uint8Array.from(recipientKeyState.publicKey),
    );

    // Encrypt with sealed box
    const messageBytes = new TextEncoder().encode(plaintext);
    const cipherBytes = libsodium.crypto_box_seal(messageBytes, recipientX25519Key);

    // Encode as base64url
    const ct = Buffer.from(cipherBytes).toString('base64url');

    // Send the encrypted message
    return this.sendRawMessage(recipient, ct, {
      ...options,
      alg: 'x25519-xsalsa20poly1305',
    });
  }

  /**
   * Send a pre-encrypted (raw) message to a recipient
   *
   * Lower-level API for sending already-encrypted ciphertext.
   * Uses the client's stored signer for authentication.
   *
   * @param recipient - Recipient's AID
   * @param ciphertext - Already-encrypted message (base64url)
   * @param options - Optional message type, algorithm, and TTL
   * @returns Message ID
   *
   * @example
   * ```typescript
   * const messageId = await client.sendRawMessage(
   *   recipientAid,
   *   encryptedData,
   *   { typ: "chat.text", alg: "x25519-xsalsa20poly1305" }
   * );
   * ```
   */
  async sendRawMessage(
    recipient: string,
    ciphertext: string,
    options?: { typ?: string; alg?: string; ek?: string; ttl?: number },
  ): Promise<string> {
    // Build the exact args that will be sent to the mutation (matching ConvexTransport.sendMessage exactly)
    // ConvexTransport passes all fields directly, including undefined ones (which JSON.stringify will omit)
    const ttl = options?.ttl ?? 24 * 60 * 60 * 1000; // Default 24 hours
    const mutationArgs: Record<string, any> = {
      recpAid: recipient,
      ct: ciphertext,
      typ: options?.typ, // May be undefined, but ConvexTransport passes it directly
      ek: options?.ek, // May be undefined, but ConvexTransport passes it directly
      alg: options?.alg ?? '', // Default empty string if not provided
      ttl,
    };

    // Use client API to create signed request (uses stored signer)
    const sig = await this.createSignedRequest(mutationArgs);

    // DEBUG: Log what's being sent
    if (process.env.DEBUG_SIGNATURES === 'true') {
      console.log('[SEND] Using transport API to send message');
      console.log('[SEND] Mutation args (without sig):', JSON.stringify({ ...mutationArgs }, null, 2));
      console.log('[SEND] Sig being sent:', JSON.stringify(sig, null, 2));
    }

    // Use transport API - it will convert the request to mutation args and add the sig
    const result = await this.transport.sendMessage({
      to: recipient,
      ct: ciphertext,
      typ: options?.typ,
      ek: options?.ek,
      alg: options?.alg,
      ttlMs: ttl,
      sig,
    });

    return result.messageId;
  }

  async getGroupIdByTag(tag: string): Promise<{
    id: string;
    name: string;
    tag?: string;
    ownerAid: string;
    membershipSaid: string;
    createdAt: number;
    createdBy: string;
  } | null> {
    return await this.convex.query(api.groups.getGroupByTag, { tag });
  }

  /**
   * Send an encrypted group message
   *
   * High-level API that handles group encryption, authentication, and sending.
   * Implements zero-knowledge encryption where the backend cannot decrypt messages.
   * Uses the client's stored signer for authentication.
   *
   * @param groupId - ID of the group to send to
   * @param plaintext - Message content (will be encrypted)
   * @param options - Optional message type
   * @returns Result with messageId and seqNo
   *
   * @example
   * ```typescript
   * const result = await client.sendGroupMessage(
   *   groupId,
   *   "Hello team!",
   *   { typ: "chat.text" }
   * );
   * console.log(result.messageId);
   * ```
   */
  async sendGroupMessage(
    groupId: string,
    plaintext: string,
    _options?: { typ?: string },
  ): Promise<{ messageId: string; seqNo: number; sentAt: number }> {
    console.log(
      `[ConvexMeritsClient] sendGroupMessage called for group ${groupId}, plaintext length: ${plaintext.length}`,
    );
    const { encryptForGroup } = await import('../../cli/lib/crypto-group');
    const { signMutationArgsWithSigner } = await import('../../core/signatures');

    // Step 1: Fetch group members with their public keys
    console.log(`[ConvexMeritsClient] Fetching members for group ${groupId}...`);
    const membersResponse = await this.convex.query(api.groups.getMembers, {
      groupChatId: groupId as any,
      callerAid: this.aid,
    });
    console.log(`[ConvexMeritsClient] Found ${membersResponse?.members?.length || 0} member(s)`);

    if (!membersResponse || !membersResponse.members || membersResponse.members.length === 0) {
      throw new Error(`No members found for group ${groupId}. You may not be a member of this group.`);
    }

    // Step 2: Convert members to Record<aid, publicKey> format
    const members: Record<string, string> = {};
    for (const member of membersResponse.members) {
      if (!member.publicKey) {
        throw new Error(`Member ${member.aid} has no public key`);
      }
      members[member.aid] = member.publicKey;
    }
    console.log(`[ConvexMeritsClient] Converted ${Object.keys(members).length} member(s) to encryption format`);

    // Step 3: Encrypt message for all group members using group encryption
    console.log(`[ConvexMeritsClient] Encrypting message for ${Object.keys(members).length} member(s)...`);
    const groupMessage = await encryptForGroup(plaintext, members, this.privateKeyBytes, groupId, this.aid);

    // Step 4: Prepare arguments for signing and sending
    // Note: groupChatId must be a string for signing, but will be cast to ID type for Convex
    console.log(`[ConvexMeritsClient] Preparing signed request...`);
    const sendArgs = {
      groupChatId: groupId,
      groupMessage,
    };

    // Step 5: Sign the request using stored signer (signs the exact args we'll send)
    console.log(`[ConvexMeritsClient] Signing request...`);
    const sig = await signMutationArgsWithSigner(sendArgs, this.signer, this.aid);
    console.log(`[ConvexMeritsClient] Request signed, sending to Convex...`);

    // Step 6: Send encrypted GroupMessage to backend with signed request
    // Cast groupChatId to ID type for Convex validation, but keep structure identical to what was signed
    const result = await this.convex.mutation(api.groups.sendGroupMessage, {
      groupChatId: groupId as any,
      groupMessage,
      sig,
    });
    console.log(`[ConvexMeritsClient] Message sent successfully: messageId=${result.messageId}, seqNo=${result.seqNo}`);

    return {
      messageId: result.messageId,
      seqNo: result.seqNo,
      sentAt: result.sentAt || Date.now(),
    };
  }

  close(): void {
    this.convex.close();
  }
}
