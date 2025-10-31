import type { CLIContext } from "../lib/context";
import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

export async function rolesCreate(roleName: string, opts: any & { _ctx: CLIContext }) {
  const ctx = opts._ctx;
  const convex = new ConvexClient(ctx.config.backend.url);
  const res = await convex.mutation(api.permissions_admin.createRole, {
    roleName,
    adminAID: opts.adminAID,
    actionSAID: opts.actionSAID,
  });
  console.log(JSON.stringify(res));
}

export async function permissionsCreate(key: string, opts: any & { _ctx: CLIContext }) {
  const ctx = opts._ctx;
  const convex = new ConvexClient(ctx.config.backend.url);
  let data: any = undefined;
  if (opts.data) {
    try { data = JSON.parse(opts.data); } catch { throw new Error("--data must be valid JSON"); }
  }
  const res = await convex.mutation(api.permissions_admin.createPermission, {
    key,
    data,
    adminAID: opts.adminAID,
    actionSAID: opts.actionSAID,
  });
  console.log(JSON.stringify(res));
}

export async function rolesAddPermission(roleName: string, key: string, opts: any & { _ctx: CLIContext }) {
  const ctx = opts._ctx;
  const convex = new ConvexClient(ctx.config.backend.url);
  const res = await convex.mutation(api.permissions_admin.addPermissionToRole, {
    roleName,
    key,
    adminAID: opts.adminAID,
    actionSAID: opts.actionSAID,
  });
  console.log(JSON.stringify(res));
}

export async function usersGrantRole(aid: string, roleName: string, opts: any & { _ctx: CLIContext }) {
  const ctx = opts._ctx;
  const convex = new ConvexClient(ctx.config.backend.url);
  const res = await convex.mutation(api.permissions_admin.grantRoleToUser, {
    userAID: aid,
    roleName,
    adminAID: opts.adminAID,
    actionSAID: opts.actionSAID,
  });
  console.log(JSON.stringify(res));
}

export async function bootstrapOnboardingCmd(opts: any & { _ctx: CLIContext }) {
  const ctx = opts._ctx;
  const convex = new ConvexClient(ctx.config.backend.url);
  const res = await convex.mutation(api.authorization_bootstrap.bootstrapOnboarding, {} as any);
  console.log(JSON.stringify(res));
}


