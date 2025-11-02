/**
 * Command: merits init
 *
 * First-time setup wizard that creates initial identity and configuration.
 */

import { intro, text, confirm, outro, cancel, isCancel } from "@clack/prompts";
import chalk from "chalk";
import type { CLIContext } from "../lib/context";
import { saveConfig, initConfig } from "../lib/config";
import { generateKeyPair, createAID } from "../../core/crypto";

export interface InitOptions {
  _ctx: CLIContext;
}

/**
 * Initialize Merits CLI with first identity
 */
export async function initCommand(opts: InitOptions): Promise<void> {
  const ctx = opts._ctx;

  intro(chalk.bold.cyan("Welcome to Merits CLI! 🎉"));

  // Check if already initialized
  const identities = await ctx.vault.listIdentities();
  if (identities.length > 0) {
    const proceed = await confirm({
      message: `You already have ${identities.length} ${identities.length === 1 ? "identity" : "identities"}. Continue setup anyway?`,
      initialValue: false,
    });

    if (isCancel(proceed) || !proceed) {
      cancel("Setup cancelled.");
      return;
    }
  }

  // Get identity name
  const nameResult = await text({
    message: "Choose a name for your identity:",
    placeholder: "alice",
    validate: (value) => {
      if (!value) return "Name is required";
      if (!/^[A-Za-z0-9-]+$/.test(value as string)) {
        return "Name must be alphanumeric with dashes (e.g., 'alice', 'Alice', 'work-identity')";
      }
      if (identities.includes(value as string)) {
        return `Identity '${value}' already exists`;
      }
    },
  });

  if (isCancel(nameResult)) {
    cancel("Setup cancelled.");
    return;
  }

  const name = nameResult as string;

  // Get optional description
  const descResult = await text({
    message: "Description (optional):",
    placeholder: "Primary identity",
  });

  if (isCancel(descResult)) {
    cancel("Setup cancelled.");
    return;
  }

  const description = (descResult as string) || "Primary identity";

  console.log();
  console.log(chalk.cyan("Creating your identity..."));

  // Generate keypair
  const keys = await generateKeyPair();
  const aid = createAID(keys.publicKey);

  console.log(chalk.gray(`  AID: ${aid}`));

  // Store in vault with public key in metadata
  await ctx.vault.storeIdentity(name, {
    aid,
    privateKey: keys.privateKey,
    ksn: 0,
    metadata: {
      publicKey: keys.publicKey,
      createdAt: Date.now(),
      description,
      registered: false,
    },
  });

  console.log(chalk.green("  ✓ Identity created locally"));

  // Register with backend (if backend is configured)
  if (ctx.config.backend?.url) {
    console.log(chalk.cyan("\nRegistering with backend..."));

    try {
      await ctx.client.identityRegistry.registerIdentity({
        aid,
        publicKey: keys.publicKey,
        ksn: 0,
      });

      await ctx.vault.updateMetadata(name, {
        registered: true,
        registeredAt: Date.now(),
      });

      console.log(chalk.green("  ✓ Registered successfully"));
    } catch (err: any) {
      console.log(chalk.yellow(`  ⚠️  Registration failed: ${err.message}`));
      console.log(chalk.gray(`     You can register later with: merits create-user --id ${aid} --public-key <key>`));
    }
  } else {
    console.log(chalk.yellow("\n⚠️  No backend configured. Skipping registration."));
    console.log(chalk.gray("   Set CONVEX_URL environment variable to enable backend features."));
  }

  // Set as default identity
  ctx.config.defaultIdentity = name;
  await saveConfig(ctx.config);

  console.log(chalk.green("  ✓ Set as default identity"));

  outro(chalk.green.bold(`\n✅ Setup complete! Identity '${name}' is ready to use.`));

  // Show next steps
  console.log();
  console.log(chalk.bold("Next steps:"));
  console.log(`  ${chalk.cyan("merits whoami")}              - View your current session`);
  console.log(`  ${chalk.cyan("merits send")} <aid>          - Send a message`);
  console.log(`  ${chalk.cyan("merits unread")}              - Check for messages`);
  if (!ctx.config.backend?.url) {
    console.log(`  ${chalk.cyan("merits config set")}         - Configure backend URL`);
  }
  console.log();
}
