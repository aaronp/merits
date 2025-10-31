/**
 * Groups: Server-side fanout messaging
 *
 * Design: Server decrypts group message once, re-encrypts for each member.
 * For MVP, we'll use a simplified approach where the server handles plaintext
 * fanout (no group encryption key).
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { verifyAuth } from "./auth";
import type { Id } from "./_generated/dataModel";
import { sha256Hex } from "../core/crypto";

/**
 * Create a new group
 */
export const createGroup = mutation({
  args: {
    name: v.string(),
    initialMembers: v.array(v.string()), // AIDs to add as members
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
        action: "createGroup",
        name: args.name,
        members: args.initialMembers.sort(), // Sort for deterministic hashing
      }
    );

    const creatorAid = verified.aid;

    // Ensure creator is included in members
    const memberSet = new Set([creatorAid, ...args.initialMembers]);
    const members = Array.from(memberSet).map((aid) => ({
      aid,
      role: aid === creatorAid ? "owner" : "member",
      joinedAt: now,
    }));

    const groupId = await ctx.db.insert("groups", {
      name: args.name,
      createdBy: creatorAid,
      createdAt: now,
      members,
    });

    return { groupId };
  },
});

/**
 * Add members to a group (requires admin or owner role)
 */
export const addMembers = mutation({
  args: {
    groupId: v.id("groups"),
    members: v.array(v.string()),
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
        groupId: args.groupId,
        members: args.members.sort(),
      }
    );

    const callerAid = verified.aid;

    // Fetch group
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new Error("Group not found");
    }

    // Check caller is admin or owner
    const callerMember = group.members.find((m) => m.aid === callerAid);
    if (!callerMember || (callerMember.role !== "admin" && callerMember.role !== "owner")) {
      throw new Error("Only admins or owners can add members");
    }

    // Add new members (avoid duplicates)
    const existingAids = new Set(group.members.map((m) => m.aid));
    const newMembers = args.members
      .filter((aid) => !existingAids.has(aid))
      .map((aid) => ({
        aid,
        role: "member" as const,
        joinedAt: now,
      }));

    await ctx.db.patch(args.groupId, {
      members: [...group.members, ...newMembers],
    });
  },
});

/**
 * Remove members from a group (requires admin or owner role)
 */
export const removeMembers = mutation({
  args: {
    groupId: v.id("groups"),
    members: v.array(v.string()),
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
        groupId: args.groupId,
        members: args.members.sort(),
      }
    );

    const callerAid = verified.aid;

    // Fetch group
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new Error("Group not found");
    }

    // Check caller is admin or owner
    const callerMember = group.members.find((m) => m.aid === callerAid);
    if (!callerMember || (callerMember.role !== "admin" && callerMember.role !== "owner")) {
      throw new Error("Only admins or owners can remove members");
    }

    // Prevent removing the last owner
    const toRemove = new Set(args.members);
    const remainingMembers = group.members.filter((m) => !toRemove.has(m.aid));
    const hasOwner = remainingMembers.some((m) => m.role === "owner");

    if (!hasOwner) {
      throw new Error("Cannot remove last owner from group");
    }

    await ctx.db.patch(args.groupId, {
      members: remainingMembers,
    });
  },
});

/**
 * Send a message to all group members (server-side fanout)
 *
 * Simplified flow for MVP:
 * 1. Verify sender is group member
 * 2. Store message in groupLog with sequence number
 * 3. Create individual encrypted messages for each member
 * 4. Return messageId (groupLog entry)
 *
 * NOTE: In production, you'd decrypt ct with group key, then re-encrypt for each member.
 * For MVP, we assume ct is already suitable for fanout (e.g., plaintext JSON).
 */
