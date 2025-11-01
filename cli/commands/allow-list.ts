/**
 * Allow-List Management Commands (Phase 6)
 *
 * Commands for managing user allow-lists (whitelists):
 * - allow-list add: Add AID to allow-list
 * - allow-list remove: Remove AID from allow-list
 * - allow-list list: List all AIDs on allow-list
 * - allow-list clear: Clear entire allow-list
 *
 * When a user's allow-list is active (non-empty), only AIDs on the list can send messages.
 * Deny-list always takes priority over allow-list.
 */

import type { CLIContext } from "../lib/context";
import { getAuthProof } from "../lib/getAuthProof";
import { normalizeFormat } from "../lib/options";
import { requireSessionToken } from "../lib/session";

interface AllowListAddOptions {
  from?: string;
  note?: string;
  token?: string;
  format?: string;
  noBanner?: boolean;
  _ctx: CLIContext;
}

interface AllowListRemoveOptions {
  from?: string;
  token?: string;
  format?: string;
  noBanner?: boolean;
  _ctx: CLIContext;
}

interface AllowListListOptions {
  from?: string;
  token?: string;
  format?: string;
  noBanner?: boolean;
  _ctx: CLIContext;
}

interface AllowListClearOptions {
  from?: string;
  token?: string;
  format?: string;
  noBanner?: boolean;
  _ctx: CLIContext;
}

/**
 * Add an AID to the allow-list
 *
 * Once added, the allow-list becomes active and implements default-deny.
 */
export async function allowListAdd(
  allowedAid: string,
  opts: AllowListAddOptions
): Promise<void> {
  const ctx = opts._ctx;
  const format = normalizeFormat(opts.format || ctx.config.outputFormat);

  // Load session token
  const session = requireSessionToken(opts.token);
  const identityName = session.identityName || ctx.config.defaultIdentity;

  if (!identityName) {
    throw new Error("No identity specified. Use --from or set a default identity.");
  }

  // Get auth proof
  const auth = await getAuthProof({
    client: ctx.client,
    vault: ctx.vault,
    identityName,
    purpose: "addToAllowList",
    args: {
      allowedAid,
    },
  });

  // Call backend API
  const result = await ctx.client.mutation(ctx.api.allowList.add, {
    allowedAid,
    note: opts.note,
    auth,
  });

  // Output result
  const output = {
    action: "added",
    aid: allowedAid,
    alreadyExists: result.alreadyExists ?? false,
    note: opts.note,
  };

  switch (format) {
    case "json":
      console.log(canonicalizeJSON(output));
      break;
    case "pretty":
      console.log(JSON.stringify(output, null, 2));
      if (!opts.noBanner) {
        if (result.alreadyExists) {
          console.error(`\n⚠ AID was already in allow-list`);
        } else {
          console.error(`\n✅ Added to allow-list`);
          console.error(`   Allow-list is now ACTIVE (default-deny mode)`);
        }
      }
      break;
    case "raw":
      console.log(JSON.stringify(output));
      break;
  }
}

/**
 * Remove an AID from the allow-list
 */
export async function allowListRemove(
  allowedAid: string,
  opts: AllowListRemoveOptions
): Promise<void> {
  const ctx = opts._ctx;
  const format = normalizeFormat(opts.format || ctx.config.outputFormat);

  // Load session token
  const session = requireSessionToken(opts.token);
  const identityName = session.identityName || ctx.config.defaultIdentity;

  if (!identityName) {
    throw new Error("No identity specified. Use --from or set a default identity.");
  }

  // Get auth proof
  const auth = await getAuthProof({
    client: ctx.client,
    vault: ctx.vault,
    identityName,
    purpose: "removeFromAllowList",
    args: {
      allowedAid,
    },
  });

  // Call backend API
  const result = await ctx.client.mutation(ctx.api.allowList.remove, {
    allowedAid,
    auth,
  });

  // Output result
  const output = {
    action: "removed",
    aid: allowedAid,
    removed: result.removed,
  };

  switch (format) {
    case "json":
      console.log(canonicalizeJSON(output));
      break;
    case "pretty":
      console.log(JSON.stringify(output, null, 2));
      if (!opts.noBanner) {
        console.error(`\n✅ Removed from allow-list`);
      }
      break;
    case "raw":
      console.log(JSON.stringify(output));
      break;
  }
}

/**
 * List all AIDs on the allow-list
 */
export async function allowListList(opts: AllowListListOptions): Promise<void> {
  const ctx = opts._ctx;
  const format = normalizeFormat(opts.format || ctx.config.outputFormat);

  // Load session token
  const session = requireSessionToken(opts.token);

  // Call backend API
  const result = await ctx.client.query(ctx.api.allowList.list, {
    ownerAid: session.aid,
  });

  // Output result
  const output = {
    allowList: result.allowList,
    isActive: result.isActive,
    count: result.allowList.length,
  };

  switch (format) {
    case "json":
      console.log(canonicalizeJSON(output));
      break;
    case "pretty":
      console.log(JSON.stringify(output, null, 2));
      if (!opts.noBanner) {
        if (result.isActive) {
          console.error(`\n📋 Allow-list: ACTIVE (default-deny mode)`);
          console.error(`   ${result.allowList.length} AIDs allowed`);
        } else {
          console.error(`\n📋 Allow-list: INACTIVE (allow-all mode)`);
        }
      }
      break;
    case "raw":
      console.log(JSON.stringify(output));
      break;
  }
}

/**
 * Clear all AIDs from the allow-list (deactivate allow-list mode)
 */
export async function allowListClear(opts: AllowListClearOptions): Promise<void> {
  const ctx = opts._ctx;
  const format = normalizeFormat(opts.format || ctx.config.outputFormat);

  // Load session token
  const session = requireSessionToken(opts.token);
  const identityName = session.identityName || ctx.config.defaultIdentity;

  if (!identityName) {
    throw new Error("No identity specified. Use --from or set a default identity.");
  }

  // Get auth proof
  const auth = await getAuthProof({
    client: ctx.client,
    vault: ctx.vault,
    identityName,
    purpose: "clearAllowList",
    args: {},
  });

  // Call backend API
  const result = await ctx.client.mutation(ctx.api.allowList.clear, {
    auth,
  });

  // Output result
  const output = {
    action: "cleared",
    removed: result.removed,
  };

  switch (format) {
    case "json":
      console.log(canonicalizeJSON(output));
      break;
    case "pretty":
      console.log(JSON.stringify(output, null, 2));
      if (!opts.noBanner) {
        console.error(`\n✅ Allow-list cleared`);
        console.error(`   Removed ${result.removed} entries`);
        console.error(`   Allow-list is now INACTIVE (allow-all mode)`);
      }
      break;
    case "raw":
      console.log(JSON.stringify(output));
      break;
  }
}

/**
 * Canonicalize JSON according to RFC8785
 */
function canonicalizeJSON(obj: any): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalizeJSON).join(",")}]`;
  }

  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map((key) => {
    return `${JSON.stringify(key)}:${canonicalizeJSON(obj[key])}`;
  });

  return `{${entries.join(",")}}`;
}
