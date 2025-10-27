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
  .option("--data-dir <path>", "Data directory (overrides ~/.merits/)")
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
    dataDir: opts.dataDir, // NEW: Data directory override
    backend: opts.convexUrl ? { type: "convex", url: opts.convexUrl } : undefined,
    outputFormat: opts.format,
    verbose: opts.verbose,
    color: opts.color,
    defaultIdentity: opts.from,
  });

  // Create vault (uses dataDir if set for FileVault)
  const vault = createVault(config);

  // Create Merits client (backend-agnostic)
  const client = createMeritsClient(config);

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

// --- Commands ---

// Import commands
import { initCommand } from "./commands/init";
import { newIdentity } from "./commands/identity/new";
import { listIdentities } from "./commands/identity/list";
import { showIdentity } from "./commands/identity/show";
import { registerIdentity } from "./commands/identity/register";
import { setDefaultIdentity } from "./commands/identity/set-default";
import { exportIdentity } from "./commands/identity/export";
import { importIdentity } from "./commands/identity/import";
import { deleteIdentity } from "./commands/identity/delete";
import { sendMessage } from "./commands/send";
import { receiveMessages } from "./commands/receive";
import { ackMessage } from "./commands/ack";
import { watchMessages } from "./commands/watch";

// Init command (first-time setup)
program
  .command("init")
  .description("First-time setup wizard")
  .action(initCommand);

// Identity command group
const identityCmd = program
  .command("identity")
  .description("Manage KERI identities");

identityCmd
  .command("new <name>")
  .description("Create a new identity")
  .option("--no-register", "Skip backend registration")
  .option("--set-default", "Set as default identity")
  .option("--description <text>", "Description for the identity")
  .action(newIdentity);

identityCmd
  .command("list")
  .description("List all identities")
  .option("--format <type>", "Output format (json|text|compact)")
  .option("--verbose", "Show full details")
  .action(listIdentities);

identityCmd
  .command("show <name>")
  .description("Show identity details")
  .option("--format <type>", "Output format (json|text)")
  .action(showIdentity);

identityCmd
  .command("register <name>")
  .description("Register identity with backend")
  .action(registerIdentity);

identityCmd
  .command("set-default <name>")
  .description("Set default identity")
  .action(setDefaultIdentity);

identityCmd
  .command("export <name>")
  .description("Export identity for backup")
  .option("--output <path>", "Output file (default: stdout)")
  .option("--include-key", "Include private key (dangerous!)")
  .action(exportIdentity);

identityCmd
  .command("import <file>")
  .description("Import identity from backup")
  .option("--name <name>", "Override identity name")
  .option("--register", "Register with backend after import")
  .action(importIdentity);

identityCmd
  .command("delete <name>")
  .description("Delete identity from vault")
  .option("--force", "Skip confirmation prompt")
  .action(deleteIdentity);

// Send command
program
  .command("send <recipient>")
  .description("Send encrypted message to recipient")
  .option("--message <text>", "Message text (or use stdin)")
  .option("--ct <ciphertext>", "Pre-encrypted message (base64)")
  .option("--encrypt-for <aid>", "Encrypt for third party (forwarding)")
  .option("--from <identity>", "Sender identity (default: config.defaultIdentity)")
  .option("--ttl <ms>", "Time-to-live in milliseconds (default: 24h)", parseInt)
  .option("--typ <type>", "Message type")
  .option("--ek <key>", "Ephemeral key")
  .option("--alg <algorithm>", "Encryption algorithm")
  .option("--format <type>", "Output format (json|text|compact)")
  .action(sendMessage);

// Receive command
program
  .command("receive")
  .description("Retrieve and display messages")
  .option("--from <identity>", "Receive as this identity (default: config.defaultIdentity)")
  .option("--mark-read", "Acknowledge messages after receiving")
  .option("--format <type>", "Output format (json|text|compact)")
  .option("--limit <n>", "Maximum messages to retrieve", parseInt)
  .option("--plaintext", "Decrypt and show plaintext")
  .action(receiveMessages);

// Ack command
program
  .command("ack <message-id>")
  .description("Acknowledge message receipt")
  .requiredOption("--envelope-hash <hash>", "Envelope hash to sign (required for non-repudiation)")
  .option("--from <identity>", "Identity acknowledging (default: config.defaultIdentity)")
  .action(ackMessage);

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

// Watch command (Phase 4: Real-time streaming with session tokens)
program
  .command("watch")
  .description("Stream messages in real-time (Phase 4)")
  .option("--from <identity>", "Watch as this identity (default: config.defaultIdentity)")
  .option("--no-auto-ack", "Disable automatic acknowledgment (default: auto-ack enabled)")
  .option("--plaintext", "Decrypt and show plaintext")
  .option("--format <type>", "Output format (json|text|compact)")
  .option("--filter <pattern>", "Filter messages by sender or content (not yet implemented)")
  .action(watchMessages);

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
