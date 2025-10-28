# CLI Phase 2: Identity Management

**Status**: Planning → In Progress
**Prerequisites**: [Phase 1 Complete](./cli-phase-1.md) ✅
**Duration**: Week 1-2
**Next Phase**: [Phase 3: Messaging Commands](./cli-phase-3.md)

## Overview

Implement complete identity lifecycle management including creation, registration, export/import, and key rotation. This phase builds on the vault infrastructure from Phase 1 to provide full KERI identity support.

**IMPORTANT**: Phase 2 implements a **backend-agnostic architecture**. The CLI commands interact only with abstract interfaces (`MeritsClient`, `IdentityAuth`, `Transport`, `GroupApi`) rather than directly calling any specific backend (Convex, REST, etc.). This allows swapping backends without modifying CLI code.

**Related Documentation**:
- [CLI Roadmap](./roadmap-cli.md) - Overall CLI development plan
- [Phase 1 Complete](./cli-phase-1.md) - Foundation infrastructure
- [Phase 2 Review](./phase2-review.md) - Architecture decisions for backend-agnostic design

---

## Goals

### Primary Goals
1. Generate and manage KERI identities
2. Register identities via backend-agnostic `MeritsClient` interface
3. Support export/import for backup and transfer
4. Implement default identity selection
5. First-time setup experience (`merits init`)
6. **Backend-agnostic architecture**: CLI never directly depends on any specific backend

### Secondary Goals
- Key rotation ceremony
- Identity metadata management
- Integration tests for full identity lifecycle
- Interactive identity creation prompts

### Architecture Goals
- Define `MeritsClient` interface that wraps all backend operations
- Refactor config from `convexUrl` → `backend: { type, url }`
- Enhance vault with `updateMetadata()` and public key storage
- Keep private keys in vault (never export except for explicit backup with `--include-key`)
- CLI commands only use abstract interfaces, never concrete backend calls

---

## Architecture Changes

### 1. Backend-Agnostic Config

**Before**:
```typescript
interface MeritsConfig {
  convexUrl: string;
  // ...
}
```

**After**:
```typescript
// cli/lib/config.ts
interface MeritsConfig {
  version: number;
  backend: {
    type: "convex" | "rest" | "local";
    url: string;
  };
  defaultIdentity?: string;
  outputFormat?: "json" | "text" | "compact";
  watchInterval?: number;
  verbose?: boolean;
  color?: boolean;
}
```

**Migration**: `loadConfig()` still accepts `CONVEX_URL` env var but maps it to `backend: { type: "convex", url }` internally.

### 2. MeritsClient Interface

```typescript
// src/client/types.ts
export interface MeritsClient {
  // Core interfaces from Phase 1
  identityAuth: IdentityAuth;  // issueChallenge(), verifyAuth()
  transport: Transport;        // sendMessage(), receiveMessages(), ackMessage()
  group: GroupApi;             // createGroup(), sendGroupMessage()

  // NEW: Identity Registry (Phase 2)
  identityRegistry: {
    registerIdentity(req: {
      aid: string;
      publicKey: Uint8Array;
      ksn: number;
    }): Promise<void>;

    rotateKeys(req: {
      aid: string;
      oldKsn: number;
      newKsn: number;
      newPublicKey: Uint8Array;
      rotationProofSigs: string[];  // indexed sigs from old key
    }): Promise<void>;
  };

  close(): void;
}
```

**Implementation**:
```typescript
// src/client/index.ts
import { ConvexMeritsClient } from './convex';

export function createMeritsClient(config: MeritsConfig): MeritsClient {
  switch (config.backend.type) {
    case "convex":
      return new ConvexMeritsClient(config.backend.url);
    case "rest":
      // Future: return new RestMeritsClient(config.backend.url);
      throw new Error("REST backend not yet implemented");
    case "local":
      // Future: return new LocalMeritsClient();
      throw new Error("Local backend not yet implemented");
    default:
      throw new Error(`Unknown backend type: ${config.backend.type}`);
  }
}
```

