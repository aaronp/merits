/**
 * Command: merits identity show
 *
 * Show detailed information about a specific identity.
 */

import chalk from "chalk";
import type { CLIContext } from "../../lib/context";

export interface ShowIdentityOptions {
  format?: "json" | "text";
  _ctx: CLIContext;
}

/**
 * Show detailed identity information
 */
export async function showIdentity(name: string, opts: ShowIdentityOptions): Promise<void> {
  const ctx = opts._ctx;
  const format = opts.format || ctx.config.outputFormat;

  const identity = await ctx.vault.getIdentity(name);
  const isDefault = name === ctx.config.defaultIdentity;

  if (format === "json") {
    console.log(JSON.stringify({
      name,
      aid: identity.aid,
      ksn: identity.ksn,
      registered: identity.metadata?.registered ?? false,
      isDefault,
      metadata: identity.metadata,
    }, null, 2));
    return;
  }

  // Text format
  const header = isDefault
    ? `${chalk.yellow("★")} Identity: ${chalk.bold(name)} ${chalk.yellow("(default)")}`
    : `Identity: ${chalk.bold(name)}`;

  console.log(`\n${header}\n`);

  console.log(chalk.cyan("AID:"));
  console.log(`  ${identity.aid}\n`);

  console.log(chalk.cyan("Key Sequence Number (KSN):"));
  console.log(`  ${identity.ksn}\n`);

  console.log(chalk.cyan("Status:"));
  const regStatus = identity.metadata?.registered
    ? chalk.green("Registered")
    : chalk.yellow("Not registered (use 'merits identity register' to register)");
  console.log(`  ${regStatus}`);

  if (identity.metadata?.createdAt) {
    const date = new Date(identity.metadata.createdAt).toLocaleString();
    console.log(`  Created: ${date}`);
  }

  if (identity.metadata?.registeredAt) {
    const date = new Date(identity.metadata.registeredAt).toLocaleString();
    console.log(`  Registered: ${date}`);
  }

  if (identity.metadata?.rotatedAt) {
    const date = new Date(identity.metadata.rotatedAt).toLocaleString();
    console.log(`  Last Rotated: ${date}`);
    if (identity.metadata.rotationReason) {
      console.log(`  Rotation Reason: ${identity.metadata.rotationReason}`);
    }
  }

  if (identity.metadata?.description) {
    console.log(`\n${chalk.cyan("Description:")}`);
    console.log(`  ${identity.metadata.description}`);
  }

  console.log();
}
