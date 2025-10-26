/**
 * Command: merits identity import
 *
 * Import identity from backup file.
 */

import chalk from "chalk";
import * as fs from "fs";
import type { CLIContext } from "../../lib/context";

export interface ImportIdentityOptions {
  name?: string;
  register?: boolean;
  _ctx: CLIContext;
}

/**
 * Import identity from backup
 */
export async function importIdentity(file: string, opts: ImportIdentityOptions): Promise<void> {
  const ctx = opts._ctx;

  // Read and validate export file
  if (!fs.existsSync(file)) {
    throw new Error(`File not found: ${file}`);
  }

  const json = fs.readFileSync(file, "utf-8");
  let data: any;

  try {
    data = JSON.parse(json);
  } catch (err) {
    throw new Error(`Invalid JSON in file: ${file}`);
  }

  // Validate export format
  if (data.version !== 1) {
    throw new Error(`Unsupported export version: ${data.version}`);
  }

  if (!data.privateKey) {
    throw new Error(
      "Export does not include private key. Cannot import.\n" +
      "Re-export with --include-key flag to include the private key."
    );
  }

  const name = opts.name || data.name;

  // Check if name already exists
  const existing = await ctx.vault.listIdentities();
  if (existing.includes(name)) {
    throw new Error(
      `Identity '${name}' already exists.\n` +
      `Use --name <different-name> to import with a different name.`
    );
  }

  console.log(`Importing identity '${name}'...`);
  console.log(`  AID: ${data.aid}`);
  console.log(`  KSN: ${data.ksn}`);

  // Import to vault
  const privateKey = Buffer.from(data.privateKey, "base64");

  await ctx.vault.storeIdentity(name, {
    aid: data.aid,
    privateKey,
    ksn: data.ksn,
    metadata: {
      ...data.metadata,
      importedAt: Date.now(),
      importedFrom: file,
    },
  });

  console.log(chalk.green(`✓ Identity imported successfully`));

  // Register if requested
  if (opts.register) {
    console.log("\nRegistering with backend...");

    try {
      const publicKey = await ctx.vault.getPublicKey(name);

      await ctx.client.identityRegistry.registerIdentity({
        aid: data.aid,
        publicKey,
        ksn: data.ksn,
      });

      await ctx.vault.updateMetadata(name, {
        registered: true,
        registeredAt: Date.now(),
      });

      console.log(chalk.green("✓ Registered with backend"));
    } catch (err: any) {
      console.log(chalk.yellow(`⚠️  Registration failed: ${err.message}`));
      console.log(chalk.gray(`   You can register later with: merits identity register ${name}`));
    }
  }

  console.log(chalk.green(`\n✅ Identity '${name}' imported successfully!`));
}
