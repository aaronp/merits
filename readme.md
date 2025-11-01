# Merits v0.1.0

A **KERI-authenticated messaging system** with challenge/response auth, supporting direct messaging, groups, and real-time delivery.

**What it does**: Let users prove control of their KERI AIDs and exchange encrypted messages (1:1 or groups) without passwords or sessions.

## Quick Start

### Installation

```bash
bun install
bunx convex dev          # Start backend
export CONVEX_URL=https://your-deployment.convex.cloud
```

### CLI Usage

```bash
# Create identity
merits identity new alice
merits identity register alice

# Send message
merits send <recipient-aid> --message "Hello!" --from alice

# Receive messages
merits receive --from alice --plaintext

# Create group
merits group create team-alpha --from alice

# Send to group
merits send <group-id> --message "Hello team!" --from alice

# Access control
merits access allow <aid> --note "friend" --token $TOKEN     # Whitelist
merits access deny <aid> --note "spam" --token $TOKEN        # Blocklist
merits access list --allow --token $TOKEN                     # View lists
merits access --help                                          # Full documentation

# Lookup public keys (NEW)
merits key-for <aid> --format pretty                          # Get public key

# Watch real-time
merits watch --from alice --plaintext
```

**CLI Examples**: See [tests/cli/integration/](tests/cli/integration/) for full E2E flows.

### SDK Usage

```typescript
import { createMeritsClient } from "./src/client";

const client = createMeritsClient(process.env.CONVEX_URL!);

// 1. Create auth proof
const auth = await client.createAuth(identity, "send", {
  recpAid: bob.aid,
  ctHash: sha256Hex(ct),
  ttl: 60000,
});

// 2. Send message
await client.transport.sendMessage({
  to: bob.aid,
  ct: encrypt("Hello!"),
  typ: "chat.text.v1",
  auth,
});

// 3. Receive messages
const msgs = await client.transport.receiveMessages({
  for: bob.aid,
  auth: bobAuth,
});

// 4. Subscribe (real-time)
const cancel = await client.transport.subscribe({
  for: bob.aid,
  auth: bobAuth,
  onMessage: async (msg) => {
    console.log("New message:", msg);
    return true; // auto-ack
  },
});
```

**SDK Examples**: See [tests/integration/sdk-integration.test.ts](tests/integration/sdk-integration.test.ts) and [tests/integration/messaging-flow.test.ts](tests/integration/messaging-flow.test.ts).

## Key Features

- ✅ **Challenge/Response Auth** - No passwords, prove AID control via Ed25519 signatures
- ✅ **Direct Messaging** - 1:1 encrypted messages with ack/replay protection
- ✅ **Zero-Knowledge Group Messaging** - End-to-end encrypted groups with ephemeral keys
  - Backend cannot decrypt messages
  - Forward secrecy via ephemeral AES-256-GCM keys
  - Per-member key distribution via X25519 ECDH
  - Automatic client-side decryption
