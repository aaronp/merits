# CLI Milestone 0: Refinements & Polish

**Based on**: Technical review of cli-milestone-0.md
**Date**: 2025-01-26

---

## Overview

This document captures the refinements to add before closing Milestone 0, based on detailed technical review. These enhancements strengthen reliability, reduce I/O overhead, and future-proof the architecture for upcoming auth flow optimizations.

**Rating**: 90-95% complete, ready for polish phase

---

## Refinements to Implement

### 1. Vault Metadata Caching

**Issue**: Current design reads/writes `~/.merits/identities.json` on every operation

**Improvement**: Lazy-load metadata once, cache in memory, persist on updates

**Implementation**:

```typescript
// cli/lib/vault/OSKeychainVault.ts

export class OSKeychainVault implements MeritsVault {
  private metadataPath: string;
  private metadata: IdentityMetadata | null = null;  // Lazy-loaded
  private metadataDirty = false;

  constructor(metadataPath = '~/.merits/identities.json') {
    this.metadataPath = expandPath(metadataPath);
    // Don't load yet - wait for first access
  }

  private getMetadata(): IdentityMetadata {
    if (!this.metadata) {
      this.metadata = this.loadMetadata();
    }
    return this.metadata;
  }

  private markDirty(): void {
    this.metadataDirty = true;
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

    // Update cached metadata
    const meta = this.getMetadata();
    meta.identities[name] = {
      aid: identity.aid,
      ksn: identity.ksn,
      name,
      createdAt: Date.now(),
      vaultProvider: 'os-keychain',
      metadata: identity.metadata
    };

    this.markDirty();
    await this.flush();  // Write to disk
  }

  async flush(): Promise<void> {
    if (!this.metadataDirty || !this.metadata) {
      return;  // No changes to persist
    }

    const dir = path.dirname(this.metadataPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(
      this.metadataPath,
      JSON.stringify(this.metadata, null, 2),
      { mode: 0o600 }
    );

    this.metadataDirty = false;
  }

  // Auto-flush on process exit
  private setupAutoFlush(): void {
    process.on('exit', () => {
      if (this.metadataDirty && this.metadata) {
        // Synchronous write on exit
        fs.writeFileSync(
          this.metadataPath,
          JSON.stringify(this.metadata, null, 2),
          { mode: 0o600 }
        );
      }
    });
  }
}
```

**Benefits**:
- ✅ Reduces FS reads from N to 1 per CLI session
- ✅ Batches writes (only flush when dirty)
- ✅ Auto-flush on exit ensures durability
- ✅ Better performance for long-running CLI sessions

**Effort**: 🟢 Easy (30 min)

---

### 2. Config Schema Validation

**Issue**: Malformed config files cause runtime errors

**Improvement**: Validate config against schema on load

**Implementation**:

```typescript
// cli/lib/config.ts

import Ajv from 'ajv';

const configSchema = {
  type: 'object',
  properties: {
    version: { type: 'number', enum: [1] },
    convexUrl: { type: 'string', format: 'uri' },
    defaultIdentity: { type: 'string' },
    outputFormat: { type: 'string', enum: ['json', 'text', 'compact'] },
    watchInterval: { type: 'number', minimum: 100, maximum: 30000 },
    autoMarkRead: { type: 'boolean' },
    verboseByDefault: { type: 'boolean' }
  },
  required: ['version'],
  additionalProperties: false
};

const ajv = new Ajv({ allErrors: true });
const validateConfig = ajv.compile(configSchema);

export function loadConfig(
  configPath = '~/.merits/config.json',
  overrides: Partial<MeritsConfig> = {}
): MeritsConfig {
  const expandedPath = expandPath(configPath);

  // Start with defaults
  let config = { ...DEFAULT_CONFIG };

  // Layer 3: Config file (with validation)
  if (fs.existsSync(expandedPath)) {
    const fileContent = fs.readFileSync(expandedPath, 'utf-8');
    let fileConfig: any;

    try {
      fileConfig = JSON.parse(fileContent);
    } catch (err) {
      throw new Error(`Invalid JSON in config file: ${expandedPath}\n${err.message}`);
    }

    // Validate schema
    if (!validateConfig(fileConfig)) {
      const errors = validateConfig.errors?.map(e =>
        `  • ${e.instancePath || 'config'}: ${e.message}`
      ).join('\n');
      throw new Error(`Invalid config file: ${expandedPath}\n${errors}`);
    }

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
```

**Error Message Example**:
```
Error: Invalid config file: ~/.merits/config.json
  • /outputFormat: must be equal to one of the allowed values
  • /watchInterval: must be >= 100

Please fix the config file or remove it to use defaults.
```

**Dependencies**:
```json
{
  "ajv": "^8.12.0",
  "ajv-formats": "^2.1.1"
}
```

