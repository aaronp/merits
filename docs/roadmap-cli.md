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

## Milestones Overview

| Phase | Milestone | Timeline | Status |
|-------|-----------|----------|--------|
| 0 | [Core Infrastructure](#milestone-0-core-infrastructure) | Week 1 | 🔄 In Progress |
| 1 | [Identity Management](#milestone-1-identity-management) | Week 1-2 | ⏳ Pending |
| 2 | [Messaging Commands](#milestone-2-messaging-commands) | Week 2-3 | ⏳ Pending |
| 3 | [Streaming & Groups](#milestone-3-streaming--groups) | Week 3-4 | ⏳ Pending |
| 4 | [Admin & Interactive](#milestone-4-admin--interactive) | Week 4-5 | ⏳ Pending |
| 5 | [Publishing & Docs](#milestone-5-publishing--docs) | Week 5-6 | ⏳ Pending |

---

## Milestone 0: Core Infrastructure

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

**Documentation**: [cli-milestone-0.md](./cli-milestone-0.md)

---

## Milestone 1: Identity Management

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

---

## Milestone 2: Messaging Commands

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

---

## Milestone 3: Streaming & Groups

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

---

## Milestone 4: Admin & Interactive

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

---

## Milestone 5: Publishing & Docs

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

**Current Status**: 🔄 Milestone 0 In Progress

**Next Steps**:
1. Implement Milestone 0 (Core Infrastructure)
2. Create [cli-milestone-0.md](./cli-milestone-0.md) completion doc
3. Begin Milestone 1 (Identity Management)

**Last Updated**: 2025-01-26
