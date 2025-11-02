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
import { requireSessionToken } from "../lib/session";
import { normalizeFormat } from "../lib/options";

interface GroupCreateOptions {
  token?: string;
  description?: string;
  _ctx: CLIContext;
}

interface GroupListOptions {
  token?: string;
  format?: string;
  _ctx: CLIContext;
}

interface GroupInfoOptions {
  token?: string;
  format?: string;
  _ctx: CLIContext;
}

interface GroupAddOptions {
  token?: string;
  role?: string;
  _ctx: CLIContext;
}

interface GroupRemoveOptions {
  token?: string;
  _ctx: CLIContext;
}

interface GroupLeaveOptions {
  token?: string;
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
  const session = requireSessionToken(opts.token);

  // Create group via backend (backend handles authorization)
  const result = await ctx.client.group.createGroup({
    token: session.token,
    name: groupName,
    initialMembers: [], // Start with just the owner
  });

  const isJsonMode = ctx.config.outputFormat === "json";

  if (isJsonMode) {
    console.log(JSON.stringify({ groupId: result.groupId, name: groupName }, null, 2));
  } else {
    console.log(chalk.green("✅ Group created successfully!"));
    console.log(chalk.cyan(`\n📋 Group Details:`));
    console.log(`   ID: ${chalk.bold(result.groupId)}`);
    console.log(`   Name: ${chalk.bold(groupName)}`);
    console.log(`   Owner: ${session.aid}`);
    console.log(`   Members: 1 (owner)`);
  }
}

/**
 * List all groups for the authenticated user
 */
export async function listGroups(opts: GroupListOptions): Promise<void> {
  const ctx = opts._ctx;
  const session = requireSessionToken(opts.token);

  // List groups via backend
  const groups = await ctx.client.group.listGroups({
    token: session.token,
  });

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
  const session = requireSessionToken(opts.token);

  // Get group info from backend
  const group = await ctx.client.group.getGroup({
    token: session.token,
    groupId,
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
  const session = requireSessionToken(opts.token);

  // Add member via backend (backend handles authorization)
  await ctx.client.group.addMembers({
    token: session.token,
    groupId,
    members: [memberAid],
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
  const session = requireSessionToken(opts.token);

  // Remove member via backend (backend handles authorization)
  await ctx.client.group.removeMembers({
    token: session.token,
    groupId,
    members: [memberAid],
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
  const session = requireSessionToken(opts.token);

  // Leave group via backend
  await ctx.client.group.leaveGroup({
    token: session.token,
    groupId,
  });

  const isJsonMode = ctx.config.outputFormat === "json";

  if (isJsonMode) {
    console.log(JSON.stringify({ success: true, groupId, aid: session.aid }, null, 2));
  } else {
    console.log(chalk.green(`✅ Left group ${groupId}`));
  }
}
