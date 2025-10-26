/**
 * Command: merits identity export
 *
 * Export identity for backup (optionally includes private key).
 */

import { confirm, isCancel } from "@clack/prompts";
import chalk from "chalk";
import * as fs from "fs";
import type { CLIContext } from "../../lib/context";

export interface ExportIdentityOptions {
  output?: string;
  includeKey?: boolean;
  _ctx: CLIContext;
}

/**
 * Export identity for backup
 */
export async function exportIdentity(name: string, opts: ExportIdentityOptions): Promise<void> {
  const ctx = opts._ctx;

  const identity = await ctx.vault.getIdentity(name);

  const exportData: any = {
    version: 1,
    name,
    aid: identity.aid,
    ksn: identity.ksn,
    metadata: identity.metadata,
    exportedAt: Date.now(),
  };

  // Include private key if explicitly requested
  if (opts.includeKey) {
    console.log(chalk.yellow.bold("\n⚠️  SECURITY WARNING"));
    console.log(chalk.yellow("You are about to export your private key!"));
    console.log();
    console.log("Private keys should only be exported for:");
    console.log("  • Secure backup to encrypted storage");
    console.log("  • Migration to another device");
    console.log("  • Account recovery");
    console.log();
    console.log(chalk.red.bold("Keep exported keys secure and delete after use!"));
    console.log();

    const confirmed = await confirm({
      message: "Continue with private key export?",
      initialValue: false,
    });

    if (isCancel(confirmed) || !confirmed) {
      console.log(chalk.gray("Export cancelled."));
      return;
    }

    const privateKey = await ctx.vault.exportPrivateKey(name);
    exportData.privateKey = Buffer.from(privateKey).toString("base64");
    exportData.includesPrivateKey = true;
  } else {
    exportData.includesPrivateKey = false;
  }

  const json = JSON.stringify(exportData, null, 2);

  if (opts.output) {
    // Write to file with secure permissions
    fs.writeFileSync(opts.output, json, { mode: 0o600 });
    console.log(chalk.green(`✅ Identity exported to ${opts.output}`));

    if (opts.includeKey) {
      console.log(chalk.yellow("\n⚠️  File contains private key! Protect it carefully."));
    }
  } else {
    // Output to stdout
    console.log(json);
  }
}
