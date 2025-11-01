import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
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

  keyStates: defineTable({
    aid: v.string(),
    ksn: v.number(),
    keys: v.array(v.string()), // Current signing keys (CESR)
    threshold: v.string(),
    lastEvtSaid: v.string(),
    updatedAt: v.number(),
  }).index("by_aid", ["aid"]),

  // Users - Registered users with public keys
  users: defineTable({
    aid: v.string(),
    publicKey: v.string(),
    createdAt: v.number(),
  })
    .index("by_aid", ["aid"]),

  // Roles - Available roles
  roles: defineTable({
    roleName: v.string(),
    adminAID: v.string(),
    actionSAID: v.string(),
    timestamp: v.number(),
  })
    .index("by_roleName", ["roleName"]),

  // Permissions - Permission keys and optional data payload
  permissions: defineTable({
    key: v.string(),
    data: v.optional(v.any()),
    adminAID: v.string(),
    actionSAID: v.string(),
    timestamp: v.number(),
  })
    .index("by_key", ["key"]),

  // RolePermissions - mapping roles to permissions
  rolePermissions: defineTable({
    roleId: v.id("roles"),
    permissionId: v.id("permissions"),
    adminAID: v.string(),
    actionSAID: v.string(),
    timestamp: v.number(),
  })
    .index("by_role", ["roleId"]) 
    .index("by_permission", ["permissionId"]),

  // UserRoles - mapping users to roles
  userRoles: defineTable({
    userAID: v.string(),
    roleId: v.id("roles"),
    adminAID: v.string(),
    actionSAID: v.string(),
    timestamp: v.number(),
  })
    .index("by_user", ["userAID"]) 
    .index("by_role", ["roleId"]),

  // GroupChat - Represents a group conversation with linear message history
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

  // GroupMessages - Linear history of messages within a group
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

  // GroupMembers - Track membership and sync state
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

  // Phase 4: Session Tokens - Short-lived bearer tokens for streaming operations
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
