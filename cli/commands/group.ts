/**
 * Group Management Commands
 *
 * Simplified token-based group management. Backend handles all authorization.
 *
 * Commands:
 * - group create: Create new group
 * - group list: List all groups
 * - group info: Show group details
 * - group add: Add member to group
 * - group remove: Remove member from group
 * - group leave: Leave a group
 */

import chalk from "chalk";
import type { CLIContext } from "../lib/context";
import { requireCredentials } from "../lib/credentials";
import { normalizeFormat } from "../lib/options";
import { signMutationArgs } from "../../core/signatures";
import { base64UrlToUint8Array } from "../../core/crypto";

interface GroupCreateOptions {
  credentials?: string;
  description?: string;
  _ctx: CLIContext;
}

interface GroupListOptions {
  credentials?: string;
  format?: string;
  _ctx: CLIContext;
}

interface GroupInfoOptions {
  credentials?: string;
  format?: string;
  _ctx: CLIContext;
}

interface GroupAddOptions {
  credentials?: string;
  role?: string;
  _ctx: CLIContext;
}

interface GroupRemoveOptions {
  credentials?: string;
  _ctx: CLIContext;
}

interface GroupLeaveOptions {
  credentials?: string;
  _ctx: CLIContext;
}

/**
 * Create a new group
 */
export async function createGroup(
  groupName: string,
  opts: GroupCreateOptions
): Promise<void> {
  const ctx = opts._ctx;
  const creds = requireCredentials(opts.credentials);

  // Build and sign mutation args
  const args = {
    name: groupName,
    initialMembers: [], // Start with just the owner
  };
  const privateKeyBytes = base64UrlToUint8Array(creds.privateKey);
  const sig = await signMutationArgs(args, privateKeyBytes, creds.aid);

  // Create group via backend (backend handles authorization)
  const result = await ctx.client.group.createGroup({
    ...args,
    sig,
  });

  const isJsonMode = ctx.config.outputFormat === "json";

  if (isJsonMode) {
    console.log(JSON.stringify({ groupId: result.groupId, name: groupName }, null, 2));
  } else {
    console.log(chalk.green("✅ Group created successfully!"));
    console.log(chalk.cyan(`\n📋 Group Details:`));
    console.log(`   ID: ${chalk.bold(result.groupId)}`);
    console.log(`   Name: ${chalk.bold(groupName)}`);
    console.log(`   Owner: ${creds.aid}`);
    console.log(`   Members: 1 (owner)`);
  }
}

/**
 * List all groups for the authenticated user
 */
export async function listGroups(opts: GroupListOptions): Promise<void> {
  const ctx = opts._ctx;
  const creds = requireCredentials(opts.credentials);

  // Create group API client (handles all signing internally)
  const groupApi = (ctx.client as any).createGroupApi(creds);

  // Simple, high-level API call
  const groups = await groupApi.listGroups();

  const format = normalizeFormat(opts.format || ctx.config.outputFormat);

  if (format === "json") {
    // Canonicalized JSON (RFC8785)
    const sorted = groups.map(g => ({
      createdAt: g.createdAt,
      createdBy: g.createdBy,
      id: g.id,
      members: g.members,
      name: g.name,
    }));
    const canonical = JSON.stringify(sorted, Object.keys(sorted[0] || {}).sort());
    console.log(canonical);
  } else if (format === "pretty") {
    console.log(JSON.stringify(groups, null, 2));
  } else if (format === "raw") {
    console.log(JSON.stringify(groups));
  } else {
    // Fallback to pretty
    console.log(JSON.stringify(groups, null, 2));
  }
}

/**
 * Show detailed group information
 */
export async function groupInfo(
  groupId: string,
  opts: GroupInfoOptions
): Promise<void> {
  const ctx = opts._ctx;
  const creds = requireCredentials(opts.credentials);

  // Build and sign mutation args
  const args = {
    groupId,
  };
  const privateKeyBytes = base64UrlToUint8Array(creds.privateKey);
  const sig = await signMutationArgs(args, privateKeyBytes, creds.aid);

  // Get group info from backend
  const group = await ctx.client.group.getGroup({
    ...args,
    sig,
  });

  const format = normalizeFormat(opts.format || ctx.config.outputFormat);

  if (format === "json") {
    // Canonicalized JSON (RFC8785)
    const data = {
      createdAt: group.createdAt,
      createdBy: group.createdBy,
      id: group.id,
      members: group.members,
      name: group.name,
    };
    const canonical = JSON.stringify(data, Object.keys(data).sort());
    console.log(canonical);
  } else if (format === "pretty") {
    console.log(JSON.stringify(group, null, 2));
  } else if (format === "raw") {
    console.log(JSON.stringify(group));
  } else {
    // Fallback to pretty
    console.log(JSON.stringify(group, null, 2));
  }
}

/**
 * Add member to group
 */
export async function addGroupMember(
  groupId: string,
  memberAid: string,
  opts: GroupAddOptions
): Promise<void> {
  const ctx = opts._ctx;
  const creds = requireCredentials(opts.credentials);

  // Build and sign mutation args
  const args = {
    groupId,
    members: [memberAid],
  };
  const privateKeyBytes = base64UrlToUint8Array(creds.privateKey);
  const sig = await signMutationArgs(args, privateKeyBytes, creds.aid);

  // Add member via backend (backend handles authorization)
  await ctx.client.group.addMembers({
    ...args,
    sig,
  });

  const isJsonMode = ctx.config.outputFormat === "json";

  if (isJsonMode) {
    console.log(JSON.stringify({ success: true, groupId, memberAid, role: "member" }, null, 2));
  } else {
    console.log(chalk.green(`✅ Added ${memberAid} to group ${groupId}`));
    console.log(`   Role: member`);
  }
}

/**
 * Remove member from group
 */
export async function removeGroupMember(
  groupId: string,
  memberAid: string,
  opts: GroupRemoveOptions
): Promise<void> {
  const ctx = opts._ctx;
  const creds = requireCredentials(opts.credentials);

  // Build and sign mutation args
  const args = {
    groupId,
    members: [memberAid],
  };
  const privateKeyBytes = base64UrlToUint8Array(creds.privateKey);
  const sig = await signMutationArgs(args, privateKeyBytes, creds.aid);

  // Remove member via backend (backend handles authorization)
  await ctx.client.group.removeMembers({
    ...args,
    sig,
  });

  const isJsonMode = ctx.config.outputFormat === "json";

  if (isJsonMode) {
    console.log(JSON.stringify({ success: true, groupId, memberAid }, null, 2));
  } else {
    console.log(chalk.green(`✅ Removed ${memberAid} from group ${groupId}`));
  }
}

/**
 * Leave a group
 */
export async function leaveGroup(
  groupId: string,
  opts: GroupLeaveOptions
): Promise<void> {
  const ctx = opts._ctx;
  const creds = requireCredentials(opts.credentials);

  // Build and sign mutation args
  // Note: members=[] signals to backend to remove the caller (leave group)
  const args = {
    groupId,
    members: [],
  };
  const privateKeyBytes = base64UrlToUint8Array(creds.privateKey);
  const sig = await signMutationArgs(args, privateKeyBytes, creds.aid);

  // Leave group via backend
  await ctx.client.group.leaveGroup({
    ...args,
    sig,
  });

  const isJsonMode = ctx.config.outputFormat === "json";

  if (isJsonMode) {
    console.log(JSON.stringify({ success: true, groupId, aid: creds.aid }, null, 2));
  } else {
    console.log(chalk.green(`✅ Left group ${groupId}`));
  }
}
