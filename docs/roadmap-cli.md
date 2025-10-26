# Merits CLI Roadmap

**Status**: Planning → Implementation
**Started**: 2025-01-26
**Target**: 6-week development cycle

## Overview

This roadmap tracks the implementation of the **Merits CLI** - a production-ready command-line interface for the Merits messaging system with KERI authentication, OS keychain integration, and comprehensive scripting support.

**Related Documentation**:
- [CLI Design Plan](./cli-plan.md) - Original comprehensive design
- [CLI Plan (Updated Review)](./merits-cli-plan-updated.md) - Refined auth model & optimizations
- [Architecture](./architecture.md) - Overall system design
- [API Reference](./api-reference.md) - TypeScript SDK

---

## Phases Overview

| Phase | Focus | Timeline | Status |
|-------|-------|----------|--------|
| 1 | [Core Infrastructure](#phase-1-core-infrastructure) | Week 1 | ✅ Complete |
| 2 | [Identity Management](#phase-2-identity-management) | Week 1-2 | ✅ Complete |
| 3 | [Messaging Commands](#phase-3-messaging-commands) | Week 2-3 | ✅ Complete |
| 3.5 | [Testing Infrastructure](#phase-35-testing-infrastructure) | Week 3 | 📋 Next |
| 4 | [Streaming & Groups](#phase-4-streaming--groups) | Week 3-4 | ⏳ Pending |
| 5 | [Admin & Interactive](#phase-5-admin--interactive) | Week 4-5 | ⏳ Pending |
| 6 | [Publishing & Docs](#phase-6-publishing--docs) | Week 5-6 | ⏳ Pending |

---

## Phase 1: Core Infrastructure

**Goal**: Establish CLI framework, vault abstraction, and configuration management

**Duration**: Week 1

**Deliverables**:
- ✅ CLI framework (commander.js)
- ✅ MeritsVault interface with OS Keychain implementation
- ✅ Config file management (`~/.merits/config.json`)
- ✅ Output formatters (json, text, compact)
- ✅ Auth helper (`getAuthProof`)
- ✅ Project structure setup

**Key Files**:
```
cli/
├── index.ts              # Entry point
├── lib/
│   ├── vault/
│   │   ├── MeritsVault.ts       # Interface
│   │   ├── OSKeychainVault.ts   # Primary implementation
│   │   └── index.ts             # Vault factory
│   ├── getAuthProof.ts   # Challenge signing helper
│   ├── config.ts         # Config management
│   ├── formatters.ts     # Output formatting
│   └── client-factory.ts # Create MeritsClient
└── types.ts              # TypeScript definitions
```

**Success Criteria**:
- Can create vault and store/retrieve credentials securely
- Can load/save config with precedence (flags > env > file > defaults)
- Can format output in json/text/compact modes
- Can sign KERI challenges via vault
- Unit tests passing for all core modules

**Technical Highlights**:
- 🔐 OS Keychain integration via `keytar` (macOS/Linux/Windows)
- 🔑 Private keys never leave vault (signing happens inside)
- ⚡ Single `getAuthProof()` helper for all auth flows
- 📊 Consistent output formatting across all commands

**Documentation**: [cli-phase-1.md](./cli-phase-1.md) ✅

---

## Phase 2: Identity Management

**Goal**: Complete identity lifecycle (create, list, export, import, register)

**Duration**: Week 1-2

**Commands**:
- `merits init` - First-time setup
- `merits id:create` - Generate new identity
- `merits id:list` - List all identities
- `merits id:export` - Export for backup
- `merits id:import` - Import from file
- `merits id:register` - Register keyState with server
- `merits id:set-default` - Set default identity

**Key Features**:
- Generate Ed25519 keypairs via @noble/ed25519
- Create KERI AIDs
- Store in OS Keychain (or encrypted file vault fallback)
- Register keyState with Convex backend
- Manage multiple identities with default selection

**Technical Highlights**:
- ✅ Full KERI AID lifecycle
- ✅ CESR key encoding/decoding
- ✅ KeyState registration with server
- ✅ Export/import for backup/transfer

**Success Criteria**:
- Can create and manage multiple identities
- Can export/import identities securely
- Can register with Convex backend
- Integration tests passing

**Documentation**: [cli-phase-2.md](./cli-phase-2.md) ✅ **COMPLETE**

**Phase 2 Achievements**:
- ✅ Backend-agnostic architecture (`MeritsClient` interface)
- ✅ 9 identity commands implemented and tested
- ✅ Vault enhancements (`updateMetadata`, `getPublicKey`)
- ✅ Interactive setup wizard (`merits init`)
- ✅ All 41 CLI tests passing
- ✅ Security: Private keys never leave vault
- ✅ UX: Multiple output formats, colored output, helpful errors

**Files Created**: 19 new files (commands, client interfaces, tests)
**Tests**: 41/41 passing (100%)

---

## Phase 3: Messaging Commands

**Goal**: Send and receive encrypted messages with optimized auth flows

**Duration**: Week 2-3

**Commands**:
- `merits send` - Send message to user or group
- `merits unread` - Retrieve unread messages
- `merits mark-read` - Explicitly mark messages as read

**Key Features**:
- **Layered encryption API**:
  - `fetchPublicKeyFor(aid)` - Get recipient's public key
  - `encryptMessage(plaintext, publicKey)` - Encrypt for specific key
  - `encryptForRecipient(plaintext, aid)` - Ergonomic wrapper
- **Optimized auth flows**:
  - `send`: Single signature per send
  - `unread --mark-read=true`: Combined `receiveAndAck` (one proof)
  - `unread --mark-read=false`: Just `receive` proof
- **Advanced use cases**:
  - Encrypt for third party (`--encrypt-for`)
  - Pre-encrypted input (`--ct`)
  - Piping support

**CLI Modes**:
```bash
# Ergonomic (auto-encrypt)
merits send --to alice --message "Hello"

# Encrypt for third party (forwarding)
merits send --to bob --message "Secret for Carol" --encrypt-for carol

# Pre-encrypted (trust as-is)
merits send --to alice --ct "SGVsbG8gQWxpY2Uh"

# Piping
echo "Deploy complete" | merits send --to bob
```

**Technical Highlights**:
- ⚡ Single-proof `receiveAndAck` for efficiency
- 🔑 Composable encryption primitives
- 📦 Vault decrypts messages for display
- 🔄 Auto-detect user vs group IDs

**Success Criteria**:
- Can send/receive encrypted messages
- Auth flow optimizations working
- Piping input/output works
- All output formats tested

**Documentation**: [cli-phase-3.md](./cli-phase-3.md) ✅

**Phase 3 Achievements**:
- ✅ 3 messaging commands implemented (`send`, `receive`, `ack`)
- ✅ Single-proof auth operations
- ✅ Silent JSON mode for scripting
- ✅ Piping support (stdin/stdout)
- ✅ All 51 unit tests passing
- ✅ Interface alignment with core types
- ✅ Crypto helpers added (`canonicalizeToBytes`, `sha256Hex`)

**Files Created**: 6 new files (commands + tests)
**Tests**: 51/51 unit tests passing, integration tests created

---

## Phase 3.5: Testing Infrastructure

**Goal**: Local data directories for isolated, reproducible end-to-end testing

**Duration**: Week 3 (1-2 days)

**Motivation**:
Currently, the CLI uses global paths (`~/.merits/`) which makes it difficult to:
- Run parallel tests without conflicts
- Create isolated test scenarios (Alice + Bob messaging)
- Debug test failures (data mixed with personal identities)
- Clean up after tests (must manually delete specific identities)

**Solution**: Add `--dir` option to confine all data to a specific directory.

### Key Features

**1. Data Directory Override**

Add global `--dir <path>` option:

```bash
# Use custom data directory
merits --dir ./test-data/alice identity new alice
merits --dir ./test-data/alice send <bob-aid> --message "Hello"

# Environment variable alternative
export MERITS_DATA_DIR=./test-data/alice
merits identity new alice

# Default behavior unchanged (uses ~/.merits/)
merits identity list
```

**Directory structure when `--dir` is set:**
```
./test-data/alice/
├── config.json           # Config (was ~/.merits/config.json)
├── identities.json       # Vault metadata (was ~/.merits/identities.json)
└── keychain/             # Encrypted keys (fallback if OS keychain unavailable)
    └── alice.key         # Encrypted private key
```

**2. Config Changes**

Update [cli/lib/config.ts](../cli/lib/config.ts):

```typescript
export interface MeritsConfig {
  // NEW: Data directory override
  dataDir?: string;

  backend?: {
    type: "convex" | "rest" | "local";
    url: string;
  };
  // ... existing fields
}

// Resolve paths based on dataDir
export function resolveConfigPath(config: MeritsConfig): string {
  const baseDir = config.dataDir || path.join(os.homedir(), ".merits");
  return path.join(baseDir, "config.json");
}

export function resolveVaultPath(config: MeritsConfig): string {
  const baseDir = config.dataDir || path.join(os.homedir(), ".merits");
  return path.join(baseDir, "identities.json");
}
```

**Precedence** (highest to lowest):
1. `--dir` CLI flag
2. `MERITS_DATA_DIR` environment variable
3. Config file `dataDir` field
4. Default: `~/.merits/`

**3. Vault Fallback Mode**

For testing without OS keychain, add file-based encrypted vault:

```typescript
// cli/lib/vault/FileVault.ts (NEW)
export class FileVault implements MeritsVault {
  constructor(
    private metadataPath: string,  // identities.json
    private keychainDir: string    // ./keychain/
  ) {}

  async storeIdentity(name: string, identity: IdentityData): Promise<void> {
    // Encrypt private key with deterministic password
    const encrypted = await encrypt(identity.privateKey, this.getPassword());

    // Write to ./keychain/{name}.key
    await fs.writeFile(
      path.join(this.keychainDir, `${name}.key`),
      encrypted,
      { mode: 0o600 }
    );

    // Store metadata as usual
    // ...
  }

  private getPassword(): string {
    // Deterministic password from environment or config
    return process.env.MERITS_VAULT_PASSWORD || "test-password-insecure";
  }
}
```

**Vault selection logic:**
```typescript
// cli/lib/vault/index.ts
export function createVault(config: ResolvedConfig): MeritsVault {
  const metadataPath = resolveVaultPath(config);

  // If dataDir is set, prefer FileVault for testing
  if (config.dataDir) {
    const keychainDir = path.join(config.dataDir, "keychain");
    return new FileVault(metadataPath, keychainDir);
  }

  // Otherwise use OS Keychain
  return new OSKeychainVault(metadataPath, "merits-cli");
}
```

**Security Note**: FileVault is **insecure by design** (for testing only). Production should use OS Keychain.

### End-to-End Test Examples

**Test 1: Alice sends to Bob**

```typescript
// tests/cli/e2e/messaging.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { $ } from "bun";

describe("E2E Messaging", () => {
  let testDir: string;
  let aliceDir: string;
  let bobDir: string;

  beforeEach(async () => {
    // Create temp directory
    testDir = await mkdtemp(join(tmpdir(), "merits-test-"));
    aliceDir = join(testDir, "alice");
    bobDir = join(testDir, "bob");
  });

  afterEach(async () => {
    // Cleanup
    await rm(testDir, { recursive: true, force: true });
  });

  test("alice sends message to bob", async () => {
    // Setup Alice
    await $`bun run cli --dir ${aliceDir} identity new alice --no-register`;
    const aliceShow = await $`bun run cli --dir ${aliceDir} identity show alice --format json`.json();
    const aliceAid = aliceShow.aid;

    // Setup Bob
    await $`bun run cli --dir ${bobDir} identity new bob --no-register`;
    const bobShow = await $`bun run cli --dir ${bobDir} identity show bob --format json`.json();
    const bobAid = bobShow.aid;

    // Alice sends to Bob
    const sendResult = await $`bun run cli --dir ${aliceDir} send ${bobAid} --message "Hello Bob" --format json`.json();
    expect(sendResult.messageId).toBeDefined();

    // Bob receives
    const receiveResult = await $`bun run cli --dir ${bobDir} receive --plaintext --format json`.json();
    expect(receiveResult).toHaveLength(1);
    expect(receiveResult[0].plaintext).toBe("Hello Bob");
    expect(receiveResult[0].from).toBe(aliceAid);

    // Bob acknowledges
    await $`bun run cli --dir ${bobDir} ack ${receiveResult[0].id} --envelope-hash ${receiveResult[0].envelopeHash}`;
  });

  test("parallel test isolation", async () => {
    // Run two isolated scenarios in parallel
    await Promise.all([
      testScenario(join(testDir, "scenario1")),
      testScenario(join(testDir, "scenario2"))
    ]);
  });
});

async function testScenario(dataDir: string) {
  await $`bun run cli --dir ${dataDir} identity new user`;
  const result = await $`bun run cli --dir ${dataDir} identity list --format json`.json();
  expect(result.identities).toHaveLength(1);
}
```

**Test 2: Group messaging**

```typescript
test("group message fanout", async () => {
  const aliceDir = join(testDir, "alice");
  const bobDir = join(testDir, "bob");
  const carolDir = join(testDir, "carol");

  // Create three identities
  await $`bun run cli --dir ${aliceDir} identity new alice`;
  await $`bun run cli --dir ${bobDir} identity new bob`;
  await $`bun run cli --dir ${carolDir} identity new carol`;

  // Alice creates group
  const groupResult = await $`bun run cli --dir ${aliceDir} group create test-group --format json`.json();
  const groupId = groupResult.groupId;

  // Add Bob and Carol
  await $`bun run cli --dir ${aliceDir} group add ${groupId} ${bobAid}`;
  await $`bun run cli --dir ${aliceDir} group add ${groupId} ${carolAid}`;

  // Alice sends to group
  await $`bun run cli --dir ${aliceDir} send ${groupId} --message "Hello group"`;

  // Bob and Carol both receive
  const bobMessages = await $`bun run cli --dir ${bobDir} receive --plaintext --format json`.json();
  const carolMessages = await $`bun run cli --dir ${carolDir} receive --plaintext --format json`.json();

  expect(bobMessages[0].plaintext).toBe("Hello group");
  expect(carolMessages[0].plaintext).toBe("Hello group");
});
```

**Test 3: Data directory persistence**

```typescript
test("data persists across CLI invocations", async () => {
  const dataDir = join(testDir, "persistent");

  // First invocation: create identity
  await $`bun run cli --dir ${dataDir} identity new alice`;

  // Second invocation: identity still exists
  const result = await $`bun run cli --dir ${dataDir} identity list --format json`.json();
  expect(result.identities).toHaveLength(1);
  expect(result.identities[0].name).toBe("alice");

  // Third invocation: can send messages
  await $`bun run cli --dir ${dataDir} send ${bobAid} --message "Test"`;
});
```

### Implementation Checklist

**Config System:**
- [ ] Add `dataDir` field to `MeritsConfig`
- [ ] Add `--dir` CLI flag to program options
- [ ] Add `MERITS_DATA_DIR` environment variable
- [ ] Update `resolveConfigPath()` and `resolveVaultPath()`
- [ ] Update 4-layer precedence handling

**Vault System:**
- [ ] Create `FileVault` implementation for testing
- [ ] Update `createVault()` to choose based on `dataDir`
- [ ] Add `MERITS_VAULT_PASSWORD` environment variable
- [ ] Ensure file permissions (0600) on keychain files
- [ ] Add vault type to debug output

**CLI Entry Point:**
- [ ] Add `--dir` to global options
- [ ] Pass `dataDir` to config loader
- [ ] Update help text with `--dir` examples

**Documentation:**
- [ ] Update CLI README with `--dir` usage
- [ ] Add testing guide with examples
- [ ] Document FileVault security warnings

**Tests:**
- [ ] E2E messaging test (Alice → Bob)
- [ ] E2E group messaging test
- [ ] Parallel test isolation test
- [ ] Data persistence test
- [ ] FileVault unit tests

### Success Criteria

- ✅ Can run CLI with `--dir` and all data confined to that directory
- ✅ Can run parallel tests without conflicts
- ✅ E2E tests written as CLI commands (no direct API calls)
- ✅ Test cleanup is simple: `rm -rf test-data-{tmp}/`
- ✅ Tests can be paused/resumed for debugging
- ✅ FileVault works for CI environments without OS keychain

### Benefits

**For Testing:**
- Complete test isolation (no shared state)
- Parallel test execution
- Easy cleanup (`rm -rf`)
- Reproducible scenarios
- Debug-friendly (inspect data directories)

**For Development:**
- Test different configurations side-by-side
- Simulate multi-user scenarios locally
- Quick reset without affecting personal data

**For CI/CD:**
- No OS keychain dependency
- Deterministic test environments
- Easy to package test fixtures

### Security Considerations

**FileVault is INSECURE:**
- Uses deterministic password
- Keys stored on disk (encrypted but weak)
- Only for testing/development

**Never use FileVault in production:**
- CLI should warn if FileVault is active
- Documentation should emphasize OS Keychain for production

**Warning message:**
```
⚠️  WARNING: Using file-based vault (INSECURE)
   This is for testing only. Production should use OS Keychain.
   Set MERITS_VAULT_PASSWORD to change encryption password.
```

### Files to Create/Modify

```
cli/
├── lib/
│   ├── config.ts              # MODIFY: Add dataDir support
│   └── vault/
│       ├── FileVault.ts       # NEW: File-based vault for testing
│       └── index.ts           # MODIFY: Vault selection logic

tests/cli/
└── e2e/                       # NEW: End-to-end test directory
    ├── messaging.test.ts      # NEW: Messaging E2E tests
    ├── groups.test.ts         # NEW: Group E2E tests
    └── helpers/
        └── cli-runner.ts      # NEW: CLI test helpers
```

**Documentation**: [cli-phase-3.5.md](./cli-phase-3.5.md) (to be created)

---

## Phase 4: Streaming & Groups

**Goal**: Real-time message delivery and group management

**Duration**: Week 3-4

**Commands**:
- `merits watch` - Stream messages in real-time
- `merits group:create` - Create new group
- `merits group:list` - List all groups
- `merits group:info` - Show group details
- `merits group:add` - Add members
- `merits group:remove` - Remove members
- `merits group:leave` - Leave group

**Key Features**:
- **Session token optimization**:
  - One initial auth proof
  - Short-lived session token (<60s)
  - Reusable for continuous acks
  - Scoped to specific purposes
- **Group operations**:
  - Server-side fanout
  - Role management (owner/admin/member)
  - Membership changes

**Watch Flow**:
```ts
// Open authenticated session
const { sessionToken } = await client.transport.openWatchSession({
  for: aliceAid,
  auth: getAuthProof({ purpose: "receive" })
});

// Subscribe with token reuse
await client.transport.subscribe({
  for: aliceAid,
  sessionToken,
  onMessage: async (msg) => {
    await router.dispatch(ctx, msg);
    await client.transport.ackBatch({
      messageIds: [msg.id],
      sessionToken  // Reuse token, no signing
    });
  }
});
```

**Technical Highlights**:
- 🔄 Session token reuse eliminates repeated signing
- 📡 Real-time message streaming via subscribe
- 👥 Group management with role-based access
- ⚡ Batch ack operations

**Success Criteria**:
- Watch streaming works with session tokens
- Groups can be created and managed
- Server-side fanout tested
- Session token expiry enforced

**Documentation**: [cli-phase-4.md](./cli-phase-4.md) (to be created)

---

## Phase 5: Admin & Interactive

**Goal**: Admin operations and interactive TUI mode

**Duration**: Week 4-5

**Commands**:
- `merits admin:promote` - Promote user tier
- `merits admin:rate-limit` - Adjust rate limits
- `merits admin:stats` - Show usage stats
- `merits admin:whoami` - Inspect admin roles
- `merits` (no args) - Interactive TUI

**Key Features**:
- **Admin namespace**:
  - Controlled onboarding (`promote`)
  - Rate limit management
  - Usage statistics
  - Role inspection
- **Interactive mode**:
  - @clack/prompts for menus
  - Guided workflows
  - User-friendly prompts

**Interactive Flow**:
```
? What would you like to do?
  › Send a message
    Check unread messages
    Manage identities
    Manage groups
    Admin operations
    Settings
    Exit
```

**Technical Highlights**:
- 🔐 Fresh proof per admin command (no token reuse)
- 🎨 Colorized output with chalk
- ⏳ Progress spinners with ora
- 💬 Interactive prompts with @clack/prompts

**Success Criteria**:
- Admin commands work with proper authorization
- Interactive mode provides complete functionality
- Help text comprehensive
- Error messages helpful

**Documentation**: [cli-phase-5.md](./cli-phase-5.md) (to be created)

---

## Phase 6: Publishing & Docs

**Goal**: Package for npm and comprehensive documentation

**Duration**: Week 5-6

**Deliverables**:
- ✅ Complete CLI usage guide
- ✅ Example scripts (automation, monitoring, etc.)
- ✅ Package configuration for npm
- ✅ Binary permissions and shebang
- ✅ Installation testing (npm/bun)
- ✅ Release process documentation

**Publishing Strategy**:
```json
// Two packages from one repo
{
  "@merits/core": {
    "description": "Merits messaging library",
    "dependencies": ["@noble/ed25519", "@noble/hashes", "convex"]
  },
  "merits": {
    "description": "Merits CLI binary",
    "dependencies": ["@merits/core", "commander", "chalk", "ora", "keytar"],
    "bin": {
      "merits": "./cli/index.ts"
    }
  }
}
```

**Documentation**:
- `docs/cli-usage.md` - User guide with examples
- `cli/README.md` - Quick reference
- `docs/cli-examples.md` - Script examples
- Man pages for `merits(1)`

**Example Scripts**:
- Automated notifications
- Batch sending
- Health checks
- Message filtering pipelines

**Success Criteria**:
- Can install via `npm install -g merits`
- All commands documented with examples
- Scripts tested and working
- Release process validated

**Documentation**: [cli-phase-6.md](./cli-phase-6.md) (to be created)

---

## Key Design Decisions (from Review)

### ✅ 1. Auth Flow Optimization

**Problem**: Original plan had N+1 round-trips for multi-message operations

**Solution**:
- Single-proof `receiveAndAck` for combined operations
- Session tokens for streaming/ack reuse
- Scoped, short-lived tokens (<60s)

**Impact**:
- Massive performance improvement for `watch` and batch operations
- Simplified user experience (less signing)
- Maintains security (tokens scoped and time-limited)

### ✅ 2. Vault Interface Expansion

**Added**:
- `signIndexed()` - Returns KERI indexed signatures
- `decrypt()` - Decrypts messages inside vault

**Benefits**:
- Keys never leave vault
- Future multisig support
- Human-readable message output in CLI

### ✅ 3. Admin Namespace

**New**: `merits admin:*` commands for system administration

**Security**:
- Always requires fresh proof (no session token reuse)
- Explicit purpose: `"admin"`
- Audit trail for all admin operations

---

## Testing Strategy

### Unit Tests
- `cli/lib/vault/` - Vault implementations
- `cli/lib/getAuthProof.ts` - Auth helper
- `cli/lib/encryption.ts` - Encryption layers
- `cli/lib/formatters.ts` - Output formatting
- `cli/lib/config.ts` - Config management

### Integration Tests
- Identity lifecycle (create → register → export → import)
- Send/receive flow with `receiveAndAck`
- Watch with session token reuse
- Group operations (create → add → send → leave)
- Admin operations (promote → rate-limit)

### End-to-End Tests
```bash
# Complete user flow
merits init
merits id:create --name alice
merits id:register alice
merits send --to bob --message "Hello"
merits unread --mark-read=true
merits watch --from alice
```

### CLI Test Helpers
```typescript
// tests/cli/helpers/cli-runner.ts
export async function runCLI(args: string[]) {
  const proc = Bun.spawn(["bun", "cli/index.ts", ...args], {
    env: {
      MERITS_CONFIG: tempConfigPath,
      CONVEX_URL: process.env.CONVEX_URL
    }
  });

  return {
    exitCode: proc.exitCode,
    stdout: await proc.text(),
    stderr: ""
  };
}
```

---

## Dependencies

### Production (CLI only)
```json
{
  "commander": "^11.1.0",      // CLI framework
  "chalk": "^5.3.0",           // Colors
  "ora": "^8.0.1",             // Spinners
  "@clack/prompts": "^0.7.0",  // Interactive
  "keytar": "^7.9.0"           // OS keychain
}
```

### Core Library (unchanged)
```json
{
  "@noble/ed25519": "^3.0.0",
  "@noble/hashes": "^2.0.1",
  "cesr-ts": "github:weboftrust/cesr-ts",
  "convex": "^1.16.0"
}
```

---

## Success Metrics

### Functional
- ✅ All commands implemented and tested
- ✅ Auth flows optimized (single-proof operations)
- ✅ OS Keychain integration working cross-platform
- ✅ Output formatting complete (json/text/compact)
- ✅ Piping support for input/output

### Performance
- ⚡ Send message: <500ms (single proof)
- ⚡ Receive+ack: <1s (single proof)
- ⚡ Watch ack: <100ms (session token, no signing)
- ⚡ Batch ack 10 messages: <500ms (single call)

### Security
- 🔐 Private keys never leave vault
- 🔐 Session tokens <60s lifetime
- 🔐 Admin ops always fresh proof
- 🔐 Audit trail for all operations

### UX
- 📊 Help text comprehensive
- 📊 Error messages actionable
- 📊 Interactive mode intuitive
- 📊 Examples working

---

## Future Enhancements (Post-MVP)

**Phase 6+**:
- Multi-backend support (Firebase, Supabase, etc.)
- Message search (`merits search --query "keyword"`)
- Contact management (`merits contacts:add alice`)
- Read receipts
- Desktop notifications
- Tab completion (bash/zsh/fish)
- File attachments
- Message threading/replies

---

## Related Documentation

- [CLI Design Plan](./cli-plan.md) - Original comprehensive design
- [CLI Plan (Updated Review)](./merits-cli-plan-updated.md) - Auth optimizations
- [Architecture](./architecture.md) - System design
- [API Reference](./api-reference.md) - TypeScript API
- [Migration Plan](./migration-plan.md) - Overall roadmap

---

**Current Status**: ✅ Phase 2 Complete | 📋 Phase 3 Ready

**Next Steps**:
1. ✅ ~~Phase 1 (Core Infrastructure)~~ - Complete!
2. ✅ ~~Phase 2 (Identity Management)~~ - Complete! (41/41 tests passing)
3. Begin Phase 3 (Messaging Commands)
4. Create [cli-phase-3-complete.md](./cli-phase-3-complete.md) when done

**Last Updated**: 2025-10-26
