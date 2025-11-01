/**
 * Access Control Helpers
 *
 * Provides helper functions for checking message permissions based on allow/deny lists.
 * These functions are used to enforce access control when sending and retrieving messages.
 *
 * Priority Rules:
 * 1. If sender is on deny-list → BLOCK (deny always wins)
 * 2. If allow-list is active (non-empty) → check if sender is on allow-list
 *    - If on allow-list → ALLOW
 *    - If not on allow-list → BLOCK
 * 3. If allow-list is inactive (empty) → ALLOW (default: allow all)
 *
 * @see allowList.ts for allow-list management
 * @see denyList.ts for deny-list management
 */

import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * Check if a sender is allowed to message a recipient
 *
 * Implements the priority rules for allow/deny lists:
 * 1. Deny-list takes priority (deny wins)
 * 2. Allow-list checked if active (non-empty)
 * 3. Default to allow if no lists active
 *
 * This function performs 1-3 database queries depending on the state:
 * - Always checks deny-list (1 query)
 * - Checks allow-list existence if deny not found (1 query)
 * - Checks allow-list membership if list is active (1 query)
 *
 * @param ctx - Mutation or query context
 * @param senderAid - AID of the sender attempting to send message
 * @param recipientAid - AID of the recipient who owns the allow/deny lists
 *
 * @returns {
 *   allowed: boolean - Whether sender can message recipient
 *   reason?: string - Explanation if blocked
 * }
 *
 * @example
 * // Check if Alice can message Bob
 * const access = await canMessage(ctx, "alice-aid", "bob-aid");
 * if (!access.allowed) {
 *   throw new Error(`Cannot send message: ${access.reason}`);
 * }
 */
export async function canMessage(
  ctx: MutationCtx | QueryCtx,
  senderAid: string,
  recipientAid: string
): Promise<{ allowed: boolean; reason?: string }> {
  // 1. Check deny-list first (highest priority)
  const denied = await ctx.db
    .query("denyList")
    .withIndex("by_owner_denied", (q) =>
      q.eq("ownerAid", recipientAid).eq("deniedAid", senderAid)
    )
    .first();

  if (denied) {
    return { allowed: false, reason: "Sender is on deny-list" };
  }

  // 2. Check if allow-list is active (has any entries)
  const allowListEntry = await ctx.db
    .query("allowList")
    .withIndex("by_owner", (q) => q.eq("ownerAid", recipientAid))
    .first(); // Just check if any exist

  if (!allowListEntry) {
    // Allow-list inactive, default to allow
    return { allowed: true };
  }

  // 3. Allow-list active, check if sender is on it
  const allowed = await ctx.db
    .query("allowList")
    .withIndex("by_owner_allowed", (q) =>
      q.eq("ownerAid", recipientAid).eq("allowedAid", senderAid)
    )
    .first();

  if (allowed) {
    return { allowed: true };
  }

  return { allowed: false, reason: "Sender not on allow-list" };
}

/**
 * Batch check access for multiple senders
 *
 * Optimized version that checks access for multiple senders at once.
 * Useful when filtering messages from multiple senders.
 *
 * @param ctx - Database context (read-only)
 * @param senderAids - Array of sender AIDs to check
 * @param recipientAid - AID of the recipient who owns the allow/deny lists
 *
 * @returns Map<senderAid, { allowed: boolean, reason?: string }>
 *
 * @example
 * // Check access for multiple senders
 * const senders = ["alice-aid", "bob-aid", "carol-aid"];
 * const accessMap = await canMessageBatch(ctx, senders, "dave-aid");
 * // Result: Map {
 * //   "alice-aid" => { allowed: true },
 * //   "bob-aid" => { allowed: false, reason: "Sender is on deny-list" },
 * //   "carol-aid" => { allowed: true }
 * // }
 */
export async function canMessageBatch(
  ctx: MutationCtx | QueryCtx,
  senderAids: string[],
  recipientAid: string
): Promise<Map<string, { allowed: boolean; reason?: string }>> {
  const results = new Map<string, { allowed: boolean; reason?: string }>();

  // Get all deny-list entries for recipient
  const denyEntries = await ctx.db
    .query("denyList")
    .withIndex("by_owner", (q) => q.eq("ownerAid", recipientAid))
    .collect();

  const deniedAids = new Set(denyEntries.map((e) => e.deniedAid));

  // Get all allow-list entries for recipient
  const allowEntries = await ctx.db
    .query("allowList")
    .withIndex("by_owner", (q) => q.eq("ownerAid", recipientAid))
    .collect();

  const allowedAids = new Set(allowEntries.map((e) => e.allowedAid));
  const allowListActive = allowEntries.length > 0;

  // Check each sender
  for (const senderAid of senderAids) {
    // Check deny-list first
    if (deniedAids.has(senderAid)) {
      results.set(senderAid, { allowed: false, reason: "Sender is on deny-list" });
      continue;
    }

    // If allow-list is inactive, allow all
    if (!allowListActive) {
      results.set(senderAid, { allowed: true });
      continue;
    }

    // Allow-list is active, check membership
    if (allowedAids.has(senderAid)) {
      results.set(senderAid, { allowed: true });
    } else {
      results.set(senderAid, { allowed: false, reason: "Sender not on allow-list" });
    }
  }

  return results;
}
