/**
 * ConvexGroupChatApi: Adapter for the new linear message history group chat system
 */

import type { ConvexClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { AuthProof } from '../../core/types';

export interface GroupChatRequest {
  name: string;
  ownerAid: string;
  membershipSaid: string;
  maxTtl?: number;
  initialMembers: string[];
  auth: AuthProof;
}

export interface SendMessageRequest {
  groupChatId: Id<'groupChats'>;
  encryptedMessage: string;
  messageType: string;
  auth: AuthProof;
}

export interface GetMessagesRequest {
  groupChatId: Id<'groupChats'>;
  afterSeqNo?: number;
  limit?: number;
  callerAid: string;
}

export interface UpdateSyncRequest {
  groupChatId: Id<'groupChats'>;
  latestSeqNo: number;
  auth: AuthProof;
}

export interface GroupMessage {
  id: Id<'groupMessages'>;
  encryptedMessage: string;
  messageType: string;
  senderAid: string;
  seqNo: number;
  received: number;
}

export interface GroupChat {
  id: Id<'groupChats'>;
  ownerAid: string;
  membershipSaid: string;
  name: string;
  maxTtl: number;
  createdAt: number;
  createdBy: string;
  members: Array<{
    aid: string;
    role: string;
    joinedAt: number;
    latestSeqNo: number;
  }>;
  callerSync: number;
}

export interface GroupChatSummary {
  id: Id<'groupChats'>;
  name: string;
  ownerAid: string;
  membershipSaid: string;
  role: string;
  joinedAt: number;
  latestSeqNo: number;
  messageCount: number;
  unreadCount: number;
}

export class ConvexGroupChatApi {
  constructor(private client: ConvexClient) {}

  async createGroupChat(req: GroupChatRequest): Promise<{ groupChatId: Id<'groupChats'> }> {
    const result = await this.client.mutation(api.groups.createGroupChat, {
      name: req.name,
      ownerAid: req.ownerAid,
      membershipSaid: req.membershipSaid,
      maxTtl: req.maxTtl,
      initialMembers: req.initialMembers,
      auth: {
        challengeId: req.auth.challengeId ? (req.auth.challengeId as any) : undefined,
        sigs: req.auth.sigs,
        ksn: req.auth.ksn,
      },
    });

    return { groupChatId: result.groupChatId };
  }

  async sendMessage(req: SendMessageRequest): Promise<{ messageId: Id<'groupMessages'>; seqNo: number }> {
    const result = await this.client.mutation(api.groups.sendGroupMessage, {
      groupChatId: req.groupChatId,
      encryptedMessage: req.encryptedMessage,
      messageType: req.messageType,
      auth: {
        challengeId: req.auth.challengeId ? (req.auth.challengeId as any) : undefined,
        sigs: req.auth.sigs,
        ksn: req.auth.ksn,
      },
    });

    return result;
  }

  async getMessages(req: GetMessagesRequest): Promise<GroupMessage[]> {
    const messages = await this.client.query(api.groups.getGroupMessages, {
      groupChatId: req.groupChatId,
      afterSeqNo: req.afterSeqNo,
      limit: req.limit,
      callerAid: req.callerAid,
    });

    return messages as GroupMessage[];
  }

  async updateSync(req: UpdateSyncRequest): Promise<void> {
    await this.client.mutation(api.groups.updateMemberSync, {
      groupChatId: req.groupChatId,
      latestSeqNo: req.latestSeqNo,
      auth: {
        challengeId: req.auth.challengeId as any,
        sigs: req.auth.sigs,
        ksn: req.auth.ksn,
      },
    });
  }

  async getGroupChat(groupChatId: Id<'groupChats'>, callerAid: string): Promise<GroupChat> {
    const groupChat = await this.client.query(api.groups.getGroupChat, {
      groupChatId,
      callerAid,
    });

    return groupChat as GroupChat;
  }

  async listGroupChats(aid: string): Promise<GroupChatSummary[]> {
    const groups = await this.client.query(api.groups.listGroupChats, {
      aid,
    });

    return groups as GroupChatSummary[];
  }

  async addMembers(groupChatId: Id<'groupChats'>, members: string[], auth: AuthProof): Promise<void> {
    await this.client.mutation(api.groups.addGroupMembers, {
      groupChatId,
      members,
      auth: {
        challengeId: auth.challengeId ? (auth.challengeId as any) : undefined,
        sigs: auth.sigs,
        ksn: auth.ksn,
      },
    });
  }

  async removeMembers(groupChatId: Id<'groupChats'>, members: string[], auth: AuthProof): Promise<void> {
    await this.client.mutation(api.groups.removeGroupMembers, {
      groupChatId,
      members,
      auth: {
        challengeId: auth.challengeId ? (auth.challengeId as any) : undefined,
        sigs: auth.sigs,
        ksn: auth.ksn,
      },
    });
  }

  async updateMembershipSaid(groupChatId: Id<'groupChats'>, membershipSaid: string, auth: AuthProof): Promise<void> {
    await this.client.mutation(api.groups.updateMembershipSaid, {
      groupChatId,
      membershipSaid,
      auth: {
        challengeId: auth.challengeId ? (auth.challengeId as any) : undefined,
        sigs: auth.sigs,
        ksn: auth.ksn,
      },
    });
  }
}
