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
      auth: {
        challengeId: req.auth.challengeId as any,
        sigs: req.auth.sigs,
        ksn: req.auth.ksn,
      },
    });

    return { groupId: result.groupId };
  }

  async addMembers(req: AddMembersRequest): Promise<void> {
    await this.client.mutation(api.groups.addMembers, {
      groupId: req.groupId as any,
      members: req.members,
      auth: {
        challengeId: req.auth.challengeId as any,
        sigs: req.auth.sigs,
        ksn: req.auth.ksn,
      },
    });
  }

  async removeMembers(req: RemoveMembersRequest): Promise<void> {
    await this.client.mutation(api.groups.removeMembers, {
      groupId: req.groupId as any,
      members: req.members,
      auth: {
        challengeId: req.auth.challengeId as any,
        sigs: req.auth.sigs,
        ksn: req.auth.ksn,
      },
    });
  }

  async sendGroupMessage(req: GroupSendRequest): Promise<{ messageId: string }> {
    const result = await this.client.mutation(api.groups.sendGroupMessage, {
      groupId: req.groupId as any,
      ct: req.ct,
      typ: req.typ,
      ttl: req.ttlMs,
      auth: {
        challengeId: req.auth.challengeId as any,
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
    const { aid } = await this.client.query(api.auth.getAidForChallenge as any, {
      challengeId: req.auth.challengeId as any,
    });

    const group = await this.client.query(api.groups.getGroup, {
      groupId: req.groupId as any,
      callerAid: aid,
    });

    return group as Group;
  }

  async leaveGroup(req: LeaveGroupRequest): Promise<void> {
    await this.client.mutation(api.groups.leaveGroup, {
      groupId: req.groupId as any,
      auth: {
        challengeId: req.auth.challengeId as any,
        sigs: req.auth.sigs,
        ksn: req.auth.ksn,
      },
    });
  }
}
