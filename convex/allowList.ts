/**
 * AllowList Management APIs
 *
 * Provides mutations and queries for managing user allow-lists (whitelists).
 * When a user's allow-list is active (non-empty), only AIDs on the list can send messages.
 *
 * Priority Rules:
 * 1. Deny-list always takes priority (deny wins)
 * 2. If allow-list is active (non-empty), only allowed AIDs can send
 * 3. If allow-list is inactive (empty), all AIDs can send (default)
 *
 * Security:
 * - All mutations require authentication
 * - Users can only modify their own allow-lists
 * - List queries are public (any user can view any allow-list)
 *
 * @see denyList.ts for deny-list (blocklist) management
 * @see accessControl.ts for canMessage() helper
 */

import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { verifySignedRequest } from './auth';

/**
 * Add an AID to the user's allow-list
 *
 * Once added, the allow-list becomes "active" and implements default-deny behavior.
 * Only AIDs on the allow-list will be able to send messages to the user.
 *
 * @param allowedAid - AID to add to allow-list
 * @param note - Optional note describing why this AID is allowed (e.g., "work colleague")
 * @param auth - Authentication proof
 *
 * @returns { id, added: true } if successfully added, or { id, alreadyExists: true } if already in list
 *
 * @example
 * // Add work colleague to allow-list
 * await ctx.client.mutation(api.allowList.add, {
 *   allowedAid: "alice-aid",
 *   note: "work colleague",
 *   auth: { challengeId, sigs, ksn }
 * });
 */
export const add = mutation({
  args: {
    allowedAid: v.string(),
    note: v.optional(v.string()),
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
      .query('allowList')
      .withIndex('by_owner_allowed', (q) => q.eq('ownerAid', ownerAid).eq('allowedAid', args.allowedAid))
      .first();

    if (existing) {
      return { id: existing._id, alreadyExists: true };
    }

    // Add to allow-list
    const id = await ctx.db.insert('allowList', {
      ownerAid,
      allowedAid: args.allowedAid,
      addedAt: Date.now(),
      note: args.note,
    });

    return { id, added: true };
  },
});

/**
 * Remove an AID from the user's allow-list
 *
 * If this was the last entry, the allow-list becomes inactive and default behavior
 * returns to allow-all.
 *
 * @param allowedAid - AID to remove from allow-list
 * @param auth - Authentication proof
 *
 * @returns { removed: true } if successfully removed
 *
 * @throws Error if AID is not in allow-list
 *
 * @example
 * // Remove someone from allow-list
 * await ctx.client.mutation(api.allowList.remove, {
 *   allowedAid: "alice-aid",
 *   auth: { challengeId, sigs, ksn }
 * });
 */
export const remove = mutation({
  args: {
    allowedAid: v.string(),
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
      .query('allowList')
      .withIndex('by_owner_allowed', (q) => q.eq('ownerAid', ownerAid).eq('allowedAid', args.allowedAid))
      .first();

    if (!entry) {
      throw new Error('AID not in allow-list');
    }

    // Remove from allow-list
    await ctx.db.delete(entry._id);
    return { removed: true };
  },
});

/**
 * List all entries in the user's allow-list
 *
 * Returns all AIDs on the allow-list along with metadata (when added, optional note).
 * Also indicates whether the allow-list is active (has any entries).
 *
 * @param ownerAid - AID of the user whose allow-list to retrieve
 *
 * @returns {
 *   allowList: Array of { aid, addedAt, note? },
 *   isActive: boolean (true if list has entries)
 * }
 *
 * @example
 * // Get Alice's allow-list
 * const result = await ctx.client.query(api.allowList.list, {
 *   ownerAid: "alice-aid"
 * });
 * // Result: { allowList: [{ aid: "bob-aid", addedAt: 123, note: "friend" }], isActive: true }
 */
export const list = query({
  args: {
    ownerAid: v.string(),
  },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query('allowList')
      .withIndex('by_owner', (q) => q.eq('ownerAid', args.ownerAid))
      .collect();

    return {
      allowList: entries.map((e) => ({
        aid: e.allowedAid,
        addedAt: e.addedAt,
        note: e.note,
      })),
      isActive: entries.length > 0,
    };
  },
});

/**
 * Clear all entries from the user's allow-list
 *
 * Removes all AIDs from the allow-list, deactivating it and returning to default
 * allow-all behavior. This is useful for disabling allow-list mode.
 *
 * @param auth - Authentication proof
 *
 * @returns { removed: number } - Number of entries removed
 *
 * @example
 * // Disable allow-list mode by clearing all entries
 * const result = await ctx.client.mutation(api.allowList.clear, {
 *   auth: { challengeId, sigs, ksn }
 * });
 * // Result: { removed: 5 }
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
      .query('allowList')
      .withIndex('by_owner', (q) => q.eq('ownerAid', ownerAid))
      .collect();

    // Delete all entries
    for (const entry of entries) {
      await ctx.db.delete(entry._id);
    }

    return { removed: entries.length };
  },
});
