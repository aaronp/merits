#!/usr/bin/env bun
/**
 * Merits CLI Entry Point
 *
 * Key Commands:
 * - merits init               - First-time setup wizard
 * - merits gen-key            - Generate Ed25519 key pair
 * - merits incept             - Complete user inception flow (one-step registration)
 * - merits create-user        - Create user registration challenge
 * - merits sign-in            - Sign in with existing user
 * - merits send               - Send encrypted message (direct or group)
 * - merits unread             - Retrieve unread messages
 * - merits group create       - Create group
 * - merits group list         - List groups
 * - merits access allow       - Add to allow-list
 * - merits access deny        - Add to deny-list
 *
 * Global options:
 * - --format <json|pretty|raw>
 * - --token <path>
 * - --no-banner
 * - --verbose
 * - --config <path>
 * - --convex-url <url>
 * - --data-dir <path>
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
  .description("Merits messaging CLI - KERI-authenticated secure messaging with zero-knowledge group encryption")
  .version("0.1.0")
  .addHelpText("after", `
Features:
  - KERI-based authentication with challenge-response proofs
  - End-to-end encrypted direct messaging
  - Zero-knowledge group messaging (backend cannot decrypt)
  - Role-based access control (RBAC)
  - Session tokens for streaming operations

Quick Start:
  $ merits init                          # First-time setup wizard
  $ merits incept                        # One-step user inception (generate + register)

  OR manually:
  $ merits gen-key                       # Generate key pair
  $ merits create-user --id <aid> --public-key <key>  # Register user

  Then:
  $ merits send <recipient> --message "Hello"         # Send message
  $ merits unread --token $TOKEN         # Retrieve messages

Documentation:
  $ merits <command> --help              # Command-specific help
  $ merits send --help                   # See group vs direct message formats
  $ merits unread --help                 # See message types and formats
  `);

// Global options (updated to match cli.md spec)
program
  .option("--data-dir <path>", "Data directory (overrides ~/.merits/)")
  .option("--format <type>", "Output format (json|pretty|raw)", "json")
  .option("--token <path>", "Session token file path (default: .merits/session.json)")
  .option("--no-banner", "Suppress welcome/status messages (for scripting)")
  .option("--verbose", "Show detailed envelope data", false)
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
  const cmdOpts = actionCommand.opts();

  // Merge program opts with command opts (command takes precedence)
  const mergedOpts = { ...opts, ...cmdOpts };

  // Load config with 4-layer precedence
  const config = loadConfig(mergedOpts.config, {
    dataDir: mergedOpts.dataDir, // NEW: Data directory override
    backend: mergedOpts.convexUrl ? { type: "convex", url: mergedOpts.convexUrl } : undefined,
    outputFormat: mergedOpts.format,
    verbose: mergedOpts.verbose,
    color: mergedOpts.color,
    defaultIdentity: mergedOpts.from,
  });

  // Create vault (uses dataDir if set for FileVault)
  const vault = createVault(config);

  // Create Merits client (backend-agnostic)
  const client = createMeritsClient(config);

  // Inject context into command options
  const ctx: CLIContext = { config, vault, client };
  actionCommand.setOptionValue("_ctx", ctx);

  // Inject global options into command (so they're accessible in command handlers)
  if (mergedOpts.token !== undefined) {
    actionCommand.setOptionValue("token", mergedOpts.token);
  }
  if (mergedOpts.format !== undefined) {
    actionCommand.setOptionValue("format", mergedOpts.format);
  }
  if (mergedOpts.noBanner !== undefined) {
    actionCommand.setOptionValue("noBanner", mergedOpts.noBanner);
  }
  if (mergedOpts.verbose !== undefined) {
    actionCommand.setOptionValue("verbose", mergedOpts.verbose);
  }
  if (mergedOpts.debug !== undefined) {
    actionCommand.setOptionValue("debug", mergedOpts.debug);
  }

  // Debug logging
  if (mergedOpts.debug) {
    console.error("[DEBUG] Config:", config);
    console.error("[DEBUG] Vault type: OS Keychain");
    console.error("[DEBUG] Global options:", {
      token: mergedOpts.token,
      format: mergedOpts.format,
      noBanner: mergedOpts.noBanner
    });
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

// Import commands (new CLI spec from cli.md)
import { initCommand } from "./commands/init";
import { genKey } from "./commands/gen-key";
import { incept } from "./commands/incept";
import { createUser } from "./commands/create-user";
import { sign } from "./commands/sign";
import { confirmChallenge } from "./commands/confirm-challenge";
import { signIn } from "./commands/sign-in";
import { whoami } from "./commands/whoami";
import { keyFor } from "./commands/key-for";
import { listUnread } from "./commands/list-unread";
import { unread } from "./commands/unread";
import { markAsRead } from "./commands/mark-as-read";
import { extractIds } from "./commands/extract-ids";
import { sendMessage } from "./commands/send";
import { encrypt } from "./commands/encrypt";
import { decrypt } from "./commands/decrypt";
import { verifySignature } from "./commands/verify-signature";
import { rolesCreate, permissionsCreate, rolesAddPermission, usersGrantRole, bootstrapOnboardingCmd } from "./commands/rbac";
import {
  createGroup,
  listGroups,
  groupInfo,
  addGroupMember,
  removeGroupMember,
  leaveGroup,
} from "./commands/group";
import {
  accessAllow,
  accessDeny,
  accessRemove,
  accessList,
  accessClear,
} from "./commands/access";

// Init command (first-time setup)
program
  .command("init")
  .description("First-time setup wizard")
  .action(initCommand);

// --- New CLI Commands (cli.md spec) ---

// Key generation
program
  .command("gen-key")
  .description("Generate a new Ed25519 key pair")
  .option("--seed <value>", "Deterministic seed for testing (not secure!)")
  .action(genKey);

// User inception (convenience command)
program
  .command("incept")
  .description("Complete user inception flow (generate keys, register, obtain session token)")
  .option("--seed <value>", "Deterministic seed for testing (not secure!)")
  .addHelpText("after", `
Convenience command that performs the full user inception flow in one step:
  1. Generate a new Ed25519 key pair
  2. Register the identity with the server
  3. Sign the registration challenge
  4. Confirm the challenge to obtain a session token

Output includes:
  - aid: The generated AID
  - keys: privateKey and publicKey (base64url encoded)
  - challenge: The registration challenge details
  - session: Session token and expiration

Examples:
  $ merits incept --format pretty
  $ merits incept --seed test123 --format json  # Deterministic (testing only)
  `)
  .action(incept);

// User management
program
  .command("create-user")
  .description("Create a registration challenge for a new user")
  .requiredOption("--id <aid>", "User AID (Agent Identifier)")
  .requiredOption("--public-key <key>", "Base64url-encoded Ed25519 public key")
  .action(createUser);

program
  .command("sign")
  .description("Sign a challenge with a private key")
  .requiredOption("--file <path>", "Path to challenge file")
  .requiredOption("--keys <path>", "Path to keys file")
  .action(sign);

program
  .command("confirm-challenge")
  .description("Confirm a signed challenge and obtain session token")
  .requiredOption("--file <path>", "Path to signed challenge response file")
  .action(confirmChallenge);

program
  .command("sign-in")
  .description("Create a sign-in challenge for an existing user")
  .requiredOption("--id <aid>", "User AID (Agent Identifier)")
  .action(signIn);

program
  .command("whoami")
  .description("Display current session information")
  .action(whoami);

program
  .command("key-for <aid>")
  .description("Fetch public key for an AID")
  .addHelpText("after", `
Retrieves the public key and metadata for a registered AID.

Output includes:
  - aid: The AID identifier
  - publicKey: Ed25519 public key (base64url encoded)
  - ksn: Key sequence number (for rotation tracking)
  - updatedAt: Last update timestamp

Examples:
  $ merits key-for Dabcd1234... --format json
  $ merits key-for Eefgh5678... --format pretty

Use Cases:
  - Verify someone's public key before encrypting
  - Check if an AID is registered
  - Export key for sharing
  - Validate key rotation status
  `)
  .action(keyFor);

// Messaging commands
program
  .command("list-unread")
  .description("List unread message counts per sender/group")
  .option("--from <senders>", "Comma-separated list of sender AIDs to filter by")
  .action(listUnread);

program
  .command("unread")
  .description("Retrieve and decrypt unread messages (direct and group)")
  .option("--from <sender>", "Filter messages by sender")
  .option("--watch", "Stream messages in real-time (continuous mode)")
  .option("--since <timestamp>", "Replay messages after this timestamp", parseInt)
  .addHelpText("after", `
Examples:
  $ merits unread --token $TOKEN                    # Get all unread messages
  $ merits unread --token $TOKEN --from alice       # Filter by sender
  $ merits unread --token $TOKEN --format pretty    # Pretty-printed output
  $ merits unread --token $TOKEN --since 1730476800000  # Messages after timestamp

Message Types:
  - Direct messages: Peer-to-peer encrypted (typ: "encrypted")
  - Group messages: Zero-knowledge encrypted (typ: "group-encrypted")
    Group messages are automatically decrypted client-side.

Output Formats:
  --format json   : RFC8785 canonical JSON (deterministic, sorted keys)
  --format pretty : Pretty-printed JSON with summary
  --format raw    : Minified JSON (no formatting)
  `)
  .action(unread);

program
  .command("mark-as-read")
  .description("Mark messages as read (acknowledges and deletes them)")
  .option("--ids <ids>", "Comma-separated message IDs")
  .option("--ids-data <file>", "Path to JSON file with message IDs")
  .action(markAsRead);

program
  .command("extract-ids")
  .description("Extract message IDs from message list (utility for piping)")
  .requiredOption("--file <path>", "Path to messages file")
  .action(extractIds);

// Utility commands (Phase 7)
program
  .command("encrypt")
  .description("Encrypt message for testing (standalone encryption)")
  .option("--message <text>", "Message text (or use stdin)")
  .requiredOption("--public-key-file <path>", "Path to JSON file with recipient's public key")
  .action(encrypt);

program
  .command("decrypt")
  .description("Decrypt message for testing (standalone decryption)")
  .option("--encrypted-file <path>", "Path to encrypted message JSON (or use stdin)")
  .requiredOption("--keys-file <path>", "Path to JSON file with private key")
  .action(decrypt);

program
  .command("verify-signature")
  .description("Verify Ed25519 signature")
  .option("--signed-file <path>", "Path to signed message JSON (or use stdin)")
  .action(verifySignature);

// Send command
program
  .command("send <recipient>")
  .description("Send encrypted message to recipient (direct or group)")
  .option("--message <text>", "Message text (or use stdin)")
  .option("--ct <ciphertext>", "Pre-encrypted message (base64, direct messages only)")
  .option("--encrypt-for <aid>", "Encrypt for third party (forwarding)")
  .option("--from <identity>", "Sender identity (default: config.defaultIdentity)")
  .option("--ttl <ms>", "Time-to-live in milliseconds (default: 24h)", parseInt)
  .option("--typ <type>", "Message type")
  .option("--ek <key>", "Ephemeral key")
  .option("--alg <algorithm>", "Encryption algorithm")
  .option("--format <type>", "Output format (json|text|compact)")
  .addHelpText("after", `
Recipient Format:
  Direct message : AID starting with 'D' or 'E' (CESR-encoded identifier)
  Group message  : Group ID (any other format)

Examples:
  # Send direct message
  $ merits send Dabcd1234... --message "Hello Alice"

  # Send group message
  $ merits send group-123 --message "Hello team"

  # Read from stdin
  $ echo "Secret message" | merits send Dabcd1234...

  # Pre-encrypted content (direct messages only)
  $ merits send Dabcd1234... --ct <base64-ciphertext>

Encryption:
  Direct Messages:
    - X25519-XChaCha20-Poly1305 encryption
    - One-to-one encrypted communication

  Group Messages:
    - Ephemeral AES-256-GCM group encryption
    - Message encrypted once, distributed to all members
    - Each member receives separately encrypted key
    - Zero-knowledge: Backend cannot decrypt

Output:
  Returns JSON with messageId, recipient/groupId, and sentAt timestamp
  `)
  .action(sendMessage);

// RBAC admin commands
const rolesCmd = program
  .command("roles")
  .description("Manage roles");

rolesCmd
  .command("create <roleName>")
  .requiredOption("--adminAID <aid>", "Admin AID performing the change")
  .requiredOption("--actionSAID <said>", "Reference to governance action")
  .action(rolesCreate);

rolesCmd
  .command("add-permission <roleName> <key>")
  .requiredOption("--adminAID <aid>", "Admin AID performing the change")
  .requiredOption("--actionSAID <said>", "Reference to governance action")
  .action(rolesAddPermission);

const permsCmd = program
  .command("permissions")
  .description("Manage permissions");

permsCmd
  .command("create <key>")
  .option("--data <json>", "JSON-encoded data payload")
  .requiredOption("--adminAID <aid>", "Admin AID performing the change")
  .requiredOption("--actionSAID <said>", "Reference to governance action")
  .action(permissionsCreate);

const usersCmd = program
  .command("users")
  .description("Manage users");

usersCmd
  .command("grant-role <aid> <roleName>")
  .requiredOption("--adminAID <aid>", "Admin AID performing the change")
  .requiredOption("--actionSAID <said>", "Reference to governance action")
  .action(usersGrantRole);

program
  .command("rbac:bootstrap-onboarding")
  .description("Bootstrap onboarding group, roles (anon, user, admin), and permission mapping")
  .option("--admin-aid <aid>", "AID to assign admin role (optional)")
  .addHelpText("after", `
⚠️  WARNING: This is a DEV-ONLY bootstrap command.
    For production deployment, see docs/bootstrap-plan.md Option A.

Environment requirements:
  - BOOTSTRAP_KEY must be set (prevents accidental production use)
  - Example: export BOOTSTRAP_KEY="dev-only-secret"

Examples:
  # Bootstrap system (no admin assignment)
  merits rbac:bootstrap-onboarding

  # Bootstrap system and assign admin role to specific AID
  merits rbac:bootstrap-onboarding --admin-aid DqQWHc-DiiUeXcsSIXni913IdnpaNklSJzM0zKj4wVAk

  # Typical dev workflow:
  merits incept --seed admin-dev-seed > admin-keys.json
  AID=$(cat admin-keys.json | jq -r '.aid')
  merits rbac:bootstrap-onboarding --admin-aid "$AID"
  `)
  .action((opts) => bootstrapOnboardingCmd(opts));

// Group command group (Phase 4)
const groupCmd = program
  .command("group")
  .description("Manage groups");

groupCmd
  .command("create <name>")
  .description("Create a new group")
  .option("--from <identity>", "Identity creating the group (default: config.defaultIdentity)")
  .option("--description <text>", "Group description")
  .action(createGroup);

groupCmd
  .command("list")
  .description("List all groups (owned, admin, or member)")
  .option("--from <identity>", "Identity to list groups for (default: config.defaultIdentity)")
  .option("--format <type>", "Output format (json|text|compact)")
  .action(listGroups);

groupCmd
  .command("info <group-id>")
  .description("Show detailed group information")
  .option("--from <identity>", "Identity requesting info (default: config.defaultIdentity)")
  .option("--format <type>", "Output format (json|text)")
  .action(groupInfo);

groupCmd
  .command("add <group-id> <member-aid>")
  .description("Add member to group")
  .option("--from <identity>", "Identity performing action (default: config.defaultIdentity)")
  .option("--role <type>", "Member role (member|admin)", "member")
  .action(addGroupMember);

groupCmd
  .command("remove <group-id> <member-aid>")
  .description("Remove member from group")
  .option("--from <identity>", "Identity performing action (default: config.defaultIdentity)")
  .action(removeGroupMember);

groupCmd
  .command("leave <group-id>")
  .description("Leave a group")
  .option("--from <identity>", "Identity leaving (default: config.defaultIdentity)")
  .action(leaveGroup);

// Access control command group (Phase 6)
const accessCmd = program
  .command("access")
  .description("Manage message access control (allow/deny lists)")
  .addHelpText("after", `
Access Control Overview:
  Control who can send you messages using allow-lists and deny-lists.

Priority Rules:
  1. Deny-list always wins (blocks even if on allow-list)
  2. Allow-list enables default-deny (only allowed AIDs can send)
  3. Empty lists = allow all (default behavior)

Examples:
  # Block a spammer
  $ merits access deny spammer-aid --note "spam" --token $TOKEN

  # Enable private messaging (default-deny mode)
  $ merits access allow alice-aid --note "work colleague" --token $TOKEN
  $ merits access allow bob-aid --note "friend" --token $TOKEN

  # View your lists
  $ merits access list --allow --token $TOKEN
  $ merits access list --deny --token $TOKEN

  # Remove from lists
  $ merits access remove alice-aid --allow --token $TOKEN
  $ merits access remove spammer-aid --deny --token $TOKEN

  # Clear all entries
  $ merits access clear --allow --token $TOKEN
  $ merits access clear --deny --token $TOKEN

For detailed API documentation, see:
  - docs/ALLOW-LIST-DESIGN.md
  - Backend APIs: convex/allowList.ts, convex/denyList.ts
  `);

accessCmd
  .command("allow <aid>")
  .description("Add AID to allow-list (whitelist)")
  .option("--note <text>", "Optional note (e.g., 'work colleague', 'friend')")
  .addHelpText("after", `
Allow-List Behavior:
  When allow-list is active (non-empty), ONLY AIDs on the list can message you.
  This enables default-deny mode for privacy and spam protection.

  - Empty allow-list: All senders allowed (default)
  - Non-empty allow-list: Only listed senders allowed
  - Deny-list always takes priority

Examples:
  $ merits access allow alice-aid --note "work colleague" --token $TOKEN
  $ merits access allow bob-aid --token $TOKEN

After adding the first entry, allow-list becomes ACTIVE (default-deny mode).
  `)
  .action(accessAllow);

accessCmd
  .command("deny <aid>")
  .description("Add AID to deny-list (blocklist)")
  .option("--note <text>", "Optional note (e.g., 'spam', 'harassment')")
  .addHelpText("after", `
Deny-List Behavior:
  Blocked AIDs cannot send you messages, even if on allow-list.
  Deny-list takes priority over allow-list.

  - Takes effect immediately
  - Blocks all message types (direct and group)
  - Can be temporary (remove later) or permanent

Examples:
  $ merits access deny spammer-aid --note "spam" --token $TOKEN
  $ merits access deny harasser-aid --note "harassment" --token $TOKEN
  `)
  .action(accessDeny);

accessCmd
  .command("remove <aid>")
  .description("Remove AID from allow-list or deny-list")
  .option("--allow", "Remove from allow-list")
  .option("--deny", "Remove from deny-list")
  .addHelpText("after", `
Must specify either --allow or --deny to indicate which list to remove from.

Examples:
  $ merits access remove alice-aid --allow --token $TOKEN
  $ merits access remove spammer-aid --deny --token $TOKEN
  `)
  .action(accessRemove);

accessCmd
  .command("list")
  .description("List AIDs on allow-list or deny-list")
  .option("--allow", "Show allow-list")
  .option("--deny", "Show deny-list")
  .addHelpText("after", `
Must specify either --allow or --deny to indicate which list to show.

Output includes:
  - All AIDs on the list
  - When each was added
  - Optional notes/reasons
  - List status (active/inactive for allow-list)

Examples:
  $ merits access list --allow --token $TOKEN --format pretty
  $ merits access list --deny --token $TOKEN
  `)
  .action(accessList);

accessCmd
  .command("clear")
  .description("Clear all entries from allow-list or deny-list")
  .option("--allow", "Clear allow-list")
  .option("--deny", "Clear deny-list")
  .addHelpText("after", `
Must specify either --allow or --deny to indicate which list to clear.

Effects:
  - Clearing allow-list: Returns to allow-all mode
  - Clearing deny-list: Unblocks all previously blocked AIDs

Examples:
  $ merits access clear --allow --token $TOKEN
  $ merits access clear --deny --token $TOKEN
  `)
  .action(accessClear);

program
  .command("config")
  .description("Manage configuration")
  .action(() => {
    console.log("Config commands coming soon!");
    console.log("  merits config show       - Show current config");
    console.log("  merits config init       - Initialize config file");
    console.log("  merits config set        - Set config value");
  });

// Parse and execute with error handling
program.parseAsync().catch((error) => {
  // Extract error details
  const errorMessage = error.message || "Unknown error";
  const errorCode = error.code || "CLI_ERROR";
  const errorContext = error.context || {};

  // Format error for stderr
  console.error("");
  console.error(`❌ Error: ${errorMessage}`);

  // Show error code if available
  if (error.code) {
    console.error(`   Code: ${error.code}`);
  }

  // Show hint if available
  if (errorContext.hint || error.hint) {
    console.error(`   Hint: ${errorContext.hint || error.hint}`);
  }

  // Show additional context in debug mode
  if (process.env.DEBUG || process.env.MERITS_DEBUG) {
    console.error("");
    console.error("Debug information:");
    console.error(JSON.stringify({ errorCode, errorContext }, null, 2));
    console.error("");
    console.error("Stack trace:");
    console.error(error.stack);
  }

  console.error("");

  // Exit with non-zero code
  process.exit(1);
});
