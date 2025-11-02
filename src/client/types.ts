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
 * Authentication credentials for operations
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
 */
export interface MeritsClient {
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

  /** Close the client connection */
  close(): void;
}
