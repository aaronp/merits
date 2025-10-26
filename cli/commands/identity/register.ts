/**
 * Command: merits identity register
 *
 * Register an existing identity with the backend.
 * Uses vault.getPublicKey() to avoid exporting the private key.
 */

import chalk from "chalk";
import type { CLIContext } from "../../lib/context";

export interface RegisterIdentityOptions {
  _ctx: CLIContext;
}

/**
 * Register identity with backend
 */
export async function registerIdentity(name: string, opts: RegisterIdentityOptions): Promise<void> {
  const ctx = opts._ctx;

  console.log(`Registering identity '${name}'...`);

  // Get identity metadata
  const identity = await ctx.vault.getIdentity(name);

  // Check if already registered
  if (identity.metadata?.registered) {
    console.log(chalk.yellow(`\n⚠️  Identity '${name}' is already registered.`));
    console.log(`   Registration timestamp: ${new Date(identity.metadata.registeredAt).toLocaleString()}`);
    return;
  }

  // Get public key from vault metadata (NO private key export!)
  const publicKey = await ctx.vault.getPublicKey(name);

  console.log(`  AID: ${identity.aid}`);
  console.log(`  KSN: ${identity.ksn}`);

  // Register with backend (backend-agnostic)
  try {
    await ctx.client.identityRegistry.registerIdentity({
      aid: identity.aid,
      publicKey,
      ksn: identity.ksn,
    });

    // Update metadata without touching private key
    await ctx.vault.updateMetadata(name, {
      registered: true,
      registeredAt: Date.now(),
    });

    console.log(chalk.green(`\n✅ Identity '${name}' registered successfully!`));
  } catch (err: any) {
    console.error(chalk.red(`\n❌ Registration failed: ${err.message}`));

    if (err.message?.includes("already registered") || err.message?.includes("duplicate")) {
      console.log(chalk.yellow("\nThis AID may already be registered. Updating local metadata..."));
      await ctx.vault.updateMetadata(name, {
        registered: true,
        registeredAt: Date.now(),
      });
      console.log(chalk.green("✅ Local metadata updated."));
    } else {
      throw err;
    }
  }
}
