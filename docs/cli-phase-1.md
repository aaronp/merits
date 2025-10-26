# CLI Milestone 0: Core Infrastructure

**Status**: 🔄 In Progress
**Started**: 2025-01-26
**Target Completion**: Week 1
**Actual Completion**: TBD

---

## Overview

Establish the foundational CLI framework, vault abstraction for secure credential management, configuration system, and output formatting. This milestone provides the infrastructure for all subsequent CLI features.

**Related Documentation**:
- [CLI Roadmap](./roadmap-cli.md) - Overall CLI development plan
- [CLI Design Plan](./cli-plan.md) - Comprehensive design
- [CLI Plan (Updated Review)](./merits-cli-plan-updated.md) - Auth optimizations

---

## Goals

### Primary Goals
1. ✅ Set up CLI framework with commander.js
2. ✅ Implement MeritsVault interface with OS Keychain integration
3. ✅ Create configuration management system
4. ✅ Build output formatters (json, text, compact)
5. ✅ Implement auth helper (`getAuthProof`)
6. ✅ Establish project structure

### Secondary Goals
- Unit tests for all core modules
- Documentation for each component
- Error handling patterns
- Logging infrastructure

---

## Architecture

### Project Structure

```
merits/
├── cli/
│   ├── index.ts                    # Entry point (#!/usr/bin/env bun)
│   ├── commands/                   # Command implementations (future)
│   ├── lib/
│   │   ├── vault/                  # Credential management
│   │   │   ├── MeritsVault.ts      # Interface definition
│   │   │   ├── OSKeychainVault.ts  # OS Keychain implementation
│   │   │   ├── EncryptedFileVault.ts # Fallback (future)
│   │   │   └── index.ts            # Vault factory
│   │   ├── getAuthProof.ts         # Challenge signing helper
│   │   ├── config.ts               # Config management
│   │   ├── formatters.ts           # Output formatting
│   │   └── client-factory.ts       # Create MeritsClient
│   └── types.ts                    # CLI-specific TypeScript types
├── tests/cli/
│   ├── unit/                       # Unit tests
│   └── integration/                # Integration tests (future)
└── package.json                    # Updated with CLI dependencies
```

---

## Deliverables

### 1. CLI Framework

**File**: `cli/index.ts`

**Purpose**: Entry point for the `merits` binary

**Implementation**:
```typescript
#!/usr/bin/env bun
import { Command } from 'commander';
import { version } from '../package.json';

const program = new Command();

program
  .name('merits')
  .description('Merits messaging CLI - KERI-authenticated secure messaging')
  .version(version);

// Global options
program
  .option('--format <type>', 'Output format (json|text|compact)', 'text')
  .option('--verbose', 'Show detailed envelope data', false)
  .option('--from <aid>', 'Identity to use')
  .option('--config <path>', 'Config file path', '~/.merits/config.json')
  .option('--no-color', 'Disable colored output')
  .option('--debug', 'Enable debug logging');

// Commands will be added in future milestones

program.parse();
```

**Features**:
- ✅ Shebang for direct execution
- ✅ Version flag
- ✅ Global options (format, verbose, etc.)
- ✅ Help text generation
- ✅ Argument parsing

---

### 2. MeritsVault Interface

**File**: `cli/lib/vault/MeritsVault.ts`

**Purpose**: Abstract interface for secure credential management

**Interface Definition**:
```typescript
/**
 * MeritsVault - Secure credential storage abstraction
 *
 * Isolates credential management from the CLI.
 * Private keys never leave the vault.
 */
export interface MeritsVault {
  /**
   * Store a new identity (securely stores private key)
   */
  storeIdentity(name: string, identity: {
    aid: string;
    privateKey: Uint8Array;
    ksn: number;
    metadata?: Record<string, any>;
  }): Promise<void>;

  /**
   * Retrieve identity metadata (NOT private key)
   */
  getIdentity(name: string): Promise<{
    aid: string;
    ksn: number;
    metadata?: Record<string, any>;
  }>;

  /**
   * List all identity names
   */
  listIdentities(): Promise<string[]>;

  /**
   * Sign data with identity's private key
   * Returns KERI indexed signatures (e.g., "0-abc123...")
   * Key never leaves vault
   */
  signIndexed(name: string, data: Uint8Array): Promise<string[]>;

  /**
   * Decrypt ciphertext using identity's private key
   * Key never leaves vault
   */
  decrypt(
    name: string,
    ct: string,
    opts?: { ek?: string; alg?: string }
  ): Promise<string>;

  /**
   * Export private key (requires confirmation/authentication)
   * Used for backup/transfer only
   */
  exportPrivateKey(name: string): Promise<Uint8Array>;

  /**
   * Delete an identity
   */
  deleteIdentity(name: string): Promise<void>;
}
```

