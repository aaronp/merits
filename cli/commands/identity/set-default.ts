/**
 * Command: merits identity set-default
 *
 * Set the default identity for commands.
 */

import chalk from "chalk";
import { saveConfig } from "../../lib/config";
import type { CLIContext } from "../../lib/context";

export interface SetDefaultIdentityOptions {
  _ctx: CLIContext;
}

/**
 * Set default identity
 */
export async function setDefaultIdentity(name: string, opts: SetDefaultIdentityOptions): Promise<void> {
  const ctx = opts._ctx;

  // Verify identity exists
  await ctx.vault.getIdentity(name);

  // Update config
  ctx.config.defaultIdentity = name;
  await saveConfig(ctx.config);

  console.log(chalk.green(`✅ Default identity set to '${name}'`));
}
