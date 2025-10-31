/**
 * Groups: Linear message history with membership tracking
 *
 * This implementation provides:
 * - Linear, persistent message history within groups
 * - Membership tracking with sync state
 * - Integration with KERI KEL/TEL for governance
 * - No fan-out needed - messages stay in the group
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { verifyAuth } from "./auth";
import type { Id } from "./_generated/dataModel";

/**
 * Create a new group chat
 */
export const createGroupChat = mutation({
  args: {
    name: v.string(),
    ownerAid: v.string(), // AID of the KEL that owns this group
    membershipSaid: v.string(), // SAID reference to TEL membership data
    maxTtl: v.optional(v.number()), // Default 30 days
    initialMembers: v.array(v.string()), // AIDs to add as initial members
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const maxTtl = args.maxTtl ?? 30 * 24 * 60 * 60 * 1000; // Default 30 days

    // Verify authentication
    const verified = await verifyAuth(
      ctx,
      args.auth,
      "createGroup",
      {
        name: args.name,
        ownerAid: args.ownerAid,
        membershipSaid: args.membershipSaid,
        members: args.initialMembers.sort(),
      }
    );

    const creatorAid = verified.aid;

    // Create the group chat
    const groupChatId = await ctx.db.insert("groupChats", {
      ownerAid: args.ownerAid,
      membershipSaid: args.membershipSaid,
      name: args.name,
      maxTtl,
      createdAt: now,
      createdBy: creatorAid,
    });

    // Add initial members including creator
    const memberSet = new Set([creatorAid, ...args.initialMembers]);

    for (const aid of memberSet) {
      await ctx.db.insert("groupMembers", {
        groupChatId,
        aid,
        latestSeqNo: -1, // No messages received yet
        joinedAt: now,
        role: aid === args.ownerAid ? "owner" :
              aid === creatorAid ? "admin" : "member",
      });
    }

    return { groupChatId };
  },
});

/**
 * Send a message to the group chat
 * Messages are stored in linear order with sequence numbers
 */
export const sendGroupMessage = mutation({
  args: {
    groupChatId: v.id("groupChats"),
    encryptedMessage: v.string(), // Message encrypted with group key
    messageType: v.string(), // text, file, system, etc.
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Verify authentication
    const verified = await verifyAuth(
      ctx,
      args.auth,
      "sendGroupMessage",
      {
        groupChatId: args.groupChatId,
        messageType: args.messageType,
      }
    );

    const senderAid = verified.aid;

    // Verify sender is a member
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_aid", (q) =>
        q.eq("groupChatId", args.groupChatId).eq("aid", senderAid)
      )
      .first();

    if (!membership) {
      throw new Error("Sender is not a member of this group");
    }

    // Get the group chat for TTL
    const groupChat = await ctx.db.get(args.groupChatId);
    if (!groupChat) {
      throw new Error("Group chat not found");
    }

    // Get next sequence number
    const lastMessage = await ctx.db
      .query("groupMessages")
      .withIndex("by_group_seq", (q) =>
        q.eq("groupChatId", args.groupChatId)
      )
      .order("desc")
      .first();

    const seqNo = lastMessage ? lastMessage.seqNo + 1 : 0;

    // Calculate expiration if TTL is set
    const expiresAt = groupChat.maxTtl > 0
      ? now + groupChat.maxTtl
      : undefined;

    // Insert the message
    const messageId = await ctx.db.insert("groupMessages", {
      groupChatId: args.groupChatId,
      encryptedMessage: args.encryptedMessage,
      messageType: args.messageType,
      senderAid,
      seqNo,
      received: now,
      expiresAt,
    });

    return {
      messageId,
      seqNo,
    };
  },
});

/**
 * Get messages from a group chat
 * Returns messages after a given sequence number for sync
 */
