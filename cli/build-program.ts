/**
 * CLI Program Factory
 *
 * Exports a factory function that creates and configures the Commander program.
 * This separation enables in-process testing without spawning subprocesses.
 *
 * Key differences from cli/index.ts:
 * - Does NOT call program.parseAsync() (caller's responsibility)
 * - Does NOT include error handling or process.exit logic
 * - Returns the configured program ready for parsing
 *
 * Usage:
 * - Production: cli/index.ts calls this, then parseAsync()
 * - Testing: tests call this with exitOverride() and configureOutput()
 */

import { Command } from "commander";
import { loadConfig } from "./lib/config";
import { createMeritsClient } from "../src/client";
import type { CLIContext } from "./lib/context";

// Import commands (new CLI spec from cli.md)
import { genKey } from "./commands/gen-key";
import { incept } from "./commands/incept";
import { createUser } from "./commands/create-user";
import { sign } from "./commands/sign";
import { confirmChallenge } from "./commands/confirm-challenge";
import { signIn } from "./commands/sign-in";
import { whoami } from "./commands/whoami";
import { status } from "./commands/status";
import { keyFor } from "./commands/key-for";
import { listUnread } from "./commands/list-unread";
import { unread } from "./commands/unread";
import { markAsRead } from "./commands/mark-as-read";
import { extractIds } from "./commands/extract-ids";
import { sendMessage } from "./commands/send";
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

/**
 * Create and configure the Merits CLI program
 *
 * @returns Configured Commander program (NOT parsed yet)
 */
