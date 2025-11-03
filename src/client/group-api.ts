/**
 * Group API - High-level interface for group operations
 *
 * Handles all signing and authentication internally, so CLI commands don't need
 * to deal with cryptographic primitives.
 */

import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { signMutationArgs } from "../../core/signatures";
import { base64UrlToUint8Array } from "../../core/crypto";
import type { Credentials } from "../../cli/lib/credentials";

export interface Group {
  id: string;
  name: string;
  ownerAid: string;
  membershipSaid: string;
  role: string;
  joinedAt: number;
  latestSeqNo: number;
  messageCount: number;
  unreadCount: number;
}

export class GroupApi {
  constructor(
    private convex: ConvexClient,
    private credentials: Credentials
  ) {}

  /**
   * Create a new group
   */
  async createGroup(name: string, initialMembers: string[] = []): Promise<{ groupId: string }> {
    const args = { name, initialMembers };
    const sig = await this.signArgs(args);

    return await this.convex.mutation(api.groups.createGroup, {
      ...args,
      sig,
    });
  }

  /**
   * List all groups for the authenticated user
   */
  async listGroups(): Promise<Group[]> {
    const args = { aid: this.credentials.aid };

    // Queries don't require signing - just pass the AID
    const groups = await this.convex.query(api.groups.listGroupChats, args);

    // Backend returns membership info, not just group details
    return groups as Group[];
  }

  /**
   * Get detailed group information
   */
  async getGroup(groupId: string): Promise<Group> {
    const args = { groupId, callerAid: this.credentials.aid };

    const group = await this.convex.query(api.groups.getGroup, args);

    return group as Group;
  }

  /**
   * Add members to a group
   */
  async addMembers(groupId: string, members: string[]): Promise<void> {
    const args = { groupId, members };
    const sig = await this.signArgs(args);

    await this.convex.mutation(api.groups.addMembers, {
      ...args,
      sig,
    });
  }

  /**
   * Remove members from a group
   */
  async removeMembers(groupId: string, members: string[]): Promise<void> {
    const args = { groupId, members };
    const sig = await this.signArgs(args);

    await this.convex.mutation(api.groups.removeMembers, {
      ...args,
      sig,
    });
  }

  /**
   * Leave a group
   */
  async leaveGroup(groupId: string): Promise<void> {
    const args = { groupId };
    const sig = await this.signArgs(args);

    await this.convex.mutation(api.groups.leaveGroup, {
      ...args,
      sig,
    });
  }

  /**
   * Send a message to a group
   */
  async sendGroupMessage(
    groupId: string,
    ct: string,
    options?: { typ?: string; ttl?: number }
  ): Promise<{ messageId: string }> {
    const args = {
      groupId,
      ct,
      typ: options?.typ,
      ttl: options?.ttl,
    };
    const sig = await this.signArgs(args);

    return await this.convex.mutation(api.groups.sendGroupMessage, {
      ...args,
      sig,
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
