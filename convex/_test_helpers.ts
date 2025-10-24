/**
 * TEST-ONLY mutations for bootstrapping admin roles
 *
 * SECURITY: These mutations should be REMOVED or DISABLED in production!
 * They exist only to bootstrap the first super_admin in tests.
 */

import { v } from "convex/values";
import { mutation } from "./_generated/server";

/**
 * Bootstrap super_admin (TEST ONLY - NO AUTHENTICATION)
 *
 * In production, the first super_admin should be created via:
 * 1. Direct Convex dashboard insert, OR
 * 2. CLI script with secure credentials, OR
 * 3. Manual database operation
 *
 * This mutation exists ONLY for test setup.
 */
export const bootstrapSuperAdmin = mutation({
  args: {
    aid: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if any super_admin already exists
    const existingAdmins = await ctx.db
      .query("adminRoles")
      .withIndex("by_role", (q) => q.eq("role", "super_admin"))
      .filter((q) => q.eq(q.field("active"), true))
      .collect();

    if (existingAdmins.length > 0) {
      throw new Error(
        "Super admin already exists. Use authenticated mutations for subsequent admins."
      );
    }

    // Create the FIRST super_admin (unauthenticated bootstrap)
    return await ctx.db.insert("adminRoles", {
      aid: args.aid,
      role: "super_admin",
      grantedAt: now,
      active: true,
    });
  },
});

/**
 * Reset all admin roles (TEST ONLY)
 */
export const resetAdminRoles = mutation({
  args: {},
  handler: async (ctx) => {
    const roles = await ctx.db.query("adminRoles").collect();
    for (const role of roles) {
      await ctx.db.delete(role._id);
    }

    const admins = await ctx.db.query("onboardingAdmins").collect();
    for (const admin of admins) {
      await ctx.db.delete(admin._id);
    }

    return { deletedRoles: roles.length, deletedAdmins: admins.length };
  },
});

/**
 * Reset ALL state for tests (TEST ONLY)
 */
export const resetAll = mutation({
  args: {},
  handler: async (ctx) => {
    const tables = [
      "messages",
      "challenges",
      "keyStates",
      "adminRoles",
      "onboardingAdmins",
      "userTiers",
      "rateLimits",
    ] as const;

    const deleted: Record<string, number> = {};

    for (const table of tables) {
      const records = await ctx.db.query(table as any).collect();
      for (const rec of records) {
        await ctx.db.delete(rec._id);
      }
      deleted[table] = records.length;
    }

    return { deleted };
  },
});