### 3. Enhanced Vault API

```typescript
// src/vault/types.ts
interface MeritsVault {
  // Existing methods from Phase 1...
  storeIdentity(name: string, data: IdentityData): Promise<void>;
  getIdentity(name: string): Promise<IdentityData>;
  listIdentities(): Promise<string[]>;
  deleteIdentity(name: string): Promise<void>;
  signIndexed(name: string, data: Uint8Array): Promise<string[]>;
  exportPrivateKey(name: string): Promise<Uint8Array>;  // Dangerous! Only for backup

  // NEW Phase 2 methods:
  // Update metadata without re-storing private key
  updateMetadata(name: string, patch: Partial<IdentityMetadata>): Promise<void>;

  // Get public key without exporting private key
  getPublicKey(name: string): Promise<Uint8Array>;
}
```

**Identity metadata structure**:
```typescript
interface IdentityMetadata {
  publicKey: Uint8Array;      // NEW: Store at creation to avoid later export
  createdAt: number;
  description?: string;
  registered: boolean;
  registeredAt?: number;
  rotatedAt?: number;
  rotationReason?: string;
  importedAt?: number;
  importedFrom?: string;
}
```

Store `publicKey` in metadata at identity creation:
```typescript
await vault.storeIdentity(name, {
  aid,
  privateKey: keys.privateKey,
  ksn: 0,
  metadata: {
    publicKey: keys.publicKey,  // <-- Store public key in metadata
    createdAt: Date.now(),
    registered: false,
  }
});
```

### 4. CLI Context

```typescript
// cli/lib/context.ts
export interface CLIContext {
  config: ResolvedConfig;
  vault: MeritsVault;
  client: MeritsClient;  // <-- Abstract interface, not backend-specific
}
```

Created via:
```typescript
import { createMeritsClient } from '../../src/client';

export function getContext(opts: any): CLIContext {
  const config = loadConfig(opts);
  const vault = createVault(config);
  const client = createMeritsClient(config);  // Switches based on backend.type

  return { config, vault, client };
}
```

---

## Commands

### 1. `merits init`

**Purpose**: First-time setup wizard

**Implementation**:
```typescript
// cli/commands/init.ts
import { intro, text, confirm, outro } from '@clack/prompts';
import { getContext } from '../lib/context';
import { generateKeyPair, createAID } from '../../core/crypto';

export async function initCommand(opts: any) {
  const ctx = getContext(opts);

  intro('Welcome to Merits CLI!');

  // Check if already initialized
  const identities = await ctx.vault.listIdentities();
  if (identities.length > 0) {
    const proceed = await confirm({
      message: 'You already have identities. Continue setup?'
    });
    if (!proceed) return;
  }

  // Create first identity
  const name = await text({
    message: 'Choose a name for your identity:',
    placeholder: 'alice',
    validate: (value) => {
      if (!value) return 'Name is required';
      if (!/^[a-z0-9-]+$/.test(value)) {
        return 'Name must be lowercase alphanumeric with dashes';
      }
    }
  });

  // Generate keypair
  const keys = await generateKeyPair();
  const aid = createAID(keys.publicKey);

  // Store in vault with public key in metadata
  await ctx.vault.storeIdentity(name, {
    aid,
    privateKey: keys.privateKey,
    ksn: 0,
    metadata: {
      publicKey: keys.publicKey,  // Store for registration
      createdAt: Date.now(),
      description: 'Primary identity',
      registered: false,
    }
  });

  // Register with backend (backend-agnostic)
  try {
    await ctx.client.identityRegistry.registerIdentity({
      aid,
      publicKey: keys.publicKey,
      ksn: 0
    });

    await ctx.vault.updateMetadata(name, {
      registered: true,
      registeredAt: Date.now(),
    });

    outro(`✅ Identity '${name}' created and registered!`);
  } catch (err) {
    outro(`⚠️  Identity created locally but registration failed: ${err.message}`);
  }
}
```

