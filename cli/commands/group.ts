/**
 * Group Management Commands (Phase 4)
 *
 * Commands for creating and managing groups:
 * - group create: Create new group
 * - group list: List all groups
 * - group info: Show group details
 * - group add: Add member to group
 * - group remove: Remove member from group
 * - group leave: Leave a group
 */

import chalk from "chalk";
import type { CLIContext } from "../lib/context";
import { getAuthProof } from "../lib/getAuthProof";
import { normalizeFormat } from "../lib/options";

interface GroupCreateOptions {
  from?: string;
  description?: string;
  _ctx: CLIContext;
}

interface GroupListOptions {
  from?: string;
  format?: string;
  _ctx: CLIContext;
}

interface GroupInfoOptions {
  from?: string;
  format?: string;
  _ctx: CLIContext;
}

interface GroupAddOptions {
  from?: string;
  role?: string;
  _ctx: CLIContext;
}

interface GroupRemoveOptions {
  from?: string;
  _ctx: CLIContext;
}

interface GroupLeaveOptions {
  from?: string;
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
  const identityName = opts.from || ctx.config.defaultIdentity;

  if (!identityName) {
    throw new Error("No identity specified. Use --from or set a default identity.");
  }

  // Get identity for AID
  const identity = await ctx.vault.getIdentity(identityName);

  // Get auth proof for creating group
  const auth = await getAuthProof({
    client: ctx.client,
    vault: ctx.vault,
    identityName,
    purpose: "manageGroup",
    args: {
      action: "createGroup",
      name: groupName,
    },
  });

  // Create group via GroupApi
  const result = await ctx.client.group.createGroup({
    name: groupName,
    initialMembers: [], // Start with just the owner
    auth,
  });

  const isJsonMode = ctx.config.outputFormat === "json";

  if (isJsonMode) {
    console.log(JSON.stringify({ groupId: result.groupId, name: groupName }, null, 2));
  } else {
    console.log(chalk.green("✅ Group created successfully!"));
    console.log(chalk.cyan(`\n📋 Group Details:`));
    console.log(`   ID: ${chalk.bold(result.groupId)}`);
    console.log(`   Name: ${chalk.bold(groupName)}`);
    console.log(`   Owner: ${identity.aid}`);
    console.log(`   Members: 1 (owner)`);
  }
}

/**
 * List all groups for an identity
 */
export async function listGroups(opts: GroupListOptions): Promise<void> {
  const ctx = opts._ctx;
  const identityName = opts.from || ctx.config.defaultIdentity;

  if (!identityName) {
    throw new Error("No identity specified. Use --from or set a default identity.");
  }

  const identity = await ctx.vault.getIdentity(identityName);

  // Get auth proof for listing groups
  const auth = await getAuthProof({
    client: ctx.client,
    vault: ctx.vault,
    identityName,
    purpose: "manageGroup",
    args: { action: "listGroups" },
  });

  // List groups via GroupApi
  const groups = await ctx.client.group.listGroups({
    for: identity.aid,
    auth,
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
  const identityName = opts.from || ctx.config.defaultIdentity;

  if (!identityName) {
    throw new Error("No identity specified. Use --from or set a default identity.");
  }

  // Get auth proof
  const auth = await getAuthProof({
    client: ctx.client,
    vault: ctx.vault,
    identityName,
    purpose: "manageGroup",
    args: { action: "info", groupId },
  });

  // Get group info
  const group = await ctx.client.group.getGroup({
    groupId,
    auth,
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
  const identityName = opts.from || ctx.config.defaultIdentity;

  if (!identityName) {
    throw new Error("No identity specified. Use --from or set a default identity.");
  }

  // Get auth proof
  const auth = await getAuthProof({
    client: ctx.client,
    vault: ctx.vault,
    identityName,
    purpose: "manageGroup",
    args: {
      action: "addMembers",
      groupId,
      members: [memberAid],
    },
  });

  // Add member (always added as "member" role - backend limitation)
  await ctx.client.group.addMembers({
    groupId,
    members: [memberAid],
    auth,
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
  const identityName = opts.from || ctx.config.defaultIdentity;

  if (!identityName) {
    throw new Error("No identity specified. Use --from or set a default identity.");
  }

  // Get auth proof
  const auth = await getAuthProof({
    client: ctx.client,
    vault: ctx.vault,
    identityName,
    purpose: "manageGroup",
    args: {
      action: "removeMembers",
      groupId,
      members: [memberAid],
    },
  });

  // Remove member
  await ctx.client.group.removeMembers({
    groupId,
    members: [memberAid],
    auth,
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
  const identityName = opts.from || ctx.config.defaultIdentity;

  if (!identityName) {
    throw new Error("No identity specified. Use --from or set a default identity.");
  }

  const identity = await ctx.vault.getIdentity(identityName);

  // Get auth proof
  const auth = await getAuthProof({
    client: ctx.client,
    vault: ctx.vault,
    identityName,
    purpose: "manageGroup",
    args: {
      action: "leaveGroup",
      groupId,
    },
  });

  // Leave group
  await ctx.client.group.leaveGroup({
    groupId,
    auth,
  });

  const isJsonMode = ctx.config.outputFormat === "json";

  if (isJsonMode) {
    console.log(JSON.stringify({ success: true, groupId, aid: identity.aid }, null, 2));
  } else {
    console.log(chalk.green(`✅ Left group ${groupId}`));
  }
}
