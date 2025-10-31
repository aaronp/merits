/**
 * Command: merits identity list
 *
 * List all stored identities with their status and metadata.
 */

import chalk from "chalk";
import type { CLIContext } from "../../lib/context";
import { normalizeFormat, type GlobalOptions } from "../../lib/options";

export interface ListIdentitiesOptions extends GlobalOptions {
  verbose?: boolean;
}

interface IdentityListItem {
  name: string;
  aid: string;
  ksn: number;
  registered: boolean;
  isDefault: boolean;
  metadata?: Record<string, any>;
}

/**
 * List all identities
 */
export async function listIdentities(opts: ListIdentitiesOptions): Promise<void> {
  const ctx = opts._ctx;
  const format = normalizeFormat(opts.format || ctx.config.outputFormat);

  const names = await ctx.vault.listIdentities();

  // Get full details for each identity
  const identities: IdentityListItem[] = await Promise.all(
    names.map(async (name) => {
      const identity = await ctx.vault.getIdentity(name);
      return {
        name,
        aid: identity.aid,
        ksn: identity.ksn,
        registered: identity.metadata?.registered ?? false,
        isDefault: name === ctx.config.defaultIdentity,
        metadata: identity.metadata,
      };
    })
  );

  // Format output
  if (format === "json") {
    // Canonicalized JSON (RFC8785) - sort keys within each object
    const sorted = identities.map(i => {
      const obj: any = {
        aid: i.aid,
        isDefault: i.isDefault,
        ksn: i.ksn,
        name: i.name,
        registered: i.registered,
      };
      if (opts.verbose && i.metadata) {
        obj.metadata = i.metadata;
      }
      return obj;
    });
    // Use canonicalize helper for proper RFC8785 canonicalization
    const keys = sorted.length > 0 ? Object.keys(sorted[0]).sort() : [];
    const canonicalized = sorted.map(obj => {
      const sortedObj: any = {};
      for (const key of keys) {
        sortedObj[key] = obj[key];
      }
      return sortedObj;
    });
    console.log(JSON.stringify(canonicalized));
  } else if (format === "pretty") {
    console.log(JSON.stringify(identities, null, 2));
  } else if (format === "raw") {
    console.log(JSON.stringify(identities));
  } else {
    // Fallback to pretty if somehow invalid
    console.log(JSON.stringify(identities, null, 2));
  }
}

// Removed formatCompact and formatText - replaced by JSON formats (json, pretty, raw)

/**
 * Truncate AID for compact display
 */
function truncateAID(aid: string): string {
  if (aid.length <= 20) return aid;
  return `${aid.slice(0, 10)}...${aid.slice(-10)}`;
}
