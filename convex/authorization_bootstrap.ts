/**
 * Bootstrap System (Dev Environment)
 *
 * ⚠️ WARNING: This is a DEVELOPMENT-ONLY bootstrap implementation.
 *    For production deployment, see docs/bootstrap-plan.md Option A.
 *
 * Security guards:
 * - BOOTSTRAP_KEY environment variable required (prevents accidental production use)
 * - Idempotent (safe to call multiple times)
 * - Creates admin role if it doesn't exist
 * - Assigns specified AID as admin
 *
 * TODO: Implement secure HMAC token bootstrap for production (see docs/bootstrap-plan.md)
 */

import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const bootstrapOnboarding = mutation({
  args: {
    adminAid: v.optional(v.string()), // AID to grant admin role (optional for backwards compat)
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // ============================================================================
    // SECURITY GUARD #1: Require BOOTSTRAP_KEY environment variable
    // ============================================================================
    // This prevents accidental bootstrap in production environments.
    // To bootstrap in dev, set: export BOOTSTRAP_KEY="dev-only-secret"
    const BOOTSTRAP_KEY = process.env.BOOTSTRAP_KEY;
    if (!BOOTSTRAP_KEY) {
      throw new Error(
        "BOOTSTRAP_DISABLED - Bootstrap is not available in this environment. " +
        "For dev setup, set BOOTSTRAP_KEY environment variable. " +
        "See docs/bootstrap-plan.md for details."
      );
    }

    // ============================================================================
    // SECURITY GUARD #2: Database must be empty for initial bootstrap
    // ============================================================================
    // Prevent bootstrap on a database with existing data to avoid corruption.
    // Check critical tables: roles, users, userRoles
    const existingRoles = await ctx.db.query("roles").first();
    const existingUsers = await ctx.db.query("users").first();
    const existingUserRoles = await ctx.db.query("userRoles").first();

    if (existingRoles || existingUsers || existingUserRoles) {
      console.log("Bootstrap: Database not empty, bootstrap already completed");

      // Return info about existing bootstrap for idempotency
      const existingAdmin = await ctx.db
        .query("roles")
        .withIndex("by_roleName", (q: any) => q.eq("roleName", "admin"))
        .first();

      const anonRole = await ctx.db
        .query("roles")
        .withIndex("by_roleName", (q: any) => q.eq("roleName", "anon"))
        .first();

      const userRole = await ctx.db
        .query("roles")
        .withIndex("by_roleName", (q: any) => q.eq("roleName", "user"))
        .first();

      const onboardingGroup = await ctx.db
        .query("groupChats")
        .filter((q: any) => q.eq(q.field("name"), "onboarding"))
        .first();

      return {
        ok: true,
        already: true,
        message: "System already bootstrapped. Database contains existing roles/users.",
        onboardingGroupId: onboardingGroup?._id,
        anonRoleId: anonRole?._id,
        userRoleId: userRole?._id,
        adminRoleId: existingAdmin?._id,
      };
    }

    // Database is empty - proceed with bootstrap
    console.log("Bootstrap: Database empty, proceeding with initial bootstrap");

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

    // ============================================================================
    // Create admin and user roles
    // ============================================================================
    // Create admin role with full permissions
    let adminRole = await ctx.db
      .query("roles")
      .withIndex("by_roleName", (q: any) => q.eq("roleName", "admin"))
      .first();

    if (!adminRole) {
      const adminRoleId = await ctx.db.insert("roles", {
        roleName: "admin",
        adminAID: "SYSTEM",
        actionSAID: "bootstrap/roles",
        timestamp: now,
      });
      adminRole = await ctx.db.get(adminRoleId);
      console.log("Bootstrap: Created admin role");
    }

    // Create user role (elevated from anon)
    let userRole = await ctx.db
      .query("roles")
      .withIndex("by_roleName", (q: any) => q.eq("roleName", "user"))
      .first();

    if (!userRole) {
      const userRoleId = await ctx.db.insert("roles", {
        roleName: "user",
        adminAID: "SYSTEM",
        actionSAID: "bootstrap/roles",
        timestamp: now,
      });
      userRole = await ctx.db.get(userRoleId);
      console.log("Bootstrap: Created user role");
    }

    // ============================================================================
    // Assign admin role to specified AID (if provided)
    // ============================================================================
    if (args.adminAid) {
      // Check if this AID already has admin role
      const existingAssignment = await ctx.db
        .query("userRoles")
        .withIndex("by_user", (q: any) => q.eq("userAID", args.adminAid))
        .filter((q: any) => q.eq(q.field("roleId"), adminRole!._id))
        .first();

      if (!existingAssignment) {
        await ctx.db.insert("userRoles", {
          userAID: args.adminAid,
          roleId: adminRole!._id,
          adminAID: "SYSTEM",
          actionSAID: "bootstrap/assign",
          timestamp: now,
        });
        console.log(`Bootstrap: Assigned admin role to ${args.adminAid}`);
      } else {
        console.log(`Bootstrap: ${args.adminAid} already has admin role`);
      }
    }

    return {
      ok: true,
      already: false,
      message: "System bootstrapped successfully",
      onboardingGroupId: onboardingGroup!._id,
      anonRoleId: anonRole!._id,
      userRoleId: userRole!._id,
      adminRoleId: adminRole!._id,
      permissionId: permission!._id,
      adminAid: args.adminAid,
    };
  },
});