export function createMeritsProgram(): Command {
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
   * Runs before every command:
   * Creates config and client once at startup.
   * Injected into command options as `_ctx`.
   */
  program.hook("preAction", (thisCommand, actionCommand) => {
    const opts = program.opts();
    const cmdOpts = actionCommand.opts();

    // Merge program opts with command opts (command takes precedence)
    const mergedOpts = { ...opts, ...cmdOpts };

    // Load config with 4-layer precedence
    const config = loadConfig(mergedOpts.config, {
      dataDir: mergedOpts.dataDir,
      backend: mergedOpts.convexUrl ? { type: "convex", url: mergedOpts.convexUrl } : undefined,
      outputFormat: mergedOpts.format,
      verbose: mergedOpts.verbose,
      color: mergedOpts.color,
    });

    // Create Merits client (backend-agnostic)
    const client = createMeritsClient(config);

    // Inject context into command options
    const ctx: CLIContext = { config, client };
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
      // Close client connection
      ctx.client.close();
    }
  });

  // --- Commands ---

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
    .command("status")
    .description("Display comprehensive user status (roles, groups, public key, session TTL)")
    .addHelpText("after", `
Displays detailed user status including:
  - User's current role(s)
  - Group memberships
  - Public key on record
  - Session token TTL and validity

Output includes:
  - aid: User's AID
  - roles: Array of assigned roles (e.g., ["user"], ["admin"])
  - groups: Array of group memberships with names, roles, and join times
  - publicKey: Currently registered public key
  - session: Session token expiration and validity status

Examples:
  $ merits status --format pretty
  $ merits status --token /path/to/session.json
  $ merits status --format json

Use Cases:
  - Check your current permissions and access level
  - Verify which groups you're a member of
  - Monitor session expiration
  - Confirm your public key registration
  `)
    .action(status);

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
    .command("mark-as-read [ids...]")
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
  // encrypt and decrypt commands removed - encryption now handled by backend

  program
    .command("verify-signature")
    .description("Verify Ed25519 signature")
    .option("--signed-file <path>", "Path to signed message JSON (or use stdin)")
    .action(verifySignature);

  // Send command
  program
    .command("send <recipient>")
    .description("Send encrypted message to recipient")
    .option("--message <text>", "Message text to encrypt and send (or use stdin)")
    .option("--raw <ciphertext>", "Pre-encrypted ciphertext (base64url, requires --alg)")
    .option("--credentials <path>", "Path to credentials JSON file")
    .option("--ttl <ms>", "Time-to-live in milliseconds (default: 24h)", parseInt)
    .option("--typ <type>", "Message type for routing/authorization (e.g., 'chat.text')")
    .option("--ek <key>", "Ephemeral key (for raw mode)")
    .option("--alg <algorithm>", "Encryption algorithm (required for --raw mode)")
    .addHelpText("after", `
Two Modes:

  1. Normal Mode (--message):
     Encrypts plaintext with recipient's public key using libsodium sealed boxes.

     Examples:
       $ merits send <recipient-aid> --message "Hello"
       $ merits send <recipient-aid> --message "Hello" --typ "chat.text"
       $ echo "Hello" | merits send <recipient-aid>

  2. Raw Mode (--raw):
     Sends pre-encrypted ciphertext as-is (for custom encryption).

     Examples:
       $ merits send <recipient-aid> --raw <base64url-ct> --alg "x25519-xsalsa20poly1305"
       $ merits send <recipient-aid> --raw <base64url-ct> --alg "custom" --ek <ephemeral-key>

Authentication:
  - Requires credentials (--credentials or MERITS_CREDENTIALS env var)
  - Each send is signed with per-request signature
  - RBAC enforced on backend (role-based permissions)

Output:
  Returns JSON with messageId, recipient, and sentAt timestamp
  `)
    .action(sendMessage);

  // RBAC admin commands
  const rolesCmd = program
    .command("roles")
    .description("Manage roles");

  rolesCmd
    .command("create <roleName>")
    .requiredOption("--actionSAID <said>", "Reference to governance action")
    .action(rolesCreate);

  rolesCmd
    .command("add-permission <roleName> <key>")
    .requiredOption("--actionSAID <said>", "Reference to governance action")
    .action(rolesAddPermission);

  const permsCmd = program
    .command("permissions")
    .description("Manage permissions");

  permsCmd
    .command("create <key>")
    .option("--data <json>", "JSON-encoded data payload")
    .requiredOption("--actionSAID <said>", "Reference to governance action")
    .action(permissionsCreate);

  const usersCmd = program
    .command("users")
    .description("Manage users");

  usersCmd
    .command("grant-role <aid> <roleName>")
    .option("--token <path>", "Admin session token file")
    .requiredOption("--actionSAID <said>", "Reference to governance action")
    .action(usersGrantRole);


  // Group command group (Phase 4)
  const groupCmd = program
    .command("group")
    .description("Manage groups");

  groupCmd
    .command("create <name>")
    .description("Create a new group")
    .option("--description <text>", "Group description")
    .action(createGroup);

  groupCmd
    .command("list")
    .description("List all groups (owned, admin, or member)")
    .option("--format <type>", "Output format (json|text|compact)")
    .action(listGroups);

  groupCmd
    .command("info <group-id>")
    .description("Show detailed group information")
    .option("--format <type>", "Output format (json|text)")
    .action(groupInfo);

  groupCmd
    .command("add <group-id> <member-aid>")
    .description("Add member to group")
    .option("--role <type>", "Member role (member|admin)", "member")
    .action(addGroupMember);

  groupCmd
    .command("remove <group-id> <member-aid>")
    .description("Remove member from group")
    .action(removeGroupMember);

  groupCmd
    .command("leave <group-id>")
    .description("Leave a group")
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

  // RBAC command group (alias for users/roles commands)
  const rbacCmd = program
    .command("rbac")
    .description("Role-Based Access Control management (alias for users/roles commands)");

  const rbacUsersCmd = rbacCmd
    .command("users")
    .description("Manage user roles");

  rbacUsersCmd
    .command("grant-role <aid> <roleName>")
    .option("--credentials <path>", "Admin credentials JSON file")
    .option("--token <path>", "Admin session token file")
    .option("--action-said <said>", "Reference to governance action")
    .action(async (userAid: string, roleName: string, opts: any) => {
      try {
        // Get context from global state
        const ctx = (globalThis as any).__cliContext;
        if (!ctx) {
          throw new Error("CLI context not initialized");
        }

        // Load admin credentials
        const { requireCredentials } = await import("./lib/credentials");
        const creds = requireCredentials(opts.credentials);

        // Sign the request
        const { signMutationArgs } = await import("../core/signatures");
        const { base64UrlToUint8Array } = await import("../core/crypto");
        const { api } = await import("../convex/_generated/api");

        const privateKeyBytes = base64UrlToUint8Array(creds.privateKey);
        const args = {
          userAID: userAid,
          roleName: roleName,
          actionSAID: opts.actionSaid || "cli/grant-role",
        };
        const sig = await signMutationArgs(args, privateKeyBytes, creds.aid);

        // Call backend mutation
        await ctx.client.convex.mutation(api.permissions_admin.grantRoleToUser, {
          ...args,
          sig,
        });

        const format = opts.format || "json";
        if (format === "json") {
          console.log(JSON.stringify({ success: true, aid: userAid, role: roleName }, null, 2));
        } else {
          console.log(`✅ Granted role ${roleName} to ${userAid}`);
        }
      } catch (err) {
        console.error(`Error granting role: ${(err as Error).message}`);
        process.exit(1);
      }
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

  // IMPORTANT: Do NOT call program.parseAsync() here
  // That's the caller's responsibility
  return program;
}
