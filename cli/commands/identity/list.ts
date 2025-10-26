/**
 * Command: merits identity list
 *
 * List all stored identities with their status and metadata.
 */

import chalk from "chalk";
import type { CLIContext } from "../../lib/context";

export interface ListIdentitiesOptions {
  format?: "json" | "text" | "compact";
  verbose?: boolean;
  _ctx: CLIContext;
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
  const format = opts.format || ctx.config.outputFormat;

  const names = await ctx.vault.listIdentities();

  if (names.length === 0) {
    if (format === "json") {
      console.log("[]");
    } else {
      console.log("No identities found.");
      console.log("\nCreate your first identity with:");
      console.log("  merits init");
      console.log("  or");
      console.log("  merits identity new <name>");
    }
    return;
  }

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
    console.log(JSON.stringify(identities, null, 2));
  } else if (format === "compact") {
    formatCompact(identities);
  } else {
    formatText(identities, opts.verbose);
  }
}

/**
 * Format as compact table
 */
function formatCompact(identities: IdentityListItem[]): void {
  console.log(chalk.bold("\nIdentities:\n"));

  for (const identity of identities) {
    const defaultMarker = identity.isDefault ? chalk.yellow("*") : " ";
    const registeredMarker = identity.registered ? chalk.green("✓") : chalk.gray("✗");
    const truncatedAid = truncateAID(identity.aid);

    console.log(`${defaultMarker} ${registeredMarker} ${chalk.bold(identity.name)} - ${chalk.gray(truncatedAid)}`);
  }

  console.log();
}

/**
 * Format as detailed text
 */
function formatText(identities: IdentityListItem[], verbose?: boolean): void {
  console.log(chalk.bold("\nIdentities:\n"));

  for (const identity of identities) {
    const header = identity.isDefault
      ? `${chalk.yellow("★")} ${chalk.bold(identity.name)} ${chalk.yellow("(default)")}`
      : `  ${chalk.bold(identity.name)}`;

    console.log(header);
    console.log(`  AID: ${chalk.gray(identity.aid)}`);
    console.log(`  KSN: ${identity.ksn}`);

    const regStatus = identity.registered
      ? chalk.green("Yes")
      : chalk.yellow("No (use 'merits identity register' to register)");
    console.log(`  Registered: ${regStatus}`);

    if (verbose && identity.metadata) {
      if (identity.metadata.createdAt) {
        const date = new Date(identity.metadata.createdAt).toLocaleString();
        console.log(`  Created: ${chalk.gray(date)}`);
      }
      if (identity.metadata.registeredAt) {
        const date = new Date(identity.metadata.registeredAt).toLocaleString();
        console.log(`  Registered At: ${chalk.gray(date)}`);
      }
      if (identity.metadata.description) {
        console.log(`  Description: ${chalk.gray(identity.metadata.description)}`);
      }
    }

    console.log();
  }

  if (!identities.some((i) => i.isDefault)) {
    console.log(chalk.yellow("No default identity set. Set one with: merits identity set-default <name>\n"));
  }
}

/**
 * Truncate AID for compact display
 */
function truncateAID(aid: string): string {
  if (aid.length <= 20) return aid;
  return `${aid.slice(0, 10)}...${aid.slice(-10)}`;
}
