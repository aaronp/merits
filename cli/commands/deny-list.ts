/**
 * Deny-List Management Commands (Phase 6)
 *
 * Commands for managing user deny-lists (blocklists):
 * - deny-list add: Add AID to deny-list (block someone)
 * - deny-list remove: Remove AID from deny-list (unblock someone)
 * - deny-list list: List all AIDs on deny-list
 * - deny-list clear: Clear entire deny-list
 *
 * Deny-list always takes priority over allow-list. If an AID is on both lists, they are blocked.
 */

import type { CLIContext } from "../lib/context";
import { getAuthProof } from "../lib/getAuthProof";
import { normalizeFormat } from "../lib/options";
import { requireSessionToken } from "../lib/session";

interface DenyListAddOptions {
  from?: string;
  reason?: string;
  token?: string;
  format?: string;
  noBanner?: boolean;
  _ctx: CLIContext;
}

interface DenyListRemoveOptions {
  from?: string;
  token?: string;
  format?: string;
  noBanner?: boolean;
  _ctx: CLIContext;
}

interface DenyListListOptions {
  from?: string;
  token?: string;
  format?: string;
  noBanner?: boolean;
  _ctx: CLIContext;
}

interface DenyListClearOptions {
  from?: string;
  token?: string;
  format?: string;
  noBanner?: boolean;
  _ctx: CLIContext;
}

/**
 * Add an AID to the deny-list (block someone)
 */
export async function denyListAdd(
  deniedAid: string,
  opts: DenyListAddOptions
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
    purpose: "addToDenyList",
    args: {
      deniedAid,
    },
  });

  // Call backend API
  const result = await ctx.client.mutation(ctx.api.denyList.add, {
    deniedAid,
    reason: opts.reason,
    auth,
  });

  // Output result
  const output = {
    action: "blocked",
    aid: deniedAid,
    alreadyExists: result.alreadyExists ?? false,
    reason: opts.reason,
  };

  switch (format) {
    case "json":
      console.log(canonicalizeJSON(output));
      break;
    case "pretty":
      console.log(JSON.stringify(output, null, 2));
      if (!opts.noBanner) {
        if (result.alreadyExists) {
          console.error(`\n⚠ AID was already blocked`);
        } else {
          console.error(`\n✅ AID blocked successfully`);
          console.error(`   This sender can no longer message you`);
        }
      }
      break;
    case "raw":
      console.log(JSON.stringify(output));
      break;
  }
}

/**
 * Remove an AID from the deny-list (unblock someone)
 */
export async function denyListRemove(
  deniedAid: string,
  opts: DenyListRemoveOptions
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
    purpose: "removeFromDenyList",
    args: {
      deniedAid,
    },
  });

  // Call backend API
  const result = await ctx.client.mutation(ctx.api.denyList.remove, {
    deniedAid,
    auth,
  });

  // Output result
  const output = {
    action: "unblocked",
    aid: deniedAid,
    removed: result.removed,
  };

  switch (format) {
    case "json":
      console.log(canonicalizeJSON(output));
      break;
    case "pretty":
      console.log(JSON.stringify(output, null, 2));
      if (!opts.noBanner) {
        console.error(`\n✅ AID unblocked successfully`);
        console.error(`   This sender can now message you`);
      }
      break;
    case "raw":
      console.log(JSON.stringify(output));
      break;
  }
}

/**
 * List all AIDs on the deny-list
 */
export async function denyListList(opts: DenyListListOptions): Promise<void> {
  const ctx = opts._ctx;
  const format = normalizeFormat(opts.format || ctx.config.outputFormat);

  // Load session token
  const session = requireSessionToken(opts.token);

  // Call backend API
  const result = await ctx.client.query(ctx.api.denyList.list, {
    ownerAid: session.aid,
  });

  // Output result
  const output = {
    denyList: result.denyList,
    count: result.denyList.length,
  };

  switch (format) {
    case "json":
      console.log(canonicalizeJSON(output));
      break;
    case "pretty":
      console.log(JSON.stringify(output, null, 2));
      if (!opts.noBanner) {
        console.error(`\n🚫 Deny-list: ${result.denyList.length} blocked AIDs`);
      }
      break;
    case "raw":
      console.log(JSON.stringify(output));
      break;
  }
}

/**
 * Clear all AIDs from the deny-list (unblock everyone)
 */
export async function denyListClear(opts: DenyListClearOptions): Promise<void> {
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
    purpose: "clearDenyList",
    args: {},
  });

  // Call backend API
  const result = await ctx.client.mutation(ctx.api.denyList.clear, {
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
        console.error(`\n✅ Deny-list cleared`);
        console.error(`   Unblocked ${result.removed} AIDs`);
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
