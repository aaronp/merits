/**
 * Admin API - High-level interface for RBAC operations
 *
 * Handles all signing and authentication internally, so CLI commands don't need
 * to deal with cryptographic primitives.
 */

import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { signMutationArgs } from "../../core/signatures";
import { base64UrlToUint8Array } from "../../core/crypto";
import type { Credentials } from "../../cli/lib/credentials";

export class AdminApi {
  constructor(
    private convex: ConvexClient,
    private credentials: Credentials
  ) {}

  /**
   * Create a new role
   */
  async createRole(roleName: string, actionSAID: string): Promise<{ roleId: string }> {
    const args = { roleName, actionSAID };
    const sig = await this.signArgs(args);

    return await this.convex.mutation(api.permissions_admin.createRole, {
      ...args,
      sig,
    });
  }

  /**
   * Create a new permission
   */
  async createPermission(
    key: string,
    actionSAID: string,
    data?: any
  ): Promise<{ permissionId: string }> {
    const args = { key, actionSAID, data };
    const sig = await this.signArgs(args);

    return await this.convex.mutation(api.permissions_admin.createPermission, {
      ...args,
      sig,
    });
  }

  /**
   * Add a permission to a role
   */
  async addPermissionToRole(
    roleName: string,
    key: string,
    actionSAID: string
  ): Promise<{ success: boolean }> {
    const args = { roleName, key, actionSAID };
    const sig = await this.signArgs(args);

    return await this.convex.mutation(api.permissions_admin.addPermissionToRole, {
      ...args,
      sig,
    });
  }

  /**
   * Grant a role to a user
   */
  async grantRoleToUser(
    userAID: string,
    roleName: string,
    actionSAID: string
  ): Promise<{ success: boolean }> {
    const args = { userAID, roleName, actionSAID };
    const sig = await this.signArgs(args);

    return await this.convex.mutation(api.permissions_admin.grantRoleToUser, {
      ...args,
      sig,
    });
  }

  /**
   * Bootstrap onboarding (create initial roles and permissions)
   */
  async bootstrapOnboarding(adminAid: string): Promise<any> {
    return await this.convex.mutation(api.authorization_bootstrap.bootstrapOnboarding, {
      adminAid,
    });
  }

  /**
   * Internal helper: sign mutation arguments
   */
  private async signArgs(args: Record<string, any>) {
    const privateKeyBytes = base64UrlToUint8Array(this.credentials.privateKey);
    return await signMutationArgs(args, privateKeyBytes, this.credentials.aid);
  }
}