**Design Principles**:
- 🔐 Private keys never exposed directly
- 🔑 Signing happens inside vault
- 📦 Decryption happens inside vault
- 🧩 Future-proof for multisig (indexed signatures)

---

### 3. OS Keychain Vault Implementation

**File**: `cli/lib/vault/OSKeychainVault.ts`

**Purpose**: Primary vault implementation using OS native credential storage

**Dependencies**:
```json
{
  "keytar": "^7.9.0"  // Cross-platform OS keychain access
}
```

**Implementation**:
```typescript
import * as keytar from 'keytar';
import { sign, verify } from '../../../core/crypto';
import type { MeritsVault } from './MeritsVault';

const SERVICE_NAME = 'com.merits.cli';

/**
 * OSKeychainVault - Stores private keys in OS credential store
 *
 * - macOS: Keychain
 * - Linux: Secret Service API (libsecret)
 * - Windows: Credential Manager
 */
export class OSKeychainVault implements MeritsVault {
  private metadataPath: string;
  private metadata: IdentityMetadata;

  constructor(metadataPath = '~/.merits/identities.json') {
    this.metadataPath = expandPath(metadataPath);
    this.metadata = this.loadMetadata();
  }

  async storeIdentity(name: string, identity: {
    aid: string;
    privateKey: Uint8Array;
    ksn: number;
    metadata?: Record<string, any>;
  }): Promise<void> {
    // Store private key in OS keychain
    const privateKeyHex = Buffer.from(identity.privateKey).toString('hex');
    await keytar.setPassword(SERVICE_NAME, name, privateKeyHex);

    // Store metadata in JSON file (public data only)
    this.metadata.identities[name] = {
      aid: identity.aid,
      ksn: identity.ksn,
      name,
      createdAt: Date.now(),
      vaultProvider: 'os-keychain',
      metadata: identity.metadata
    };

    await this.saveMetadata();
  }

  async getIdentity(name: string): Promise<{
    aid: string;
    ksn: number;
    metadata?: Record<string, any>;
  }> {
    const identity = this.metadata.identities[name];
    if (!identity) {
      throw new Error(`Identity not found: ${name}`);
    }

    return {
      aid: identity.aid,
      ksn: identity.ksn,
      metadata: identity.metadata
    };
  }

  async listIdentities(): Promise<string[]> {
    return Object.keys(this.metadata.identities);
  }

  async signIndexed(name: string, data: Uint8Array): Promise<string[]> {
    const privateKey = await this.getPrivateKey(name);
    const signature = await sign(data, privateKey);

    // Create indexed signature (format: "0-base64sig")
    const sigBase64 = uint8ArrayToBase64Url(signature);
    return [`0-${sigBase64}`];
  }

  async decrypt(
    name: string,
    ct: string,
    opts?: { ek?: string; alg?: string }
  ): Promise<string> {
    const privateKey = await this.getPrivateKey(name);

    // For now: simple base64 decoding (mock decryption)
    // Future: X25519 + XChaCha20-Poly1305
    return Buffer.from(ct, 'base64').toString('utf-8');
  }

  async exportPrivateKey(name: string): Promise<Uint8Array> {
    // This should prompt for OS authentication (Touch ID, etc.)
    const privateKey = await this.getPrivateKey(name);
    return privateKey;
  }

  async deleteIdentity(name: string): Promise<void> {
    await keytar.deletePassword(SERVICE_NAME, name);
    delete this.metadata.identities[name];
    await this.saveMetadata();
  }

  // Private helper
  private async getPrivateKey(name: string): Promise<Uint8Array> {
    const privateKeyHex = await keytar.getPassword(SERVICE_NAME, name);
    if (!privateKeyHex) {
      throw new Error(`Private key not found for: ${name}`);
    }
    return Buffer.from(privateKeyHex, 'hex');
  }

  private loadMetadata(): IdentityMetadata {
    if (!fs.existsSync(this.metadataPath)) {
      return { version: 1, defaultIdentity: null, identities: {} };
    }
    return JSON.parse(fs.readFileSync(this.metadataPath, 'utf-8'));
  }

  private async saveMetadata(): Promise<void> {
    const dir = path.dirname(this.metadataPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      this.metadataPath,
      JSON.stringify(this.metadata, null, 2),
      { mode: 0o600 }
    );
  }
}
```

