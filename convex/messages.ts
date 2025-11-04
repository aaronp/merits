import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { verifyAuth, verifySignedRequest, computeCtHash, computeEnvelopeHash } from "./auth";
import { resolveUserClaims, claimsInclude, PERMISSIONS } from "./permissions";
import { canMessage, canMessageBatch } from "./accessControl";

/**
 * Send a message to a recipient (authenticated)
 *
 * SECURITY: senderAid is DERIVED from verified signature, never trusted from client!
 *
 * Supports two authentication methods:
 * - sig (NEW): Per-request signature (preferred)
 * - auth (OLD): Challenge-response (backward compatibility)
 */
export const send = mutation({
  args: {
    recpAid: v.string(),
    ct: v.string(), // Ciphertext
    typ: v.optional(v.string()), // Message type for authorization (e.g., "app.message", "kel.proposal")
    ek: v.optional(v.string()), // Ephemeral key for PFS
    alg: v.optional(v.string()), // Algorithm identifier
    ttl: v.optional(v.number()), // TTL in milliseconds
    // NEW: Signed request (preferred)
    sig: v.optional(
      v.object({
        signature: v.string(),
        timestamp: v.number(),
        nonce: v.string(),
        keyId: v.string(),
        signedFields: v.array(v.string()),
      })
    ),
    // OLD: Challenge-response (backward compatibility)
    auth: v.optional(
      v.object({
        challengeId: v.id("challenges"),
        sigs: v.array(v.string()),
        ksn: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Enforce TTL limits
    const MIN_TTL = 1000; // 1 second
    const MAX_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
    const ttl = args.ttl ?? 24 * 60 * 60 * 1000; // Default 24 hours

    if (ttl < MIN_TTL || ttl > MAX_TTL) {
      throw new Error(`Invalid TTL: must be between ${MIN_TTL}ms and ${MAX_TTL}ms`);
    }

    // Enforce ciphertext size limit
    const MAX_CT_SIZE = 64 * 1024; // 64 KiB
    if (args.ct.length > MAX_CT_SIZE) {
      throw new Error(`Ciphertext too large: max ${MAX_CT_SIZE} bytes`);
    }

    const expiresAt = now + ttl;

    // Compute ctHash for binding
    const ctHash = await computeCtHash(args.ct);

    // Verify authentication - support both sig and auth
    let senderAid: string;
    let senderKsn: number;
    let senderEvtSaid: string;
    let senderSigs: string[];
    let usedChallengeId: string | undefined;

    if (args.sig) {
      // NEW: Signed request (preferred)
      const verified = await verifySignedRequest(ctx, args);
      senderAid = verified.aid;
      senderKsn = verified.ksn;
      senderEvtSaid = verified.evtSaid;
      senderSigs = [args.sig.signature];
      usedChallengeId = undefined;
    } else if (args.auth) {
      // OLD: Challenge-response (backward compatibility)
      const verified = await verifyAuth(
        ctx,
        args.auth,
        "send",
        {
          recpAid: args.recpAid,
          ctHash, // Bind to hash, not plaintext
          ttl, // Use ttl, not expiresAt (timing-independent)
          alg: args.alg ?? "",
          ek: args.ek ?? "",
        }
      );
      senderAid = verified.aid;
      senderKsn = verified.ksn;
      senderEvtSaid = verified.evtSaid;
      senderSigs = args.auth.sigs;
      usedChallengeId = verified.challengeId;
    } else {
      throw new Error("Must provide either sig or auth");
    }

    // AUTHORIZATION: RBAC permission check
    // Check if recipient is a group or a user
    const isGroup = await ctx.db
      .query("groupChats")
      .filter((q) => q.eq(q.field("_id"), args.recpAid))
      .first();


    const claims = await resolveUserClaims(ctx, senderAid);
    let allowed = false;

    if (isGroup) {
      // Check CAN_MESSAGE_GROUPS permission
      allowed = claimsInclude(claims, PERMISSIONS.CAN_MESSAGE_GROUPS, (data) => {
        if (data === undefined || data === null) return true; // global allow
        // data should be an array of group IDs
        if (Array.isArray(data)) return data.includes(args.recpAid);
        return false;
      });
    } else {
      // Check CAN_MESSAGE_USERS permission
      allowed = claimsInclude(claims, PERMISSIONS.CAN_MESSAGE_USERS, (data) => {
        const result = data === undefined || data === null;
        if (result) return true; // global allow
        if (Array.isArray(data)) return data.includes(args.recpAid);
        if (typeof data === "object" && Array.isArray((data as any).aids)) {
          return (data as any).aids.includes(args.recpAid);
        }
        return false;
      });
    }


    if (!allowed) {
      throw new Error("Not permitted to message this recipient");
    }

    // ACCESS CONTROL: Check allow/deny lists
    const access = await canMessage(ctx, senderAid, args.recpAid);
    if (!access.allowed) {
      throw new Error(`Cannot send message: ${access.reason}`);
    }

    // Compute envelope hash (audit anchor)
    const envelopeHash = await computeEnvelopeHash(
      args.recpAid,
      senderAid,
      ctHash,
      args.alg,
      args.ek,
      now,
      expiresAt
    );

    const messageId = await ctx.db.insert("messages", {
      recpAid: args.recpAid,
      senderAid, // Server-verified, not client-supplied!
      ct: args.ct,
      ctHash,
      typ: args.typ,
      ek: args.ek,
      alg: args.alg,
      createdAt: now,
      expiresAt,
      retrieved: false,
      senderSig: senderSigs,
      senderKsn,
      senderEvtSaid,
      envelopeHash,
      usedChallengeId,
    });

    return messageId;
  },
});

/**
 * Retrieve messages for a recipient (authenticated)
 */
export const receive = mutation({
  args: {
    recpAid: v.string(),
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Verify authentication - argsHash binds to recpAid only
    const verified = await verifyAuth(
      ctx,
      args.auth,
      "receive",
      {
        recpAid: args.recpAid,
      }
    );

    // SECURITY: Ensure the verified AID matches the recipient
    if (verified.aid !== args.recpAid) {
      throw new Error("Cannot receive messages for different AID");
    }

    // Get all unretrieved messages for the recipient that haven't expired
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_recipient", (q) =>
        q.eq("recpAid", args.recpAid).eq("retrieved", false)
      )
      .filter((q) => q.gt(q.field("expiresAt"), now))
      .collect();

    // ACCESS CONTROL: Filter out messages from blocked senders
    const senderAids = [...new Set(messages.map((m) => m.senderAid))];
    const accessMap = await canMessageBatch(ctx, senderAids, args.recpAid);
    const filteredMessages = messages.filter((msg) => {
      const access = accessMap.get(msg.senderAid);
      return access?.allowed ?? true;
    });

    return filteredMessages.map((msg) => ({
      id: msg._id,
      senderAid: msg.senderAid,
      ct: msg.ct,
      typ: msg.typ,
      ctHash: msg.ctHash,
      ek: msg.ek,
      alg: msg.alg,
      createdAt: msg.createdAt,
      expiresAt: msg.expiresAt,
      senderSig: msg.senderSig,
      senderKsn: msg.senderKsn,
      senderEvtSaid: msg.senderEvtSaid,
      envelopeHash: msg.envelopeHash,
    }));
  },
});

/**
 * Mark a message as retrieved (acknowledge receipt) - authenticated
 *
 * Authentication: Accepts either challenge-response (auth) OR signed request (sig)
 *
 * SECURITY: Stores recipient's signature over envelopeHash for non-repudiable
 * proof of delivery.
 */
export const acknowledge = mutation({
  args: {
    messageId: v.id("messages"),
    receipt: v.optional(v.array(v.string())), // Recipient signs envelopeHash (optional)
    // Accept either challenge-response OR signed request
    auth: v.optional(
      v.object({
        challengeId: v.id("challenges"),
        sigs: v.array(v.string()),
        ksn: v.number(),
      })
    ),
    sig: v.optional(
      v.object({
        signature: v.string(),
        timestamp: v.number(),
        nonce: v.string(),
        keyId: v.string(),
        signedFields: v.array(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Fetch message to get recpAid
    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    let verifiedAid: string;
    let verifiedKsn: number;
    let verifiedEvtSaid: string | undefined;

    // Support both auth methods: signed request OR challenge-response
    if (args.sig) {
      // Signed request (replaces session tokens)
      const verified = await verifySignedRequest(ctx, args);
      verifiedAid = verified.aid;
      verifiedKsn = verified.ksn;
      verifiedEvtSaid = verified.evtSaid;
    } else if (args.auth) {
      // Traditional challenge-response auth
      const verified = await verifyAuth(ctx, args.auth, "ack", {
        recpAid: message.recpAid,
        messageId: args.messageId,
      });
      verifiedAid = verified.aid;
      verifiedKsn = verified.ksn;
      verifiedEvtSaid = verified.evtSaid;
    } else {
      throw new Error("Must provide either auth or sig");
    }

    // SECURITY: Ensure the verified AID matches the recipient
    if (verifiedAid !== message.recpAid) {
      throw new Error("Cannot acknowledge message for different AID");
    }

    // TODO: Verify receipt signatures over envelopeHash
    // This requires importing verifyIndexedSigs or creating a public version
    // For now, we trust that the auth challenge proves control
    // In production, add:
    // const receiptPayload = { envelopeHash: message.envelopeHash, aud: "https://merits-convex.app" };
    // const receiptValid = await verifyIndexedSigs(receiptPayload, args.receipt, recipientKeyState);

    await ctx.db.patch(args.messageId, {
      retrieved: true,
      receiptSig: args.receipt,
      receiptKsn: verifiedKsn,
      receiptEvtSaid: verifiedEvtSaid,
    });
  },
});

/**
 * Clean up expired messages (can be called periodically)
 */
export const cleanupExpired = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const expiredMessages = await ctx.db
      .query("messages")
      .withIndex("by_expiration")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();

    for (const msg of expiredMessages) {
      await ctx.db.delete(msg._id);
    }

    return { deleted: expiredMessages.length };
  },
});

/**
 * List messages for a recipient (reactive query for WebSocket subscriptions)
 *
 * This is a pure query - no mutations, no popping/dequeuing.
 * Use messages:acknowledge to mark messages as retrieved.
 */
export const list = query({
  args: {
    recpAid: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get all non-expired, unretrieved messages for recipient
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_recipient", (q) => q.eq("recpAid", args.recpAid))
      .filter((q) =>
        q.and(
          q.gt(q.field("expiresAt"), now), // Not expired
          q.eq(q.field("retrieved"), false)  // Not yet retrieved
        )
      )
      .order("desc") // Newest first
      .collect();

    // ACCESS CONTROL: Filter out messages from blocked senders
    const senderAids = [...new Set(messages.map((m) => m.senderAid))];
    const accessMap = await canMessageBatch(ctx, senderAids, args.recpAid);
    const filteredMessages = messages.filter((msg) => {
      const access = accessMap.get(msg.senderAid);
      return access?.allowed ?? true;
    });

    // Return in the format expected by UI
    return filteredMessages.map((msg) => ({
      id: msg._id,
      senderAid: msg.senderAid,
      ct: msg.ct,
      typ: msg.typ,
      ek: msg.ek,
      alg: msg.alg,
      createdAt: msg.createdAt,
      expiresAt: msg.expiresAt,
      envelopeHash: msg.envelopeHash,
      senderSig: msg.senderSig,
      senderKsn: msg.senderKsn,
    }));
  },
});

/**
 * Get unread messages - Unified inbox for direct and group messages
 *
 * Returns all unread messages for a user in a unified format, including both:
 * - Direct messages (encrypted peer-to-peer)
 * - Group messages (encrypted with zero-knowledge group encryption)
 *
 * Message Types:
 * 1. Direct Messages (typ: "encrypted"):
 *    - ct: Ciphertext string
 *    - from/to: Sender and recipient AIDs
 *    - isGroupMessage: false
 *
 * 2. Group Messages (typ: "group-encrypted"):
 *    - ct: Full GroupMessage object with encryptedContent and encryptedKeys
 *    - senderPublicKey: Needed for ECDH decryption
 *    - groupId: Group the message belongs to
 *    - seqNo: Message sequence number
 *    - isGroupMessage: true
 *
 * Unread Detection:
 * - Direct messages: retrieved=false
 * - Group messages: seqNo > membership.latestSeqNo
 *
 * Group Message Decryption Flow (client-side):
 * 1. Client receives GroupMessage structure in ct field
 * 2. Client looks up their encrypted key in ct.encryptedKeys[recipientAid]
 * 3. Client performs ECDH with senderPublicKey to derive shared secret
 * 4. Client decrypts ephemeral group key
 * 5. Client decrypts message content with group key
 *
 * Expiration:
 * - Only returns non-expired messages
 * - Direct messages: expiresAt > now
 * - Group messages: expiresAt > now or no expiration
 *
 * @param aid - User's AID to get unread messages for
 * @param includeGroupMessages - Whether to include group messages (default: true)
 *
 * @returns Object containing messages array with:
 *   Common fields:
 *   - id: Message ID
 *   - from: Sender AID
 *   - to: Recipient AID
 *   - typ: "encrypted" or "group-encrypted"
 *   - createdAt: Message timestamp
 *   - isGroupMessage: boolean
 *
 *   Direct message fields:
 *   - ct: Ciphertext string
 *
 *   Group message fields:
 *   - ct: GroupMessage object {encryptedContent, nonce, encryptedKeys, ...}
 *   - groupId: Group chat ID
 *   - senderPublicKey: Sender's Ed25519 public key (for ECDH)
 *   - seqNo: Message sequence number
 *
 * @see schema.ts messages and groupMessages tables
 * @see cli/commands/unread.ts for client-side decryption
 * @see cli/lib/crypto-group.ts decryptGroupMessage() for group decryption
 */
export const getUnread = query({
  args: {
    aid: v.string(), // The user's AID
    includeGroupMessages: v.optional(v.boolean()), // Whether to include group messages
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const includeGroups = args.includeGroupMessages ?? true;

    // Get direct messages
    const directMessages = await ctx.db
      .query("messages")
      .withIndex("by_recipient", (q) => q.eq("recpAid", args.aid))
      .filter((q) =>
        q.and(
          q.gt(q.field("expiresAt"), now),
          q.eq(q.field("retrieved"), false)
        )
      )
      .collect();

    // ACCESS CONTROL: Filter out direct messages from blocked senders
    const directSenderAids = [...new Set(directMessages.map((m) => m.senderAid))];
    const directAccessMap = await canMessageBatch(ctx, directSenderAids, args.aid);
    const filteredDirectMessages = directMessages.filter((msg) => {
      const access = directAccessMap.get(msg.senderAid);
      return access?.allowed ?? true;
    });

    const result: any[] = filteredDirectMessages.map((msg) => ({
      id: msg._id,
      from: msg.senderAid,
      to: msg.recpAid,
      ct: msg.ct,
      typ: msg.typ ?? "encrypted",
      createdAt: msg.createdAt,
      isGroupMessage: false,
    }));

    // Get group messages if requested
    if (includeGroups) {
      // Get all groups the user is a member of
      const memberships = await ctx.db
        .query("groupMembers")
        .withIndex("by_aid", (q) => q.eq("aid", args.aid))
        .collect();

      // For each group, get unread messages
      for (const membership of memberships) {
        const groupMessages = await ctx.db
          .query("groupMessages")
          .withIndex("by_group_seq", (q) =>
            q.eq("groupChatId", membership.groupChatId)
          )
          .filter((q) =>
            q.and(
              q.gt(q.field("seqNo"), membership.latestSeqNo),
              q.or(
                q.eq(q.field("expiresAt"), undefined),
                q.gt(q.field("expiresAt"), now)
              )
            )
          )
          .collect();

        // ACCESS CONTROL: Filter out group messages from blocked senders
        const groupSenderAids = [...new Set(groupMessages.map((m) => m.senderAid))];
        const groupAccessMap = await canMessageBatch(ctx, groupSenderAids, args.aid);

        // Get sender public keys for decryption
        for (const msg of groupMessages) {
          // Check access control
          const access = groupAccessMap.get(msg.senderAid);
          if (!access?.allowed) {
            continue; // Skip messages from blocked senders
          }
          const senderUser = await ctx.db
            .query("users")
            .withIndex("by_aid", (q) => q.eq("aid", msg.senderAid))
            .first();

          result.push({
            id: msg._id,
            from: msg.senderAid,
            to: args.aid,
            // Return the full GroupMessage structure
            ct: {
              encryptedContent: msg.encryptedContent,
              nonce: msg.nonce,
              encryptedKeys: msg.encryptedKeys,
              senderAid: msg.senderAid,
              groupId: membership.groupChatId,
              aad: msg.aad,
            },
            typ: "group-encrypted",
            createdAt: msg.received,
            isGroupMessage: true,
            groupId: membership.groupChatId,
            senderPublicKey: senderUser?.publicKey,
            seqNo: msg.seqNo,
          });
        }
      }
    }

    // Sort by creation time (newest first)
    result.sort((a, b) => b.createdAt - a.createdAt);

    return { messages: result };
  },
});
