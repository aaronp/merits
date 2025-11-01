/**
 * Merits Backend Database Schema
 *
 * This schema defines the data structures for a zero-knowledge encrypted messaging system
 * built on KERI (Key Event Receipt Infrastructure) principles.
 *
 * Key Design Principles:
 * - Zero-knowledge: Backend cannot decrypt message content
 * - End-to-end encryption: Messages encrypted client-side before sending
 * - KERI-based authentication: Challenge-response auth using Ed25519 signatures
 * - Role-based access control: Flexible RBAC for permissions
 * - Group messaging: Support for encrypted group conversations with linear message history
 *
 * Security Model:
 * - All mutations require authenticated challenges (see challenges table)
 * - Message content is always encrypted (ciphertext only)
 * - Public keys are public, but message keys are encrypted per-recipient
 * - Group messages use ephemeral keys encrypted separately for each member
 *
 * @see https://keri.one for KERI specification
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  /**
   * Messages - Direct encrypted messages between two users
   *
   * Schema for storing encrypted messages with KERI-based authentication.
   * Backend stores ciphertext only - cannot decrypt message content.
   *
   * Security:
   * - senderAid verified via challenge-response authentication
   * - ct (ciphertext) is opaque to backend
   * - envelopeHash provides audit trail without revealing content
   * - Optional receipt signatures provide non-repudiable proof of delivery
   *
   * Encryption:
   * - Uses X25519-XChaCha20-Poly1305 or similar AEAD
   * - Ephemeral key (ek) provides forward secrecy
   * - Each message has unique encryption (no key reuse)
   *
   * Lifecycle:
   * 1. Client encrypts message and creates challenge
   * 2. Backend verifies challenge and inserts message
   * 3. Recipient retrieves message (sets retrieved=true)
   * 4. Message auto-expires based on expiresAt timestamp
   *
   * Indexes:
   * - by_recipient: Fast lookup for unread messages
   * - by_expiration: Cleanup expired messages
   * - by_recipient_time: Chronological message history
   */
  messages: defineTable({
    recpAid: v.string(), // Recipient AID
    senderAid: v.string(), // REQUIRED - set by server after verification (never trust client)
    ct: v.string(), // Ciphertext (sealed to recpAid)
    ctHash: v.string(), // Hash of ct (binds challenge to this message)
    typ: v.optional(v.string()), // Optional message type for routing/authorization
    ek: v.optional(v.string()), // Sender's ephemeral X25519 pub (PFS)
    alg: v.optional(v.string()), // e.g. "x25519-xchacha20poly1305"
    createdAt: v.number(),
    expiresAt: v.number(),
    retrieved: v.boolean(),
    senderSig: v.array(v.string()), // Detached KERI indexed sigs over envelopeHash
    senderKsn: v.number(), // Key sequence at send
    senderEvtSaid: v.string(), // Last event SAID at send
    envelopeHash: v.string(), // hash(headers+ctHash) - audit anchor
    usedChallengeId: v.id("challenges"), // Which challenge authorized insertion
    // Receipt fields (non-repudiable proof of delivery)
    receiptSig: v.optional(v.array(v.string())), // Recipient's indexed sigs over envelopeHash
    receiptKsn: v.optional(v.number()), // Recipient's KSN at acknowledgment
    receiptEvtSaid: v.optional(v.string()), // Recipient's event SAID at acknowledgment
  })
    .index("by_recipient", ["recpAid", "retrieved"])
    .index("by_expiration", ["expiresAt"])
    .index("by_recipient_time", ["recpAid", "createdAt"]),

  /**
   * Challenges - Challenge-response authentication system
   *
   * Provides anti-replay protection and binds authentication to specific operations.
   * Each challenge is single-use and expires after a short time window.
   *
   * Flow:
   * 1. Client requests challenge for specific purpose and args
   * 2. Backend creates challenge with nonce and argsHash
   * 3. Client signs challenge payload with private key
   * 4. Backend verifies signature and marks challenge as used
   *
   * Security:
   * - Challenges expire after 60 seconds
   * - Each challenge can only be used once (used=true after verification)
   * - argsHash binds challenge to specific operation parameters
   * - Prevents replay attacks and unauthorized operations
   *
   * @see auth.ts for challenge creation and verification
   */
  challenges: defineTable({
    aid: v.string(),
    purpose: v.string(), // "send" | "receive" | "ack"
    argsHash: v.string(), // Hash of purpose-specific args
    nonce: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    used: v.boolean(),
  })
    .index("by_aid", ["aid"])
    .index("by_expiration", ["expiresAt"]),

  /**
   * KeyStates - KERI key state tracking for each AID
   *
   * Tracks the current cryptographic key state for each Autonomic Identifier (AID).
   * Supports key rotation via Key Event Logs (KELs).
   *
   * KERI Integration:
   * - ksn (Key Sequence Number): Increments with each key rotation
   * - keys: Current signing keys in CESR format
   * - threshold: Number of signatures required for multi-sig
   * - lastEvtSaid: Reference to last event in the KEL
   *
   * Security:
   * - Old challenges invalidated when ksn changes (key rotation)
   * - Multi-sig support via threshold mechanism
   * - Immutable audit trail via KEL references
   *
   * @see https://keri.one for KERI key rotation
   */
  keyStates: defineTable({
    aid: v.string(),
    ksn: v.number(),
    keys: v.array(v.string()), // Current signing keys (CESR)
    threshold: v.string(),
    lastEvtSaid: v.string(),
    updatedAt: v.number(),
  }).index("by_aid", ["aid"]),

  /**
   * Users - Registered user accounts with public keys
   *
   * Maps AIDs to Ed25519 public keys for encryption and verification.
   * Public keys are used for:
   * - Message encryption (converted to X25519 for ECDH)
   * - Signature verification (Ed25519)
   * - Group member key distribution
   *
   * Security:
   * - Public keys are public data (no authentication required to read)
   * - Registration requires challenge-response authentication
   * - AID uniqueness enforced by database index
   *
   * @see auth.ts registerUser() and getPublicKey()
   */
  users: defineTable({
    aid: v.string(),
    publicKey: v.string(),
    createdAt: v.number(),
  })
    .index("by_aid", ["aid"]),

  /**
   * Roles - Role definitions for RBAC system
   *
   * Defines available roles that can be assigned to users.
   * Each role has a set of permissions mapped in rolePermissions table.
   *
   * KERI Governance:
   * - adminAID: AID that created/manages this role
   * - actionSAID: Reference to governance action in TEL
   * - timestamp: Audit trail for role creation
   *
   * Common roles:
   * - ADMIN: Full system access
   * - USER: Basic user permissions
   * - GROUP_CREATOR: Can create groups
   *
   * @see rolePermissions for role-to-permission mappings
   */
  roles: defineTable({
    roleName: v.string(),
    adminAID: v.string(),
    actionSAID: v.string(),
    timestamp: v.number(),
  })
    .index("by_roleName", ["roleName"]),

  /**
   * Permissions - Permission definitions with optional data constraints
   *
   * Defines granular permissions that can be assigned to roles.
   * Each permission has a unique key and optional data payload.
   *
   * Permission Keys:
   * - CAN_CREATE_GROUPS: Allow creating new group chats
   * - CAN_MESSAGE_GROUPS: Allow sending messages to groups
   * - CAN_INVITE_MEMBERS: Allow inviting users to groups
   * - CAN_ADMIN_ROLES: Allow managing roles and permissions
   *
   * Data Payload:
   * - Optional constraints (e.g., max group size, rate limits)
   * - Can be queried for fine-grained access control
   *
   * @see rbac.ts for permission checking logic
   */
  permissions: defineTable({
    key: v.string(),
    data: v.optional(v.any()),
    adminAID: v.string(),
    actionSAID: v.string(),
    timestamp: v.number(),
  })
    .index("by_key", ["key"]),

  /**
   * RolePermissions - Many-to-many mapping between roles and permissions
   *
   * Defines which permissions are granted by each role.
   * A role can have multiple permissions, and a permission can be in multiple roles.
   *
   * Usage:
   * - Query by roleId to get all permissions for a role
   * - Query by permissionId to find which roles have a permission
   *
   * @see rbac.ts for querying user permissions
   */
  rolePermissions: defineTable({
    roleId: v.id("roles"),
    permissionId: v.id("permissions"),
    adminAID: v.string(),
    actionSAID: v.string(),
    timestamp: v.number(),
  })
    .index("by_role", ["roleId"])
    .index("by_permission", ["permissionId"]),

  /**
   * UserRoles - Many-to-many mapping between users and roles
   *
   * Assigns roles to users. A user can have multiple roles.
   * All permissions from assigned roles are aggregated for access control.
   *
   * Usage:
   * - Query by userAID to get all roles for a user
   * - Query by roleId to find all users with a role
   *
   * @see rbac.ts checkPermission() for permission evaluation
   */
  userRoles: defineTable({
    userAID: v.string(),
    roleId: v.id("roles"),
    adminAID: v.string(),
    actionSAID: v.string(),
    timestamp: v.number(),
  })
    .index("by_user", ["userAID"])
    .index("by_role", ["roleId"]),

  /**
   * GroupChats - Group conversation metadata
   *
   * Represents a group conversation with encrypted message history.
   * Each group has a linear sequence of messages stored in groupMessages table.
   *
   * KERI Governance:
   * - ownerAid: AID that controls the group (via KEL)
   * - membershipSaid: Reference to membership list in TEL
   * - Supports governance events for membership changes
   *
   * Security:
   * - Only members can send/receive messages (verified in groupMembers)
   * - Messages encrypted with ephemeral keys per message
   * - Backend cannot decrypt messages (zero-knowledge)
   *
   * Lifecycle:
   * 1. Creator creates group (requires CAN_CREATE_GROUPS permission)
   * 2. Members added to groupMembers table
   * 3. Messages sent via sendGroupMessage mutation
   * 4. Messages auto-expire based on maxTtl
   *
   * @see groupMessages for message storage
   * @see groupMembers for membership tracking
   */
  groupChats: defineTable({
    // Group identity and governance
    ownerAid: v.string(), // AID of the KEL which owns this group
    membershipSaid: v.string(), // SAID reference to membership TEL data

    // Group metadata
    name: v.string(), // Human-readable group name
    maxTtl: v.number(), // Maximum TTL for messages (for cleanup)
    createdAt: v.number(),
    createdBy: v.string(), // AID that created the group
  })
    .index("by_owner", ["ownerAid"])
    .index("by_created", ["createdAt"]),

  /**
   * GroupMessages - Encrypted group message history
   *
   * Stores encrypted messages for group conversations using zero-knowledge encryption.
   * Each message is encrypted with an ephemeral group key, which is then encrypted
   * separately for each group member using X25519 ECDH + AES-256-GCM.
   *
   * Encryption Structure (GroupMessage):
   * - encryptedContent: Message encrypted with ephemeral AES-256-GCM key
   * - nonce: AES-GCM nonce for content encryption (96 bits)
   * - encryptedKeys: Map of {aid -> {encryptedKey, nonce}} for each member
   * - aad: Additional Authenticated Data (optional)
   *
   * Security Properties:
   * - Zero-knowledge: Backend cannot decrypt messages
   * - Forward secrecy: Ephemeral key per message
   * - Per-recipient isolation: Each member has separate encrypted key
   * - Authenticated encryption: AES-GCM provides authenticity
   *
   * Message Ordering:
   * - seqNo: Monotonically increasing sequence number per group
   * - Provides total ordering of messages
   * - Used for sync and unread tracking (see groupMembers.latestSeqNo)
   *
   * Decryption Flow (client-side):
   * 1. Recipient looks up their encrypted key in encryptedKeys[recipientAid]
   * 2. Performs ECDH with sender's public key to derive shared secret
   * 3. Decrypts ephemeral group key using shared secret
   * 4. Decrypts message content using ephemeral key
   *
   * Indexes:
   * - by_group_seq: Fast lookup by group and sequence number
   * - by_group_time: Chronological message history
   * - by_sender: Messages sent by a specific user
   * - by_expiration: Cleanup expired messages
   *
   * @see cli/lib/crypto-group.ts for encryption implementation
   * @see groups.ts sendGroupMessage() and getGroupMessages()
   */
  groupMessages: defineTable({
    groupChatId: v.id("groupChats"), // Foreign key to group chat

    // GroupMessage structure (from CLI encryption)
    encryptedContent: v.string(), // base64url - message encrypted with group key
    nonce: v.string(), // base64url - AES-GCM nonce (96 bits)
    encryptedKeys: v.any(), // Record<aid, {encryptedKey, nonce}> - per-recipient keys
    aad: v.optional(v.string()), // base64url - Additional Authenticated Data

    // Legacy fields for backwards compatibility
    encryptedMessage: v.optional(v.string()), // Deprecated - use encryptedContent
    messageType: v.optional(v.string()), // Type of message (text, file, system, etc.)

    // Sender information
    senderAid: v.string(), // AID of message sender

    // Ordering and timestamps
    seqNo: v.number(), // Sequence number for message ordering
    received: v.number(), // Timestamp when message was received by server

    // Optional expiration for cleanup
    expiresAt: v.optional(v.number()),
  })
    .index("by_group_seq", ["groupChatId", "seqNo"])
    .index("by_group_time", ["groupChatId", "received"])
    .index("by_sender", ["senderAid", "received"])
    .index("by_expiration", ["expiresAt"]),

  /**
   * GroupMembers - Group membership and message sync tracking
   *
   * Tracks who is a member of each group and their message sync state.
   * Used for access control and determining unread messages.
   *
   * Sync State:
   * - latestSeqNo: Last message sequence number this member has seen
   * - Used to determine unread messages (seqNo > latestSeqNo)
   * - Updated when member reads messages
   *
   * Membership Roles:
   * - owner: Full control over group (can delete, change settings)
   * - admin: Can invite/remove members
   * - member: Can send/receive messages
   *
   * Access Control:
   * - Verified before allowing sendGroupMessage
   * - Verified before returning messages in getUnread
   * - Verified before returning member list in getMembers
   *
   * Indexes:
   * - by_group: All members of a group
   * - by_aid: All groups a user is member of
   * - by_group_aid: Fast membership lookup
   *
   * @see groups.ts for membership verification
   */
  groupMembers: defineTable({
    groupChatId: v.id("groupChats"), // Foreign key to group chat
    aid: v.string(), // AID of the member

    // Sync tracking
    latestSeqNo: v.number(), // Latest message seq number this user has received

    // Membership metadata
    joinedAt: v.number(),
    role: v.string(), // "owner" | "admin" | "member"
  })
    .index("by_group", ["groupChatId"])
    .index("by_aid", ["aid"])
    .index("by_group_aid", ["groupChatId", "aid"]),

  /**
   * SessionTokens - Short-lived bearer tokens for streaming operations
   *
   * Provides temporary authentication for operations that don't support
   * challenge-response (e.g., WebSocket streaming, long-polling).
   *
   * Token Lifecycle:
   * 1. Client authenticates via challenge-response
   * 2. Backend issues session token (60s expiry)
   * 3. Client uses token for streaming operations
   * 4. Token auto-expires and must be refreshed
   *
   * Security:
   * - Tokens are cryptographically random (64 bytes)
   * - Short expiry window (60 seconds max)
   * - Invalidated on key rotation (ksn changes)
   * - Limited scopes (e.g., only "receive" operations)
   * - Audit trail via useCount and lastUsedAt
   *
   * Scopes:
   * - receive: Can retrieve messages
   * - ack: Can acknowledge message receipt
   * - Custom scopes for future features
   *
   * Claims:
   * - Optional key-value pairs for fine-grained permissions
   * - Can restrict token to specific groups or message types
   *
   * Indexes:
   * - by_token: Fast token validation
   * - by_aid: Revoke all tokens for a user
   * - by_expiration: Cleanup expired tokens
   *
   * @see auth.ts issueSessionToken() and validateSessionToken()
   */
  sessionTokens: defineTable({
    token: v.string(), // Cryptographically random token (64 bytes hex)
    aid: v.string(), // AID this token is bound to
    ksn: v.number(), // Key sequence number at token issuance (invalidated on rotation)
    scopes: v.array(v.string()), // Operations allowed: ["receive", "ack"]
    claims: v.array(
      v.object({
        key: v.string(),
        data: v.optional(v.any()),
      })
    ),
    createdAt: v.number(), // Token creation timestamp
    expiresAt: v.number(), // Token expiry (max 60s from creation)
    usedChallengeId: v.id("challenges"), // Challenge that authorized token creation
    // Audit trail
    lastUsedAt: v.optional(v.number()), // Last time token was used
    useCount: v.number(), // Number of times token has been used
  })
    .index("by_token", ["token"]) // Fast lookup by token string
    .index("by_aid", ["aid"]) // Lookup all tokens for an AID
    .index("by_expiration", ["expiresAt"]), // Cleanup expired tokens
});
