/**
 * Debug endpoints for troubleshooting authentication
 */

import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { verifyAuth } from './auth';
import { GROUP_TAGS } from './groupTags';

/**
 * Debug mutation to test signature verification
 *
 * This allows step-by-step testing of the auth flow without side effects
 */
export const debugVerify = mutation({
  args: {
    challengeId: v.string(),
    sigs: v.array(v.string()),
    ksn: v.number(),
  },
  handler: async (ctx, args) => {
    try {
      // Call verifyAuth just like a real mutation would
      await verifyAuth(ctx, {
        challengeId: args.challengeId,
        sigs: args.sigs,
        ksn: args.ksn,
      });

      return {
        success: true,
        message: 'Signature verification successful',
      };
    } catch (error) {
      // Return error details for debugging
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };
    }
  },
});

export const getOnboardingGroupDebug = query({
  args: {},
  handler: async (ctx) => {
    // Try by tag
    const byTag = await ctx.db
      .query('groupChats')
      .withIndex('by_tag', (q: any) => q.eq('tag', GROUP_TAGS.ONBOARDING))
      .first();

    // Try by name
    const byName = await ctx.db
      .query('groupChats')
      .filter((q: any) => q.eq(q.field('name'), 'onboarding'))
      .first();

    // Get all groups
    const allGroups = await ctx.db.query('groupChats').collect();

    // Get permissions
    const permissions = await ctx.db.query('permissions').collect();

    return {
      byTag,
      byName,
      allGroups,
      totalGroups: allGroups.length,
      permissions,
    };
  },
});

export const fixPermission = mutation({
  args: {
    permissionId: v.id('permissions'),
    newData: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.permissionId, {
      data: args.newData,
    });
    return { ok: true };
  },
});

export const checkRolePermissions = query({
  args: {},
  handler: async (ctx) => {
    const roles = await ctx.db.query('roles').collect();
    const permissions = await ctx.db.query('permissions').collect();
    const rolePermissions = await ctx.db.query('rolePermissions').collect();
    const userRoles = await ctx.db.query('userRoles').collect();

    return {
      roles,
      permissions,
      rolePermissions,
      userRoles,
      anonRole: roles.find((r) => r.roleName === 'anon'),
      canMessageGroupsPermission: permissions.find((p) => p.key === 'can.message.groups'),
    };
  },
});

export const getUserRoles = query({
  args: {
    aid: v.string(),
  },
  handler: async (ctx, args) => {
    // Get user
    const user = await ctx.db
      .query('users')
      .withIndex('by_aid', (q: any) => q.eq('aid', args.aid))
      .first();

    if (!user) {
      return { error: 'User not found', aid: args.aid };
    }

    // Get user's role assignments
    const userRoles = await ctx.db
      .query('userRoles')
      .withIndex('by_user', (q: any) => q.eq('userAID', args.aid))
      .collect();

    // Get role details
    const roleDetails = await Promise.all(
      userRoles.map(async (ur) => {
        const role = await ctx.db.get(ur.roleId);
        return { ...ur, roleName: role?.roleName };
      }),
    );

    // Get all roles for reference
    const allRoles = await ctx.db.query('roles').collect();

    return {
      user,
      userRoles: roleDetails,
      allRoles,
    };
  },
});

export const forceCreateAnonRole = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Create anon role
    let anonRole = await ctx.db
      .query('roles')
      .withIndex('by_roleName', (q: any) => q.eq('roleName', 'anon'))
      .first();

    if (!anonRole) {
      const rid = await ctx.db.insert('roles', {
        roleName: 'anon',
        adminAID: 'SYSTEM',
        actionSAID: 'debug/fix',
        timestamp: now,
      });
      anonRole = await ctx.db.get(rid);
    }

    // Get permission
    const permission = await ctx.db
      .query('permissions')
      .withIndex('by_key', (q: any) => q.eq('key', 'can.message.groups'))
      .first();

    if (!permission) {
      throw new Error('Permission not found');
    }

    // Create role-permission mapping
    const existingRP = await ctx.db
      .query('rolePermissions')
      .withIndex('by_role', (q: any) => q.eq('roleId', anonRole._id))
      .filter((q: any) => q.eq(q.field('permissionId'), permission._id))
      .first();

    if (!existingRP) {
      await ctx.db.insert('rolePermissions', {
        roleId: anonRole._id,
        permissionId: permission._id,
        adminAID: 'SYSTEM',
        actionSAID: 'debug/fix',
        timestamp: now,
      });
    }

    return { ok: true, anonRoleId: anonRole._id };
  },
});
