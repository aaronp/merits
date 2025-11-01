/**
 * TEST-ONLY mutations for bootstrapping test data
 *
 * SECURITY: These mutations should be REMOVED or DISABLED in production!
 * They exist only for test setup.
 */

import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { PERMISSIONS } from "./permissions";

/**
 * Grant all permissions to a test user (TEST ONLY - NO AUTHENTICATION)
 *
 * This helper creates a "test_admin" role with all permissions
 * and assigns it to the specified user.
 */
export const grantAllPermissions = mutation({
  args: {
    aid: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if test_admin role exists
    let testAdminRole = await ctx.db
      .query("roles")
      .withIndex("by_roleName", (q) => q.eq("roleName", "test_admin"))
      .first();

    if (!testAdminRole) {
      // Create role with fake governance data (for tests only)
      const roleId = await ctx.db.insert("roles", {
        roleName: "test_admin",
        adminAID: "TEST_ADMIN",
        actionSAID: "TEST_ACTION",
        timestamp: now,
      });
      testAdminRole = {
        _id: roleId,
        roleName: "test_admin",
        adminAID: "TEST_ADMIN",
        actionSAID: "TEST_ACTION",
        timestamp: now,
      };
    }

    // Create all permissions if they don't exist
    const permissionKeys = Object.values(PERMISSIONS);
    const permissionIds: string[] = [];

    for (const key of permissionKeys) {
      let perm = await ctx.db
        .query("permissions")
        .withIndex("by_key", (q) => q.eq("key", key))
        .first();

      if (!perm) {
        const permId = await ctx.db.insert("permissions", {
          key,
          data: undefined,
          adminAID: "TEST_ADMIN",
          actionSAID: "TEST_ACTION",
          timestamp: now,
        });
        permissionIds.push(permId);
      } else {
        permissionIds.push(perm._id);
      }
    }

    // Link permissions to role
    for (const permId of permissionIds) {
      const existing = await ctx.db
        .query("rolePermissions")
        .withIndex("by_role", (q) => q.eq("roleId", testAdminRole!._id))
        .filter((q) => q.eq(q.field("permissionId"), permId))
        .first();

      if (!existing) {
        await ctx.db.insert("rolePermissions", {
          roleId: testAdminRole!._id,
          permissionId: permId,
          adminAID: "TEST_ADMIN",
          actionSAID: "TEST_ACTION",
          timestamp: now,
        });
      }
    }

    // Grant role to user
    const existing = await ctx.db
      .query("userRoles")
      .withIndex("by_user", (q) => q.eq("userAID", args.aid))
      .filter((q) => q.eq(q.field("roleId"), testAdminRole!._id))
      .first();

    if (!existing) {
      await ctx.db.insert("userRoles", {
        userAID: args.aid,
        roleId: testAdminRole!._id,
        adminAID: "TEST_ADMIN",
        actionSAID: "TEST_ACTION",
        timestamp: now,
      });
    }

    return { aid: args.aid, role: "test_admin", permissionCount: permissionIds.length };
  },
});

/**
 * Reset all RBAC data (TEST ONLY)
 */
export const resetRBAC = mutation({
  args: {},
  handler: async (ctx) => {
    let deleted = 0;

    // Delete all user roles
    const userRoles = await ctx.db.query("userRoles").collect();
    for (const ur of userRoles) {
      await ctx.db.delete(ur._id);
      deleted++;
    }

    // Delete all role permissions
    const rolePerms = await ctx.db.query("rolePermissions").collect();
    for (const rp of rolePerms) {
      await ctx.db.delete(rp._id);
      deleted++;
    }

    // Delete all permissions
    const perms = await ctx.db.query("permissions").collect();
    for (const p of perms) {
      await ctx.db.delete(p._id);
      deleted++;
    }

    // Delete all roles
    const roles = await ctx.db.query("roles").collect();
    for (const r of roles) {
      await ctx.db.delete(r._id);
      deleted++;
    }

    return { deleted };
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
      "users",
      "groupChats",
      "groupMessages",
      "groupMembers",
      "sessionTokens",
      "allowList",
      "denyList",
      "userRoles",
      "rolePermissions",
      "permissions",
      "roles",
    ];

    let totalDeleted = 0;

    for (const table of tables) {
      const records = await ctx.db.query(table as any).collect();
      for (const record of records) {
        await ctx.db.delete(record._id);
        totalDeleted++;
      }
    }

    return { deletedRecords: totalDeleted };
  },
});

/**
 * Register a user without authentication (TEST ONLY)
 */
export const registerTestUser = mutation({
  args: {
    aid: v.string(),
    publicKey: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if user already exists
    const existing = await ctx.db
      .query("users")
      .withIndex("by_aid", (q) => q.eq("aid", args.aid))
      .first();

    if (existing) {
      return { userId: existing._id, created: false };
    }

    // Insert user
    const userId = await ctx.db.insert("users", {
      aid: args.aid,
      publicKey: args.publicKey,
      createdAt: now,
    });

    return { userId, created: true };
  },
});
