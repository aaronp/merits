/**
 * Command: merits identity new
 *
 * Generate a new KERI identity and optionally register it with the backend.
 * Private key is stored securely in OS keychain, public key in metadata.
 */

import type { CLIContext } from "../../lib/context";
import { generateKeyPair, createAID } from "../../../core/crypto";

export interface NewIdentityOptions {
  register?: boolean;
  setDefault?: boolean;
  description?: string;
  _ctx: CLIContext;
}

/**
 * Create a new identity
 *
 * @param name - Human-friendly name for the identity (lowercase alphanumeric + dashes)
 * @param opts - Command options
 */
export async function newIdentity(name: string, opts: NewIdentityOptions): Promise<void> {
  const ctx = opts._ctx;
  const isJson = ctx.config.outputFormat === "json";

  // Validate name
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error('Identity name must be lowercase alphanumeric with dashes (e.g., "alice", "work-identity")');
  }

  // Check if already exists
  const existing = await ctx.vault.listIdentities();
  if (existing.includes(name)) {
    throw new Error(`Identity '${name}' already exists. Use 'merits identity show ${name}' to view it.`);
  }

  if (!isJson) console.log(`Creating identity '${name}'...`);

  // Generate keypair
  const keys = await generateKeyPair();
  const aid = createAID(keys.publicKey);

  if (!isJson) console.log(`  AID: ${aid}`);

  // Store in vault with public key in metadata
  await ctx.vault.storeIdentity(name, {
    aid,
    privateKey: keys.privateKey,
    ksn: 0,
    metadata: {
      publicKey: keys.publicKey,  // Store public key to avoid later export
      createdAt: Date.now(),
      description: opts.description || '',
      registered: false,
    }
  });

  if (!isJson) console.log(`✓ Identity created locally`);

  // Register with backend if requested (default: true)
  let registered = false;
  if (opts.register !== false) {
    try {
      if (!isJson) console.log(`Registering with backend...`);

      await ctx.client.identityRegistry.registerIdentity({
        aid,
        publicKey: keys.publicKey,
        ksn: 0,
      });

      // Update metadata to reflect registration
      await ctx.vault.updateMetadata(name, {
        registered: true,
        registeredAt: Date.now(),
      });

      registered = true;
      if (!isJson) console.log(`✓ Identity registered with backend`);
    } catch (err: any) {
      if (!isJson) {
        console.warn(`⚠️  Registration failed: ${err.message}`);
        console.warn(`   Identity created locally. Use 'merits identity register ${name}' to retry.`);
      }
    }
  }

  // Set as default if requested
  if (opts.setDefault) {
    const { saveConfig } = await import("../../lib/config");
    ctx.config.defaultIdentity = name;
    await saveConfig(ctx.config);
    if (!isJson) console.log(`✓ Set as default identity`);
  }

  // Output result
  if (isJson) {
    console.log(JSON.stringify({
      name,
      aid,
      registered,
      isDefault: opts.setDefault || false,
    }));
  } else {
    console.log(`\n✅ Identity '${name}' created successfully!`);

    if (!opts.setDefault && existing.length === 0) {
      console.log(`\nTip: Set as default with: merits identity set-default ${name}`);
    }
  }
}
