# Architecture

**Merits v0.1.0** uses a layered, backend-agnostic design where core interfaces define contracts and adapters implement them for specific backends.

## Design Principles

### 1. Backend Agnostic

**Core interfaces have zero backend dependencies**:
- All interfaces in `core/interfaces/` are pure TypeScript
- Crypto uses portable `@noble` libraries (no Node/Bun-specific APIs)
- Business logic lives in interfaces, not adapters

**Why**: Swap backends (Convex → Firebase → REST API) without touching app code.

### 2. Single Responsibility

Each layer has one job:
- **CLI**: User interaction, key management, output formatting
- **SDK**: Convenient API, auth helpers, unified client
- **Interfaces**: Contracts (what operations exist)
- **Adapters**: Implementation (how they work on specific backend)
- **Backend**: Storage, serverless functions, real-time subscriptions

### 3. Explicit Authentication

**No implicit auth**. Every operation requires an `AuthProof`:

```typescript
interface AuthProof {
  challengeId: string;  // Binds to specific operation
  sigs: string[];       // Indexed threshold signatures
  ksn: number;          // Key sequence number
}
```

Auth is:
- **Single-use**: Challenges consumed on first use
- **Purpose-bound**: `"send"`, `"receive"`, `"manageGroup"`, etc.
- **Args-bound**: Hash of operation parameters included in signed payload
- **Time-limited**: Challenges expire (default 120s)

## Codebase Layout

### Core (`core/`)

Backend-agnostic contracts and utilities.

```
core/
├── crypto.ts              # Ed25519 sign/verify, CESR encoding, SHA256
├── types.ts               # AID, AuthProof, EncryptedMessage
├── interfaces/
│   ├── IdentityAuth.ts    # Challenge/response auth contract
│   ├── Transport.ts       # Send/receive/subscribe contract
│   ├── GroupApi.ts        # Group management contract
│   └── MessageRouter.ts   # Type-based routing contract
└── runtime/
    └── MessageRouter.ts   # Router implementation (registry + dispatch)
```

**Key Files**:
- **[core/crypto.ts](../core/crypto.ts)**: `sign()`, `verify()`, `createAID()`, `sha256Hex()` - all using `@noble` libraries
- **[core/interfaces/IdentityAuth.ts](../core/interfaces/IdentityAuth.ts)**: Challenge/response flow definition
- **[core/interfaces/Transport.ts](../core/interfaces/Transport.ts)**: Message operations (send/receive/subscribe)
- **[core/interfaces/GroupApi.ts](../core/interfaces/GroupApi.ts)**: Group operations (create/add/remove/fanout)

### Backend (`convex/`)

Convex implementation with serverless functions and real-time subscriptions.

```
convex/
├── auth.ts                # Challenge/proof mutations
│                          # - issueChallenge, proveChallenge, verifyAuth
├── messages.ts            # Message CRUD
│                          # - sendMessage, receiveMessages, ackMessage
├── groups.ts              # Group management + fanout
│                          # - createGroup, addMembers, sendGroupMessage
├── sessions.ts            # Session tokens (for watch command)
│                          # - openSession, refreshSession, validateSession
├── schema.ts              # Database tables
│                          # - challenges, keyStates, messages, groups, sessionTokens
└── adapters/              # Interface implementations
    ├── ConvexIdentityAuth.ts   # Implements IdentityAuth
    ├── ConvexTransport.ts      # Implements Transport
    └── ConvexGroupApi.ts       # Implements GroupApi
```

**Database Schema** ([convex/schema.ts](../convex/schema.ts)):
- `challenges`: Single-use auth challenges (120s TTL)
- `keyStates`: Cached public keys (AID → keys mapping)
- `messages`: Encrypted messages with envelope metadata
- `groups`: Group membership and roles
- `groupLog`: Ordered group message log (for fanout audit)
- `sessionTokens`: Long-lived tokens for watch command (60s TTL, auto-refresh)

### SDK (`src/client.ts`)

Unified client with convenience methods.