**Security Features**:
- ✅ Private keys stored in OS keychain (encrypted by OS)
- ✅ Touch ID / Windows Hello integration (OS-level)
- ✅ Metadata file permissions: 0600 (owner only)
- ✅ No plaintext keys on disk
- ✅ Signing happens in-process (keys retrieved only for operation)

---

### 4. Vault Factory

**File**: `cli/lib/vault/index.ts`

**Purpose**: Auto-detect best vault for platform

**Implementation**:
```typescript
import { OSKeychainVault } from './OSKeychainVault';
import type { MeritsVault } from './MeritsVault';

/**
 * Check if OS keychain is available
 */
function isOSKeychainAvailable(): boolean {
  try {
    require.resolve('keytar');
    return true;
  } catch {
    return false;
  }
}

/**
 * Create vault instance (auto-detect best available)
 */
export function createVault(config?: {
  metadataPath?: string;
}): MeritsVault {
  if (isOSKeychainAvailable()) {
    return new OSKeychainVault(config?.metadataPath);
  }

  // Fallback to encrypted file vault (future)
  console.warn('⚠ OS keychain not available, using encrypted file vault');
  throw new Error('EncryptedFileVault not yet implemented');
}

export type { MeritsVault };
export { OSKeychainVault };
```

---

### 5. Auth Helper

**File**: `cli/lib/getAuthProof.ts`

**Purpose**: Unified helper for KERI challenge signing

**Implementation**:
```typescript
import type { MeritsClient } from '../../src/client';
import type { MeritsVault } from './vault/MeritsVault';
import type { AuthProof } from '../../core/types';

/**
 * Get authentication proof for a Merits operation
 *
 * Handles the complete challenge/response flow:
 * 1. Issue challenge from server
 * 2. Sign payload with vault
 * 3. Return AuthProof
 *
 * @example
 * const auth = await getAuthProof({
 *   client,
 *   vault,
 *   identityName: "alice",
 *   purpose: "send",
 *   args: { recpAid: bobAid, ctHash: "abc123", ttl: 60000 }
 * });
 */
export async function getAuthProof(params: {
  client: MeritsClient;
  vault: MeritsVault;
  identityName: string;
  purpose: 'send' | 'receive' | 'ack' | 'receiveAndAck' | 'admin' | 'manageGroup';
  args?: Record<string, unknown>;
}): Promise<AuthProof> {
  const { client, vault, identityName, purpose, args = {} } = params;

  // Get identity metadata
  const identity = await vault.getIdentity(identityName);

  // Issue challenge
  const challenge = await client.identity.issueChallenge({
    aid: identity.aid,
    purpose: purpose as any,
    args
  });

  // Canonical JSON encoding for signing
  const canonical = JSON.stringify(
    challenge.payloadToSign,
    Object.keys(challenge.payloadToSign).sort()
  );
  const data = new TextEncoder().encode(canonical);

  // Sign with vault (key never leaves vault)
  const sigs = await vault.signIndexed(identityName, data);

  return {
    challengeId: challenge.challengeId,
    sigs,
    ksn: identity.ksn
  };
}
```

**Benefits**:
- ✅ Single point for all auth flows
- ✅ Consistent canonical JSON encoding
- ✅ Type-safe purpose parameter
- ✅ Vault abstraction (works with any vault implementation)

---

### 6. Configuration Management

**File**: `cli/lib/config.ts`

**Purpose**: Load/save configuration with precedence

**Config Format** (`~/.merits/config.json`):
```json
{
  "version": 1,
  "convexUrl": "https://accurate-penguin-901.convex.cloud",
  "defaultIdentity": "alice",
  "outputFormat": "text",
  "watchInterval": 1000,
  "autoMarkRead": true,
  "verboseByDefault": false
}
```

