/**
 * Transport Interface - Backend-agnostic message transport contract
 *
 * Provides encrypted message delivery for KERI-authenticated senders.
 * Supports both pull (receiveMessages) and push (subscribe) models.
 */

import { AID, AuthProof } from "../types";

/**
 * Request to send a message
 */
export interface MessageSendRequest {
  /** Recipient AID */
  to: AID;

  /** Ciphertext body (already encrypted for recipient) */
  ct: string;

  /** Application message type (e.g., "chat.text.v1", "kel.proposal") */
  typ?: string;

  /** Ephemeral sender public key for PFS (e.g., X25519) */
  ek?: string;

  /** Encryption algorithm identifier (e.g., "x25519-xchacha20poly1305") */
  alg?: string;

  /** Time-to-live in milliseconds (how long server keeps this message) */
  ttlMs?: number;

  /** Authentication proof (sender proves control of their AID) */
  auth: AuthProof;
}

/**
 * Encrypted message delivered to recipient
 *
 * Contains everything needed to:
 * - Decrypt the message
 * - Verify sender's identity
 * - Prove non-repudiation
 * - Route to appropriate handler (via typ)
 */
export interface EncryptedMessage {
  /** Server-assigned message ID / SAID of envelope */
  id: string;

  /** Sender AID (server-verified, never client-supplied) */
  from: AID;

  /** Recipient AID */
  to: AID;

  /** Ciphertext body */
  ct: string;

  /** Ephemeral key for decryption (optional) */
  ek?: string;

  /** Algorithm identifier (optional) */
  alg?: string;

  /** Message type for routing (optional) */
  typ?: string;

  /** Server timestamp when message was accepted (ms since epoch) */
  createdAt: number;

  /** Server timestamp when message expires (ms since epoch) */
  expiresAt: number;

  /**
   * Envelope hash - deterministic hash of message metadata + ctHash.
   * Used for:
   * - Audit trails
   * - Delivery receipts (recipient signs this to prove receipt)
   * - Non-repudiation
   */
  envelopeHash: string;

  /**
   * Sender's cryptographic proof at send time.
   * Proves sender controlled their AID when sending.
   */
  senderProof: {
    /** Indexed signatures over envelope */
    sigs: string[];

    /** Sender's KSN at send time */
    ksn: number;

    /** SAID of sender's KEL event at send time */
    evtSaid: string;
  };
}

/**
 * Options for subscribing to live message feed
 */
export interface SubscribeOptions {
  /** AID to receive messages for */
  for: AID;

  /** Authentication proof (proves control of the AID) */
  auth: AuthProof;

  /**
   * Callback invoked for each new message.
   *
   * Return value:
   * - `true`: Message handled successfully, auto-acknowledge it
   * - `false` or `undefined`: Keep message unread for retry
   *
   * If the handler throws, the message stays unread.
   */
  onMessage: (msg: EncryptedMessage) => Promise<boolean> | boolean;

  /**
   * Error handler for network/auth failures.
   * Optional - if not provided, errors will be thrown.
   */
  onError?: (err: Error) => void;
}

/**
 * Transport - Message delivery interface
 *
 * Provides both pull and push models for message delivery:
 * - Pull: Client calls receiveMessages() periodically
 * - Push: Client calls subscribe() to get real-time updates
 */
export interface Transport {
  /**
   * Send a message to a recipient.
   *
   * The sender must prove control of their AID via auth.
   * Server will:
   * - Verify authentication
   * - Check authorization (can sender message this recipient?)
   * - Enforce rate limits
   * - Store message with TTL
   * - Return message ID
   *
   * @returns Message ID assigned by server
   */
  sendMessage(req: MessageSendRequest): Promise<{ messageId: string }>;

  /**
   * Receive messages for an AID (pull model).
   *
   * Returns all unretrieved, non-expired messages for the recipient.
   * Messages remain in the queue until acknowledged.
   *
   * Authentication required - recipient must prove control of their AID.
   * Server enforces that auth.aid === req.for (can't receive for others).
   */
  receiveMessages(req: {
    for: AID;
    auth: AuthProof;
  }): Promise<EncryptedMessage[]>;

  /**
   * Acknowledge receipt of a message.
   *
   * Marks the message as retrieved so it won't appear in future receives.
   * Optionally includes recipient's signature over envelopeHash for
   * non-repudiation proof of delivery.
   *
   * Authentication required - must be the message recipient.
   */
  ackMessage(req: {
    messageId: string;
    auth: AuthProof;
    receiptSig?: string[]; // Recipient's indexed sigs over envelopeHash
  }): Promise<void>;

  /**
   * Subscribe to live message feed (push model).
   *
   * Opens a persistent connection and calls onMessage for each new message.
   * Messages are auto-acknowledged if onMessage returns true.
   *
   * Authentication required - subscriber must prove control of their AID.
   *
   * @returns Cancel function to stop the subscription
   */
  subscribe(opts: SubscribeOptions): Promise<() => void>;
}