```typescript
createMeritsClient(convexUrl: string): {
  // Direct interface access
  identity: IdentityAuth;
  transport: Transport;
  group: GroupApi;
  router: MessageRouter;

  // Convenience helpers
  createAuth(identity, purpose, args): Promise<AuthProof>;
  computeCtHash(ct: string): string;
  computeArgsHash(args: Record<string, any>): string;

  // Lifecycle
  close(): void;
}
```

**See**: [src/client.ts](../src/client.ts) for implementation.

### CLI (`cli/`)

Command-line interface with key management.

```
cli/
├── commands/              # Command implementations
│   ├── send.ts            # Send direct/group messages
│   ├── receive.ts         # Receive messages (pull)
│   ├── watch.ts           # Subscribe (push, auto-ack)
│   ├── group.ts           # Group CRUD
│   └── identity/          # Identity management
├── lib/
│   ├── context.ts         # CLIContext (client + vault + config)
│   ├── getAuthProof.ts    # Auth helpers (challenge → proof)
│   └── vault/             # Key storage
│       ├── MeritsVault.ts         # Interface
│       ├── FileVault.ts           # Filesystem storage
│       └── OSKeychainVault.ts     # OS keychain (future)
└── index.ts               # Commander.js setup
```

**Vault Design**:
- Stores private keys encrypted at rest
- Metadata in `~/.merits/vault-metadata.json`
- Keys in `~/.merits/identities/<name>/privateKey.enc`
- Future: OS keychain integration for production

## Key Assumptions (v0.1.0)

### Identity & Key Management

1. **Manual Key Registration**
   - Public keys manually registered via `identity.register`
   - No OOBI/witness resolution (structure exists, not implemented)
   - No automatic key discovery

2. **Key Rotation Not Enforced**
   - KSN (Key Sequence Number) tracked in database
   - Backend accepts KSN in auth proofs
   - **But**: Rotations not triggered, old keys not invalidated
   - Future: Implement KEL event processing

3. **Single Current Key**
   - Each AID has one active key set
   - Threshold signatures supported in crypto layer
   - Multi-sig not tested in practice

### Encryption

1. **Stub Encryption (v0.1.0)**
   - Messages encrypted with **base64 encoding** (NOT SECURE)
   - Structure ready for ECDH-ES + AES-GCM
   - See [docs/future-work.md](./future-work.md) for crypto roadmap

2. **Group Encryption**
   - Group messages use placeholder encryption
   - Backend re-encrypts for each member (fanout)
   - No shared group keys (each member gets individual copy)

### Permissions

1. **Open Messaging (v0.1.0)**
   - Any registered AID can message any other registered AID
   - No allowlists/blocklists enforced
   - Rate limiting structure exists but not active
   - See [docs/permissions.md](./permissions.md) for details

2. **Group Membership**
   - Only group members can send group messages
   - Role-based permissions (owner/admin/member)
   - Owner role enforced (cannot remove last owner)
   - Admin/member distinction not fully implemented

### Message Lifecycle

1. **No TTL Enforcement**
   - Messages have `expiresAt` field
   - **Not enforced** - no cleanup mutations
   - Old messages accumulate in database

2. **No Message Deletion**
   - Ack marks message as `retrieved: true`
   - Message stays in database forever
   - Future: Add expiry cleanup cron job

## Data Flow Examples

### 1. Send Direct Message

```
CLI: merits send <aid> --message "Hello"
  ↓
SDK: client.createAuth(identity, "send", {...})
  ↓
IdentityAuth: issueChallenge("send", argsHash)
  ← Challenge { challengeId, payloadToSign }
  ↓
SDK: Sign payloadToSign with private key → AuthProof
  ↓
Transport: sendMessage({ to, ct, auth })
  ↓
Backend: verifyAuth(auth) → Check sigs, consume challenge
Backend: Insert into messages table
  ← { messageId }
```

### 2. Watch Real-Time Messages