export const getGroupMessages = query({
  args: {
    groupChatId: v.id("groupChats"),
    afterSeqNo: v.optional(v.number()), // Get messages after this seq number
    limit: v.optional(v.number()), // Max messages to return
    callerAid: v.string(), // AID requesting messages
  },
  handler: async (ctx, args) => {
    // Verify caller is a member
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_aid", (q) =>
        q.eq("groupChatId", args.groupChatId).eq("aid", args.callerAid)
      )
      .first();

    if (!membership) {
      throw new Error("Caller is not a member of this group");
    }

    const afterSeqNo = args.afterSeqNo ?? -1;
    const limit = args.limit ?? 100;

    // Get messages after the specified sequence number
    const messages = await ctx.db
      .query("groupMessages")
      .withIndex("by_group_seq", (q) =>
        q.eq("groupChatId", args.groupChatId)
      )
      .filter((q) => q.gt(q.field("seqNo"), afterSeqNo))
      .order("asc")
      .take(limit);

    return messages.map(msg => ({
      id: msg._id,
      encryptedMessage: msg.encryptedMessage,
      messageType: msg.messageType,
      senderAid: msg.senderAid,
      seqNo: msg.seqNo,
      received: msg.received,
    }));
  },
});

/**
 * Update member's latest received sequence number
 * Used for tracking sync state
 */
export const updateMemberSync = mutation({
  args: {
    groupChatId: v.id("groupChats"),
    latestSeqNo: v.number(),
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    // Verify authentication
    const verified = await verifyAuth(
      ctx,
      args.auth,
      "updateSync",
      {
        groupChatId: args.groupChatId,
        latestSeqNo: args.latestSeqNo,
      }
    );

    const callerAid = verified.aid;

    // Find membership record
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_aid", (q) =>
        q.eq("groupChatId", args.groupChatId).eq("aid", callerAid)
      )
      .first();

    if (!membership) {
      throw new Error("Caller is not a member of this group");
    }

    // Update sync state
    await ctx.db.patch(membership._id, {
      latestSeqNo: args.latestSeqNo,
    });
  },
});

/**
 * Get group chat details including membership
 */
export const getGroupChat = query({
  args: {
    groupChatId: v.id("groupChats"),
    callerAid: v.string(),
  },
  handler: async (ctx, args) => {
    // Verify caller is a member
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_aid", (q) =>
        q.eq("groupChatId", args.groupChatId).eq("aid", args.callerAid)
      )
      .first();

    if (!membership) {
      throw new Error("Caller is not a member of this group");
    }

    const groupChat = await ctx.db.get(args.groupChatId);
    if (!groupChat) {
      throw new Error("Group chat not found");
    }

    // Get all members
    const members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupChatId", args.groupChatId))
      .collect();

    return {
      id: groupChat._id,
      ownerAid: groupChat.ownerAid,
      membershipSaid: groupChat.membershipSaid,
      name: groupChat.name,
      maxTtl: groupChat.maxTtl,
      createdAt: groupChat.createdAt,
      createdBy: groupChat.createdBy,
      members: members.map(m => ({
        aid: m.aid,
        role: m.role,
        joinedAt: m.joinedAt,
        latestSeqNo: m.latestSeqNo,
      })),
      callerSync: membership.latestSeqNo,
    };
  },
});

/**
 * List all group chats for an AID
 */
export const listGroupChats = query({
  args: {
    aid: v.string(),
  },
  handler: async (ctx, args) => {
    // Get all group memberships for this AID
    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_aid", (q) => q.eq("aid", args.aid))
      .collect();

    // Get group details for each membership
    const groups = await Promise.all(
      memberships.map(async (membership) => {
        const group = await ctx.db.get(membership.groupChatId);
        if (!group) return null;

        // Get message count
        const messageCount = await ctx.db
          .query("groupMessages")
          .withIndex("by_group_seq", (q) =>
            q.eq("groupChatId", membership.groupChatId)
          )
          .collect()
          .then(msgs => msgs.length);

        return {
          id: group._id,
          name: group.name,
          ownerAid: group.ownerAid,
          membershipSaid: group.membershipSaid,
          role: membership.role,
          joinedAt: membership.joinedAt,
          latestSeqNo: membership.latestSeqNo,
          messageCount,
          unreadCount: Math.max(0, messageCount - (membership.latestSeqNo + 1)),
        };
      })
    );

    return groups.filter(g => g !== null);
  },
});

