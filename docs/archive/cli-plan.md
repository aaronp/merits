# Merits CLI Design Plan

**Status**: Planning Phase
**Created**: 2025-01-26

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Design Decisions](#design-decisions)
3. [Command Reference](#command-reference)
4. [Output Formats](#output-formats)
5. [Credential Management](#credential-management)
6. [Piping & Scripting](#piping--scripting)
7. [Implementation Plan](#implementation-plan)
8. [Testing Strategy](#testing-strategy)

---

## Architecture Overview

### Project Structure Decision

**Approach**: Hybrid Monorepo

Keep CLI within `merits/cli/` directory while maintaining the ability to publish the library separately from the CLI binary.

```
merits/
├── cli/
│   ├── index.ts              # Entry point (#!/usr/bin/env bun)
│   ├── commands/
│   │   ├── init.ts           # merits init
│   │   ├── identity.ts       # merits id:* commands
│   │   ├── send.ts           # merits send
│   │   ├── unread.ts         # merits unread
│   │   ├── mark-read.ts      # merits mark-read
│   │   ├── watch.ts          # merits watch
│   │   └── group.ts          # merits group:* commands
│   ├── lib/
│   │   ├── vault/            # Credential management (pluggable)
│   │   │   ├── MeritsVault.ts       # Interface for signing/credential access
│   │   │   ├── OSKeychainVault.ts   # macOS Keychain implementation
│   │   │   ├── EncryptedFileVault.ts # PBKDF2+AES fallback (future)
│   │   │   └── index.ts             # Vault factory (auto-detect platform)
│   │   ├── config.ts         # Config file (~/.merits/config.json)
│   │   ├── formatters.ts     # Output formatters (json|text|compact)
│   │   ├── interactive.ts    # Interactive mode (@clack/prompts)
│   │   ├── encryption.ts     # Message encryption helpers
│   │   │                     # - fetchPublicKeyFor(aid)
│   │   │                     # - encryptMessage(msg, publicKey)
│   │   │                     # - encryptForRecipient(msg, aid) [ergonomic]
│   │   └── client-factory.ts # Create authenticated MeritsClient
│   ├── types.ts              # CLI-specific TypeScript types
│   └── README.md             # CLI quick reference
├── core/                      # Existing backend-agnostic code
├── src/client.ts             # Existing unified SDK
└── package.json              # Add "bin" field for CLI
```

### Rationale

**Pros**:
- Development simplicity (single repo, shared code)
- Direct TypeScript source access (no build step for dev)
- Easy to keep CLI in sync with API changes
- Can publish as two packages: `@merits/core` (lib) + `merits` (CLI)

**Cons**:
- Need careful dependency management (CLI deps vs lib deps)
- Slightly larger repo size

**Publishing Strategy**:
- Use workspace packages or "files" field in package.json
- Library users install `@merits/core` (no CLI deps)
- CLI users install `merits` globally (includes all deps)

---

## Design Decisions

### 1. Credential Storage (MeritsVault)

**Decision**: Pluggable vault interface with OS Keychain as primary implementation

**Architecture**: Abstract credential management behind `MeritsVault` interface

**Interface**:
```typescript
interface MeritsVault {
  /** Store a new identity (securely stores private key) */
  storeIdentity(name: string, identity: {
    aid: string;
    privateKey: Uint8Array;
    ksn: number;
    metadata?: Record<string, any>;
  }): Promise<void>;

  /** Retrieve identity metadata (NOT private key) */
  getIdentity(name: string): Promise<{
    aid: string;
    ksn: number;
    metadata?: Record<string, any>;
  }>;

  /** List all identity names */
  listIdentities(): Promise<string[]>;

  /** Sign data with identity's private key (key never leaves vault) */
  sign(identityName: string, data: Uint8Array): Promise<Uint8Array>;

  /** Export private key (requires confirmation/authentication) */
  exportPrivateKey(identityName: string): Promise<Uint8Array>;

  /** Delete an identity */
  deleteIdentity(name: string): Promise<void>;
}
```

**Primary Implementation**: `OSKeychainVault`

Uses native OS credential storage:
- **macOS**: Keychain (`security` command-line tool or `keytar` library)
- **Linux**: Secret Service API (libsecret via `keytar`)
- **Windows**: Credential Manager (via `keytar`)

**Benefits**:
- No passphrase prompts (OS handles authentication)
- Integration with system security (Touch ID, Windows Hello)
- Private keys never written to disk unencrypted
- Follows OS security best practices

**Metadata Storage**: `~/.merits/identities.json` (public data only)
```json
{
  "version": 1,
  "defaultIdentity": "alice",
  "identities": {
    "alice": {
      "aid": "DHytGsw0r-wYg0DSf_4l_D594hXtKH_e5-zMIdlM",
      "ksn": 0,
      "name": "Alice (Personal)",
      "createdAt": 1705329130000,
      "vaultProvider": "os-keychain"
    },
    "bob-work": {
      "aid": "DXaNTrBG50YwcTLZw2YCkCmKNl2cELpuH-EjDCmdCaXU",
      "ksn": 0,
      "name": "Bob (Work)",
      "createdAt": 1705329145000,
      "vaultProvider": "os-keychain"
    }
  }
}
```

**Private Keys**: Stored in OS keychain with service name `com.merits.cli`

**Fallback Implementation** (Future): `EncryptedFileVault`

For systems without OS keychain support (headless servers, etc.):
- PBKDF2 + AES-256-GCM encryption
- Configurable passphrase policy (regex-based rules)
- Stored at `~/.merits/vault.encrypted`
- Passphrase required for each operation (with optional session caching)

**Vault Selection**:
```typescript
// cli/lib/vault/index.ts
export function createVault(config?: VaultConfig): MeritsVault {
  // Auto-detect best vault for platform
  if (isOSKeychainAvailable()) {
    return new OSKeychainVault();
  }

  // Fallback to encrypted file (requires passphrase)
  console.warn("OS keychain not available, using encrypted file vault");
  return new EncryptedFileVault(config?.passphrase);
}
```

**Usage in CLI**:
```typescript
const vault = createVault();

// Store new identity
await vault.storeIdentity("alice", {
  aid: aliceAid,
  privateKey: alicePrivateKey,
  ksn: 0
});

// Sign without exposing private key
const signature = await vault.sign("alice", messageData);

// Private key never leaves vault!
```

### 2. Configuration File

**Location**: `~/.merits/config.json`

**Format**:
```json
{
  "convexUrl": "https://accurate-penguin-901.convex.cloud",
  "defaultIdentity": "alice",
  "outputFormat": "text",
  "watchInterval": 1000,
  "autoMarkRead": true,
  "verboseByDefault": false
}
```

**Precedence** (highest to lowest):
1. Command-line flags (`--format json`)
2. Environment variables (`MERITS_FORMAT=json`)
3. Config file (`~/.merits/config.json`)
4. Built-in defaults

### 3. Message Encryption

**Decision**: Layered API with ergonomic high-level and flexible low-level functions

**Architecture**: Separate concerns for composability

**Low-Level Functions** (`cli/lib/encryption.ts`):

```typescript
/**
 * Fetch recipient's public key from server
 */
export async function fetchPublicKeyFor(
  client: MeritsClient,
  aid: string
): Promise<Uint8Array> {
  // Query keyState from server, return current public key
  const keyState = await client.identity.getKeyState({ aid });
  return decodeCESRKey(keyState.keys[0]);
}

/**
 * Encrypt message for a specific public key
 *
 * Supports flexible use cases:
 * - Encrypt for intended recipient: encryptMessage(msg, bobPublicKey)
 * - Encrypt for third party: encryptMessage(msg, carolPublicKey)
 *   (e.g., Bob sends to Carol via Alice as intermediary)
 */
export async function encryptMessage(
  plaintext: string,
  recipientPublicKey: Uint8Array,
  options?: {
    alg?: string;  // Encryption algorithm
    generateEK?: boolean;  // Generate ephemeral key for PFS
  }
): Promise<{
  ct: string;     // Base64-encoded ciphertext
  ek?: string;    // Ephemeral key (if PFS enabled)
  alg?: string;   // Algorithm identifier
}> {
  // For now: simple base64 encoding (mock encryption)
  // Future: X25519 + XChaCha20-Poly1305 with ephemeral keys
  const ct = Buffer.from(plaintext).toString('base64');
  return { ct };
}

/**
 * Decrypt message using private key
 */
export async function decryptMessage(
  ct: string,
  privateKey: Uint8Array,
  options?: {
    ek?: string;   // Ephemeral key (if PFS used)
    alg?: string;  // Algorithm identifier
  }
): Promise<string> {
  // For now: simple base64 decoding (mock decryption)
  return Buffer.from(ct, 'base64').toString('utf-8');
}
```

**High-Level Ergonomic Function**:

```typescript
/**
 * Encrypt message for a recipient (by AID)
 *
 * Convenience wrapper that:
 * 1. Fetches recipient's public key from server
 * 2. Encrypts message using that key
 *
 * Use this for 99% of cases.
 */
export async function encryptForRecipient(
  client: MeritsClient,
  plaintext: string,
  recipientAid: string,
  options?: {
    alg?: string;
    generateEK?: boolean;
  }
): Promise<{
  ct: string;
  ek?: string;
  alg?: string;
}> {
  const publicKey = await fetchPublicKeyFor(client, recipientAid);
  return encryptMessage(plaintext, publicKey, options);
}
```

**CLI Usage Modes**:

**Mode 1: Ergonomic (auto-fetch + encrypt)**
```bash
merits send --to alice --message "Hello"
# Internally: encryptForRecipient(client, "Hello", aliceAid)
```

**Mode 2: Custom encryption target**
```bash
# Send to Bob, but encrypt for Carol (Bob will forward)
merits send --to bob \
  --message "Secret for Carol" \
  --encrypt-for carol
# Internally:
#   publicKey = fetchPublicKeyFor(client, carolAid)
#   encrypted = encryptMessage("Secret for Carol", publicKey)
#   send to bob with encrypted.ct
```

**Mode 3: Pre-encrypted (trust the ciphertext)**
```bash
# User provides already-encrypted data
merits send --to alice --ct "SGVsbG8gQWxpY2Uh"
# CLI sends ct as-is, no encryption
# Useful for:
# - Custom encryption schemes
# - Backup/storage (plaintext in ct field)
# - Testing
```

**Mode 4: Low-level composition**
```bash
# For scripting with maximum control
CAROL_PUBKEY=$(merits key:fetch carol --format hex)
ENCRYPTED=$(echo "Hello Carol" | merits encrypt --public-key "$CAROL_PUBKEY")
merits send --to bob --ct "$ENCRYPTED"
```

**Benefits**:
- ✅ Ergonomic for common case (auto-encrypt)
- ✅ Flexible for advanced use (encrypt for third party)
- ✅ Composable (functions work independently)
- ✅ Testable (each layer can be unit tested)
- ✅ No assumptions (can send plaintext if desired)

### 4. Group vs User ID Handling

**Decision**: Unified identifier with auto-detection

**Approach**:
1. CLI accepts any ID (AID or GroupId)
2. Try as user AID first (check keyState exists)
3. If not found, try as GroupId (check group membership)
4. If both fail, show helpful error

**Alternative**: Prefix notation (opt-in via flag)
```bash
merits send --to @alice:AID    # Explicit user
merits send --to #team:GROUP   # Explicit group
merits send --to alice         # Auto-detect
```

Use auto-detect by default, prefix notation for disambiguation.

### 5. Dependencies

**Production Dependencies** (CLI only):
```json
{
  "commander": "^11.1.0",        // CLI argument parsing
  "chalk": "^5.3.0",             // Terminal colors
  "ora": "^8.0.1",               // Spinners for async ops
  "@clack/prompts": "^0.7.0",    // Interactive prompts (already present)
  "keytar": "^7.9.0"             // OS keychain integration (native module)
}
```

**Optional Dependencies** (for fallback vault):
```json
{
  // Only loaded if OS keychain unavailable
  // PBKDF2 + AES-256-GCM already available in Node.js crypto
}
```

**Core Library Dependencies** (no change):
```json
{
  "@noble/ed25519": "^3.0.0",
  "@noble/hashes": "^2.0.1",
  "cesr-ts": "github:weboftrust/cesr-ts",
  "convex": "^1.16.0"
}
```

**Note on `keytar`**:
- Native Node.js module (requires compilation)
- Provides cross-platform OS keychain access
- Graceful fallback if compilation fails
- Alternative: `node-keytar` or direct `security` CLI on macOS

---

## Command Reference

### Interactive Mode

**Command**: `merits` (no arguments)

**Behavior**: Launches interactive TUI using @clack/prompts

**Flow**:
```
? What would you like to do?
  › Send a message
    Check unread messages
    Manage identities
    Manage groups
    Settings
    Exit
```

Subsequent menus guide user through operations.

### Global Flags

Available on all commands:

| Flag | Description | Default |
|------|-------------|---------|
| `--format <json\|text\|compact>` | Output format | `text` |
| `--verbose` | Show full envelope data | `false` |
| `--from <AID>` | Identity to use | Config default |
| `--config <PATH>` | Alternate config file | `~/.merits/config.json` |
| `--no-color` | Disable colored output | `false` |
| `--passphrase <PASS>` | Keystore passphrase (insecure!) | Prompt |

### Help & Version

**`merits --help`**: Show all commands with examples

**`merits <command> --help`**: Command-specific help

**`merits --version`**: Show version number

### Setup & Configuration

#### `merits init`

Initialize Merits CLI (first-time setup).

**Usage**:
```bash
merits init
```

**Interactive Prompts**:
1. Enter passphrase for keystore encryption
2. Confirm passphrase
3. Enter Convex deployment URL
4. Create first identity? (yes/no)
   - If yes: Enter name for identity
   - Auto-generates keypair and AID

**Output**:
```
✓ Keystore created at ~/.merits/credentials.json
✓ Config created at ~/.merits/config.json
✓ Identity created: alice (DHytG...)

Next steps:
  1. Register your identity: merits id:register alice
  2. Send a message: merits send --to <recipient-aid>
```

**Files Created**:
- `~/.merits/credentials.json` (encrypted keystore)
- `~/.merits/config.json` (configuration)

### Identity Management

#### `merits id:create`

Create a new identity (keypair + AID).

**Usage**:
```bash
merits id:create [--name NAME]
```

**Examples**:
```bash
merits id:create --name "Alice Personal"
merits id:create  # Interactive prompt for name
```

**Output**:
```
✓ Identity created: alice-personal
  AID: DHytGsw0r-wYg0DSf_4l_D594hXtKH_e5-zMIdlM

Next: Register with server using:
  merits id:register alice-personal
```

#### `merits id:list`

List all identities in keystore.

**Usage**:
```bash
merits id:list [--format json|text]
```

**Output (text)**:
```
Identities:
  * alice (default)
    AID: DHytGsw0r-wYg0DSf_4l_D594hXtKH_e5-zMIdlM
    KSN: 0
    Created: 2024-01-15 14:30:00

  bob-work
    AID: DXaNTrBG50YwcTLZw2YCkCmKNl2cELpuH-EjDCmdCaXU
    KSN: 0
    Created: 2024-01-15 14:32:00
```

**Output (json)**:
```json
[
  {
    "name": "alice",
    "aid": "DHytGsw0r-wYg0DSf_4l_D594hXtKH_e5-zMIdlM",
    "ksn": 0,
    "default": true,
    "createdAt": 1705329000000
  },
  {
    "name": "bob-work",
    "aid": "DXaNTrBG50YwcTLZw2YCkCmKNl2cELpuH-EjDCmdCaXU",
    "ksn": 0,
    "default": false,
    "createdAt": 1705329120000
  }
]
```

#### `merits id:export`

Export private key for backup or transfer.

**Usage**:
```bash
merits id:export <identity-name>
```

**Examples**:
```bash
merits id:export alice > alice-key.json
merits id:export alice --format hex
```

**Output (json)**:
```json
{
  "name": "alice",
  "aid": "DHytGsw0r-wYg0DSf_4l_D594hXtKH_e5-zMIdlM",
  "ksn": 0,
  "privateKey": "a1b2c3d4...",
  "publicKeyCESR": "DHytGsw0r-wYg0DSf_4l_D594hXtKH_e5-zMIdlM",
  "exportedAt": 1705329200000
}
```

**Security Warning**: Prompts for confirmation before exporting.

#### `merits id:import`

Import identity from file or stdin.

**Usage**:
```bash
merits id:import <file>
merits id:import < alice-key.json
cat alice-key.json | merits id:import
```

**Example**:
```bash
merits id:import alice-backup.json --name "alice-restored"
```

#### `merits id:register`

Register identity's keyState with Convex backend.

**Usage**:
```bash
merits id:register <identity-name>
```

**Example**:
```bash
merits id:register alice
```

**Output**:
```
Registering identity with server...
✓ KeyState registered for alice (DHytG...)
  KSN: 0
  Keys: 1
  Threshold: 1
```

#### `merits id:set-default`

Set default identity for commands.

**Usage**:
```bash
merits id:set-default <identity-name>
```

**Example**:
```bash
merits id:set-default bob-work
✓ Default identity set to: bob-work
```

### Messaging Commands

#### `merits send`

Send a message to a recipient (user or group).

**Usage**:
```bash
merits send --to <AID|GROUP_ID> [options]
```

**Options**:
- `--to <ID>` (required): Recipient AID or group ID
- `--from <AID>`: Sender identity (default: config default)
- `--message <TEXT>`: Message content (prompts if not provided)
- `--ct <BASE64>`: Pre-encrypted ciphertext (advanced)
- `--typ <TYPE>`: Message type (default: `chat.text.v1`)
- `--ttl <MS>`: Time-to-live in milliseconds (default: 24h)
- `--ek <KEY>`: Ephemeral key (for custom encryption)
- `--alg <ALG>`: Algorithm identifier (for custom encryption)

**Examples**:

**Basic send**:
```bash
merits send --to alice --message "Hello!"
```

**Piped input**:
```bash
echo "Server is up" | merits send --to bob
cat report.txt | merits send --to #team
```

**Interactive (no --message flag)**:
```bash
merits send --to alice
? Enter message: Hello, how are you?
✓ Message sent (ID: j5768kc...)
```

**Send to group**:
```bash
merits send --to #dev-team --message "Deploy complete"
```

**Custom type**:
```bash
merits send --to alice --message '{"action":"subscribe"}' --typ "app.command.v1"
```

**Output**:
```
✓ Message sent
  To: alice (DHytG...)
  ID: j5768kc28d1gwe1f9n24xnneyn7t2vbq
  Type: chat.text.v1
```

#### `merits unread`

Retrieve unread messages.

**Usage**:
```bash
merits unread [options]
```

**Options**:
- `--from <AID>`: Filter by sender
- `--mark-read <true|false>`: Auto-mark as read (default: `true`)
- `--format <json|text|compact>`: Output format
- `--verbose`: Show full envelope data
- `--limit <N>`: Max messages to retrieve

**Examples**:

**Get all unread**:
```bash
merits unread
```

**Output (text)**:
```
3 unread messages

From: alice (DHytG...)
To: me (DXaNT...)
Time: 2024-01-15 14:35:22
Type: chat.text.v1

Hey, are you free for lunch?

---

From: bob (DPqR9...)
To: me (DXaNT...)
Time: 2024-01-15 14:40:15
Type: chat.text.v1

Meeting at 3pm, don't forget!

---

From: #dev-team
To: me (DXaNT...)
Time: 2024-01-15 14:45:00
Type: chat.text.v1

New deploy to staging
```

**Filter by sender**:
```bash
merits unread --from alice
```

**Don't auto-mark as read**:
```bash
merits unread --mark-read=false
```

**JSON format for scripting**:
```bash
merits unread --format json | jq '.[] | {from, message: .ct | @base64d}'
```

**Compact format**:
```bash
merits unread --format compact
```

**Output (compact)**:
```
[14:35:22] alice→me: Hey, are you free for lunch?
[14:40:15] bob→me: Meeting at 3pm, don't forget!
[14:45:00] #dev-team→me: New deploy to staging
```

#### `merits watch`

Stream messages in real-time (uses subscribe API).

**Usage**:
```bash
merits watch [options]
```

**Options**:
- `--from <AID>`: Filter by sender (watch specific user)
- `--format <json|text|compact>`: Output format
- `--mark-read <true|false>`: Auto-acknowledge (default: `true`)

**Examples**:

**Watch all incoming**:
```bash
merits watch
```

**Output**:
```
Watching for messages... (Ctrl+C to stop)

[14:50:33] alice→me: Quick question
[14:51:10] bob→me: Done with the task
[14:52:45] #team→me: Standup in 5 mins
```

**Watch specific sender**:
```bash
merits watch --from alice
```

**JSON stream for processing**:
```bash
merits watch --format json | while read msg; do
  echo "$msg" | jq '.ct | @base64d'
done
```

#### `merits mark-read`

Explicitly mark message(s) as read.

**Usage**:
```bash
merits mark-read <MESSAGE_ID> [MESSAGE_ID...]
```

**Examples**:
```bash
merits mark-read j5768kc28d1gwe1f9n24xnneyn7t2vbq
merits mark-read msg1 msg2 msg3
```

**Output**:
```
✓ Marked 3 messages as read
```

### Group Management

#### `merits group:create`

Create a new group.

**Usage**:
```bash
merits group:create --name <NAME> [options]
```

**Options**:
- `--name <NAME>` (required): Group name
- `--members <AID,AID,...>`: Initial members (comma-separated)
- `--from <AID>`: Creator identity

**Examples**:
```bash
merits group:create --name "Dev Team" --members alice,bob,carol
```

**Output**:
```
✓ Group created: Dev Team
  ID: grp_abc123xyz
  Members: 4 (including you)

Send messages with:
  merits send --to grp_abc123xyz
```

#### `merits group:list`

List all groups.

**Usage**:
```bash
merits group:list [--format json|text]
```

**Output (text)**:
```
Your groups:

Dev Team (grp_abc123xyz)
  Members: 4
  Role: owner
  Created: 2024-01-15 10:00:00

Marketing (grp_xyz789abc)
  Members: 8
  Role: member
  Created: 2024-01-10 15:30:00
```

#### `merits group:info`

Show group details.

**Usage**:
```bash
merits group:info <GROUP_ID>
```

**Output**:
```
Group: Dev Team
ID: grp_abc123xyz
Created: 2024-01-15 10:00:00
Created by: alice (DHytG...)

Members (4):
  * alice (DHytG...) - owner
    bob (DXaNT...) - admin
    carol (DPqR9...) - member
    dave (DKlM2...) - member
```

#### `merits group:add`

Add members to a group.

**Usage**:
```bash
merits group:add --group <GROUP_ID> --members <AID,AID,...>
```

**Example**:
```bash
merits group:add --group grp_abc123xyz --members eve,frank
```

**Permissions**: Requires admin or owner role.

#### `merits group:remove`

Remove members from a group.

**Usage**:
```bash
merits group:remove --group <GROUP_ID> --members <AID,AID,...>
```

**Example**:
```bash
merits group:remove --group grp_abc123xyz --members eve
```

**Permissions**: Requires admin or owner role.

#### `merits group:leave`

Leave a group.

**Usage**:
```bash
merits group:leave <GROUP_ID>
```

**Example**:
```bash
merits group:leave grp_abc123xyz
```

**Note**: Owners must transfer ownership before leaving.

---

## Output Formats

### Text Format (Default)

Human-readable with colors and formatting.

**Single Message**:
```
From: alice (DHytGsw0r-wYg0DSf_4l_D594hXtKH_e5-zMIdlM)
To: bob (DXaNTrBG50YwcTLZw2YCkCmKNl2cELpuH-EjDCmdCaXU)
Type: chat.text.v1
Time: 2024-01-15 14:35:22

Hey, are you free for lunch?
```

**With `--verbose`**:
```
From: alice (DHytGsw0r-wYg0DSf_4l_D594hXtKH_e5-zMIdlM)
To: bob (DXaNTrBG50YwcTLZw2YCkCmKNl2cELpuH-EjDCmdCaXU)
Type: chat.text.v1
Time: 2024-01-15 14:35:22
Expires: 2024-01-16 14:35:22

Envelope:
  ID: j5768kc28d1gwe1f9n24xnneyn7t2vbq
  Hash: e4f8a9b2c7d1e3f5a6b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0

Sender Proof:
  KSN: 0
  Signature: 0-K8j5eh1qHOt3yQ5M1BFLya84P4WBXpjkjZS14Hez8F-vicimqe8GlzEIDOg...
  Event SAID: evt-alice-0

Message:
Hey, are you free for lunch?
```

### Compact Format

One line per message, minimal formatting.

**Format**: `[TIME] SENDER→RECIPIENT: MESSAGE`

**Example**:
```
[14:35:22] alice→bob: Hey, are you free for lunch?
[14:40:15] bob→alice: Sure! Where?
[14:42:30] alice→bob: Corner cafe at 12:30?
```

### JSON Format

Machine-readable, suitable for piping and scripting.

**Single Message**:
```json
{
  "id": "j5768kc28d1gwe1f9n24xnneyn7t2vbq",
  "from": "DHytGsw0r-wYg0DSf_4l_D594hXtKH_e5-zMIdlM",
  "to": "DXaNTrBG50YwcTLZw2YCkCmKNl2cELpuH-EjDCmdCaXU",
  "ct": "SGVsbG8sIGFyZSB5b3UgZnJlZSBmb3IgbHVuY2g/",
  "typ": "chat.text.v1",
  "createdAt": 1705329322000,
  "expiresAt": 1705415722000,
  "envelopeHash": "e4f8a9b2c7d1e3f5a6b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0"
}
```

**With `--verbose`** (adds senderProof):
```json
{
  "id": "j5768kc28d1gwe1f9n24xnneyn7t2vbq",
  "from": "DHytGsw0r-wYg0DSf_4l_D594hXtKH_e5-zMIdlM",
  "to": "DXaNTrBG50YwcTLZw2YCkCmKNl2cELpuH-EjDCmdCaXU",
  "ct": "SGVsbG8sIGFyZSB5b3UgZnJlZSBmb3IgbHVuY2g/",
  "typ": "chat.text.v1",
  "createdAt": 1705329322000,
  "expiresAt": 1705415722000,
  "envelopeHash": "e4f8a9b2c7d1e3f5a6b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0",
  "senderProof": {
    "sigs": ["0-K8j5eh1qHOt3yQ5M1BFLya84P4WBXpjkjZS14Hez8F-vicimqe8GlzEIDOg..."],
    "ksn": 0,
    "evtSaid": "evt-alice-0"
  }
}
```

**Array of Messages**:
```json
[
  {
    "id": "msg1",
    "from": "alice",
    "to": "bob",
    "ct": "...",
    "createdAt": 1705329322000
  },
  {
    "id": "msg2",
    "from": "bob",
    "to": "alice",
    "ct": "...",
    "createdAt": 1705329450000
  }
]
```

---

## Credential Management

### Vault-Based Architecture

**Primary**: OS Keychain via `MeritsVault` interface (see Design Decision #1)

Private keys stored in:
- **macOS**: Keychain (service: `com.merits.cli`)
- **Linux**: Secret Service (libsecret)
- **Windows**: Credential Manager

**No passphrase prompts** - OS handles authentication (Touch ID, etc.)

### Fallback: EncryptedFileVault (Future)

For systems without OS keychain (headless servers, unsupported platforms):

**File**: `~/.merits/vault.encrypted`

**Permissions**: `0600` (read/write for owner only)

**Encryption Algorithm**: AES-256-GCM via PBKDF2-derived key

**Passphrase Policy**: Regex-based validation (configurable)

**Default Rules**:
```typescript
const passphraseRules = [
  {
    regex: /.{12,}/,
    description: "At least 12 characters"
  },
  {
    regex: /[A-Z]/,
    description: "At least one uppercase letter"
  },
  {
    regex: /[a-z]/,
    description: "At least one lowercase letter"
  },
  {
    regex: /[0-9]/,
    description: "At least one number"
  },
  {
    regex: /[^A-Za-z0-9]/,
    description: "At least one special character"
  }
];

function validatePassphrase(passphrase: string): {
  valid: boolean;
  failedRules: string[];
} {
  const failed = passphraseRules
    .filter(rule => !rule.regex.test(passphrase))
    .map(rule => rule.description);

  return {
    valid: failed.length === 0,
    failedRules: failed
  };
}
```

**Custom Rules** (via config):
```json
{
  "vault": {
    "type": "encrypted-file",
    "passphraseRules": [
      {
        "regex": "^.{16,}$",
        "description": "At least 16 characters"
      },
      {
        "regex": "[A-Z].*[A-Z]",
        "description": "At least two uppercase letters"
      }
    ]
  }
}
```

**Validation Feedback**:
```bash
merits init
? Enter passphrase for vault: ********
✗ Passphrase does not meet requirements:
  • At least 12 characters
  • At least one number
  • At least one special character

? Enter passphrase for vault: MyP@ssw0rd123
✓ Passphrase meets all requirements
```

**Key Derivation** (PBKDF2):
```typescript
const salt = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.deriveKey(
  {
    name: "PBKDF2",
    salt,
    iterations: 600000,  // OWASP 2023 recommendation
    hash: "SHA-256"
  },
  passphraseKey,
  { name: "AES-GCM", length: 256 },
  false,
  ["encrypt", "decrypt"]
);
```

### Passphrase Management (EncryptedFileVault only)

**Session Caching**:
- Prompt once per CLI session
- Store in memory (never on disk)
- Clear on exit or after 15 min inactivity

**Environment Variable** (insecure, for automation):
```bash
export MERITS_PASSPHRASE="my-secret"
merits send --to alice --message "automated message"
```

**Warning displayed**:
```
⚠ Warning: Using passphrase from environment variable
  This is insecure and should only be used in trusted environments.
  Consider using OS keychain vault instead.
```

### Backup & Recovery

**OS Keychain Vault**:
- Export identities: `merits id:export alice > alice-backup.json`
- Import on new system: `merits id:import alice-backup.json`
- OS keychain syncs automatically (macOS iCloud Keychain, etc.)

**EncryptedFileVault**:
```bash
# Backup encrypted vault
cp ~/.merits/vault.encrypted ~/merits-backup-2024-01-15.encrypted
cp ~/.merits/identities.json ~/merits-backup-2024-01-15-meta.json

# Restore
cp ~/merits-backup-2024-01-15.encrypted ~/.merits/vault.encrypted
cp ~/merits-backup-2024-01-15-meta.json ~/.merits/identities.json
```

**Change Passphrase** (EncryptedFileVault):
```bash
merits vault:change-passphrase
? Enter current passphrase: ****
? Enter new passphrase: ****
✗ Passphrase does not meet requirements:
  • At least one special character

? Enter new passphrase: ****
? Confirm new passphrase: ****
✓ Passphrase changed successfully
```

---

## Piping & Scripting

### Input Piping

**Send Message from Pipe**:
```bash
echo "Deploy complete" | merits send --to bob
cat report.txt | merits send --to #team
curl https://api.example.com/status | merits send --to alice
```

**Import Identity**:
```bash
cat alice-key.json | merits id:import
```

### Output Piping

**Process JSON Output**:
```bash
# Extract sender AIDs
merits unread --format json | jq '.[] | .from'

# Count messages per sender
merits unread --format json | jq 'group_by(.from) | map({sender: .[0].from, count: length})'

# Decrypt and save messages
merits unread --format json | jq -r '.[] | .ct' | base64 -d > messages.txt
```

**Watch and Process**:
```bash
# Alert on messages from specific sender
merits watch --format json | while read msg; do
  sender=$(echo "$msg" | jq -r '.from')
  if [ "$sender" = "$ALICE_AID" ]; then
    notify-send "Message from Alice" "$(echo "$msg" | jq -r '.ct | @base64d')"
  fi
done
```

### Scripting Examples

**Automated Notification Script**:
```bash
#!/bin/bash
# notify-on-message.sh

RECIPIENT_AID="DHytGsw0r..."
MERITS_PASSPHRASE="my-secret"

export MERITS_PASSPHRASE

merits watch --from "$RECIPIENT_AID" --format json | while read msg; do
  content=$(echo "$msg" | jq -r '.ct | @base64d')
  timestamp=$(echo "$msg" | jq -r '.createdAt')

  # Send to notification system
  curl -X POST https://notifications.example.com/alert \
    -H "Content-Type: application/json" \
    -d "{\"message\": \"$content\", \"timestamp\": $timestamp}"
done
```

**Batch Send Script**:
```bash
#!/bin/bash
# batch-send.sh

RECIPIENTS="alice bob carol dave"

for recipient in $RECIPIENTS; do
  echo "Deployment complete at $(date)" | \
    merits send --to "$recipient" --typ "ops.notification.v1"
  echo "✓ Sent to $recipient"
done
```

**Health Check Script**:
```bash
#!/bin/bash
# health-check.sh

# Check if any critical alerts in last 5 minutes
ALERTS=$(merits unread --from "$MONITORING_AID" --format json | \
  jq '[.[] | select(.createdAt > (now - 300000))]')

if [ "$(echo "$ALERTS" | jq 'length')" -gt 0 ]; then
  echo "CRITICAL: $(echo "$ALERTS" | jq 'length') alerts in last 5 minutes"
  echo "$ALERTS" | jq -r '.[] | .ct | @base64d'
  exit 1
fi

echo "OK: No recent alerts"
exit 0
```

---

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1)

**Goal**: CLI framework and credential management

**Tasks**:
1. Set up commander.js CLI framework
2. Implement keystore encryption/decryption
3. Implement config file management
4. Create output formatters (json, text, compact)
5. Add passphrase prompting and validation
6. Set up project structure (`cli/` directory)

**Files**:
- `cli/index.ts` - Entry point
- `cli/lib/keystore.ts` - Encrypted storage
- `cli/lib/config.ts` - Config management
- `cli/lib/formatters.ts` - Output formatting
- `cli/types.ts` - TypeScript definitions

**Tests**:
- Keystore encryption/decryption
- Config file read/write
- Format conversions

**Milestone**: Can create keystore, store/retrieve credentials securely

### Phase 2: Identity Commands (Week 1-2)

**Goal**: Full identity lifecycle management

**Commands**:
- `merits init`
- `merits id:create`
- `merits id:list`
- `merits id:export`
- `merits id:import`
- `merits id:register`
- `merits id:set-default`

**Files**:
- `cli/commands/init.ts`
- `cli/commands/identity.ts`
- `cli/lib/client-factory.ts` - Create authenticated client

**Tests**:
- Identity creation
- Import/export roundtrip
- Keystore integration
- Server registration

**Milestone**: Can manage multiple identities, register with server

### Phase 3: Messaging Commands (Week 2-3)

**Goal**: Send and receive messages

**Commands**:
- `merits send`
- `merits unread`
- `merits mark-read`

**Files**:
- `cli/commands/send.ts`
- `cli/commands/unread.ts`
- `cli/commands/mark-read.ts`
- `cli/lib/crypto-helpers.ts` - Auto-encryption

**Features**:
- Auto-encryption of plaintext
- Message type handling
- TTL configuration
- Recipient validation (user vs group)

**Tests**:
- Send message end-to-end
- Receive and decrypt
- Mark as read workflow
- Piping support

**Milestone**: Can send/receive encrypted messages via CLI

### Phase 4: Advanced Features (Week 3-4)

**Goal**: Real-time streaming and group management

**Commands**:
- `merits watch`
- `merits group:create`
- `merits group:list`
- `merits group:info`
- `merits group:add`
- `merits group:remove`
- `merits group:leave`

**Files**:
- `cli/commands/watch.ts`
- `cli/commands/group.ts`

**Features**:
- Subscribe API integration
- Real-time message streaming
- Group role management
- Server-side fanout testing

**Tests**:
- Watch streaming
- Group CRUD operations
- Permission enforcement

**Milestone**: Full-featured CLI with real-time and groups

### Phase 5: Interactive Mode & Polish (Week 4)

**Goal**: User experience enhancements

**Features**:
- Interactive mode using @clack/prompts
- Comprehensive help text
- Colorized output with chalk
- Progress spinners with ora
- Error messages with suggestions
- Tab completion scripts (bash/zsh)

**Files**:
- `cli/lib/interactive.ts`
- `cli/lib/help-text.ts`
- `cli/completions/` - Shell completion scripts

**Tests**:
- Interactive flow testing
- Help text coverage
- Error handling

**Milestone**: Production-ready CLI

### Phase 6: Documentation & Publishing (Week 5)

**Goal**: Package and release

**Tasks**:
1. Write comprehensive CLI usage guide
2. Create example scripts
3. Set up npm packaging
4. Configure binary permissions
5. Test installation flow
6. Create release process

**Documentation**:
- `docs/cli-usage.md` - User guide
- `cli/README.md` - Quick reference
- `docs/cli-examples.md` - Script examples

**Publishing**:
- Publish `@merits/core` (library only)
- Publish `merits` (CLI binary)
- NPM registry setup
- Version management

**Milestone**: Published to npm, ready for users

---

## Testing Strategy

### Unit Tests

**Location**: `tests/cli/unit/`

**Coverage**:
- Keystore encryption/decryption
- Config file parsing
- Output formatters
- Crypto helpers
- Argument parsing

**Example**:
```typescript
// tests/cli/unit/keystore.test.ts
import { test, expect } from "bun:test";
import { Keystore } from "../../../cli/lib/keystore";

test("encrypt and decrypt credentials", async () => {
  const keystore = new Keystore();
  const passphrase = "test-passphrase";

  const credentials = {
    alice: { privateKey: "a1b2c3..." }
  };

  const encrypted = await keystore.encrypt(credentials, passphrase);
  const decrypted = await keystore.decrypt(encrypted, passphrase);

  expect(decrypted).toEqual(credentials);
});
```

### Integration Tests

**Location**: `tests/cli/integration/`

**Coverage**:
- Full command workflows
- End-to-end messaging
- Identity lifecycle
- Group operations

**Example**:
```typescript
// tests/cli/integration/send-receive.test.ts
import { test, expect } from "bun:test";
import { runCLI } from "../helpers/cli-runner";

test("send and receive message via CLI", async () => {
  // Setup
  await runCLI(["init"]);
  await runCLI(["id:create", "--name", "alice"]);
  await runCLI(["id:create", "--name", "bob"]);

  // Send
  const sendResult = await runCLI([
    "send",
    "--from", "alice",
    "--to", bobAid,
    "--message", "Hello Bob!"
  ]);
  expect(sendResult.exitCode).toBe(0);

  // Receive
  const unreadResult = await runCLI([
    "unread",
    "--from", bobAid,
    "--format", "json"
  ]);
  const messages = JSON.parse(unreadResult.stdout);
  expect(messages.length).toBe(1);
  expect(messages[0].from).toBe(aliceAid);
});
```

### CLI Test Helpers

**CLI Runner**:
```typescript
// tests/cli/helpers/cli-runner.ts
export async function runCLI(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(["bun", "cli/index.ts", ...args], {
    env: {
      MERITS_PASSPHRASE: "test-passphrase",
      MERITS_CONFIG: tempConfigPath,
      CONVEX_URL: process.env.CONVEX_URL
    }
  });

  const stdout = await proc.text();
  const exitCode = proc.exitCode;

  return { exitCode, stdout, stderr: "" };
}
```

### Test Scenarios

**Identity Management**:
- ✅ Create identity
- ✅ List identities
- ✅ Export/import roundtrip
- ✅ Set default identity
- ✅ Register with server

**Messaging**:
- ✅ Send plaintext message (auto-encrypt)
- ✅ Send pre-encrypted message
- ✅ Receive and auto-mark-read
- ✅ Receive without marking read
- ✅ Explicit mark-read
- ✅ Filter messages by sender
- ✅ Pipe input to send
- ✅ Pipe output from unread

**Groups**:
- ✅ Create group
- ✅ List groups
- ✅ Add/remove members
- ✅ Send to group
- ✅ Leave group

**Streaming**:
- ✅ Watch all messages
- ✅ Watch from specific sender
- ✅ Auto-acknowledge on watch

**Output Formats**:
- ✅ JSON output valid
- ✅ Text output readable
- ✅ Compact format correct
- ✅ Verbose flag shows envelope

**Error Handling**:
- ✅ Invalid AID error
- ✅ Wrong passphrase error
- ✅ Network error handling
- ✅ Missing credentials error

---

## Design Decisions - Confirmed

The following design decisions have been confirmed by the user:

### ✅ 1. Credential Storage
**Decision**: OS Keychain integration via `MeritsVault` interface (primary)

- Uses `keytar` library for cross-platform OS keychain access
- Fallback to `EncryptedFileVault` (PBKDF2 + AES-256-GCM) for unsupported systems
- Vault abstraction allows future pluggability (hardware tokens, etc.)
- Private keys never leave vault - signing happens inside vault

**Rationale**: Maximum security with minimal user friction (no passphrase prompts on supported systems)

### ✅ 2. Message Encryption
**Decision**: Layered API with ergonomic high-level and composable low-level functions

**Low-level**:
- `fetchPublicKeyFor(aid)` - Get recipient's public key
- `encryptMessage(msg, publicKey)` - Encrypt for specific key
- `decryptMessage(ct, privateKey)` - Decrypt message

**High-level**:
- `encryptForRecipient(msg, aid)` - Auto-fetch key and encrypt

**CLI Modes**:
- `--message TEXT` - Auto-encrypt for `--to` recipient (default)
- `--message TEXT --encrypt-for AID` - Encrypt for third party
- `--ct BASE64` - Pre-encrypted, trust as-is (no encryption)

**Rationale**: Ergonomic for 99% use case, flexible for advanced scenarios (forwarding, backup, custom crypto)

### ✅ 3. Default Configuration
**Decision**: Support `~/.merits/config.json` for defaults

Includes:
- `convexUrl` - Backend URL
- `defaultIdentity` - Which AID to use by default
- `outputFormat` - json|text|compact
- `autoMarkRead` - Auto-acknowledge messages
- `watchInterval` - Polling interval for watch mode

**Precedence**: CLI flags > Environment vars > Config file > Built-in defaults

**Rationale**: Reduces typing, improves UX for repeated operations

### ✅ 4. Group/User ID Handling
**Decision**: Auto-detect with optional prefix notation

- Try as user AID first (check keyState)
- If not found, try as group ID
- Optional prefix for disambiguation: `@user:AID` vs `#group:ID`

**Rationale**: Clean, unified interface - groups and users look the same to end user

### ✅ 5. Binary Distribution
**Decision**: npm package `merits` with global install

```bash
npm install -g merits
# or
bun install -g merits
```

**Publishing**:
- `@merits/core` - Library package (no CLI deps)
- `merits` - CLI binary (depends on @merits/core)

**Rationale**: Standard Node.js distribution, familiar to developers

### ✅ 6. Passphrase Policy (EncryptedFileVault only)
**Decision**: Regex-based validation with configurable rules

**Default rules** (12+ chars, upper, lower, number, special character)
- Users can override via config
- Each rule has regex + description for clear feedback
- Not needed for OS Keychain vault (OS handles auth)

**Rationale**: Flexible, extensible, clear user feedback on failed validation

### ✅ 7. Binary Name
**Decision**: `merits`

**Rationale**: Simple, memorable, matches project name

---

## Additional Design Decisions

### 8. Rate Limiting
**Decision**: Respect server rate limits with exponential backoff

- Detect 429 responses
- Exponential backoff (1s, 2s, 4s, 8s, etc.)
- Configurable max retries (default: 5)
- Show spinner during backoff

**Rationale**: Prevents hammering server, better UX than immediate failure

### 9. Logging
**Decision**: `--debug` flag for verbose logging to stderr

- Normal output to stdout (for piping)
- Errors and debug to stderr
- Optional `--log-file PATH` for persistent logs

**Rationale**: Separates data from diagnostics, supports piping

---

## Appendix

### Related Documentation

- [Architecture](./architecture.md) - System design
- [API Reference](./api-reference.md) - TypeScript API
- [Migration Plan](./migration-plan.md) - Development roadmap

### External Dependencies

**Production**:
- [commander](https://github.com/tj/commander.js) - CLI framework
- [chalk](https://github.com/chalk/chalk) - Terminal colors
- [ora](https://github.com/sindresorhus/ora) - Spinners
- [@clack/prompts](https://github.com/natemoo-re/clack) - Interactive prompts

**Development**:
- [bun:test](https://bun.sh/docs/cli/test) - Testing framework

### Future Enhancements

**Phase 7+** (post-MVP):
- Multi-backend support (switch between Convex, Firebase, etc.)
- Message search (`merits search --query "keyword"`)
- Contact management (`merits contacts:add alice --aid DHytG...`)
- Message threading/replies
- Read receipts
- Typing indicators (via presence)
- Desktop notifications (via `node-notifier`)
- Tab completion for bash/zsh/fish
- Man pages
- Emoji support in messages
- Message editing/deletion
- File attachments (upload to storage, send reference)
- End-to-end encrypted group chat (client-side fanout option)

---

**Status**: ✅ Planning Complete - Design Approved

**Design Highlights**:
- 🔐 **MeritsVault** interface with OS Keychain integration (primary)
- 🔑 Layered encryption API (ergonomic + composable)
- 📦 Pluggable vault architecture (PBKDF2+AES fallback)
- 🎯 Regex-based passphrase validation
- 🔄 Auto-detect user vs group IDs
- 📊 Multiple output formats (json|text|compact)
- 🚀 Production-ready architecture

**Next Steps**:
1. ✅ Design decisions confirmed
2. Begin Phase 1 implementation (Core Infrastructure)
3. Iterate based on testing feedback

**Key Architectural Wins**:
- Private keys never leave vault (sign inside vault)
- Encryption functions composable for advanced use cases
- Clean separation: ergonomic wrapper delegates to low-level primitives
- Platform-specific vault selection with graceful fallback