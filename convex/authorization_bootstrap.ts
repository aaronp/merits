import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const bootstrapOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Create onboarding group if missing
    let onboardingGroup = await ctx.db
      .query("groupChats")
      .withIndex("by_created", (q: any) => q.gt("createdAt", 0))
      .filter((q: any) => q.eq(q.field("name"), "onboarding"))
      .first();

    if (!onboardingGroup) {
      const groupId = await ctx.db.insert("groupChats", {
        ownerAid: "SYSTEM",
        membershipSaid: "bootstrap/onboarding",
        name: "onboarding",
        maxTtl: 30 * 24 * 60 * 60 * 1000,
        createdAt: now,
        createdBy: "SYSTEM",
      });
      onboardingGroup = await ctx.db.get(groupId);
    }

    // Ensure anon role exists
    let anonRole = await ctx.db
      .query("roles")
      .withIndex("by_roleName", (q: any) => q.eq("roleName", "anon"))
      .first();
    if (!anonRole) {
      const rid = await ctx.db.insert("roles", {
        roleName: "anon",
        adminAID: "SYSTEM",
        actionSAID: "bootstrap/roles",
        timestamp: now,
      });
      anonRole = await ctx.db.get(rid);
    }

    // Ensure permission key exists: can.message.groups [onboardingGroupId]
    const permKey = "can.message.groups";
    let permission = await ctx.db
      .query("permissions")
      .withIndex("by_key", (q: any) => q.eq("key", permKey))
      .first();
    if (!permission) {
      const pid = await ctx.db.insert("permissions", {
        key: permKey,
        data: [onboardingGroup!._id],
        adminAID: "SYSTEM",
        actionSAID: "bootstrap/perms",
        timestamp: now,
      });
      permission = await ctx.db.get(pid);
    }

    // Ensure role->permission mapping exists
    const existingRP = await ctx.db
      .query("rolePermissions")
      .withIndex("by_role", (q: any) => q.eq("roleId", anonRole!._id))
      .collect();

    const hasMapping = existingRP.some((rp: any) => rp.permissionId === permission!._id);
    if (!hasMapping) {
      await ctx.db.insert("rolePermissions", {
        roleId: anonRole!._id,
        permissionId: permission!._id,
        adminAID: "SYSTEM",
        actionSAID: "bootstrap/map",
        timestamp: now,
      });
    }

    return {
      onboardingGroupId: onboardingGroup!._id,
      anonRoleId: anonRole!._id,
      permissionId: permission!._id,
    };
  },
});


