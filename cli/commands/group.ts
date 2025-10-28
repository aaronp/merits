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

  const format = opts.format || ctx.config.outputFormat;

  if (format === "json") {
    console.log(JSON.stringify(groups, null, 2));
  } else if (format === "compact") {
    for (const group of groups) {
      // Find user's role in this group
      const userMember = group.members.find((m) => m.aid === identity.aid);
      const role = userMember?.role || "member";
      console.log(`${group.id}\t${group.name}\t${role}`);
    }
  } else {
    // text format (default)
    if (groups.length === 0) {
      console.log(chalk.gray("No groups found."));
      return;
    }

    console.log(chalk.cyan(`\n📋 Groups for ${identityName}:\n`));

    for (const group of groups) {
      // Find user's role in this group
      const userMember = group.members.find((m) => m.aid === identity.aid);
      const role = userMember?.role || "member";
      const roleIcon = role === "owner" ? "👑" : role === "admin" ? "⚙️" : "👤";

      console.log(`${roleIcon} ${chalk.bold(group.name)} (${role})`);
      console.log(`   ID: ${group.id}`);
      console.log(`   Members: ${group.members.length}`);
      console.log();
    }
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

  const format = opts.format || ctx.config.outputFormat;

  if (format === "json") {
    console.log(JSON.stringify(group, null, 2));
  } else {
    console.log(chalk.cyan(`\n📋 Group Information:\n`));
    console.log(`   Name: ${chalk.bold(group.name)}`);
    console.log(`   ID: ${group.id}`);
    console.log(`   Created by: ${group.createdBy}`);
    console.log(`   Created: ${new Date(group.createdAt).toLocaleString()}`);
    console.log();

    if (group.members && group.members.length > 0) {
      console.log(chalk.cyan("   Members:"));
      for (const member of group.members) {
        const roleIcon = member.role === "owner" ? "👑" : member.role === "admin" ? "⚙️" : "👤";
        console.log(`   ${roleIcon} ${member.aid} (${member.role})`);
      }
    }
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