**Benefits**:
- ✅ Catches config errors early with clear messages
- ✅ Enforces value constraints (e.g., watchInterval >= 100)
- ✅ Prevents runtime crashes from bad config
- ✅ Aligns with schema-first design philosophy

**Effort**: 🟢 Easy (45 min)

---

### 3. Async Formatters (Future-Proof)

**Issue**: Formatters currently synchronous, but future decryption needs async

**Improvement**: Make formatters async now to avoid breaking changes later

**Implementation**:

```typescript
// cli/lib/formatters.ts

/**
 * Format messages for display
 *
 * Now async to support future decryption via vault
 */
export async function formatMessages(
  messages: EncryptedMessage[],
  format: OutputFormat,
  options: {
    verbose?: boolean;
    vault?: MeritsVault;      // Optional: decrypt messages
    identityName?: string;
  } = {}
): Promise<string> {
  const { verbose = false, vault, identityName } = options;

  // If vault provided, decrypt messages first
  let displayMessages = messages;
  if (vault && identityName) {
    displayMessages = await Promise.all(
      messages.map(async msg => {
        try {
          const plaintext = await vault.decrypt(identityName, msg.ct, {
            ek: msg.ek,
            alg: msg.alg
          });
          return { ...msg, ct: plaintext, decrypted: true };
        } catch (err) {
          // Decryption failed, show ciphertext
          return { ...msg, decrypted: false };
        }
      })
    );
  }

  switch (format) {
    case 'json':
      return formatJSON(displayMessages, verbose);
    case 'text':
      return formatText(displayMessages, verbose);
    case 'compact':
      return formatCompact(displayMessages);
    default:
      throw new Error(`Unknown format: ${format}`);
  }
}
```

**Usage** (future):
```typescript
// Milestone 2: Show decrypted messages
const output = await formatMessages(messages, 'text', {
  vault,
  identityName: config.defaultIdentity,
  verbose: options.verbose
});

console.log(output);
```

**Benefits**:
- ✅ No breaking changes when adding decryption
- ✅ Clean separation: vault handles crypto, formatter handles display
- ✅ Graceful fallback if decryption fails

**Effort**: 🟢 Easy (30 min)

---

### 4. Commander PreAction Hook

**Issue**: Each command will need to load config and vault - duplicated setup

**Improvement**: Centralize context loading in preAction hook

**Implementation**:

```typescript
// cli/index.ts

import { Command } from 'commander';
import { loadConfig } from './lib/config';
import { createVault } from './lib/vault';
import { createMeritsClient } from '../src/client';

const program = new Command();

// Global context (available to all commands)
interface GlobalContext {
  config: MeritsConfig;
  vault: MeritsVault;
  client: MeritsClient;
}

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

// Setup hook - runs before every command
program.hook('preAction', (thisCommand, actionCommand) => {
  const opts = program.opts();

  // Load config (with CLI overrides)
  const config = loadConfig(opts.config, {
    outputFormat: opts.format,
    verboseByDefault: opts.verbose,
    defaultIdentity: opts.from
  });

  // Validate required config
  if (!config.convexUrl) {
    console.error('Error: CONVEX_URL not configured');
    console.error('Set via:');
    console.error('  • Config file: ~/.merits/config.json');
    console.error('  • Environment: CONVEX_URL=...');
    console.error('  • Or run: merits init');
    process.exit(1);
  }

  // Create vault
  const vault = createVault();

  // Create client
  const client = createMeritsClient(config.convexUrl);

  // Attach to command context
  actionCommand.setOptionValue('_ctx', {
    config,
    vault,
    client
  } as GlobalContext);

  // Setup debug logging if requested
  if (opts.debug) {
    // Enable debug mode
    process.env.DEBUG = 'merits:*';
  }

  // Disable colors if requested
  if (!opts.color) {
    chalk.level = 0;
  }
});

// Commands can now access context via opts()._ctx
program
  .command('send')
  .option('--to <aid>', 'Recipient AID')
  .option('--message <text>', 'Message content')
  .action(async (options) => {
    const ctx: GlobalContext = options._ctx;

    // Use ctx.config, ctx.vault, ctx.client
    // ...
  });

program.parse();
```

**Benefits**:
- ✅ Centralized setup (DRY principle)
- ✅ Config validation happens once
- ✅ Vault/client available to all commands
- ✅ Easy to add telemetry/logging later
- ✅ Clear error messages for missing config

**Effort**: 🟢 Easy (1 hour)

---

### 5. Auth Helper Extensions

**Issue**: Future auth flows (session tokens, receiveAndAck) need placeholder support

**Improvement**: Add forward-compatible purpose types and session token helper

**Implementation**:

