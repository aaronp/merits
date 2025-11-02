/**
 * User Status Query
 *
 * Provides comprehensive user status information including:
 * - Current role(s)
 * - Group memberships
 * - Public key on record
 * - Session token metadata
 */

import { query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Get comprehensive user status
 *
 * Returns detailed information about a user's current state in the system.
 */
export const getUserStatus = query({
  args: {
    aid: v.string(),
  },
  handler: async (ctx, { aid }) => {
    // Get user's roles
    const userRoles = await ctx.db
      .query("userRoles")
      .withIndex("by_user", (q) => q.eq("userAID", aid))
      .collect();

    // Fetch role names
    const roleNames = await Promise.all(
      userRoles.map(async (ur) => {
        const role = await ctx.db.get(ur.roleId);
        return role?.roleName || null;
      })
    );

    const roles = roleNames.filter((name) => name !== null) as string[];

    // Get user's group memberships
    const groupMembers = await ctx.db
      .query("groupMembers")
      .withIndex("by_aid", (q) => q.eq("aid", aid))
      .collect();

    const groups = await Promise.all(
      groupMembers.map(async (member) => {
        const group = await ctx.db.get(member.groupChatId);
        if (!group) return null;

        return {
          groupId: member.groupChatId,
          groupName: group.name,
          role: member.role,
          joinedAt: member.joinedAt,
        };
      })
    );

    // Filter out null groups (deleted groups)
    const activeGroups = groups.filter((g) => g !== null);

    // Get user's key state (public key)
    const keyState = await ctx.db
      .query("keyStates")
      .withIndex("by_aid", (q) => q.eq("aid", aid))
      .filter((q) => q.eq(q.field("ksn"), 0))
      .first();

    const publicKey = keyState?.keys[0] || null;

    return {
      aid,
      roles: roles.length > 0 ? roles : ["anon"], // Default to anon if no roles
      groups: activeGroups,
      publicKey,
      publicKeyKsn: keyState?.ksn ?? 0,
      publicKeyUpdatedAt: keyState?._creationTime ?? null,
    };
  },
});
