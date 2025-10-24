# Merits - KERI-Authenticated Messaging System

A **backend-agnostic** messaging system with KERI-style challenge/response authentication, supporting 1:1 messaging, groups, and real-time delivery.

## Features

- ✅ **Challenge/Response Authentication** - KERI-based Ed25519 signatures
- ✅ **1:1 Messaging** - Send/receive encrypted messages between AIDs
- ✅ **Group Messaging** - Server-side fanout with total ordering
- ✅ **Real-Time Delivery** - Subscribe to messages with auto-ack
- ✅ **Message Routing** - Type-based dispatch to handlers
- ✅ **Backend-Agnostic** - Core interfaces with Convex adapter (easily swap backends)
- ✅ **Type-Safe** - Full TypeScript support
- ✅ **Portable Crypto** - @noble/ed25519 + @noble/hashes (no platform dependencies)

## Quick Start

### Installation

```bash
# Install dependencies
bun install

# Start Convex development server
make dev

# Run tests
make test
```

### Basic Usage

```typescript
import { createMeritsClient } from "./src/client";
import { generateKeyPair, createAID } from "./core/crypto";

// 1. Create client
const client = createMeritsClient(process.env.CONVEX_URL!);

// 2. Generate keys
const aliceKeys = await generateKeyPair();
const alice = {
  aid: createAID(aliceKeys.publicKey),
  privateKey: aliceKeys.privateKey,
  ksn: 0,
};

// 3. Send a message
const ct = encrypt("Hello Bob!");
const auth = await client.createAuth(alice, "send", {
  recpAid: bob.aid,
  ctHash: client.computeCtHash(ct),
  ttl: 60000,
});

await client.transport.sendMessage({
  to: bob.aid,
  ct,
  typ: "chat.text.v1",
  auth,
});

// 4. Receive messages
const messages = await client.transport.receiveMessages({
  for: bob.aid,
  auth: bobAuth,
});

client.close();
```

## Architecture

Merits uses a **layered, interface-based architecture**:

```
┌─────────────────────────────────────┐
│      Application Code               │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│      Unified SDK                    │
│  createMeritsClient()               │
│  • identity  • transport            │
│  • group     • router               │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│   Core Interfaces (Backend-Agnostic)│
│  • IdentityAuth  • Transport        │
│  • GroupApi      • MessageRouter    │
│  • core/crypto (@noble libraries)   │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│     Backend Adapters                │
│  • ConvexIdentityAuth               │
│  • ConvexTransport                  │
│  • ConvexGroupApi                   │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│      Convex Backend                 │
│  • auth.ts    • messages.ts         │
│  • groups.ts  • schema.ts           │
└─────────────────────────────────────┘
```

**Key Principle**: Core interfaces have **zero dependencies** on any backend.

See [docs/architecture.md](docs/architecture.md) for details.

## Examples

See [examples/](examples/) for complete working examples:

- **[chat-client.ts](examples/chat-client.ts)** - Basic 1:1 messaging
- **[group-chat.ts](examples/group-chat.ts)** - Group messaging with fanout
- **[subscribe.ts](examples/subscribe.ts)** - Real-time message delivery

## Documentation

- **[Architecture](docs/architecture.md)** - System design and data flow
- **[API Reference](docs/api-reference.md)** - Complete API documentation
- **[Migration Plan](docs/migration-plan.md)** - Development roadmap

## Development

### Project Structure

```
merits/
├── core/                    # Backend-agnostic code
│   ├── crypto.ts           # @noble-based crypto
│   ├── types.ts            # Common types
│   ├── interfaces/         # Core interfaces
│   └── runtime/            # Message routing
├── convex/                 # Convex backend
│   ├── adapters/          # Interface implementations
│   ├── auth.ts            # Auth mutations/queries
│   ├── messages.ts        # Message mutations
│   ├── groups.ts          # Group mutations
│   └── schema.ts          # Database schema
├── src/
│   └── client.ts          # Unified SDK
├── tests/                 # Unit + integration tests
├── examples/              # Working code examples
└── docs/                  # Documentation
```

### Testing

```bash
make test              # Run all tests
make test-unit         # Unit tests only (no backend)
make test-integration  # Integration tests (requires Convex)
```

**Test Results**: 51 unit tests passing ✅

## License

See [LICENSE](LICENSE) for details.

---

**Status**: Production-ready | All milestones complete ✅
