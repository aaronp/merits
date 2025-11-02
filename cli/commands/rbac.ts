import type { CLIContext } from "../lib/context";
import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { requireSessionToken } from "../lib/session";

export async function rolesCreate(roleName: string, opts: any & { _ctx: CLIContext }) {
  const ctx = opts._ctx;
  const convex = new ConvexClient(ctx.config.backend.url);

  // Load session token (admin must be signed in)
  const session = requireSessionToken(opts.token);

  const res = await convex.mutation(api.permissions_admin.createRole, {
    roleName,
    actionSAID: opts.actionSAID,
    sessionToken: session.token,
  });
  console.log(JSON.stringify(res));
}

export async function permissionsCreate(key: string, opts: any & { _ctx: CLIContext }) {
  const ctx = opts._ctx;
  const convex = new ConvexClient(ctx.config.backend.url);

  // Load session token (admin must be signed in)
  const session = requireSessionToken(opts.token);

  let data: any = undefined;
  if (opts.data) {
    try { data = JSON.parse(opts.data); } catch { throw new Error("--data must be valid JSON"); }
  }

  const res = await convex.mutation(api.permissions_admin.createPermission, {
    key,
    data,
    actionSAID: opts.actionSAID,
    sessionToken: session.token,
  });
  console.log(JSON.stringify(res));
}

export async function rolesAddPermission(roleName: string, key: string, opts: any & { _ctx: CLIContext }) {
  const ctx = opts._ctx;
  const convex = new ConvexClient(ctx.config.backend.url);

  // Load session token (admin must be signed in)
  const session = requireSessionToken(opts.token);

  const res = await convex.mutation(api.permissions_admin.addPermissionToRole, {
    roleName,
    key,
    actionSAID: opts.actionSAID,
    sessionToken: session.token,
  });
  console.log(JSON.stringify(res));
}

export async function usersGrantRole(aid: string, roleName: string, opts: any & { _ctx: CLIContext }) {
  const ctx = opts._ctx;
  const convex = new ConvexClient(ctx.config.backend.url);

  // Load session token (admin must be signed in)
  const session = requireSessionToken(opts.token);

  const res = await convex.mutation(api.permissions_admin.grantRoleToUser, {
    userAID: aid,
    roleName,
    actionSAID: opts.actionSAID,
    sessionToken: session.token,
  });
  console.log(JSON.stringify(res));
}

export async function bootstrapOnboardingCmd(opts: any & { _ctx: CLIContext }) {
  const ctx = opts._ctx;
  const convex = new ConvexClient(ctx.config.backend.url);

  const args: { adminAid?: string } = {};
  if (opts.adminAid) {
    args.adminAid = opts.adminAid;
  }

  const res = await convex.mutation(api.authorization_bootstrap.bootstrapOnboarding, args as any);
  console.log(JSON.stringify(res));
}