**Implementation**:
```typescript
import * as fs from 'fs';
import * as path from 'path';

export interface MeritsConfig {
  version: number;
  convexUrl?: string;
  defaultIdentity?: string;
  outputFormat?: 'json' | 'text' | 'compact';
  watchInterval?: number;
  autoMarkRead?: boolean;
  verboseByDefault?: boolean;
}

const DEFAULT_CONFIG: MeritsConfig = {
  version: 1,
  outputFormat: 'text',
  watchInterval: 1000,
  autoMarkRead: true,
  verboseByDefault: false
};

/**
 * Load configuration with precedence:
 * 1. CLI flags (passed as overrides)
 * 2. Environment variables
 * 3. Config file
 * 4. Built-in defaults
 */
export function loadConfig(
  configPath = '~/.merits/config.json',
  overrides: Partial<MeritsConfig> = {}
): MeritsConfig {
  const expandedPath = expandPath(configPath);

  // Start with defaults
  let config = { ...DEFAULT_CONFIG };

  // Layer 3: Config file
  if (fs.existsSync(expandedPath)) {
    const fileConfig = JSON.parse(fs.readFileSync(expandedPath, 'utf-8'));
    config = { ...config, ...fileConfig };
  }

  // Layer 2: Environment variables
  const envConfig: Partial<MeritsConfig> = {
    convexUrl: process.env.MERITS_CONVEX_URL || process.env.CONVEX_URL,
    defaultIdentity: process.env.MERITS_DEFAULT_IDENTITY,
    outputFormat: process.env.MERITS_FORMAT as any
  };
  config = { ...config, ...envConfig };

  // Layer 1: CLI overrides
  config = { ...config, ...overrides };

  return config;
}

/**
 * Save configuration to file
 */
export function saveConfig(
  config: MeritsConfig,
  configPath = '~/.merits/config.json'
): void {
  const expandedPath = expandPath(configPath);
  const dir = path.dirname(expandedPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(
    expandedPath,
    JSON.stringify(config, null, 2),
    { mode: 0o600 }
  );
}

function expandPath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(process.env.HOME || '~', p.slice(2));
  }
  return p;
}
```

**Precedence Example**:
```bash
# Config file: outputFormat = "text"
# Env var: MERITS_FORMAT=json
# CLI flag: --format compact

# Result: "compact" (CLI flag wins)
```

---

### 7. Output Formatters

**File**: `cli/lib/formatters.ts`

**Purpose**: Consistent output formatting across all commands

**Implementation**:
```typescript
import chalk from 'chalk';
import type { EncryptedMessage } from '../../core/interfaces/Transport';

export type OutputFormat = 'json' | 'text' | 'compact';

/**
 * Format messages for display
 */
export function formatMessages(
  messages: EncryptedMessage[],
  format: OutputFormat,
  verbose = false
): string {
  switch (format) {
    case 'json':
      return formatJSON(messages, verbose);
    case 'text':
      return formatText(messages, verbose);
    case 'compact':
      return formatCompact(messages);
    default:
      throw new Error(`Unknown format: ${format}`);
  }
}

/**
 * JSON format - machine-readable
 */
function formatJSON(messages: EncryptedMessage[], verbose: boolean): string {
  if (verbose) {
    return JSON.stringify(messages, null, 2);
  }

  // Minimal JSON (exclude senderProof unless verbose)
  const minimal = messages.map(m => ({
    id: m.id,
    from: m.from,
    to: m.to,
    ct: m.ct,
    typ: m.typ,
    createdAt: m.createdAt,
    expiresAt: m.expiresAt
  }));

  return JSON.stringify(minimal, null, 2);
}

/**
 * Text format - human-readable with colors
 */
function formatText(messages: EncryptedMessage[], verbose: boolean): string {
  const lines: string[] = [];

  lines.push(chalk.bold(`${messages.length} message(s)\n`));

  for (const msg of messages) {
    lines.push(chalk.cyan(`From: ${msg.from}`));
    lines.push(chalk.cyan(`To: ${msg.to}`));
    lines.push(`Type: ${msg.typ || 'unknown'}`);
    lines.push(`Time: ${new Date(msg.createdAt).toLocaleString()}`);

    if (verbose) {
      lines.push(`Expires: ${new Date(msg.expiresAt).toLocaleString()}`);
      lines.push('');
      lines.push(chalk.gray('Envelope:'));
      lines.push(chalk.gray(`  ID: ${msg.id}`));
      lines.push(chalk.gray(`  Hash: ${msg.envelopeHash}`));
      lines.push('');
      lines.push(chalk.gray('Sender Proof:'));
      lines.push(chalk.gray(`  KSN: ${msg.senderProof.ksn}`));
      lines.push(chalk.gray(`  Signature: ${msg.senderProof.sigs[0]}`));
    }

    lines.push('');
    lines.push(chalk.white(msg.ct)); // Will be decrypted plaintext in future
    lines.push('');
    lines.push(chalk.gray('---'));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Compact format - one line per message
 */
function formatCompact(messages: EncryptedMessage[]): string {
  return messages.map(msg => {
    const time = new Date(msg.createdAt).toLocaleTimeString();
    const from = truncateAID(msg.from);
    const to = truncateAID(msg.to);
    const content = msg.ct.substring(0, 50); // Preview
    return `[${time}] ${from}→${to}: ${content}`;
  }).join('\n');
}

/**
 * Truncate AID for compact display
 */
function truncateAID(aid: string, length = 8): string {
  if (aid.length <= length) return aid;
  return aid.substring(0, length) + '...';
}
```

