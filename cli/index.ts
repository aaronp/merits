#!/usr/bin/env bun
/**
 * Merits CLI Entry Point
 *
 * Commands:
 * - merits identity new       - Generate new identity
 * - merits identity list      - List identities
 * - merits send               - Send message
 * - merits receive            - Receive messages
 * - merits group create       - Create group
 * - merits group list         - List groups
 *
 * Global options:
 * - --format <json|text|compact>
 * - --verbose
 * - --from <identity>
 * - --config <path>
 * - --convex-url <url>
 * - --no-color
 * - --debug
 */

import { Command } from "commander";
import { loadConfig } from "./lib/config";
import { createVault } from "./lib/vault";
import { createMeritsClient } from "../src/client";
import type { CLIContext } from "./lib/context";

const program = new Command();

program
  .name("merits")
  .description("Merits messaging CLI - KERI-authenticated secure messaging")
  .version("0.1.0");

// Global options
program
  .option("--format <type>", "Output format (json|text|compact)", "text")
  .option("--verbose", "Show detailed envelope data", false)
  .option("--from <aid>", "Identity to use")
  .option("--config <path>", "Config file path")
  .option("--convex-url <url>", "Convex deployment URL")
  .option("--no-color", "Disable colored output")
  .option("--debug", "Enable debug logging");

/**
 * PreAction hook: Initialize context for all commands
 *
 * Creates config, vault, and client once at startup.
 * Injected into command options as `_ctx`.
 */
program.hook("preAction", (thisCommand, actionCommand) => {
  const opts = program.opts();

  // Load config with 4-layer precedence
  const config = loadConfig(opts.config, {
    convexUrl: opts.convexUrl,
    outputFormat: opts.format,
    verbose: opts.verbose,
    color: opts.color,
    defaultIdentity: opts.from,
  });

  // Create vault (OS keychain)
  const vault = createVault();

  // Create Merits client
  const client = createMeritsClient(config.convexUrl);

  // Inject context into command options
  const ctx: CLIContext = { config, vault, client };
  actionCommand.setOptionValue("_ctx", ctx);

  // Debug logging
  if (opts.debug) {
    console.error("[DEBUG] Config:", config);
    console.error("[DEBUG] Vault type: OS Keychain");
  }
});

/**
 * PostAction hook: Cleanup resources
 */
program.hook("postAction", async (thisCommand, actionCommand) => {
  const opts = actionCommand.opts();
  const ctx = opts._ctx as CLIContext | undefined;

  if (ctx) {
    // Flush vault metadata
    await ctx.vault.flush();

    // Close client connection
    ctx.client.close();
  }
});

// --- Commands (placeholders for now) ---

program
  .command("identity")
  .description("Manage identities")
  .action(() => {
    console.log("Identity commands coming soon!");
    console.log("  merits identity new      - Generate new identity");
    console.log("  merits identity list     - List identities");
    console.log("  merits identity show     - Show identity details");
    console.log("  merits identity export   - Export private key");
    console.log("  merits identity delete   - Delete identity");
  });

program
  .command("send")
  .description("Send a message")
  .action(() => {
    console.log("Send command coming in Milestone 2!");
  });

program
  .command("receive")
  .description("Receive messages")
  .action(() => {
    console.log("Receive command coming in Milestone 2!");
  });

program
  .command("group")
  .description("Manage groups")
  .action(() => {
    console.log("Group commands coming in Milestone 3!");
    console.log("  merits group create      - Create group");
    console.log("  merits group list        - List groups");
    console.log("  merits group add-member  - Add member to group");
    console.log("  merits group send        - Send group message");
  });

program
  .command("watch")
  .description("Watch for incoming messages")
  .action(() => {
    console.log("Watch command coming in Milestone 3!");
  });

program
  .command("config")
  .description("Manage configuration")
  .action(() => {
    console.log("Config commands coming soon!");
    console.log("  merits config show       - Show current config");
    console.log("  merits config init       - Initialize config file");
    console.log("  merits config set        - Set config value");
  });

// Parse and execute
program.parse();