**Features**:
- Interactive prompts with validation
- Checks for existing identities
- Auto-registers with backend (backend-agnostic!)
- Sets as default identity

---

### 2. `merits identity new`

**Purpose**: Generate new identity

**Syntax**:
```bash
merits identity new <name> [options]

Options:
  --register          Register with backend immediately (default: true)
  --set-default       Set as default identity (default: false)
  --description <text> Description for identity
```

**Implementation**:
```typescript
// cli/commands/identity/new.ts
import { getContext } from '../../lib/context';
import { generateKeyPair, createAID } from '../../../core/crypto';
import { formatIdentity } from '../../lib/formatters';

export async function newIdentity(name: string, opts: any) {
  const ctx = getContext(opts);

  // Validate name
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error('Identity name must be lowercase alphanumeric with dashes');
  }

  // Check if already exists
  const existing = await ctx.vault.listIdentities();
  if (existing.includes(name)) {
    throw new Error(`Identity '${name}' already exists`);
  }

  // Generate keypair
  const keys = await generateKeyPair();
  const aid = createAID(keys.publicKey);

  // Store in vault with public key in metadata
  await ctx.vault.storeIdentity(name, {
    aid,
    privateKey: keys.privateKey,
    ksn: 0,
    metadata: {
      publicKey: keys.publicKey,  // Store for later use
      createdAt: Date.now(),
      description: opts.description || '',
      registered: false
    }
  });

  // Register with backend if requested
  if (opts.register !== false) {
    try {
      await ctx.client.identityRegistry.registerIdentity({
        aid,
        publicKey: keys.publicKey,
        ksn: 0
      });

      // Update metadata (no need to re-store private key!)
      await ctx.vault.updateMetadata(name, {
        registered: true,
        registeredAt: Date.now(),
      });
    } catch (err) {
      console.warn(`⚠️  Registration failed: ${err.message}`);
      console.warn('    Identity created locally. Use `merits identity register` later.');
    }
  }

  // Set as default if requested
  if (opts.setDefault) {
    await setDefaultIdentity(name, ctx);
  }

  // Display result
  const identity = await ctx.vault.getIdentity(name);
  const output = await formatIdentity(name, identity, ctx.config.outputFormat);
  console.log(output);
}
```

**Example Usage**:
```bash
# Basic usage
merits identity new alice

# With description
merits identity new bob --description "Work account"

# Create and set as default
merits identity new charlie --set-default

# Create without registering
merits identity new dave --no-register
```

---

### 3. `merits identity list`

**Purpose**: List all identities

**Syntax**:
```bash
merits identity list [options]

Options:
  --format <type>     Output format (json|text|compact)
  --verbose           Show full details
```

**Implementation**: (Same as before, no backend-specific changes needed)

---

### 4. `merits identity show`

**Purpose**: Show detailed identity information

**Implementation**: (Same as before, reads from vault only)

---

### 5. `merits identity register`

**Purpose**: Register identity with backend

**Syntax**:
```bash
merits identity register <name>
```

**Implementation**:
```typescript
// cli/commands/identity/register.ts
import { getContext } from '../../lib/context';

export async function registerIdentity(name: string, opts: any) {
  const ctx = getContext(opts);

  const identity = await ctx.vault.getIdentity(name);

  // Check if already registered
  if (identity.metadata?.registered) {
    console.log(`Identity '${name}' is already registered`);
    return;
  }

  // Get public key from vault (NO private key export!)
  const publicKey = await ctx.vault.getPublicKey(name);

  // Register with backend (backend-agnostic)
  await ctx.client.identityRegistry.registerIdentity({
    aid: identity.aid,
    publicKey,
    ksn: identity.ksn
  });

  // Update metadata without touching private key
  await ctx.vault.updateMetadata(name, {
    registered: true,
    registeredAt: Date.now(),
  });

  console.log(`✅ Identity '${name}' registered successfully`);
}
```

