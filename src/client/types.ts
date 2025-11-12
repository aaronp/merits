/**
 * Merits Client Types
 *
 * Backend-agnostic interfaces for all Merits operations
 */

import type { IdentityAuth } from "../../core/interfaces/IdentityAuth";
import type { Transport } from "../../core/interfaces/Transport";
import type { GroupApi } from "../../core/interfaces/GroupApi";
import type { MessageRouter } from "../../core/runtime/router";
import type { AuthProof } from "../../core/types";

/**
 * Signer interface - Abstracts signing operations
 *
 * Encapsulates private key operations without exposing key material.
 * Implementations can use libsodium, WebCrypto, hardware keys, etc.
 */
export interface Signer {
  /** Sign data and return CESR-encoded signature */
  sign(data: Uint8Array): Promise<string>;

  /** Get current public key (verifier) in CESR format */
  verifier(): string;
}

/**
 * Authentication credentials for operations
 *
 * Legacy interface for backward compatibility with existing code.
 * New code should use Signer interface instead.
 */
export interface AuthCredentials {
  aid: string;
  privateKey: Uint8Array;
  ksn: number;
}

/**
 * Identity Registry - Backend-agnostic identity management
 *
 * Handles identity registration and key rotation without exposing
 * backend-specific details (Convex, REST, etc.)
 */
export interface IdentityRegistry {
  /**
   * Register a new identity with its initial public key
   *
   * @param req - Registration request
   */
  registerIdentity(req: {
    aid: string;
    publicKey: Uint8Array;
    ksn: number;
    publicKeyCESR?: string; // Optional: if provided, use this directly instead of re-encoding
  }): Promise<void>;

  /**
   * Rotate keys for an identity (key ceremony)
   *
   * @param req - Rotation request with proof signatures from old key
   */
  rotateKeys(req: {
    aid: string;
    oldKsn: number;
    newKsn: number;
    newPublicKey: Uint8Array;
    rotationProofSigs: string[]; // Indexed signatures from old key
  }): Promise<void>;

  /**
   * Get public key for an identity
   *
   * @param aid - Identity AID
   * @returns Public key and current KSN
   */
  getPublicKey(aid: string): Promise<{ publicKey: Uint8Array; ksn: number }>;
}

/**
 * Session token for authenticated operations
 */
export interface SessionToken {
  token: string;
  aid: string;
  expiresAt: number;
  ksn: number;
}

/**
 * Group membership information
 */
export interface GroupMembership {
  groupId: string;
  groupName: string;
  role: string;
  joinedAt: number;
}

/**
 * User status information
 */
export interface UserStatus {
  aid: string;
  roles: string[];
  groups: GroupMembership[];
  publicKey: string | null;
  publicKeyKsn: number;
  publicKeyUpdatedAt: number | null;
}

/**
 * Unified Merits Client Interface
 *
 * Provides backend-agnostic access to all Merits operations.
 * The CLI uses only this interface, never touching backend-specific APIs.
 *
 * The client stores authentication context (AID + Signer) so individual
 * operations don't need to pass credentials repeatedly.
 */
export interface MeritsClient {
  /** Authenticated user's AID */
  readonly aid: string;

  /** Signer for authentication and message signing */
  readonly signer: Signer;

  /** Current key sequence number */
  readonly ksn: number;

  /** Identity authentication (challenge/response) */
  identityAuth: IdentityAuth;

  /** Message transport (send/receive/ack/subscribe) */
  transport: Transport;

  /** Group management and messaging */
  group: GroupApi;

  /** Identity registry (registration, rotation) */
  identityRegistry: IdentityRegistry;

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

  /**
   * Register a new user with authenticated challenge
   *
   * @param req - Registration request with auth proof
   * @returns Session token for the newly registered user
   */
  registerUser(req: {
    aid: string;
    publicKey: string;
    challengeId: string;
    sigs: string[];
    ksn: number;
  }): Promise<SessionToken>;

  /**
   * Get comprehensive user status information
   *
   * @param aid - User's AID
   * @returns User status including roles, groups, and public key
   */
  getUserStatus(aid: string): Promise<UserStatus>;

  /**
   * Send an encrypted message to a recipient
   *
   * High-level API that handles encryption and authentication internally.
   * Encrypts the plaintext message with the recipient's public key.
   * Uses the client's stored signer for authentication.
   *
   * @param recipient - Recipient's AID
   * @param plaintext - Message content (will be encrypted)
   * @param options - Optional message type and TTL
   * @returns Message ID
   */
  sendMessage(
    recipient: string,
    plaintext: string,
    options?: { typ?: string; ttl?: number }
  ): Promise<string>;

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
   */
  sendRawMessage(
    recipient: string,
    ciphertext: string,
    options?: { typ?: string; alg?: string; ek?: string; ttl?: number }
  ): Promise<string>;

  /**
   * Send an encrypted group message
   *
   * High-level API that handles group encryption, authentication, and sending.
   * Implements zero-knowledge encryption where the backend cannot decrypt messages.
   * Uses ephemeral AES-256-GCM keys with per-member key distribution via X25519 ECDH.
   * Uses the client's stored signer for authentication.
   *
   * @param groupId - ID of the group to send to
   * @param plaintext - Message content (will be encrypted)
   * @param options - Optional message type
   * @returns Result with messageId, seqNo, and sentAt timestamp
   */
  sendGroupMessage(
    groupId: string,
    plaintext: string,
    options?: { typ?: string }
  ): Promise<{ messageId: string; seqNo: number; sentAt: number }>;

  /**
   * Get group by unique tag
   *
   * Tags identify system-managed groups (e.g., "onboarding").
   * Returns the group ID and metadata, or null if not found.
   *
   * @param tag - Unique tag identifier (e.g., "onboarding")
   * @returns Group information or null
   */
  getGroupIdByTag(tag: string): Promise<{
    id: string;
    name: string;
    tag?: string;
    ownerAid: string;
    membershipSaid: string;
    createdAt: number;
    createdBy: string;
  } | null>;

  /** Close the client connection */
  close(): void;
}
