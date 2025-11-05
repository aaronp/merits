/**
 * ConvexGroupApi: Convex implementation of GroupApi interface
 */

import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type {
  GroupApi,
  CreateGroupRequest,
  AddMembersRequest,
  RemoveMembersRequest,
  GroupSendRequest,
  ListGroupsRequest,
  GetGroupRequest,
  LeaveGroupRequest,
  Group,
  GroupId,
} from "../../core/interfaces/GroupApi";

export class ConvexGroupApi implements GroupApi {
  constructor(private client: ConvexClient) { }

  async createGroup(req: CreateGroupRequest): Promise<{ groupId: GroupId }> {
    const result = await this.client.mutation(api.groups.createGroup, {
      name: req.name,
      initialMembers: req.initialMembers,
      sig: (req as any).sig, // Pass signed request if available
      auth: (req as any).auth ? {
        challengeId: (req as any).auth.challengeId ? ((req as any).auth.challengeId as any) : undefined,
        sigs: (req as any).auth.sigs,
        ksn: (req as any).auth.ksn,
      } : undefined,
    });

    return { groupId: result.groupId };
  }

  async addMembers(req: AddMembersRequest): Promise<void> {
    await this.client.mutation(api.groups.addMembers, {
      groupId: req.groupId as any,
      members: req.members,
      sig: (req as any).sig, // Pass signed request if available
      auth: (req as any).auth ? {
        challengeId: (req as any).auth.challengeId ? ((req as any).auth.challengeId as any) : undefined,
        sigs: (req as any).auth.sigs,
        ksn: (req as any).auth.ksn,
      } : undefined,
    });
  }

  async removeMembers(req: RemoveMembersRequest): Promise<void> {
    await this.client.mutation(api.groups.removeMembers, {
      groupId: req.groupId as any,
      members: req.members,
      sig: (req as any).sig, // Pass signed request if available
      auth: (req as any).auth ? {
        challengeId: (req as any).auth.challengeId ? ((req as any).auth.challengeId as any) : undefined,
        sigs: (req as any).auth.sigs,
        ksn: (req as any).auth.ksn,
      } : undefined,
    });
  }

  async sendGroupMessage(req: GroupSendRequest): Promise<{ messageId: string }> {
    const result = await this.client.mutation(api.groups.sendGroupMessage, {
      groupId: req.groupId as any,
      ct: req.ct,
      typ: req.typ,
      ttl: req.ttlMs,
      auth: {
        challengeId: req.auth.challengeId ? (req.auth.challengeId as any) : undefined,
        sigs: req.auth.sigs,
        ksn: req.auth.ksn,
      },
    });

    return { messageId: result.messageId };
  }

  async listGroups(req: ListGroupsRequest): Promise<Group[]> {
    const groups = await this.client.query(api.groups.listGroups, {
      aid: req.for,
    });

    return groups.map((g: any) => ({
      id: g.id,
      name: g.name,
      createdBy: g.createdBy,
      createdAt: g.createdAt,
      members: g.members,
    }));
  }

  async getGroup(req: GetGroupRequest): Promise<Group> {
    // Resolve caller AID from challengeId (read-only, no verification here)
    let aid: string;
    if (req.auth.challengeId) {
      const result = await this.client.query(api.auth.getAidForChallenge as any, {
        challengeId: req.auth.challengeId as any,
      });
      aid = result.aid;
    } else {
      // For signed requests, derive AID from signature verification
      throw new Error("getGroup with signed requests not yet implemented");
    }

    const group = await this.client.query(api.groups.getGroup, {
      groupId: req.groupId as any,
      callerAid: aid,
    });

    return group as Group;
  }

  async leaveGroup(req: LeaveGroupRequest): Promise<void> {
    // leaveGroup is implemented by calling removeMembers with the caller's own AID
    // The backend will verify the signature and extract the caller's AID
    await this.client.mutation(api.groups.removeMembers, {
      groupId: req.groupId as any,
      members: [], // Empty array - backend will infer caller from sig and remove them
      sig: (req as any).sig, // Pass signed request
    });
  }
}
