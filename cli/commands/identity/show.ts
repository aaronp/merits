/**
 * Command: merits identity show
 *
 * Show detailed information about a specific identity.
 */

import chalk from "chalk";
import type { CLIContext } from "../../lib/context";
import { normalizeFormat, type GlobalOptions } from "../../lib/options";

export interface ShowIdentityOptions extends GlobalOptions {}

/**
 * Show detailed identity information
 */
export async function showIdentity(name: string, opts: ShowIdentityOptions): Promise<void> {
  const ctx = opts._ctx;
  const format = normalizeFormat(opts.format || ctx.config.outputFormat);

  const identity = await ctx.vault.getIdentity(name);
  const isDefault = name === ctx.config.defaultIdentity;

  const data = {
    aid: identity.aid,
    isDefault,
    ksn: identity.ksn,
    metadata: identity.metadata,
    name,
    registered: identity.metadata?.registered ?? false,
  };

  if (format === "json") {
    // Canonicalized JSON (RFC8785)
    const canonical = JSON.stringify(data, Object.keys(data).sort());
    console.log(canonical);
  } else if (format === "pretty") {
    console.log(JSON.stringify(data, null, 2));
  } else if (format === "raw") {
    console.log(JSON.stringify(data));
  } else {
    // Fallback
    console.log(JSON.stringify(data, null, 2));
    return;
  }

}