```typescript
// cli/lib/getAuthProof.ts

/**
 * Auth purposes (forward-compatible with future flows)
 */
export type AuthPurpose =
  | 'send'
  | 'receive'
  | 'ack'
  | 'receiveAndAck'      // Milestone 2: Combined operation
  | 'openSession'        // Milestone 3: Session token
  | 'admin'
  | 'manageGroup';

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
  purpose: AuthPurpose;
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
  // Use deterministic base64url encoding (no newline padding)
  const sigs = await vault.signIndexed(identityName, data);

  return {
    challengeId: challenge.challengeId,
    sigs,
    ksn: identity.ksn
  };
}

/**
 * Open a session for streaming operations (Milestone 3)
 *
 * TODO: Implement when backend supports session tokens
 * See: merits-cli-plan-updated.md for session token spec
 *
 * @example
 * const session = await getSessionToken({
 *   client,
 *   vault,
 *   identityName: "alice",
 *   scopes: ["ack"],
 *   ttl: 60000
 * });
 */
export async function getSessionToken(params: {
  client: MeritsClient;
  vault: MeritsVault;
  identityName: string;
  scopes: string[];
  ttl?: number;
}): Promise<{ sessionToken: string; expiresAt: number }> {
  // TODO: Implement in Milestone 3
  throw new Error('Session tokens not yet implemented (Milestone 3)');
}
```

**Benefits**:
- ✅ Type-safe purpose enum prevents typos
- ✅ Placeholder for session tokens (clear roadmap)
- ✅ Documents future auth flows
- ✅ Smooth transition to Milestone 3

**Effort**: 🟢 Easy (15 min)

---

### 6. Error Path Testing

**Issue**: Unit tests only cover happy paths

**Improvement**: Add error-path tests for each module

**Implementation**:

```typescript
// tests/cli/unit/vault.test.ts

test("vault throws on missing identity", async () => {
  const vault = createVault();

  await expect(vault.getIdentity("nonexistent")).rejects.toThrow(
    "Identity not found: nonexistent"
  );
});

test("vault throws on missing private key", async () => {
  const vault = createVault();

  // Store identity but corrupt keychain
  await vault.storeIdentity("alice", {
    aid: "DHytG...",
    privateKey: new Uint8Array(32),
    ksn: 0
  });

  // Manually delete from keychain
  await keytar.deletePassword(SERVICE_NAME, "alice");

  // Should throw when trying to sign
  const data = new TextEncoder().encode("test");
  await expect(vault.signIndexed("alice", data)).rejects.toThrow(
    "Private key not found for: alice"
  );
});
```

```typescript
// tests/cli/unit/config.test.ts

test("config throws on invalid JSON", () => {
  // Create malformed config file
  const tempPath = '/tmp/test-config-invalid.json';
  fs.writeFileSync(tempPath, '{ invalid json }');

  expect(() => loadConfig(tempPath)).toThrow("Invalid JSON in config file");
});

test("config throws on schema violation", () => {
  const tempPath = '/tmp/test-config-schema.json';
  fs.writeFileSync(tempPath, JSON.stringify({
    version: 1,
    outputFormat: "invalid"  // Not in enum
  }));

  expect(() => loadConfig(tempPath)).toThrow("Invalid config file");
});
```

```typescript
// tests/cli/unit/formatters.test.ts

test("formatters throw on unknown format", async () => {
  const messages = [mockMessage];

  await expect(
    formatMessages(messages, 'xml' as any)
  ).rejects.toThrow("Unknown format: xml");
});

test("formatters handle empty message array", async () => {
  const output = await formatMessages([], 'text');
  expect(output).toContain("0 message(s)");
});
```

```typescript
// tests/cli/unit/getAuthProof.test.ts

test("getAuthProof throws on invalid purpose", async () => {
  await expect(
    getAuthProof({
      client: mockClient,
      vault: mockVault,
      identityName: "alice",
      purpose: "invalidPurpose" as any,
      args: {}
    })
  ).rejects.toThrow();
});

test("getAuthProof throws when identity not found", async () => {
  mockVault.getIdentity = jest.fn().mockRejectedValue(
    new Error("Identity not found: bob")
  );

  await expect(
    getAuthProof({
      client: mockClient,
      vault: mockVault,
      identityName: "bob",
      purpose: "send",
      args: {}
    })
  ).rejects.toThrow("Identity not found: bob");
});
```

**Benefits**:
- ✅ Strengthens reliability
- ✅ Documents error behavior
- ✅ Catches regressions
- ✅ Improves user-facing error messages

**Effort**: 🟡 Medium (2-3 hours for all modules)

---

### 7. Snapshot Tests for Formatters

**Issue**: Output format regressions hard to detect

**Improvement**: Add snapshot tests for text/json/compact output

**Implementation**:

