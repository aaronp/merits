/**
 * Convex Transport Client - Type Definitions
 *
 * Clean interface for KERI message transport over Convex.
 * Designed to be imported by kerits core without circular dependencies.
 */

/**
 * Core primitives
 */
export type AID = string;   // KERI AID (e.g., "EAlice...")
export type SAID = string;  // Self-Addressing Identifier
export type Bytes = Uint8Array;

/**
 * Signature over message envelope SAID
 * Required for non-repudiation
 */
export interface Signature {
  ksn: number;      // Key sequence number at signing time
  sig: string;      // CESR signature over envelope SAID
}

/**
 * KEL Event Hint
 *
 * Helps recipient identify which KEL state to use for verification.
 * Especially useful after key rotations.
 */
export interface KelEventHint {
  /** SAID of the latest establishment event (inception or rotation) */
  est: SAID;

  /** Sequence number of the establishment event */
  s: number;
}

/**
 * Transport Message
 *
 * Core message envelope for KERI-authenticated peer-to-peer messaging.
 *
 * ## Message ID (SAID)
 * `id = SAID({ from, to, typ, refs, dt, bodyHash, evt?, nonce? })`
 * - Uses bodyHash (not full body) for efficient SAID computation
 * - Includes all envelope fields for tamper-evidence
 *
 * ## Responsibilities
 * - **Client sets**: from, to, typ, body, refs, dt, evt (optional), nonce (optional)
 * - **Transport computes**: id (SAID), sigs[] (signs with signer)
 * - **Server verifies**: id matches recomputed SAID, sigs[] valid for from's KEL state
 *
 * ## Security Properties
 * - **Non-repudiation**: sigs[] proves sender control of from AID
 * - **Integrity**: id (SAID) detects any tampering
 * - **Replay protection**: nonce (if present) + server-side deduplication by id
 * - **Timeliness**: dt timestamp (not enforced by transport, but available for policy)
 */
export interface Message {
  /**
   * Message ID - SAID of envelope
   *
   * **Computed by**: Transport (before sending)
   * **Verified by**: Server (on receipt)
   * **Purpose**: Tamper-evident identifier, enables idempotent delivery
   */
  id: SAID;

  /**
   * Sender AID
   *
   * **Set by**: Client (application)
   * **Verified by**: Server (must match authenticated AID from challenge-response or KEL)
   * **Purpose**: Identifies message sender
   */
  from: AID;

  /**
   * Recipient AID
   *
   * **Set by**: Client (application)
   * **Used by**: Server (for routing/authorization), recipient (for filtering)
   * **Purpose**: Identifies intended recipient
   */
  to: AID;

  /**
   * Message type
   *
   * **Set by**: Client (application)
   * **Examples**: "kel.proposal", "tel.append", "app.message", "acdc.credential"
   * **Purpose**: Application-level routing/handling, authorization policy
   */
  typ: string;

  /**
   * Message body (payload)
   *
   * **Set by**: Client (application)
   * **Format**: Raw bytes (can be encrypted by MessageBus layer)
   * **Encryption**: Higher layer (MessageBus) wraps as `{ct, ek, alg, aad}`
   * **Purpose**: Application data
   */
  body: Bytes;

  /**
   * Referenced SAIDs (optional)
   *
   * **Set by**: Client (application, if applicable)
   * **Examples**: SAIDs of KEL events, TEL entries, ACDC credentials
   * **Purpose**: Links message to other content-addressed data
   */
  refs?: SAID[];

  /**
   * Datetime (ISO 8601)
   *
   * **Set by**: Client (application)
   * **Format**: ISO string (e.g., "2025-01-15T10:30:00Z")
   * **Verified by**: Server (optional - can enforce max skew for timeliness)
   * **Purpose**: Timestamp for ordering, expiration, timeliness checks
   */
  dt: string;