```
CLI: merits watch --from alice
  ↓
SDK: client.createAuth(identity, "openSession", {...})
  ↓
Backend: openSession(auth) → Verify, create session token
  ← { sessionToken, expiresAt }
  ↓
Transport: subscribe({ for, sessionToken, onMessage })
  ↓
Backend: Watch messages table, filter by recpAid
  ← Stream of EncryptedMessage via Convex subscriptions
  ↓
CLI: onMessage(msg) → Display → Return true (auto-ack)
  ↓
Backend: Mark message as retrieved via session token
```

### 3. Send Group Message

```
CLI: merits send <group-id> --message "Hello team"
  ↓
SDK: Detect group ID (not an AID) → Route to group.sendGroupMessage
  ↓
SDK: client.createAuth(identity, "sendGroup", {...})
  ↓
GroupApi: sendGroupMessage({ groupId, ct, auth })
  ↓
Backend: verifyAuth(auth, purpose="sendGroup")
Backend: Check sender is group member
Backend: Insert into groupLog (seqNum, audit trail)
Backend: Fan out to members:
  For each member (except sender):
    - Insert into messages table
    - Re-encrypt ct for member's keys (stub encryption in v0.1.0)
  ← { messageId }
```

## Testing Strategy

### Unit Tests (`tests/unit/`)

**Fast tests, no backend**:
- Crypto primitives (`crypto.test.ts`)
- Message routing (`router.test.ts`)
- Auth logic (isolated, mocked)

**Run**: `make test-unit` (< 1s)

### Integration Tests (`tests/integration/`)

**Real backend (Convex)**:
- End-to-end messaging flows (`messaging-flow.test.ts`)
- Group fanout (`group-integration.test.ts`)
- Auth challenge/response (`identity-auth-interface.test.ts`)
- SDK convenience methods (`sdk-integration.test.ts`)

**Run**: `CONVEX_URL=... make test-integration` (5-10s)

### CLI Tests (`tests/cli/`)

**CLI command execution**:
- Unit tests for vault, formatters
- Integration tests for send/receive/group workflows

**Run**: `CONVEX_URL=... make test-cli`

## Extension Points

### Adding a New Backend

1. Create adapter directory: `<backend>/adapters/`
2. Implement interfaces:
   - `<Backend>IdentityAuth implements IdentityAuth`
   - `<Backend>Transport implements Transport`
   - `<Backend>GroupApi implements GroupApi`
3. Update `src/client.ts` to support new backend
4. Write backend-specific mutations/queries

**No changes to core/ required**.

### Adding a New Message Type

1. Register handler in router:
   ```typescript
   router.register("my.type.v1", async (ctx, msg) => {
     const plaintext = decrypt(msg.ct);
     // Handle message
   });
   ```
2. Send messages with `typ: "my.type.v1"`
3. Router dispatches to your handler automatically

### Adding a New CLI Command

1. Create `cli/commands/mycommand.ts`
2. Use `CLIContext` to access client, vault, config
3. Register in `cli/index.ts` with Commander.js
4. Use `getAuthProof()` helper for auth

## Security Considerations (v0.1.0)

### ✅ What's Secure

- Ed25519 signatures (via @noble/ed25519)
- Challenge/response prevents replay attacks
- Args hash binds auth to specific operation
- Single-use challenges (consumed on first verify)
- Threshold signature support (crypto layer)

### ⚠️ What's NOT Secure (Yet)

- **Encryption**: Base64 stub, not ECDH-ES + AES-GCM
- **Key Storage**: Filesystem encryption weak (future: OS keychain)
- **MITM**: No TLS validation in Convex client (relies on Convex security)
- **Rate Limiting**: Structure exists, not enforced
- **Message Expiry**: Old messages never cleaned up

**See**: [docs/future-work.md](./future-work.md) for security roadmap.

## References

- **[Core Interfaces](../core/interfaces/)** - Interface definitions
- **[Convex Backend](../convex/)** - Implementation
- **[SDK Client](../src/client.ts)** - Unified client
- **[CLI](../cli/)** - Command-line tool
- **[Tests](../tests/)** - Usage examples