**Security Note**: Private key never leaves the vault. We retrieve the public key from metadata.

---

### 6. `merits identity export`

**Purpose**: Export identity for backup

**Syntax**:
```bash
merits identity export <name> [options]

Options:
  --output <path>     Output file (default: stdout)
  --include-key       Include private key (dangerous!)
```

**Implementation**: (Same as before - still requires explicit `--include-key` for private key export)

---

### 7. `merits identity import`

**Purpose**: Import identity from backup

**Implementation**: (Same as before - requires file with private key)

---

### 8. `merits identity delete`

**Purpose**: Delete identity from vault

**Implementation**: (Same as before - local vault operation only)

---

### 9. `merits identity set-default`

**Purpose**: Set default identity for commands

**Implementation**: (Same as before - updates config file)

---

## Key Rotation (Advanced)

### `merits identity rotate`

**Purpose**: Perform key rotation ceremony

**Syntax**:
```bash
merits identity rotate <name> [options]

Options:
  --reason <text>     Rotation reason (e.g., "security-audit")
```

**Implementation**:
```typescript
// cli/commands/identity/rotate.ts
export async function rotateIdentity(name: string, opts: any) {
  const ctx = getContext(opts);

  // 1. Get current identity
  const identity = await ctx.vault.getIdentity(name);
  const oldKsn = identity.ksn;

  // 2. Generate new keypair
  const newKeys = await generateKeyPair();

  // 3. Create rotation event
  const rotationEvent = {
    aid: identity.aid,
    oldKsn,
    newKsn: oldKsn + 1,
    newPublicKey: newKeys.publicKey,
    reason: opts.reason || 'manual-rotation',
    timestamp: Date.now()
  };

  // 4. Sign rotation event with OLD key (NO export!)
  const eventBytes = new TextEncoder().encode(JSON.stringify(rotationEvent));
  const rotationProofSigs = await ctx.vault.signIndexed(name, eventBytes);

  // 5. Submit rotation to backend (backend-agnostic)
  await ctx.client.identityRegistry.rotateKeys({
    aid: identity.aid,
    oldKsn,
    newKsn: oldKsn + 1,
    newPublicKey: newKeys.publicKey,
    rotationProofSigs
  });

  // 6. Update vault with new key
  await ctx.vault.storeIdentity(name, {
    aid: identity.aid,
    privateKey: newKeys.privateKey,
    ksn: oldKsn + 1,
    metadata: {
      ...identity.metadata,
      publicKey: newKeys.publicKey,  // Update public key too
      rotatedAt: Date.now(),
      rotationReason: opts.reason
    }
  });

  console.log(`✅ Identity '${name}' rotated: KSN ${oldKsn} → ${oldKsn + 1}`);
}
```

**Security Note**: The private key never leaves the vault. We use `vault.signIndexed()` to sign the rotation event with the old key, keeping keys secure throughout the rotation ceremony.

---

## Testing

### Unit Tests

**File**: `tests/cli/unit/identity.test.ts`

```typescript
import { describe, test, expect } from 'bun:test';
import { newIdentity, listIdentities } from '../../../cli/commands/identity';

describe('Identity Commands', () => {
  test('creates new identity', async () => {
    const name = 'test-alice';
    await newIdentity(name, { register: false });

    const identities = await listIdentities({ format: 'json' });
    expect(identities).toContainEqual(expect.objectContaining({ name }));
  });

  test('stores public key in metadata', async () => {
    const name = 'test-pubkey';
    await newIdentity(name, { register: false });

    const identity = await vault.getIdentity(name);
    expect(identity.metadata.publicKey).toBeDefined();
    expect(identity.metadata.publicKey).toBeInstanceOf(Uint8Array);
  });

  test('exports and imports identity', async () => {
    // TODO: Implement
  });

  test('sets default identity', async () => {
    // TODO: Implement
  });
});
```

