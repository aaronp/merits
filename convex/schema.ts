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

  // Admin Roles - AIDs that can perform admin operations
  adminRoles: defineTable({
    aid: v.string(), // Admin AID
    role: v.string(), // "onboarding_admin" | "super_admin"
    grantedBy: v.optional(v.string()), // Who granted this role
    grantedAt: v.number(),
    active: v.boolean(),
  })
    .index("by_aid", ["aid"])
    .index("by_role", ["role"])
    .index("by_active", ["active"]),

  // Tier Configurations - Define permissions and rules for each tier
  tierConfigs: defineTable({
    name: v.string(), // "unknown", "known", "verified", "test", etc.
    priority: v.number(), // For pattern matching (higher = checked first)
    isDefault: v.boolean(), // Auto-assign to AIDs with no explicit tier
    aidPatterns: v.array(v.string()), // Regex patterns for auto-assignment (checked on sender)
    requiresPromotion: v.boolean(), // Must be assigned by admin
    canMessageTiers: v.array(v.string()), // Which tiers can receive messages
    canMessageAnyone: v.boolean(), // Bypass tier checks
    messagesPerWindow: v.number(), // Rate limit
    windowMs: v.number(), // Rate limit window duration
    description: v.string(),
    createdBy: v.string(), // Admin AID or "SYSTEM"
    createdAt: v.number(),
    active: v.boolean(),
  })
    .index("by_priority", ["active", "priority"])
    .index("by_name", ["name", "active"]),

  // AID → Tier Assignments
  aidTiers: defineTable({
    aid: v.string(),
    tierName: v.string(), // References tierConfigs.name
    assignedBy: v.string(), // "SYSTEM" | admin AID
    assignedAt: v.number(),
    promotionProof: v.optional(v.string()), // SAID reference for audit
    kycStatus: v.optional(v.string()), // For verified tier
    kycProvider: v.optional(v.string()),
    kycTimestamp: v.optional(v.number()),
    notes: v.optional(v.string()),
  })
    .index("by_aid", ["aid"])
    .index("by_tier", ["tierName"]),

  // Rate limits per AID (tracks actual usage)
  rateLimits: defineTable({
    aid: v.string(),
    tierName: v.string(), // Current tier (for audit)
    windowStart: v.number(), // Start of current window
    windowDuration: v.number(), // Duration in ms
    messagesInWindow: v.number(), // Count in current window
    limit: v.number(), // Max messages per window (from tier config)
  }).index("by_aid", ["aid"]),

  // Groups - collections of AIDs for server-side fanout messaging
  groups: defineTable({
    name: v.string(), // Human-readable group name
    createdBy: v.string(), // Creator AID (initial owner)
    createdAt: v.number(),
    // Members stored inline for fast access
    members: v.array(
      v.object({
        aid: v.string(),
        role: v.string(), // "owner" | "admin" | "member"
        joinedAt: v.number(),
      })
    ),
  })
    .index("by_member", ["members"]) // Find groups by member AID
    .index("by_created", ["createdAt"]),

  // Group message log - maintains total ordering of group messages
  groupLog: defineTable({
    groupId: v.id("groups"),
    senderAid: v.string(), // Verified sender AID
    seqNum: v.number(), // Monotonic sequence number per group
    ct: v.string(), // Original ciphertext (encrypted to group key)
    ctHash: v.string(), // Hash of ct
    typ: v.optional(v.string()), // Message type for routing
    createdAt: v.number(),
    expiresAt: v.number(),
    senderSig: v.array(v.string()), // Sender's indexed sigs
    senderKsn: v.number(),
    senderEvtSaid: v.string(),
    envelopeHash: v.string(), // Audit anchor
    usedChallengeId: v.id("challenges"),
    // Fan-out status - track which members have been notified
    fanoutComplete: v.boolean(),
    fanoutCount: v.number(), // Number of individual messages created
  })
    .index("by_group", ["groupId", "seqNum"])
    .index("by_group_time", ["groupId", "createdAt"])
    .index("by_expiration", ["expiresAt"]),

  // Phase 4: Session Tokens - Short-lived bearer tokens for streaming operations
  sessionTokens: defineTable({
    token: v.string(), // Cryptographically random token (64 bytes hex)
    aid: v.string(), // AID this token is bound to
    ksn: v.number(), // Key sequence number at token issuance (invalidated on rotation)
    scopes: v.array(v.string()), // Operations allowed: ["receive", "ack"]
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
