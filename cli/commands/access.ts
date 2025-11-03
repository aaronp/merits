/**
 * Access Control Commands (Phase 6)
 *
 * Unified commands for managing message access control via allow/deny lists.
 *
 * Commands:
 * - access allow <aid>: Add AID to allow-list (whitelist)
 * - access deny <aid>: Add AID to deny-list (blocklist)
 * - access remove <aid> --allow|--deny: Remove from list
 * - access list --allow|--deny: Show list contents
 * - access clear --allow|--deny: Clear entire list
 *
 * Priority Rules:
 * 1. Deny-list always wins (even if on allow-list)
 * 2. Allow-list enables default-deny (only allowed can send)
 * 3. Empty lists = allow all (default)
 *
 * @see convex/allowList.ts for allow-list backend
 * @see convex/denyList.ts for deny-list backend
 * @see convex/accessControl.ts for filtering logic
 */

import type { CLIContext } from "../lib/context";
import { normalizeFormat } from "../lib/options";
import { requireCredentials } from "../lib/credentials";
import { signMutationArgs } from "../../core/signatures";
import { base64UrlToUint8Array } from "../../core/crypto";

interface AccessOptions {
  from?: string;
  note?: string;
  allow?: boolean;
  deny?: boolean;
  credentials?: string;
  format?: string;
  noBanner?: boolean;
  _ctx: CLIContext;
}

/**
 * Add AID to allow-list (enable for this sender)
 *
 * When allow-list is active (non-empty), only AIDs on the list can send messages.
 * This enables default-deny mode for privacy and spam protection.
 *
 * @param aid - AID to allow
 * @param opts - Command options
 */
export async function accessAllow(aid: string, opts: AccessOptions): Promise<void> {
  const ctx = opts._ctx;
  const format = normalizeFormat(opts.format || ctx.config.outputFormat);

  // Load credentials
  const creds = requireCredentials(opts.credentials);

  // Build and sign mutation args
  const args = {
    allowedAid: aid,
    note: opts.note,
  };
  const privateKeyBytes = base64UrlToUint8Array(creds.privateKey);
  const sig = await signMutationArgs(args, privateKeyBytes, creds.aid);

  // Call backend API (backend handles authorization via signature)
  const result = await ctx.client.mutation(ctx.api.allowList.add, {
    ...args,
    sig,
  });

  // Output result
  const output = {
    action: "allowed",
    aid,
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
          console.error(`\n⚠ AID was already on allow-list`);
        } else {
          console.error(`\n✅ Added to allow-list`);
          console.error(`   Allow-list is now ACTIVE (default-deny mode)`);
          console.error(`   Only AIDs on allow-list can send you messages`);
        }
      }
      break;
    case "raw":
      console.log(JSON.stringify(output));
      break;
  }
}

/**
 * Add AID to deny-list (block this sender)
 *
 * Deny-list takes priority over allow-list. Blocked AIDs cannot send messages
 * even if they're on the allow-list.
 *
 * @param aid - AID to block
 * @param opts - Command options
 */