- ✅ **Access Control** - Fine-grained message filtering with allow/deny lists (NEW ✨)
  - Block unwanted senders (deny-list)
  - Private messaging mode (allow-list)
  - Priority rules (deny always wins)
  - See [`merits access --help`](#access-control) and [docs/ALLOW-LIST-DESIGN.md](docs/ALLOW-LIST-DESIGN.md)
- ✅ **Real-Time Delivery** - Subscribe to messages with auto-ack
- ✅ **Message Routing** - Type-based dispatch (`typ: "chat.text.v1"`)
- ✅ **Backend-Agnostic** - Core interfaces + Convex adapter
- ✅ **CLI** - Full-featured command-line tool with comprehensive help text
- ✅ **Portable Crypto** - [@noble/ed25519](https://github.com/paulmillr/noble-ed25519) + [@noble/hashes](https://github.com/paulmillr/noble-hashes) (no platform deps)

## Architecture

```
┌─────────────────────────────────┐
│    CLI (merits)                 │  User-facing tool
│    cli/commands/*.ts            │
└──────────────┬──────────────────┘
               │
┌──────────────▼──────────────────┐
│    Unified SDK                  │  Application interface
│    src/client.ts                │
│    • createMeritsClient()       │
└──────────────┬──────────────────┘
               │
┌──────────────▼──────────────────┐
│  Core Interfaces                │  Backend-agnostic contracts
│  core/interfaces/               │
│  • IdentityAuth                 │  Challenge/response auth
│  • Transport                    │  Send/receive messages
│  • GroupApi                     │  Group management
│  • MessageRouter                │  Type-based routing
│  core/crypto.ts                 │  @noble crypto primitives
└──────────────┬──────────────────┘
               │
┌──────────────▼──────────────────┐
│  Backend Adapters               │  Implementation layer
│  convex/adapters/               │
│  • ConvexIdentityAuth.ts        │
│  • ConvexTransport.ts           │
│  • ConvexGroupApi.ts            │
└──────────────┬──────────────────┘
               │
┌──────────────▼──────────────────┐
│  Convex Backend                 │  Storage + serverless functions
│  convex/                        │
│  • auth.ts                      │  Challenge/proof verification
│  • messages.ts                  │  Message CRUD
│  • groups.ts                    │  Group fanout
│  • sessions.ts                  │  Session tokens (watch)
│  • schema.ts                    │  Database schema
└─────────────────────────────────┘
```

**Core Principle**: All business logic lives in backend-agnostic interfaces. Adapters are thin wrappers.

**See**: [docs/architecture.md](docs/architecture.md) for detailed design decisions.

## Documentation

### Overview & Architecture
- **[Architecture](docs/architecture.md)** - Codebase layout, design patterns, key assumptions
- **[Group Messaging](docs/GROUP-MESSAGING-COMPLETE.md)** - Zero-knowledge group encryption implementation
- **[Group Chat Design](docs/group-chat.md)** - Group chat architecture and message flow

### Security & Authentication
- **[Authentication](docs/auth.md)** - Challenge/response flow, signature verification, KSN binding
- **[Permissions](docs/permissions.md)** - Who can message whom, admin controls, rate limiting
- **[Access Control](docs/ALLOW-LIST-DESIGN.md)** - Allow/deny lists for message filtering (NEW ✨)
  - Use `merits access --help` for CLI documentation
  - Backend APIs: [convex/allowList.ts](convex/allowList.ts), [convex/denyList.ts](convex/denyList.ts)
  - Implementation summary: [docs/PHASE-6-ALLOW-LIST-COMPLETE.md](docs/PHASE-6-ALLOW-LIST-COMPLETE.md)

### API & CLI Reference
- **CLI Help** - Run `merits --help` for command overview
  - `merits send --help` - Direct and group message sending
  - `merits unread --help` - Message retrieval and decryption
  - `merits access --help` - Access control (allow/deny lists)
  - `merits key-for --help` - Public key lookup
- **Code Documentation** - Comprehensive JSDoc comments in source files:
  - [convex/schema.ts](convex/schema.ts) - Database schemas with security notes
  - [convex/groups.ts](convex/groups.ts) - Group APIs (getMembers, sendGroupMessage)
  - [convex/messages.ts](convex/messages.ts) - Message APIs (getUnread unified inbox)
  - [convex/auth.ts](convex/auth.ts) - Authentication APIs (getPublicKey)
  - [cli/commands/send.ts](cli/commands/send.ts) - Send command implementation
  - [cli/commands/unread.ts](cli/commands/unread.ts) - Unread command implementation
  - [cli/lib/crypto-group.ts](cli/lib/crypto-group.ts) - Group encryption library

### Testing & Development
- **[API Reference](docs/api-reference.md)** - Backend API contracts
- **[Future Work](docs/future-work.md)** - Known limitations, deferred features, roadmap

## Project Structure

```
merits/
├── cli/                      # Command-line interface
│   ├── commands/            # Command implementations
│   │   ├── send.ts          # Send messages (direct + group)
│   │   ├── receive.ts       # Receive messages
│   │   ├── watch.ts         # Real-time streaming
│   │   ├── group.ts         # Group management
│   │   └── identity/        # Identity management
│   ├── lib/                 # CLI utilities
│   │   ├── context.ts       # CLI context (client, vault, config)
│   │   ├── getAuthProof.ts  # Auth proof helpers
│   │   └── vault/           # Key storage (filesystem + OS keychain)
│   └── index.ts             # CLI entry point
│
├── core/                     # Backend-agnostic code
│   ├── crypto.ts            # @noble-based crypto primitives
│   ├── types.ts             # Common types (AID, AuthProof, etc.)
│   ├── interfaces/          # Core interface definitions
│   │   ├── IdentityAuth.ts  # Challenge/response auth
│   │   ├── Transport.ts     # Message send/receive
│   │   ├── GroupApi.ts      # Group management
│   │   └── MessageRouter.ts # Type-based routing
│   └── runtime/             # Message router implementation
│
├── convex/                   # Convex backend implementation
│   ├── adapters/            # Interface adapters
│   │   ├── ConvexIdentityAuth.ts
│   │   ├── ConvexTransport.ts
│   │   └── ConvexGroupApi.ts
│   ├── auth.ts              # Challenge/proof mutations
│   ├── messages.ts          # Message CRUD
│   ├── groups.ts            # Group fanout
│   ├── sessions.ts          # Session tokens
│   └── schema.ts            # Database schema
│
├── src/
│   └── client.ts            # Unified SDK (createMeritsClient)
│
├── tests/
│   ├── unit/                # Fast tests (no backend)
│   ├── integration/         # Backend integration tests
│   └── cli/                 # CLI E2E tests
│
├── docs/                     # Documentation
│   ├── architecture.md
│   ├── auth.md
│   ├── permissions.md
│   └── future-work.md
│
└── examples/                 # (Reserved for user examples)
```

## Testing

```bash
make test                  # All tests
make test-unit             # Unit tests only (no backend)
make test-integration      # Integration tests (requires CONVEX_URL)
make test-cli              # CLI E2E tests

# Run specific test file
CONVEX_URL=... bun test tests/integration/messaging-flow.test.ts
```

**Test Coverage**:
- ✅ Unit tests: Crypto, routing, auth logic
- ✅ Integration tests: End-to-end flows with real backend
- ✅ CLI tests: Command execution, vault operations, message flows

## Development

```bash
# Start Convex dev server
bunx convex dev

# Run CLI locally
bun run cli/index.ts --help

# Deploy to Convex
bunx convex deploy
```

## What's NOT Included (v0.1.0)

See [docs/future-work.md](docs/future-work.md) for:
- ECDH-ES encryption (currently stub base64)
- Key rotation support (KSN tracked but not enforced)
- OOBI/witness resolution (keys manually registered)
- Message expiry/cleanup (TTL tracked but not enforced)
- Rate limiting (structure exists, not enforced)
- Onboarding proofs (SAID-based, structure ready)
- Group roles beyond owner/member
- Message filtering in watch command

## License

MIT (see [LICENSE](LICENSE))

---

**Version**: 0.1.0
**Status**: Functional MVP - Ready for testing and feedback
**Git Tag**: v0.1.0