export const sendGroupMessage = mutation({
  args: {
    groupId: v.id("groups"),
    ct: v.string(),
    typ: v.optional(v.string()),
    ttl: v.optional(v.number()),
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const ttl = args.ttl ?? 24 * 60 * 60 * 1000; // Default 24 hours
    const expiresAt = now + ttl;

    // Compute ctHash
    const encoder = new TextEncoder();
    const data = encoder.encode(args.ct);
    const ctHash = sha256Hex(data);

    // Verify authentication
    const verified = await verifyAuth(
      ctx,
      args.auth,
      "sendGroup",
      {
        groupId: args.groupId,
        ctHash,
        ttl,
      }
    );

    const senderAid = verified.aid;

    // Fetch group
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new Error("Group not found");
    }

    // Verify sender is group member
    const isMember = group.members.some((m) => m.aid === senderAid);
    if (!isMember) {
      throw new Error("Only group members can send messages");
    }

    // Get next sequence number for this group
    const lastLog = await ctx.db
      .query("groupLog")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .order("desc")
      .first();

    const seqNum = lastLog ? lastLog.seqNum + 1 : 0;

    // Compute envelope hash
    const envelope = {
      ver: "group-envelope/1",
      groupId: args.groupId,
      senderAid,
      ctHash,
      seqNum,
      createdAt: now,
      expiresAt,
    };
    const canonical = JSON.stringify(envelope, Object.keys(envelope).sort());
    const envelopeHash = sha256Hex(encoder.encode(canonical));

    // Insert group log entry
    const logId = await ctx.db.insert("groupLog", {
      groupId: args.groupId,
      senderAid,
      seqNum,
      ct: args.ct,
      ctHash,
      typ: args.typ,
      createdAt: now,
      expiresAt,
      senderSig: args.auth.sigs,
      senderKsn: verified.ksn,
      senderEvtSaid: verified.evtSaid,
      envelopeHash,
      usedChallengeId: verified.challengeId,
      fanoutComplete: false,
      fanoutCount: 0,
    });

    // Fan out to all members (except sender)
    let fanoutCount = 0;
    for (const member of group.members) {
      if (member.aid === senderAid) continue; // Don't send to self

      // Create individual message for this member
      // NOTE: In production, re-encrypt ct for member's keys here
      await ctx.db.insert("messages", {
        recpAid: member.aid,
        senderAid,
        ct: args.ct, // Simplified: use same ct (in production, re-encrypt)
        ctHash,
        typ: args.typ,
        ek: undefined,
        alg: "group-fanout",
        createdAt: now,
        expiresAt,
        retrieved: false,
        senderSig: args.auth.sigs,
        senderKsn: verified.ksn,
        senderEvtSaid: verified.evtSaid,
        envelopeHash,
        usedChallengeId: verified.challengeId,
      });

      fanoutCount++;
    }

    // Update fanout status
    await ctx.db.patch(logId, {
      fanoutComplete: true,
      fanoutCount,
    });

    return { messageId: logId };
  },
});

/**
 * List all groups for an AID
 */
export const listGroups = query({
  args: {
    aid: v.string(),
  },
  handler: async (ctx, args) => {
    // Query all groups and filter by membership
    const allGroups = await ctx.db.query("groups").collect();

    return allGroups
      .filter((group) => group.members.some((m) => m.aid === args.aid))
      .map((group) => ({
        id: group._id,
        name: group.name,
        createdBy: group.createdBy,
        createdAt: group.createdAt,
        members: group.members,
      }));
  },
});

/**
 * Get group details (requires membership)
 */
export const getGroup = query({
  args: {
    groupId: v.id("groups"),
    callerAid: v.string(),
  },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new Error("Group not found");
    }

    // Verify caller is member
    const isMember = group.members.some((m) => m.aid === args.callerAid);
    if (!isMember) {
      throw new Error("Only group members can view group details");
    }

    return {
      id: group._id,
      name: group.name,
      createdBy: group.createdBy,
      createdAt: group.createdAt,
      members: group.members,
    };
  },
});

/**
 * Leave a group (members can leave, owners must transfer first)
 */
export const leaveGroup = mutation({
  args: {
    groupId: v.id("groups"),
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
        action: "leaveGroup",
        groupId: args.groupId,
      }
    );

    const callerAid = verified.aid;

    // Fetch group
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new Error("Group not found");
    }

    // Find caller's membership
    const callerMember = group.members.find((m) => m.aid === callerAid);
    if (!callerMember) {
      throw new Error("Not a member of this group");
    }

    // Prevent last owner from leaving
    if (callerMember.role === "owner") {
      const ownerCount = group.members.filter((m) => m.role === "owner").length;
      if (ownerCount === 1) {
        throw new Error("Last owner cannot leave group. Transfer ownership first.");
      }
    }

    // Remove member
    const remainingMembers = group.members.filter((m) => m.aid !== callerAid);
    await ctx.db.patch(args.groupId, {
      members: remainingMembers,
    });
  },
});