**Output Examples**:

**JSON**:
```json
[
  {
    "id": "j5768kc28d1gwe1f9n24xnneyn7t2vbq",
    "from": "DHytGsw0r-wYg0DSf_4l_D594hXtKH_e5-zMIdlM",
    "to": "DXaNTrBG50YwcTLZw2YCkCmKNl2cELpuH-EjDCmdCaXU",
    "ct": "SGVsbG8gQWxpY2Uh",
    "typ": "chat.text.v1",
    "createdAt": 1705329322000,
    "expiresAt": 1705415722000
  }
]
```

**Text**:
```
1 message(s)

From: DHytGsw0r-wYg0DSf_4l_D594hXtKH_e5-zMIdlM
To: DXaNTrBG50YwcTLZw2YCkCmKNl2cELpuH-EjDCmdCaXU
Type: chat.text.v1
Time: 1/15/2024, 2:35:22 PM

Hello Alice!

---
```

**Compact**:
```
[14:35:22] DHytGsw0...→DXaNTrBG... Hello Alice!
```

---

## Testing

### Unit Tests

**Location**: `tests/cli/unit/`

**Coverage**:

1. **Vault Tests** (`vault.test.ts`):
```typescript
test("store and retrieve identity metadata", async () => {
  const vault = createVault();

  await vault.storeIdentity("alice", {
    aid: "DHytG...",
    privateKey: new Uint8Array(32),
    ksn: 0
  });

  const identity = await vault.getIdentity("alice");
  expect(identity.aid).toBe("DHytG...");
  expect(identity.ksn).toBe(0);
});

test("sign data with vault", async () => {
  const vault = createVault();
  const data = new TextEncoder().encode("test");

  const sigs = await vault.signIndexed("alice", data);
  expect(sigs).toHaveLength(1);
  expect(sigs[0]).toMatch(/^0-/); // Indexed signature format
});
```

2. **Config Tests** (`config.test.ts`):
```typescript
test("load config with precedence", () => {
  const config = loadConfig('~/.merits/config.json', {
    outputFormat: 'json'
  });

  expect(config.outputFormat).toBe('json'); // Override wins
});
```

3. **Formatter Tests** (`formatters.test.ts`):
```typescript
test("format messages as JSON", () => {
  const messages = [{ id: "msg1", from: "alice", ... }];
  const output = formatMessages(messages, 'json');

  expect(() => JSON.parse(output)).not.toThrow();
});
```

4. **Auth Helper Tests** (`getAuthProof.test.ts`):
```typescript
test("getAuthProof returns valid proof", async () => {
  const proof = await getAuthProof({
    client: mockClient,
    vault: mockVault,
    identityName: "alice",
    purpose: "send",
    args: { recpAid: "bob" }
  });

  expect(proof.challengeId).toBeDefined();
  expect(proof.sigs).toHaveLength(1);
  expect(proof.ksn).toBe(0);
});
```

---

## Success Criteria

### Functional
- ✅ CLI boots with `merits --help`
- ✅ Can create vault and store credentials
- ✅ Can load/save config with precedence
- ✅ Can format output in json/text/compact
- ✅ Can sign challenges via vault
- ✅ All unit tests passing

### Security
- ✅ Private keys stored in OS keychain
- ✅ Metadata file has 0600 permissions
- ✅ Keys never exposed in plaintext
- ✅ Signing happens inside vault

### Code Quality
- ✅ TypeScript strict mode
- ✅ All interfaces documented
- ✅ Error handling consistent
- ✅ Logging infrastructure ready

---

## Dependencies Added

```json
{
  "dependencies": {
    "commander": "^11.1.0",
    "chalk": "^5.3.0",
    "ora": "^8.0.1",
    "keytar": "^7.9.0"
  }
}
```

---

## Next Steps

After Milestone 0 completion:
1. Create completion document
2. Begin Milestone 1 (Identity Management)
3. Implement `merits init` command
4. Implement `merits id:*` commands

---

**Status**: 🔄 In Progress
**Completion**: TBD
**Next Milestone**: [Milestone 1: Identity Management](./roadmap-cli.md#milestone-1-identity-management)