```typescript
// tests/cli/unit/formatters.test.ts

import { expect, test } from 'bun:test';
import { formatMessages } from '../../../cli/lib/formatters';

const mockMessages = [
  {
    id: "msg1",
    from: "DHytGsw0r-wYg0DSf_4l_D594hXtKH_e5-zMIdlM",
    to: "DXaNTrBG50YwcTLZw2YCkCmKNl2cELpuH-EjDCmdCaXU",
    ct: "SGVsbG8gQWxpY2Uh",
    typ: "chat.text.v1",
    createdAt: 1705329322000,
    expiresAt: 1705415722000,
    envelopeHash: "abc123",
    senderProof: {
      sigs: ["0-xyz789"],
      ksn: 0,
      evtSaid: "evt-0"
    }
  }
];

test("format JSON matches snapshot", async () => {
  const output = await formatMessages(mockMessages, 'json');
  expect(output).toMatchSnapshot();
});

test("format text matches snapshot", async () => {
  // Disable colors for snapshot consistency
  process.env.NO_COLOR = '1';

  const output = await formatMessages(mockMessages, 'text');
  expect(output).toMatchSnapshot();
});

test("format compact matches snapshot", async () => {
  const output = await formatMessages(mockMessages, 'compact');
  expect(output).toMatchSnapshot();
});

test("format JSON verbose matches snapshot", async () => {
  const output = await formatMessages(mockMessages, 'json', { verbose: true });
  expect(output).toMatchSnapshot();
});
```

**Benefits**:
- ✅ Detects unintended output changes
- ✅ Documents expected format
- ✅ Fast to write (auto-generated)

**Effort**: 🟢 Easy (30 min)

---

## Implementation Checklist

Before closing Milestone 0, complete these refinements:

- [ ] **Vault metadata caching** (30 min)
  - [ ] Lazy-load metadata
  - [ ] Mark dirty on updates
  - [ ] Auto-flush on exit
  - [ ] Test with multiple identities

- [ ] **Config schema validation** (45 min)
  - [ ] Add Ajv dependency
  - [ ] Define JSON schema
  - [ ] Validate on load
  - [ ] Test with invalid configs

- [ ] **Async formatters** (30 min)
  - [ ] Change formatMessages to async
  - [ ] Add optional vault/identityName params
  - [ ] Update all call sites
  - [ ] Test with/without decryption

- [ ] **Commander preAction hook** (1 hour)
  - [ ] Add hook to cli/index.ts
  - [ ] Load config with precedence
  - [ ] Create vault and client
  - [ ] Attach to command context
  - [ ] Test with mock commands

- [ ] **Auth helper extensions** (15 min)
  - [ ] Add AuthPurpose type
  - [ ] Add getSessionToken stub
  - [ ] Document TODO for Milestone 3
  - [ ] Update tests

- [ ] **Error path tests** (2-3 hours)
  - [ ] Vault error tests (5 scenarios)
  - [ ] Config error tests (3 scenarios)
  - [ ] Formatter error tests (2 scenarios)
  - [ ] Auth helper error tests (3 scenarios)

- [ ] **Snapshot tests** (30 min)
  - [ ] JSON format snapshot
  - [ ] Text format snapshot
  - [ ] Compact format snapshot
  - [ ] Verbose format snapshot

**Total Effort**: ~6-7 hours

---

## Success Criteria (Updated)

### Functional
- ✅ CLI boots with `merits --help`
- ✅ Can create vault and store credentials
- ✅ Can load/save config with precedence
- ✅ **Config validated against schema**
- ✅ Can format output in json/text/compact
- ✅ **Formatters are async**
- ✅ Can sign challenges via vault
- ✅ **Vault caches metadata in memory**
- ✅ **PreAction hook sets up context**
- ✅ All unit tests passing
- ✅ **Error path tests passing**
- ✅ **Snapshot tests passing**

### Security
- ✅ Private keys stored in OS keychain
- ✅ Metadata file has 0600 permissions
- ✅ Keys never exposed in plaintext
- ✅ Signing happens inside vault
- ✅ **Config validation prevents injection**

### Code Quality
- ✅ TypeScript strict mode
- ✅ All interfaces documented
- ✅ Error handling consistent
- ✅ **All error paths tested**
- ✅ Logging infrastructure ready
- ✅ **Output formats snapshot-tested**

---

## Completion Status

**Before Refinements**: 90% complete
**After Refinements**: 100% complete, ready for Milestone 1

**Next Steps**:
1. Implement refinements (checklist above)
2. Run full test suite
3. Create cli-milestone-0-complete.md
4. Begin Milestone 1 (Identity Management)

---

**Related Documentation**:
- [CLI Milestone 0](./cli-milestone-0.md) - Original milestone plan
- [CLI Roadmap](./roadmap-cli.md) - Overall CLI development plan
- [CLI Plan (Updated Review)](./merits-cli-plan-updated.md) - Auth optimizations
