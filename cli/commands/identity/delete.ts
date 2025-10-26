/**
 * Command: merits identity delete
 *
 * Delete an identity from the vault (irreversible).
 */

import { confirm, isCancel } from "@clack/prompts";
import chalk from "chalk";
import type { CLIContext } from "../../lib/context";
import { saveConfig } from "../../lib/config";

export interface DeleteIdentityOptions {
  force?: boolean;
  _ctx: CLIContext;
}

/**
 * Delete identity from vault
 */
export async function deleteIdentity(name: string, opts: DeleteIdentityOptions): Promise<void> {
  const ctx = opts._ctx;

  // Verify identity exists
  await ctx.vault.getIdentity(name);

  // Confirm deletion (unless --force)
  if (!opts.force) {
    const confirmed = await confirm({
      message: chalk.yellow(`⚠️  Delete identity '${name}'? This cannot be undone!`),
      initialValue: false,
    });

    if (isCancel(confirmed) || !confirmed) {
      console.log(chalk.gray("Deletion cancelled."));
      return;
    }
  }

  // Delete from vault
  await ctx.vault.deleteIdentity(name);

  console.log(chalk.green(`✅ Identity '${name}' deleted`));

  // If this was the default, clear it
  if (ctx.config.defaultIdentity === name) {
    ctx.config.defaultIdentity = undefined;
    await saveConfig(ctx.config);

    console.log(chalk.yellow("\n⚠️  This was your default identity."));

    const remaining = await ctx.vault.listIdentities();
    if (remaining.length > 0) {
      console.log(`Set a new default with: ${chalk.cyan(`merits identity set-default ${remaining[0]}`)}`);
    } else {
      console.log("Create a new identity with: " + chalk.cyan("merits init"));
    }
  }
}