### Integration Tests

**File**: `tests/cli/integration/identity-lifecycle.test.ts`

```typescript
describe('Identity Lifecycle', () => {
  test('complete flow: create → register → export → import', async () => {
    // 1. Create identity
    await runCLI(['identity', 'new', 'alice', '--no-register']);

    // 2. Register (should use vault.getPublicKey, not export private key)
    await runCLI(['identity', 'register', 'alice']);

    // 3. Export
    await runCLI(['identity', 'export', 'alice', '--include-key', '--output', '/tmp/alice.json']);

    // 4. Delete
    await runCLI(['identity', 'delete', 'alice', '--force']);

    // 5. Import
    await runCLI(['identity', 'import', '/tmp/alice.json']);

    // 6. Verify
    const identities = await runCLI(['identity', 'list', '--format', 'json']);
    expect(identities).toContainEqual(expect.objectContaining({ name: 'alice' }));
  });

  test('key rotation uses vault.signIndexed (no export)', async () => {
    // Setup
    await runCLI(['identity', 'new', 'bob', '--no-register']);

    // Spy to ensure exportPrivateKey is never called
    const exportSpy = vi.spyOn(vault, 'exportPrivateKey');

    // Rotate
    await runCLI(['identity', 'rotate', 'bob', '--reason', 'test']);

    // Verify private key was never exported
    expect(exportSpy).not.toHaveBeenCalled();
  });
});
```

---

## Success Criteria

### Functional
- ✅ Can create new identities with `merits identity new`
- ✅ Can list all identities with details
- ✅ Can export/import identities securely
- ✅ Can register identities with backend (backend-agnostic)
- ✅ Can set default identity
- ✅ Can delete identities with confirmation
- ✅ `merits init` provides good first-time experience
- ✅ Key rotation works without exporting private keys

### Security
- ✅ Private keys only exported when explicitly requested (`--include-key`)
- ✅ Registration uses `vault.getPublicKey()`, not private key export
- ✅ Rotation uses `vault.signIndexed()`, not private key export
- ✅ Export files have 0600 permissions
- ✅ Confirmation prompts for dangerous operations
- ✅ Warning messages for security-sensitive actions

### Architecture
- ✅ CLI commands only use `MeritsClient` interface
- ✅ No direct Convex API calls in CLI code
- ✅ Config uses `backend: { type, url }` structure
- ✅ Backend can be swapped without touching CLI commands
- ✅ Vault enhancements (`updateMetadata`, `getPublicKey`) implemented

### UX
- ✅ Interactive prompts with validation
- ✅ Clear error messages (no backend-specific terminology)
- ✅ Progress indicators for network operations
- ✅ Helpful hints for next steps

### Testing
- ✅ Unit tests for all commands
- ✅ Integration tests for full lifecycle
- ✅ Security tests (verify no private key exports)
- ✅ Cross-platform compatibility (macOS/Linux/Windows)

---

## Dependencies

No new dependencies required. Uses existing:
- `@clack/prompts` - Interactive prompts
- `commander` - CLI framework
- `chalk` - Colored output
- `keytar` - OS keychain (from Phase 1)

**Architecture Note**: CLI depends only on abstract interfaces from `core/interfaces`. The specific backend adapter (Convex, REST, etc.) is selected at runtime based on config.

---

## Files to Create/Modify

