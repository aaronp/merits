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
  $ merits init                          # First-time setup
  $ merits gen-key                       # Generate key pair
  $ merits create-user --id <aid> --public-key <key>  # Register user
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
import { createUser } from "./commands/create-user";
import { sign } from "./commands/sign";
import { confirmChallenge } from "./commands/confirm-challenge";
import { signIn } from "./commands/sign-in";
import { whoami } from "./commands/whoami";
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
  allowListAdd,
  allowListRemove,
  allowListList,
  allowListClear,
} from "./commands/allow-list";
import {
  denyListAdd,
  denyListRemove,
  denyListList,
  denyListClear,
} from "./commands/deny-list";

// Old messaging commands (to be removed in Phase 9)
import { receiveMessages } from "./commands/receive";
import { ackMessage } from "./commands/ack";
import { watchMessages } from "./commands/watch";

// Old commands (to be removed in Phase 9)
import { newIdentity } from "./commands/identity/new";
import { listIdentities } from "./commands/identity/list";
import { showIdentity } from "./commands/identity/show";
import { registerIdentity } from "./commands/identity/register";
import { setDefaultIdentity } from "./commands/identity/set-default";
import { exportIdentity } from "./commands/identity/export";
import { importIdentity } from "./commands/identity/import";
import { deleteIdentity } from "./commands/identity/delete";

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

// --- Old Identity Commands (to be removed in Phase 9) ---

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

// Old registration helper commands (replaced by gen-key, create-user, sign, confirm-challenge)
// Commented out - to be removed in Phase 9
// program
//   .command("gen-user")
//   .description("Generate a new user keypair (prints JSON with aid/publicKey/secretKey)")
//   .action((_opts, cmd) => genUser(cmd.opts()));

// program
//   .command("create")
//   .description("Create registration challenge for an AID")
//   .requiredOption("-aid <aid>", "User AID")
//   .requiredOption("-publicKey <publicKey>", "User public key (CESR or base64url)")
//   .action((opts) => createUser(opts));

// program
//   .command("sign-challenge")
//   .description("Submit signed registration challenge to create user")
//   .requiredOption("-aid <aid>", "User AID")
//   .requiredOption("-publicKey <publicKey>", "User public key")
//   .requiredOption("--challenge-id <id>", "Challenge ID returned by create")
//   .option("--sigs <list>", "Comma-separated indexed signatures (idx-b64,idx-b64,...)")
//   .option("--ksn <num>", "Key sequence number", (v) => parseInt(v, 10))
//   .option("--from <identity>", "Sign locally using this identity from vault")
//   .action((opts) => signChallenge(opts));

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
  .description("Bootstrap onboarding group, anon role, and permission mapping")
  .action((opts) => bootstrapOnboardingCmd(opts));

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

// Allow-list command group (Phase 6)
const allowListCmd = program
  .command("allow-list")
  .description("Manage allow-list (whitelist) for messages");

allowListCmd
  .command("add <aid>")
  .description("Add AID to allow-list (enable default-deny mode)")
  .option("--note <text>", "Optional note describing this entry")
  .addHelpText("after", `
When active (non-empty), only AIDs on the allow-list can send you messages.
Deny-list takes priority over allow-list.

Example:
  $ merits allow-list add alice-aid --note "work colleague" --token $TOKEN
  `)
  .action(allowListAdd);

allowListCmd
  .command("remove <aid>")
  .description("Remove AID from allow-list")
  .action(allowListRemove);

allowListCmd
  .command("list")
  .description("List all AIDs on allow-list")
  .addHelpText("after", `
Shows whether allow-list is active and all allowed AIDs.

Example:
  $ merits allow-list list --token $TOKEN --format pretty
  `)
  .action(allowListList);

allowListCmd
  .command("clear")
  .description("Clear entire allow-list (disable default-deny mode)")
  .addHelpText("after", `
Removes all entries from allow-list, returning to default allow-all behavior.

Example:
  $ merits allow-list clear --token $TOKEN
  `)
  .action(allowListClear);

// Deny-list command group (Phase 6)
const denyListCmd = program
  .command("deny-list")
  .description("Manage deny-list (blocklist) for messages");

denyListCmd
  .command("add <aid>")
  .description("Add AID to deny-list (block someone)")
  .option("--reason <text>", "Optional reason for blocking")
  .addHelpText("after", `
Blocked AIDs cannot send you messages. Deny-list takes priority over allow-list.

Example:
  $ merits deny-list add spammer-aid --reason "spam" --token $TOKEN
  `)
  .action(denyListAdd);

denyListCmd
  .command("remove <aid>")
  .description("Remove AID from deny-list (unblock someone)")
  .addHelpText("after", `
Example:
  $ merits deny-list remove alice-aid --token $TOKEN
  `)
  .action(denyListRemove);

denyListCmd
  .command("list")
  .description("List all AIDs on deny-list")
  .addHelpText("after", `
Shows all blocked AIDs with optional reasons.

Example:
  $ merits deny-list list --token $TOKEN --format pretty
  `)
  .action(denyListList);

denyListCmd
  .command("clear")
  .description("Clear entire deny-list (unblock everyone)")
  .addHelpText("after", `
Removes all entries from deny-list, unblocking all previously blocked AIDs.

Example:
  $ merits deny-list clear --token $TOKEN
  `)
  .action(denyListClear);

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
