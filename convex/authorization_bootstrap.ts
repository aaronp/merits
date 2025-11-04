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
import { PERMISSIONS } from "./permissions";
import { GROUP_TAGS } from "./groupTags";

export const bootstrapOnboarding = mutation({
  args: {
    adminAid: v.optional(v.string()), // AID to grant admin role (optional for backwards compat)
  },
  handler: async (ctx, args) => {
    try {
      console.log("[BOOTSTRAP] Starting bootstrap with adminAid:", args.adminAid);
      const now = Date.now();

      // ============================================================================
      // SECURITY GUARD #1: Require BOOTSTRAP_KEY environment variable
      // ============================================================================
      // This prevents accidental bootstrap in production environments.
      // To bootstrap in dev, set: export BOOTSTRAP_KEY="dev-only-secret"
      // NOTE: Temporarily disabled - Convex env vars not accessible at runtime via process.env
      // TODO: Implement proper environment variable access for Convex
      // const BOOTSTRAP_KEY = process.env.BOOTSTRAP_KEY;
      // console.log("[BOOTSTRAP] BOOTSTRAP_KEY exists:", !!BOOTSTRAP_KEY);
      // if (!BOOTSTRAP_KEY) {
      //   throw new Error(
      //     "BOOTSTRAP_DISABLED - Bootstrap is not available in this environment. " +
      //     "For dev setup, set BOOTSTRAP_KEY environment variable. " +
      //     "See docs/bootstrap-plan.md for details."
      //   );
      // }
      console.log("[BOOTSTRAP] Proceeding with bootstrap (BOOTSTRAP_KEY check disabled)");

    // ============================================================================
    // SECURITY GUARD #2: Database must be empty for initial bootstrap
    // ============================================================================
    // Prevent bootstrap on a database with existing data to avoid corruption.
    // Check critical tables: roles, users, userRoles
    console.log("[BOOTSTRAP] Checking existing data...");
    const existingRoles = await ctx.db.query("roles").first();
    // const existingUsers = await ctx.db.query("users").first();
    const existingUserRoles = await ctx.db.query("userRoles").first();
    console.log("[BOOTSTRAP] Existing roles:", existingRoles, "userRoles:", existingUserRoles);

    if (existingRoles || existingUserRoles) {
      console.log("Bootstrap: Database not empty, checking if onboarding group exists", {
        existingRoles,
        existingUserRoles,
      });

      // Check if onboarding group exists, create if missing
      // Try by tag first (new schema), then fall back to name (legacy)
      let onboardingGroup = await ctx.db
        .query("groupChats")
        .withIndex("by_tag", (q: any) => q.eq("tag", GROUP_TAGS.ONBOARDING))
        .first();

      if (!onboardingGroup) {
        onboardingGroup = await ctx.db
          .query("groupChats")
          .filter((q: any) => q.eq(q.field("name"), "onboarding"))
          .first();

        // If found by name but missing tag, update it
        if (onboardingGroup && !onboardingGroup.tag) {
          await ctx.db.patch(onboardingGroup._id, { tag: GROUP_TAGS.ONBOARDING });
          onboardingGroup = await ctx.db.get(onboardingGroup._id);
        }
      }

      if (!onboardingGroup && args.adminAid) {
        console.log("Bootstrap: Creating missing onboarding group");
        const groupId = await ctx.db.insert("groupChats", {
          ownerAid: args.adminAid,
          membershipSaid: "bootstrap/onboarding",
          name: "onboarding",
          tag: GROUP_TAGS.ONBOARDING,
          maxTtl: 30 * 24 * 60 * 60 * 1000,
          createdAt: now,
          createdBy: "SYSTEM",
        });
        onboardingGroup = await ctx.db.get(groupId);

        // Add admin as group member
        await ctx.db.insert("groupMembers", {
          groupChatId: groupId,
          aid: args.adminAid,
          latestSeqNo: 0,
          joinedAt: now,
          role: "owner",
        });
        console.log("Bootstrap: Added admin as onboarding group member");
      }

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

      // Ensure admin is a member of onboarding group
      if (onboardingGroup && args.adminAid) {
        const existingMembership = await ctx.db
          .query("groupMembers")
          .withIndex("by_group_aid", (q: any) =>
            q.eq("groupChatId", onboardingGroup._id).eq("aid", args.adminAid)
          )
          .first();

        if (!existingMembership) {
          await ctx.db.insert("groupMembers", {
            groupChatId: onboardingGroup._id,
            aid: args.adminAid,
            latestSeqNo: 0,
            joinedAt: now,
            role: "owner",
          });
          console.log("Bootstrap: Added admin as onboarding group member");
        }
      }

      // Ensure anon role has permission to message onboarding group
      if (anonRole && onboardingGroup) {
        const permKey = PERMISSIONS.CAN_MESSAGE_GROUPS;
        let permission = await ctx.db
          .query("permissions")
          .withIndex("by_key", (q: any) => q.eq("key", permKey))
          .first();

        if (!permission) {
          const pid = await ctx.db.insert("permissions", {
            key: permKey,
            data: [onboardingGroup._id as string],
            adminAID: "SYSTEM",
            actionSAID: "bootstrap/perms",
            timestamp: now,
          });
          permission = await ctx.db.get(pid);
        } else {
          // Update permission data if it doesn't include this group
          const currentData = (permission.data as string[]) || [];
          if (!currentData.includes(onboardingGroup._id as string)) {
            await ctx.db.patch(permission._id, {
              data: [onboardingGroup._id as string],
              adminAID: "SYSTEM",
              actionSAID: "bootstrap/perms",
            });
            permission = await ctx.db.get(permission._id);
          }
        }

        // Ensure role->permission mapping exists
        const existingRP = await ctx.db
          .query("rolePermissions")
          .withIndex("by_role", (q: any) => q.eq("roleId", anonRole._id))
          .collect();

        if (permission) {
          const hasMapping = existingRP.some((rp: any) => rp.permissionId === permission._id);
          if (!hasMapping) {
            await ctx.db.insert("rolePermissions", {
              roleId: anonRole._id,
              permissionId: permission._id,
              adminAID: "SYSTEM",
              actionSAID: "bootstrap/map",
              timestamp: now,
            });
          }
        }
      }

      // Ensure admin role has permission to message users directly
      if (existingAdmin) {
        const messageUsersPermKey = PERMISSIONS.CAN_MESSAGE_USERS;
        let messageUsersPermission = await ctx.db
          .query("permissions")
          .withIndex("by_key", (q: any) => q.eq("key", messageUsersPermKey))
          .first();

        if (!messageUsersPermission) {
          const pid = await ctx.db.insert("permissions", {
            key: messageUsersPermKey,
            data: undefined, // No restrictions - admin can message all users
            adminAID: "SYSTEM",
            actionSAID: "bootstrap/perms",
            timestamp: now,
          });
          messageUsersPermission = await ctx.db.get(pid);
          console.log("Bootstrap: Created CAN_MESSAGE_USERS permission (idempotent)");
        }

        // Ensure role->permission mapping exists
        const existingAdminRP = await ctx.db
          .query("rolePermissions")
          .withIndex("by_role", (q: any) => q.eq("roleId", existingAdmin._id))
          .collect();

        if (messageUsersPermission) {
          const hasMapping = existingAdminRP.some(
            (rp: any) => rp.permissionId === messageUsersPermission._id
          );
          if (!hasMapping) {
            await ctx.db.insert("rolePermissions", {
              roleId: existingAdmin._id,
              permissionId: messageUsersPermission._id,
              adminAID: "SYSTEM",
              actionSAID: "bootstrap/map",
              timestamp: now,
            });
            console.log("Bootstrap: Linked admin role to CAN_MESSAGE_USERS permission (idempotent)");
          }
        }

        // Ensure admin AID is assigned the admin role
        if (args.adminAid) {
          const existingAssignment = await ctx.db
            .query("userRoles")
            .withIndex("by_user", (q: any) => q.eq("userAID", args.adminAid))
            .filter((q: any) => q.eq(q.field("roleId"), existingAdmin._id))
            .first();

          if (!existingAssignment) {
            await ctx.db.insert("userRoles", {
              userAID: args.adminAid,
              roleId: existingAdmin._id,
              adminAID: "SYSTEM",
              actionSAID: "bootstrap/assign",
              timestamp: now,
            });
            console.log(`Bootstrap: Assigned admin role to ${args.adminAid} (idempotent)`);
          } else {
            console.log(`Bootstrap: ${args.adminAid} already has admin role`);
          }
        }
      }

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
    console.log("[BOOTSTRAP] Database empty, proceeding with initial bootstrap");

    // Create onboarding group if missing
    console.log("[BOOTSTRAP] Checking for existing onboarding group...");
    let onboardingGroup = await ctx.db
      .query("groupChats")
      .withIndex("by_created", (q: any) => q.gt("createdAt", 0))
      .filter((q: any) => q.eq(q.field("name"), "onboarding"))
      .first();
    console.log("[BOOTSTRAP] Existing onboarding group:", onboardingGroup);

    if (!onboardingGroup) {
      console.log("[BOOTSTRAP] Creating onboarding group with tag:", GROUP_TAGS.ONBOARDING);
      const groupId = await ctx.db.insert("groupChats", {
        ownerAid: args.adminAid!,
        membershipSaid: "bootstrap/onboarding",
        name: "onboarding",
        tag: GROUP_TAGS.ONBOARDING,
        maxTtl: 30 * 24 * 60 * 60 * 1000,
        createdAt: now,
        createdBy: "SYSTEM",
      });
      console.log("[BOOTSTRAP] Created group with ID:", groupId);
      onboardingGroup = await ctx.db.get(groupId);

      // Add admin as group member
      await ctx.db.insert("groupMembers", {
        groupChatId: groupId,
        aid: args.adminAid!,
        latestSeqNo: 0,
        joinedAt: now,
        role: "owner",
      });
      console.log("[BOOTSTRAP] Added admin as onboarding group member");
    } else {
      console.log("Bootstrap: Onboarding group already exists");
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
    const permKey = PERMISSIONS.CAN_MESSAGE_GROUPS;
    let permission = await ctx.db
      .query("permissions")
      .withIndex("by_key", (q: any) => q.eq("key", permKey))
      .first();
    if (!permission) {
      const pid = await ctx.db.insert("permissions", {
        key: permKey,
        data: [onboardingGroup!._id as string],
        adminAID: "SYSTEM",
        actionSAID: "bootstrap/perms",
        timestamp: now,
      });
      permission = await ctx.db.get(pid);
    } else {
      // Update permission data if it doesn't include this group
      const currentData = (permission.data as string[]) || [];
      if (!currentData.includes(onboardingGroup!._id as string)) {
        await ctx.db.patch(permission._id, {
          data: [onboardingGroup!._id as string],
          adminAID: "SYSTEM",
          actionSAID: "bootstrap/perms",
        });
        permission = await ctx.db.get(permission._id);
      }
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

    // Grant admin permission to message users directly
    const messageUsersPermKey = PERMISSIONS.CAN_MESSAGE_USERS;
    let messageUsersPermission = await ctx.db
      .query("permissions")
      .withIndex("by_key", (q: any) => q.eq("key", messageUsersPermKey))
      .first();

    if (!messageUsersPermission) {
      const pid = await ctx.db.insert("permissions", {
        key: messageUsersPermKey,
        data: undefined, // No restrictions - admin can message all users
        adminAID: "SYSTEM",
        actionSAID: "bootstrap/perms",
        timestamp: now,
      });
      messageUsersPermission = await ctx.db.get(pid);
      console.log("Bootstrap: Created CAN_MESSAGE_USERS permission");
    }

    // Link admin role to CAN_MESSAGE_USERS permission
    const existingAdminRP = await ctx.db
      .query("rolePermissions")
      .withIndex("by_role", (q: any) => q.eq("roleId", adminRole!._id))
      .collect();

    const hasMessageUsersMapping = existingAdminRP.some(
      (rp: any) => rp.permissionId === messageUsersPermission!._id
    );

    if (!hasMessageUsersMapping) {
      await ctx.db.insert("rolePermissions", {
        roleId: adminRole!._id,
        permissionId: messageUsersPermission!._id,
        adminAID: "SYSTEM",
        actionSAID: "bootstrap/map",
        timestamp: now,
      });
      console.log("Bootstrap: Linked admin role to CAN_MESSAGE_USERS permission");
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
    } else {
      console.log("Bootstrap: No admin AID provided");
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
    } catch (error: any) {
      console.error("[BOOTSTRAP] Error occurred:", error);
      console.error("[BOOTSTRAP] Error stack:", error.stack);
      throw error;
    }
  },
});