```
src/
├── client/
│   ├── index.ts               # NEW: createMeritsClient() factory
│   ├── types.ts               # NEW: MeritsClient interface
│   └── convex.ts              # NEW: ConvexMeritsClient implementation
└── vault/
    ├── vault.ts               # MODIFY: Add updateMetadata() and getPublicKey()
    └── types.ts               # MODIFY: Add publicKey to metadata

cli/
├── lib/
│   ├── config.ts              # MODIFY: Change convexUrl → backend: {type, url}
│   ├── context.ts             # MODIFY: Use createMeritsClient(config)
│   └── auth.ts                # NEW: getAuthProof() helper using IdentityAuth
└── commands/
    ├── init.ts                # NEW: First-time setup
    └── identity/
        ├── new.ts             # NEW: Create identity
        ├── list.ts            # NEW: List identities
        ├── show.ts            # NEW: Show details
        ├── register.ts        # NEW: Register with backend
        ├── export.ts          # NEW: Export for backup
        ├── import.ts          # NEW: Import from backup
        ├── delete.ts          # NEW: Delete identity
        ├── set-default.ts     # NEW: Set default
        └── rotate.ts          # NEW: Key rotation (advanced)

tests/cli/
├── unit/
│   └── identity.test.ts       # NEW: Unit tests
└── integration/
    └── identity-lifecycle.test.ts  # NEW: End-to-end tests
```

---

## Implementation Order

### Phase A: Architecture Foundation (Days 1-2)

1. **Config refactoring**
   - [ ] Change `MeritsConfig` from `convexUrl` → `backend: { type, url }`
   - [ ] Update `loadConfig()` to still accept `CONVEX_URL` env var but map to new structure
   - [ ] Update CLI flags: `--backend-url`, `--backend-type`
   - [ ] Tests

2. **MeritsClient interface**
   - [ ] Define `MeritsClient` interface with `identityRegistry`, `identityAuth`, `transport`, `group`
   - [ ] Implement `createConvexMeritsClient()` wrapping existing Convex functions
   - [ ] Update `getContext()` to use `createMeritsClient(config)`
   - [ ] Tests

3. **Vault enhancements**
   - [ ] Add `vault.updateMetadata(name, patch)`
   - [ ] Add `vault.getPublicKey(name)` (reads from metadata)
   - [ ] Store `publicKey` in metadata at creation time
   - [ ] Tests

### Phase B: Core Identity Commands (Days 3-5)

4. **Basic commands**
   - [ ] `merits identity new` - uses `identityRegistry.registerIdentity()`
   - [ ] `merits identity list`
   - [ ] `merits identity show`
   - [ ] Unit tests

5. **Registration & default**
   - [ ] `merits identity register` - uses `vault.getPublicKey()`, no private key export
   - [ ] `merits identity set-default`
   - [ ] Update CLI entry point to load default
   - [ ] Integration tests

### Phase C: Backup & Lifecycle (Days 6-8)

6. **Export/import**
   - [ ] `merits identity export`
   - [ ] `merits identity import`
   - [ ] Security warnings for `--include-key`
   - [ ] Tests

7. **Init & delete**
   - [ ] `merits init` (first-time setup wizard)
   - [ ] `merits identity delete`
   - [ ] Interactive prompts with @clack/prompts
   - [ ] Tests

### Phase D: Advanced Features (Days 9-11)

8. **Key rotation**
   - [ ] `merits identity rotate` - uses `vault.signIndexed()` and `identityRegistry.rotateKeys()`
   - [ ] Rotation event handling
   - [ ] Tests to verify no private key export

9. **Auth helper**
   - [ ] Refactor `getAuthProof()` to use `client.identityAuth.issueChallenge()`
   - [ ] Backend-agnostic challenge/response flow
   - [ ] Tests

### Phase E: Polish (Days 12-14)

10. **UX & docs**
    - [ ] Error message improvements (no Convex references)
    - [ ] Help text (backend-neutral terminology)
    - [ ] Update README
    - [ ] Integration test coverage
    - [ ] Verify backend portability by mocking different backend types

---

## Next Steps

After Phase 2 completion:
1. Create `cli-phase-2-complete.md` with results
2. Update roadmap with completion status
3. Begin Phase 3 (Messaging Commands) - which will automatically inherit the backend-agnostic architecture!

**Related**: [Phase 3: Messaging Commands](./cli-phase-3.md) (to be created)

---

**Status**: 📋 Planning → In Progress
**Prerequisites**: Phase 1 ✅
**Estimated Effort**: 2 weeks
