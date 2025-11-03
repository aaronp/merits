import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const PERMISSIONS = {
  CAN_MESSAGE_GROUPS: "can.message.groups",
  CAN_READ_GROUPS: "can.read.groups",
  CAN_CREATE_GROUPS: "can.create.groups",
  CAN_UPDATE_GROUPS: "can.update.groups",
  CAN_DELETE_GROUPS: "can.delete.groups",
  CAN_ASSIGN_USERS_TO_GROUPS: "can.assign.users.to.groups",
  CAN_ASSIGN_ROLES: "can.assign.roles",
  CAN_MESSAGE_USERS: "can.message.users",
} as const;

export type Claim = { key: string; data?: any };

export async function resolveUserClaims(ctx: MutationCtx | QueryCtx, aid: string): Promise<Claim[]> {
  // Find roles for the user
  const userRoles = await ctx.db
    .query("userRoles")
    .withIndex("by_user", (q: any) => q.eq("userAID", aid))
    .collect();

  if (userRoles.length === 0) {
    return [];
  }

  // Gather role ids
  const roleIds = userRoles.map((ur: any) => ur.roleId);

  // Map roles to permission mappings
  const rolePerms = await Promise.all(
    roleIds.map((rid) =>
      ctx.db
        .query("rolePermissions")
        .withIndex("by_role", (q: any) => q.eq("roleId", rid))
        .collect()
    )
  );

  const permIds = new Set<Id<"permissions">>();
  for (const list of rolePerms) {
    for (const rp of list) permIds.add(rp.permissionId);
  }

  if (permIds.size === 0) {
    return [];
  }

  // Fetch permissions
  const claims: Claim[] = [];
  await Promise.all(
    Array.from(permIds).map(async (pid) => {
      const perm = await ctx.db.get(pid);
      if (perm) {
        claims.push({ key: perm.key, data: perm.data });
      }
    })
  );

  return claims;
}

export function claimsInclude(
  claims: Claim[],
  key: string,
  predicate?: (data: any) => boolean
): boolean {
  for (const c of claims) {
    if (c.key !== key) continue;
    if (!predicate) return true;
    return !!predicate(c.data);
  }
  return false;
}


