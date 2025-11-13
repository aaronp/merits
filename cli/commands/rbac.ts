import type { CLIContext } from '../lib/context';
import { requireCredentials } from '../lib/credentials';

export async function rolesCreate(roleName: string, opts: any & { _ctx: CLIContext }) {
  const ctx = opts._ctx;
  const creds = requireCredentials(opts.credentials);

  // Create admin API client (handles all signing internally)
  const admin = (ctx.client as any).createAdminApi(creds);

  // Simple, high-level API call
  const res = await admin.createRole(roleName, opts.actionSAID);
  console.log(JSON.stringify(res));
}

export async function permissionsCreate(key: string, opts: any & { _ctx: CLIContext }) {
  const ctx = opts._ctx;
  const creds = requireCredentials(opts.credentials);

  let data: any;
  if (opts.data) {
    try {
      data = JSON.parse(opts.data);
    } catch {
      throw new Error('--data must be valid JSON');
    }
  }

  // Create admin API client (handles all signing internally)
  const admin = (ctx.client as any).createAdminApi(creds);

  // Simple, high-level API call
  const res = await admin.createPermission(key, opts.actionSAID, data);
  console.log(JSON.stringify(res));
}

export async function rolesAddPermission(roleName: string, key: string, opts: any & { _ctx: CLIContext }) {
  const ctx = opts._ctx;
  const creds = requireCredentials(opts.credentials);

  // Create admin API client (handles all signing internally)
  const admin = (ctx.client as any).createAdminApi(creds);

  // Simple, high-level API call
  const res = await admin.addPermissionToRole(roleName, key, opts.actionSAID);
  console.log(JSON.stringify(res));
}

export async function usersGrantRole(aid: string, roleName: string, opts: any & { _ctx: CLIContext }) {
  const ctx = opts._ctx;
  const creds = requireCredentials(opts.credentials);

  // Create admin API client (handles all signing internally)
  const admin = (ctx.client as any).createAdminApi(creds);

  // Simple, high-level API call
  const res = await admin.grantRoleToUser(aid, roleName, opts.actionSAID);
  console.log(JSON.stringify(res));
}

export async function bootstrapOnboardingCmd(convexUrl: string, adminAid: string) {
  // Bootstrap doesn't require authentication - it's open during initial setup
  const { ConvexClient } = await import('convex/browser');
  const { api } = await import('../../convex/_generated/api');
  const convex = new ConvexClient(convexUrl);

  return convex.mutation(api.authorization_bootstrap.bootstrapOnboarding, { adminAid });
}