/**
 * Add members to a group chat
 * Requires admin or owner role
 */
export const addGroupMembers = mutation({
  args: {
    groupChatId: v.id("groupChats"),
    members: v.array(v.string()), // AIDs to add
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Verify authentication
    const verified = await verifyAuth(
      ctx,
      args.auth,
      "manageGroup",
      {
        action: "addMembers",
        groupChatId: args.groupChatId,
        members: args.members.sort(),
      }
    );

    const callerAid = verified.aid;

    // Check caller's role
    const callerMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_aid", (q) =>
        q.eq("groupChatId", args.groupChatId).eq("aid", callerAid)
      )
      .first();

    if (!callerMembership ||
        (callerMembership.role !== "admin" && callerMembership.role !== "owner")) {
      throw new Error("Only admins or owners can add members");
    }

    // Get existing members
    const existingMembers = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupChatId", args.groupChatId))
      .collect();

    const existingAids = new Set(existingMembers.map(m => m.aid));

    // Add new members
    for (const aid of args.members) {
      if (!existingAids.has(aid)) {
        await ctx.db.insert("groupMembers", {
          groupChatId: args.groupChatId,
          aid,
          latestSeqNo: -1,
          joinedAt: now,
          role: "member",
        });
      }
    }
  },
});

/**
 * Remove members from a group chat
 * Requires admin or owner role
 */
export const removeGroupMembers = mutation({
  args: {
    groupChatId: v.id("groupChats"),
    members: v.array(v.string()), // AIDs to remove
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    // Verify authentication
    const verified = await verifyAuth(
      ctx,
      args.auth,
      "manageGroup",
      {
        action: "removeMembers",
        groupChatId: args.groupChatId,
        members: args.members.sort(),
      }
    );

    const callerAid = verified.aid;

    // Check caller's role
    const callerMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_aid", (q) =>
        q.eq("groupChatId", args.groupChatId).eq("aid", callerAid)
      )
      .first();

    if (!callerMembership ||
        (callerMembership.role !== "admin" && callerMembership.role !== "owner")) {
      throw new Error("Only admins or owners can remove members");
    }

    // Get group chat to check owner
    const groupChat = await ctx.db.get(args.groupChatId);
    if (!groupChat) {
      throw new Error("Group chat not found");
    }

    // Prevent removing the owner
    if (args.members.includes(groupChat.ownerAid)) {
      throw new Error("Cannot remove the group owner");
    }

    // Remove members
    for (const aid of args.members) {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_aid", (q) =>
          q.eq("groupChatId", args.groupChatId).eq("aid", aid)
        )
        .first();

      if (membership) {
        await ctx.db.delete(membership._id);
      }
    }
  },
});

/**
 * Update membership SAID reference
 * Used when TEL membership data changes
 */
export const updateMembershipSaid = mutation({
  args: {
    groupChatId: v.id("groupChats"),
    membershipSaid: v.string(),
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    // Verify authentication
    const verified = await verifyAuth(
      ctx,
      args.auth,
      "updateGroupGovernance",
      {
        groupChatId: args.groupChatId,
        membershipSaid: args.membershipSaid,
      }
    );

    const callerAid = verified.aid;

    // Get group chat
    const groupChat = await ctx.db.get(args.groupChatId);
    if (!groupChat) {
      throw new Error("Group chat not found");
    }

    // Only owner can update membership SAID
    if (callerAid !== groupChat.ownerAid) {
      throw new Error("Only the group owner can update membership SAID");
    }

    // Update the membership SAID
    await ctx.db.patch(args.groupChatId, {
      membershipSaid: args.membershipSaid,
    });
  },
});