  /**
   * Signatures over envelope SAID
   *
   * **Computed by**: Transport (signs id with signer)
   * **Verified by**: Server (against from's KEL state at ksn)
   * **Required**: At least one signature
   * **Purpose**: Non-repudiation, proves sender control of from AID
   */
  sigs: Signature[];

  /**
   * Per-sender sequence number (optional)
   *
   * **Set by**: Client (MessageBus layer, if ordering needed)
   * **Maintained by**: Sender (monotonic counter per recipient)
   * **Purpose**: Client-side message reordering (transport makes no ordering guarantees)
   */
  seq?: number;

  /**
   * KEL event hint (optional)
   *
   * **Set by**: Client (if recently rotated keys)
   * **Purpose**: Helps recipient identify which KEL state to use for sig verification
   * **Use case**: After rotation, sender includes {est, s} to hint at new keys
   */
  evt?: KelEventHint;

  /**
   * Nonce for replay protection (optional)
   *
   * **Set by**: Client (if replay protection needed)
   * **Format**: Random hex or base64 string (96-128 bits recommended)
   * **Verified by**: Server (optional - can maintain seen-nonce cache)
   * **Purpose**: Prevents replay attacks (combined with id deduplication)
   */
  nonce?: string;
}

/**
 * Channel - Message subscription interface
 */
export interface Channel {
  /**
   * Subscribe to messages for this channel
   * Returns unsubscribe function
   */
  subscribe(onMessage: (m: Message) => void): () => void;
}

/**
 * Signer interface - abstracts signing operations
 * Implementation can use libsodium, WebCrypto, or hardware keys
 */
export interface Signer {
  /** Sign data and return CESR signature */
  sign(data: Uint8Array): Promise<string>;

  /** Get current public key (verifier) in CESR format */
  verifier(): string;
}

/**
 * Transport Configuration
 */
export interface TransportConfig {
  /** Convex deployment URL */
  convexUrl: string;

  /** Authenticated AID */
  aid: AID;

  /** Signer for challenge-response and message signing */
  signer: Signer;

  /** Current key sequence number */
  ksn: number;

  /** Optional: Last establishment event SAID (for key state) */
  estEventSaid?: SAID;
}

/**
 * Transport Interface
 *
 * Core message delivery abstraction.
 * Handles authentication, signatures, and delivery semantics.
 */
export interface Transport {
  /**
   * Send a message
   * - Automatically computes message SAID
   * - Signs envelope with signer
   * - Uses challenge-response for authentication
   * - Idempotent (duplicate sends are no-ops)
   */
  send(msg: Omit<Message, 'id' | 'sigs'>): Promise<SAID>;

  /**
   * Get channel for receiving messages to an AID
   * Uses WebSocket subscription with cursor management
   */
  channel(aid: AID): Channel;

  /**
   * Read unread messages (poll-based fallback)
   * Returns messages that haven't been acknowledged
   */
  readUnread(aid: AID, limit?: number): Promise<Message[]>;

  /**
   * Acknowledge messages (idempotent)
   * Marks messages as read
   */
  ack(aid: AID, messageIds: SAID[]): Promise<void>;

  /**
   * Close transport and cleanup resources
   */
  close(): void;
}

/**
 * Key State Registration
 *
 * Must be called before creating transport to register the AID's key state.
 * Uses challenge-response authentication.
 */
export interface KeyStateRegistration {
  aid: AID;
  ksn: number;
  verfer: string;           // Current public key (CESR)
  estEventSaid: SAID;       // Anchored establishment event
}

/**
 * Challenge-Response Types (internal to transport)
 */
export interface Challenge {
  id: string;
  aid: AID;
  mutationName: string;
  argsHash: string;
  ksn: number;
  nonce: string;
  exp: number;              // Expiration timestamp
  used: boolean;            // Single-use flag
}

export interface ChallengeResponse {
  challengeId: string;
  signature: string;        // Signature over SAID(challengeId||mutation||argsHash||nonce)
}
