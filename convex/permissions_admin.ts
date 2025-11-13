import { v } from 'convex/values';
import { mutation } from './_generated/server';
import { verifySignedRequest } from './auth';
import { claimsInclude, PERMISSIONS, resolveUserClaims } from './permissions';

// Signature validator (reusable)
const sigValidator = v.object({
  signature: v.string(),
  timestamp: v.number(),
  nonce: v.string(),
  keyId: v.string(),
  signedFields: v.array(v.string()),
});

async function requireAssignRoles(ctx: any, aid: string) {
  // First-run bypass: if there are no roles and no permissions yet, allow
  const anyRole = await ctx.db.query('roles').first();
  const anyPerm = await ctx.db.query('permissions').first();
  if (!anyRole && !anyPerm) return;

  const claims = await resolveUserClaims(ctx, aid);
  if (!claimsInclude(claims, PERMISSIONS.CAN_ASSIGN_ROLES)) {
    throw new Error('Not permitted to administer roles/permissions');
  }
}

export const createRole = mutation({
  args: {
    roleName: v.string(),
    actionSAID: v.string(),
    sig: sigValidator,
  },
  handler: async (ctx, args) => {
    // Verify signed request
    const verified = await verifySignedRequest(ctx, args);

    // Check permissions
    await requireAssignRoles(ctx, verified.aid);

    const now = Date.now();
    // Ensure not exists
    const existing = await ctx.db
      .query('roles')
      .withIndex('by_roleName', (q: any) => q.eq('roleName', args.roleName))
      .first();
    if (existing) return { roleId: existing._id };
    const id = await ctx.db.insert('roles', {
      roleName: args.roleName,
      adminAID: verified.aid,
      actionSAID: args.actionSAID,
      timestamp: now,
    });
    return { roleId: id };
  },
});

export const createPermission = mutation({
  args: {
    key: v.string(),
    data: v.optional(v.any()),
    actionSAID: v.string(),
    sig: sigValidator,
  },
  handler: async (ctx, args) => {
    // Verify signed request
    const verified = await verifySignedRequest(ctx, args);

    // Check permissions
    await requireAssignRoles(ctx, verified.aid);

    const now = Date.now();
    const existing = await ctx.db
      .query('permissions')
      .withIndex('by_key', (q: any) => q.eq('key', args.key))
      .first();
    if (existing) return { permissionId: existing._id };
    const id = await ctx.db.insert('permissions', {
      key: args.key,
      data: args.data,
      adminAID: verified.aid,
      actionSAID: args.actionSAID,
      timestamp: now,
    });
    return { permissionId: id };
  },
});

export const addPermissionToRole = mutation({
  args: {
    roleName: v.string(),
    key: v.string(),
    actionSAID: v.string(),
    sig: sigValidator,
  },
  handler: async (ctx, args) => {
    // Verify signed request
    const verified = await verifySignedRequest(ctx, args);

    // Check permissions
    await requireAssignRoles(ctx, verified.aid);

    const now = Date.now();
    const role = await ctx.db
      .query('roles')
      .withIndex('by_roleName', (q: any) => q.eq('roleName', args.roleName))
      .first();
    if (!role) throw new Error('Role not found');
    const perm = await ctx.db
      .query('permissions')
      .withIndex('by_key', (q: any) => q.eq('key', args.key))
      .first();
    if (!perm) throw new Error('Permission not found');

    const existing = await ctx.db
      .query('rolePermissions')
      .withIndex('by_role', (q: any) => q.eq('roleId', role._id))
      .collect();
    if (existing.some((rp: any) => rp.permissionId === perm._id)) {
      return { success: true };
    }
    await ctx.db.insert('rolePermissions', {
      roleId: role._id,
      permissionId: perm._id,
      adminAID: verified.aid,
      actionSAID: args.actionSAID,
      timestamp: now,
    });
    return { success: true };
  },
});

export const grantRoleToUser = mutation({
  args: {
    userAID: v.string(),
    roleName: v.string(),
    actionSAID: v.string(),
    sig: sigValidator,
  },
  handler: async (ctx, args) => {
    // Verify signed request
    const verified = await verifySignedRequest(ctx, args);

    // Check permissions
    await requireAssignRoles(ctx, verified.aid);

    const now = Date.now();
    const role = await ctx.db
      .query('roles')
      .withIndex('by_roleName', (q: any) => q.eq('roleName', args.roleName))
      .first();
    if (!role) throw new Error('Role not found');
    await ctx.db.insert('userRoles', {
      userAID: args.userAID,
      roleId: role._id,
      adminAID: verified.aid,
      actionSAID: args.actionSAID,
      timestamp: now,
    });
    return { success: true };
  },
});
