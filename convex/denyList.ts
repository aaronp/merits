/**
 * DenyList Management APIs
 *
 * Provides mutations and queries for managing user deny-lists (blocklists).
 * AIDs on the deny-list are blocked from sending messages to the user.
 *
 * Priority Rules:
 * 1. Deny-list always takes priority (deny wins)
 * 2. If sender is on deny-list → BLOCK (even if also on allow-list)
 * 3. Otherwise, check allow-list rules
 *
 * Security:
 * - All mutations require authentication
 * - Users can only modify their own deny-lists
 * - List queries are public (any user can view any deny-list)
 *
 * Use Cases:
 * - Block spam or unwanted messages
 * - Harassment protection
 * - Temporary or permanent blocks
 *
 * @see allowList.ts for allow-list (whitelist) management
 * @see accessControl.ts for canMessage() helper
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { verifySignedRequest } from "./auth";

/**
 * Add an AID to the user's deny-list (block someone)
 *
 * Once added, the AID will be unable to send messages to the user.
 * Deny-list takes priority over allow-list (if AID is on both lists, they are blocked).
 *
 * @param deniedAid - AID to add to deny-list (block)
 * @param reason - Optional reason for blocking (e.g., "spam", "harassment")
 * @param auth - Authentication proof
 *
 * @returns { id, added: true } if successfully added, or { id, alreadyExists: true } if already blocked
 *
 * @example
 * // Block a spammer
 * await ctx.client.mutation(api.denyList.add, {
 *   deniedAid: "spammer-aid",
 *   reason: "spam",
 *   auth: { challengeId, sigs, ksn }
 * });
 */
export const add = mutation({
  args: {
    deniedAid: v.string(),
    reason: v.optional(v.string()),
    sig: v.object({
      signature: v.string(),
      timestamp: v.number(),
      nonce: v.string(),
      keyId: v.string(),
      signedFields: v.array(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    // Verify signed request authentication
    const verified = await verifySignedRequest(ctx, args);

    const ownerAid = verified.aid;

    // Check if already in list
    const existing = await ctx.db
      .query("denyList")
      .withIndex("by_owner_denied", (q) =>
        q.eq("ownerAid", ownerAid).eq("deniedAid", args.deniedAid)
      )
      .first();

    if (existing) {
      return { id: existing._id, alreadyExists: true };
    }

    // Add to deny-list
    const id = await ctx.db.insert("denyList", {
      ownerAid,
      deniedAid: args.deniedAid,
      addedAt: Date.now(),
      reason: args.reason,
    });

    return { id, added: true };
  },
});

/**
 * Remove an AID from the user's deny-list (unblock someone)
 *
 * Once removed, the AID will be able to send messages to the user again
 * (subject to allow-list rules if active).
 *
 * @param deniedAid - AID to remove from deny-list (unblock)
 * @param auth - Authentication proof
 *
 * @returns { removed: true } if successfully removed
 *
 * @throws Error if AID is not in deny-list
 *
 * @example
 * // Unblock someone
 * await ctx.client.mutation(api.denyList.remove, {
 *   deniedAid: "formerly-blocked-aid",
 *   auth: { challengeId, sigs, ksn }
 * });
 */
export const remove = mutation({
  args: {
    deniedAid: v.string(),
    sig: v.object({
      signature: v.string(),
      timestamp: v.number(),
      nonce: v.string(),
      keyId: v.string(),
      signedFields: v.array(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    // Verify signed request authentication
    const verified = await verifySignedRequest(ctx, args);

    const ownerAid = verified.aid;

    // Find entry
    const entry = await ctx.db
      .query("denyList")
      .withIndex("by_owner_denied", (q) =>
        q.eq("ownerAid", ownerAid).eq("deniedAid", args.deniedAid)
      )
      .first();

    if (!entry) {
      throw new Error("AID not in deny-list");
    }

    // Remove from deny-list
    await ctx.db.delete(entry._id);
    return { removed: true };
  },
});

/**
 * List all entries in the user's deny-list
 *
 * Returns all AIDs on the deny-list along with metadata (when added, optional reason).
 *
 * @param ownerAid - AID of the user whose deny-list to retrieve
 *
 * @returns {
 *   denyList: Array of { aid, addedAt, reason? }
 * }
 *
 * @example
 * // Get Alice's deny-list
 * const result = await ctx.client.query(api.denyList.list, {
 *   ownerAid: "alice-aid"
 * });
 * // Result: { denyList: [{ aid: "spammer-aid", addedAt: 123, reason: "spam" }] }
 */
export const list = query({
  args: {
    ownerAid: v.string(),
  },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("denyList")
      .withIndex("by_owner", (q) => q.eq("ownerAid", args.ownerAid))
      .collect();

    return {
      denyList: entries.map((e) => ({
        aid: e.deniedAid,
        addedAt: e.addedAt,
        reason: e.reason,
      })),
    };
  },
});

/**
 * Clear all entries from the user's deny-list
 *
 * Removes all AIDs from the deny-list, unblocking all previously blocked senders.
 *
 * @param auth - Authentication proof
 *
 * @returns { removed: number } - Number of entries removed
 *
 * @example
 * // Unblock everyone
 * const result = await ctx.client.mutation(api.denyList.clear, {
 *   auth: { challengeId, sigs, ksn }
 * });
 * // Result: { removed: 3 }
 */
export const clear = mutation({
  args: {
    sig: v.object({
      signature: v.string(),
      timestamp: v.number(),
      nonce: v.string(),
      keyId: v.string(),
      signedFields: v.array(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    // Verify signed request authentication
    const verified = await verifySignedRequest(ctx, args);

    const ownerAid = verified.aid;

    // Get all entries
    const entries = await ctx.db
      .query("denyList")
      .withIndex("by_owner", (q) => q.eq("ownerAid", ownerAid))
      .collect();

    // Delete all entries
    for (const entry of entries) {
      await ctx.db.delete(entry._id);
    }

    return { removed: entries.length };
  },
});