export async function accessDeny(aid: string, opts: AccessOptions): Promise<void> {
  const ctx = opts._ctx;
  const format = normalizeFormat(opts.format || ctx.config.outputFormat);

  // Load credentials
  const creds = requireCredentials(opts.credentials);

  // Build and sign mutation args
  const args = {
    deniedAid: aid,
    reason: opts.note, // Using 'note' for both allow and deny
  };
  const privateKeyBytes = base64UrlToUint8Array(creds.privateKey);
  const sig = await signMutationArgs(args, privateKeyBytes, creds.aid);

  // Call backend API (backend handles authorization via signature)
  const result = await ctx.client.mutation(ctx.api.denyList.add, {
    ...args,
    sig,
  });

  // Output result
  const output = {
    action: "blocked",
    aid,
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
 * Remove AID from allow-list or deny-list
 *
 * @param aid - AID to remove
 * @param opts - Command options (must specify --allow or --deny)
 */
export async function accessRemove(aid: string, opts: AccessOptions): Promise<void> {
  const ctx = opts._ctx;
  const format = normalizeFormat(opts.format || ctx.config.outputFormat);

  // Validate flags
  if (!opts.allow && !opts.deny) {
    throw new Error("Must specify --allow or --deny");
  }
  if (opts.allow && opts.deny) {
    throw new Error("Cannot specify both --allow and --deny");
  }

  // Load credentials
  const creds = requireCredentials(opts.credentials);

  const isAllow = opts.allow;
  const listType = isAllow ? "allow-list" : "deny-list";

  // Build and sign mutation args
  const privateKeyBytes = base64UrlToUint8Array(creds.privateKey);

  // Call backend API (backend handles authorization via signature)
  let result;
  if (isAllow) {
    const args = { allowedAid: aid };
    const sig = await signMutationArgs(args, privateKeyBytes, creds.aid);
    result = await ctx.client.mutation(ctx.api.allowList.remove, { ...args, sig });
  } else {
    const args = { deniedAid: aid };
    const sig = await signMutationArgs(args, privateKeyBytes, creds.aid);
    result = await ctx.client.mutation(ctx.api.denyList.remove, { ...args, sig });
  }

  // Output result
  const output = {
    action: "removed",
    aid,
    list: listType,
    removed: result.removed,
  };

  switch (format) {
    case "json":
      console.log(canonicalizeJSON(output));
      break;
    case "pretty":
      console.log(JSON.stringify(output, null, 2));
      if (!opts.noBanner) {
        console.error(`\n✅ Removed from ${listType}`);
      }
      break;
    case "raw":
      console.log(JSON.stringify(output));
      break;
  }
}

/**
 * List AIDs on allow-list or deny-list
 *
 * @param opts - Command options (must specify --allow or --deny)
 */
export async function accessList(opts: AccessOptions): Promise<void> {
  const ctx = opts._ctx;
  const format = normalizeFormat(opts.format || ctx.config.outputFormat);

  // Validate flags
  if (!opts.allow && !opts.deny) {
    throw new Error("Must specify --allow or --deny");
  }
  if (opts.allow && opts.deny) {
    throw new Error("Cannot specify both --allow and --deny");
  }

  // Load credentials
  const creds = requireCredentials(opts.credentials);

  const isAllow = opts.allow;

  // Call backend API
  const result = isAllow
    ? await ctx.client.query(ctx.api.allowList.list, { ownerAid: creds.aid })
    : await ctx.client.query(ctx.api.denyList.list, { ownerAid: creds.aid });

  // Output result
  const output = isAllow
    ? {
        list: "allow",
        entries: result.allowList,
        isActive: result.isActive,
        count: result.allowList.length,
      }
    : {
        list: "deny",
        entries: result.denyList,
        count: result.denyList.length,
      };

  switch (format) {
    case "json":
      console.log(canonicalizeJSON(output));
      break;
    case "pretty":
      console.log(JSON.stringify(output, null, 2));
      if (!opts.noBanner) {
        if (isAllow) {
          if (result.isActive) {
            console.error(`\n📋 Allow-list: ACTIVE (default-deny mode)`);
            console.error(`   ${result.allowList.length} AIDs allowed`);
          } else {
            console.error(`\n📋 Allow-list: INACTIVE (allow-all mode)`);
          }
        } else {
          console.error(`\n🚫 Deny-list: ${result.denyList.length} blocked AIDs`);
        }
      }
      break;
    case "raw":
      console.log(JSON.stringify(output));
      break;
  }
}

/**
 * Clear all entries from allow-list or deny-list
 *
 * @param opts - Command options (must specify --allow or --deny)
 */
export async function accessClear(opts: AccessOptions): Promise<void> {
  const ctx = opts._ctx;
  const format = normalizeFormat(opts.format || ctx.config.outputFormat);

  // Validate flags
  if (!opts.allow && !opts.deny) {
    throw new Error("Must specify --allow or --deny");
  }
  if (opts.allow && opts.deny) {
    throw new Error("Cannot specify both --allow and --deny");
  }

  // Load credentials
  const creds = requireCredentials(opts.credentials);

  const isAllow = opts.allow;
  const listType = isAllow ? "allow-list" : "deny-list";

  // Build and sign mutation args
  const privateKeyBytes = base64UrlToUint8Array(creds.privateKey);

  // Call backend API (backend handles authorization via signature)
  let result;
  if (isAllow) {
    const args = {};
    const sig = await signMutationArgs(args, privateKeyBytes, creds.aid);
    result = await ctx.client.mutation(ctx.api.allowList.clear, { sig });
  } else {
    const args = {};
    const sig = await signMutationArgs(args, privateKeyBytes, creds.aid);
    result = await ctx.client.mutation(ctx.api.denyList.clear, { sig });
  }

  // Output result
  const output = {
    action: "cleared",
    list: listType,
    removed: result.removed,
  };

  switch (format) {
    case "json":
      console.log(canonicalizeJSON(output));
      break;
    case "pretty":
      console.log(JSON.stringify(output, null, 2));
      if (!opts.noBanner) {
        console.error(`\n✅ ${listType} cleared`);
        console.error(`   Removed ${result.removed} entries`);
        if (isAllow) {
          console.error(`   Allow-list is now INACTIVE (allow-all mode)`);
        }
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
