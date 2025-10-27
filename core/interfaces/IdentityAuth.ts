/**
 * IdentityAuth Interface - Backend-agnostic authentication contract
 *
 * Provides challenge/response authentication for KERI AIDs.
 * Any backend (Convex, REST API, etc.) can implement this interface.
 */

import { AID, AuthProof } from "../types";

/**
 * Purpose of authentication challenge
 *
 * Each purpose binds the authentication to a specific operation type,
 * preventing replay attacks across different contexts.
 */
export type Purpose =
  | "send"        // Send a message
  | "receive"     // Receive messages
  | "ack"         // Acknowledge message receipt
  | "admin"       // Admin operations
  | "sendGroup"   // Send group message
  | "manageGroup" // Create/update group
  | "openSession"; // Phase 4: Create session token for streaming

/**
 * Request to issue an authentication challenge
 */
export interface IssueChallengeRequest {
  /** The AID requesting authentication */
  aid: AID;

  /** Purpose of this authentication (prevents cross-purpose replay) */
  purpose: Purpose;

  /**
   * Arguments to bind to this challenge.
   * Server will hash these and include in the payload.
   * Client must provide the exact same args when verifying.
   */
  args: Record<string, unknown>;

  /** Challenge TTL in milliseconds (optional, defaults to 120s) */
  ttlMs?: number;
}

/**
 * Response from issuing a challenge
 */
export interface IssueChallengeResponse {
  /** Opaque challenge identifier to include in AuthProof */
  challengeId: string;

  /**
   * Canonical payload that the client must sign.
   * This payload binds together:
   * - The AID (who)
   * - The purpose (what operation)
   * - The args hash (specific parameters)
   * - A nonce (uniqueness)
   * - A timestamp (replay prevention)
   */
  payloadToSign: {
    ver: "msg-auth/1";    // Payload schema version
    aud: string;          // Audience (server origin)
    ts: number;           // Timestamp (ms since epoch)
    nonce: string;        // Random nonce
    aid: AID;             // Who is authenticating
    purpose: Purpose;     // What they're authenticating for
    argsHash: string;     // Hash of bound arguments
  };
}

/**
 * Request to verify an authentication proof
 */
export interface VerifyAuthRequest {
  /** The authentication proof from the client */
  proof: AuthProof;

  /** Expected purpose (must match what was in the challenge) */
  expectedPurpose: Purpose;

  /**
   * Arguments to verify against the challenge.
   * Server will hash these and compare to the challenge's argsHash.
   * MUST be identical to the args used in issueChallenge.
   */
  args: Record<string, unknown>;
}

/**
 * Result of successful authentication verification
 */
export interface VerifyAuthResult {
  /** The authenticated AID (from the challenge, NEVER trust client) */
  aid: AID;

  /** Current Key Sequence Number for this AID */
  ksn: number;

  /** SAID of the last key event that established current keys */
  evtSaid: string;
}

/**
 * IdentityAuth - Challenge/response authentication for KERI AIDs
 *
 * Flow:
 * 1. Client calls issueChallenge(aid, purpose, args)
 * 2. Server returns challengeId + payloadToSign
 * 3. Client signs payloadToSign with their AID's keys
 * 4. Client calls operation with AuthProof { challengeId, sigs, ksn }
 * 5. Server calls verifyAuth(proof, purpose, args) internally
 * 6. Server performs operation as the authenticated AID
 *
 * Security properties:
 * - Challenges are single-use (replay prevention)
 * - Args hash binds authentication to specific parameters
 * - Purpose binds to operation type
 * - KSN prevents use of revoked keys
 * - Threshold signatures required
 */
export interface IdentityAuth {
  /**
   * Issue a challenge for authentication
   *
   * Returns a payload that the client must sign with their AID's keys.
   * The challenge is valid for ttlMs (default 120s) and single-use.
   */
  issueChallenge(req: IssueChallengeRequest): Promise<IssueChallengeResponse>;

  /**
   * Verify an authentication proof
   *
   * Called internally by the server during mutation/query handling.
   * Validates:
   * - Challenge exists and hasn't been used
   * - Challenge hasn't expired
   * - Purpose matches
   * - Args hash matches (args are identical)
   * - Signatures meet threshold for the AID's current keys
   * - KSN matches current state
   *
   * Returns the authenticated AID on success.
   * Throws an error on failure.
   */
  verifyAuth(req: VerifyAuthRequest): Promise<VerifyAuthResult>;
}
