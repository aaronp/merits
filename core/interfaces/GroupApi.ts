/**
 * GroupApi: Backend-agnostic interface for group messaging with server-side fanout
 *
 * Design principle: Server decrypts once, encrypts per member, maintains ordering.
 * This provides better performance and consistency than client-side fanout.
 */

import type { AID, AuthProof } from "../types";
import type { EncryptedMessage } from "./Transport";

/**
 * Group identifier (could be AID, UUID, or backend-specific ID)
 */
export type GroupId = string;

/**
 * Member role in a group
 */
export type MemberRole = "owner" | "admin" | "member";

/**
 * Group member information
 */
export interface GroupMember {
  aid: AID;
  role: MemberRole;
  joinedAt: number;
}

/**
 * Group metadata
 */
export interface Group {
  id: GroupId;
  name: string;
  members: GroupMember[];
  createdAt: number;
  createdBy: AID;
}

/**
 * Request to create a new group
 */
export interface CreateGroupRequest {
  name: string;
  initialMembers: AID[]; // AIDs to add as initial members
  auth: AuthProof;
}

/**
 * Request to add members to a group
 */
export interface AddMembersRequest {
  groupId: GroupId;
  members: AID[];
  auth: AuthProof;
}

/**
 * Request to remove members from a group
 */
export interface RemoveMembersRequest {
  groupId: GroupId;
  members: AID[];
  auth: AuthProof;
}

/**
 * Request to send a message to a group
 */
export interface GroupSendRequest {
  groupId: GroupId;
  ct: string; // Ciphertext encrypted to group key
  typ?: string; // Message type for routing
  ttlMs?: number;
  auth: AuthProof;
}

/**
 * Request to list groups for an AID
 */
export interface ListGroupsRequest {
  for: AID;
  auth: AuthProof;
}

/**
 * Request to get group details
 */
export interface GetGroupRequest {
  groupId: GroupId;
  auth: AuthProof;
}

/**
 * Request to leave a group
 */
export interface LeaveGroupRequest {
  groupId: GroupId;
  auth: AuthProof;
}

/**
 * GroupApi interface
 *
 * Provides group management and server-side fanout messaging.
 * The server decrypts the group message once, then re-encrypts for each member.
 */
export interface GroupApi {
  /**
   * Create a new group with initial members
   */
  createGroup(req: CreateGroupRequest): Promise<{ groupId: GroupId }>;

  /**
   * Add members to a group (requires admin/owner role)
   */
  addMembers(req: AddMembersRequest): Promise<void>;

  /**
   * Remove members from a group (requires admin/owner role)
   */
  removeMembers(req: RemoveMembersRequest): Promise<void>;

  /**
   * Send a message to all group members
   *
   * Server-side flow:
   * 1. Verify sender is group member
   * 2. Decrypt ct using group key
   * 3. Re-encrypt plaintext for each member
   * 4. Store individual encrypted messages
   * 5. Append to group ordering log
   */
  sendGroupMessage(req: GroupSendRequest): Promise<{ messageId: string }>;

  /**
   * List all groups for an AID
   */
  listGroups(req: ListGroupsRequest): Promise<Group[]>;

  /**
   * Get group details (requires membership)
   */
  getGroup(req: GetGroupRequest): Promise<Group>;

  /**
   * Leave a group (members can leave, owners transfer first)
   */
  leaveGroup(req: LeaveGroupRequest): Promise<void>;
}
