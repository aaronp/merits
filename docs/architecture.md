# Merits Architecture

## Overview

Merits is a backend-agnostic messaging system with KERI-based authentication. The architecture is built in layers, with clear separation between core interfaces, adapters, and application code.

## Layer Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                       │
│  (Your chat app, group messaging, etc.)                     │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      Unified SDK                             │
│                  createMeritsClient()                        │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ identity │  │transport │  │  group   │  │  router  │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                              │
│  Helpers: createAuth(), computeArgsHash(), computeCtHash()  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Core Interfaces                           │
│              (Backend-Agnostic Contracts)                    │
│                                                              │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐  │
│  │ IdentityAuth   │  │   Transport    │  │   GroupApi   │  │
│  │ - issueChall.. │  │ - sendMessage  │  │ - createGr.. │  │
│  │ - verifyAuth   │  │ - receiveMess..│  │ - addMemb..  │  │
│  └────────────────┘  │ - ackMessage   │  │ - sendGrou.. │  │
│                      │ - subscribe    │  └──────────────┘  │
│  ┌────────────────┐  └────────────────┘                     │
│  │ MessageRouter  │                                         │
│  │ - register     │  ┌────────────────┐                     │
│  │ - dispatch     │  │   core/crypto  │                     │
│  │ - hasHandler   │  │ - @noble/ed..  │                     │
│  └────────────────┘  │ - @noble/hash..│                     │
│                      └────────────────┘                     │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  Backend Adapters                            │
│           (Implementation for specific backend)              │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Convex Adapters                         │   │
│  │                                                      │   │
│  │  ┌─────────────────┐  ┌──────────────────┐         │   │
│  │  │ConvexIdentity..│  │ConvexTransport   │         │   │
│  │  └─────────────────┘  └──────────────────┘         │   │
│  │                                                      │   │
│  │  ┌─────────────────┐                                │   │
│  │  │ConvexGroupApi   │                                │   │
│  │  └─────────────────┘                                │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Future: Firebase, Supabase, Custom REST API adapters       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend Services                          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                 Convex Backend                       │   │
│  │                                                      │   │
│  │  • auth.ts - Challenge/response mutations           │   │
│  │  • messages.ts - Send/receive/ack mutations          │   │
│  │  • groups.ts - Group management                      │   │
│  │  • schema.ts - Database schema                       │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Core Design Principles

### 1. Backend-Agnostic Core

All core interfaces have **zero dependencies** on any specific backend:

- `core/interfaces/` - Pure TypeScript interfaces
- `core/crypto.ts` - Uses `@noble` libraries (portable)
- `core/runtime/` - No backend coupling
- `core/types.ts` - Universal types

This enables:
- Easy backend swapping (Convex → Firebase → Custom)
- Testing without backend
- Code reuse across platforms

### 2. Adapter Pattern

Each backend implements the core interfaces via adapters:

```typescript
// Core interface (backend-agnostic)
interface Transport {
  sendMessage(req: MessageSendRequest): Promise<{messageId: string}>;
  // ...
}

// Convex adapter (backend-specific)
class ConvexTransport implements Transport {
  constructor(private client: ConvexClient) {}

  async sendMessage(req) {
    // Convex-specific implementation
    return this.client.mutation(api.messages.send, ...);
  }
}

// Future: Firebase adapter
class FirebaseTransport implements Transport {
  async sendMessage(req) {
    // Firebase-specific implementation
  }
}
```

### 3. Dependency Flow

Dependencies flow **downward only**:

```
Application Code
    ↓ (depends on)
Unified SDK
    ↓ (depends on)
Core Interfaces
    ↓ (implements)
Backend Adapters
    ↓ (depends on)
Backend Services
```

**Never upward**: Core never depends on adapters or SDK.

### 4. KERI Authentication

All operations use KERI challenge/response:

1. **Issue Challenge**: Server creates nonce + binds to operation args
2. **Sign Payload**: Client signs with private key
3. **Verify Auth**: Server verifies signatures + threshold
4. **Execute Operation**: Server performs action as authenticated AID

This provides:
- Non-repudiation (signatures prove intent)
- Replay prevention (challenges are single-use)
- Threshold security (multi-sig support)
- Args binding (prevents parameter tampering)

## Component Details

### Core Interfaces

#### IdentityAuth
```typescript
interface IdentityAuth {
  issueChallenge(req: IssueChallengeRequest): Promise<IssueChallengeResponse>;
  verifyAuth(req: VerifyAuthRequest): Promise<VerifyAuthResult>;
}
```

**Purpose**: Challenge/response authentication for KERI AIDs.

**Flow**:
1. Client requests challenge for specific operation (send, receive, etc.)
2. Server returns nonce + payload to sign
3. Client signs payload with AID keys
4. Server verifies signature + threshold

#### Transport
```typescript
interface Transport {
  sendMessage(req: MessageSendRequest): Promise<{messageId: string}>;
  receiveMessages(req: {for: AID; auth: AuthProof}): Promise<EncryptedMessage[]>;
  ackMessage(req: {messageId: string; auth: AuthProof}): Promise<void>;
  subscribe(opts: SubscribeOptions): Promise<() => void>;
}
```

**Purpose**: Move encrypted messages between AIDs.

**Features**:
- Authenticated send/receive/ack
- Real-time subscribe with auto-ack
- Content hash binding (prevents substitution)
- Receipt signatures (non-repudiation)

#### GroupApi
```typescript
interface GroupApi {
  createGroup(req: CreateGroupRequest): Promise<{groupId: GroupId}>;
  addMembers(req: AddMembersRequest): Promise<void>;
  removeMembers(req: RemoveMembersRequest): Promise<void>;
  sendGroupMessage(req: GroupSendRequest): Promise<{messageId: string}>;
  listGroups(req: ListGroupsRequest): Promise<Group[]>;
  getGroup(req: GetGroupRequest): Promise<Group>;
  leaveGroup(req: LeaveGroupRequest): Promise<void>;
}
```

**Purpose**: Manage groups and send messages with server-side fanout.

**Server-Side Fanout**:
1. Sender sends one encrypted message
2. Server decrypts once
3. Server re-encrypts for each member
4. Individual messages created atomically
5. Total ordering via sequence numbers

#### MessageRouter
```typescript
interface MessageRouter {
  register(typ: string, handler: MessageHandler): void;
  dispatch(ctx: MessageHandlerContext, msg: EncryptedMessage): Promise<void>;
  hasHandler(typ: string): boolean;
  unregister(typ: string): boolean;
}
```

**Purpose**: Route messages to handlers based on `typ` field.

**Features**:
- Type-based dispatch
- Error handling hooks
- Default handler
- Async support

### Core Crypto

All crypto operations use `@noble` libraries:

```typescript
// core/crypto.ts
import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";

export async function sign(message: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  return ed.signAsync(message, privateKey);
}

export async function verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
  return ed.verifyAsync(signature, message, publicKey);
}

export function sha256Hex(data: Uint8Array): string {
  // ... using @noble/hashes
}
```

**Zero dependencies** on:
- Web Crypto API
- Node.js crypto
- Any backend-specific crypto

### Unified SDK

Single entry point for all operations:

```typescript
const client = createMeritsClient(convexUrl);

// All interfaces available
await client.identity.issueChallenge({...});
await client.transport.sendMessage({...});
await client.group.createGroup({...});
client.router.register("chat.text.v1", handler);

// Helpers included
const auth = await client.createAuth(credentials, "send", args);
const hash = client.computeArgsHash(args);

client.close();
```

## Data Flow Examples

### Send Message Flow

```
Alice                  SDK                 ConvexTransport        Convex Backend
  |                     |                        |                      |
  | sendMessage()       |                        |                      |
  |-------------------->|                        |                      |
  |                     | computeCtHash(ct)      |                      |
  |                     |                        |                      |
  |                     | createAuth(...)        |                      |
  |                     |   |                    |                      |
  |                     |   | issueChallenge     |                      |
  |                     |   |------------------->|--------------------->|
  |                     |   |<-------------------|<---------------------|
  |                     |   | (challengeId, payload)                    |
  |                     |   |                    |                      |
  |                     |   | signPayload(...)   |                      |
  |                     |   | (using @noble/ed25519)                    |
  |                     |   |                    |                      |
  |                     |<--|                    |                      |
  |                     | (AuthProof)            |                      |
  |                     |                        |                      |
  |                     | transport.sendMessage()|                      |
  |                     |----------------------->|                      |
  |                     |                        | mutation(api.messages.send)
  |                     |                        |--------------------->|
  |                     |                        |                      | verifyAuth()
  |                     |                        |                      | insertMessage()
  |                     |                        |<---------------------|
  |                     |<-----------------------| (messageId)          |
  |<--------------------|                        |                      |
  | (messageId)         |                        |                      |
```

### Subscribe + Route Flow

```
Bob                    SDK                 ConvexTransport        Convex Backend
  |                     |                        |                      |
  | router.register()   |                        |                      |
  |-------------------->|                        |                      |
  |                     |                        |                      |
  | subscribe()         |                        |                      |
  |-------------------->|                        |                      |
  |                     | transport.subscribe()  |                      |
  |                     |----------------------->|                      |
  |                     |                        | onUpdate(api.messages.list)
  |                     |                        |--------------------->|
  |                     |                        |                      |
  |                     |                        |<---------------------|
  |                     |                        | (new messages)       |
  |                     |                        |                      |
  |                     |                        | onMessage callback   |
  |                     |<-----------------------|                      |
  |                     |                        |                      |
  |                     | router.dispatch()      |                      |
  |                     | (routes by typ field)  |                      |
  |                     |                        |                      |
  | handler callback    |                        |                      |
  |<--------------------|                        |                      |
  | (message processed) |                        |                      |
  |                     |                        |                      |
  |                     | ackMessage()           |                      |
  |                     |----------------------->|--------------------->|
  |                     |                        |                      | deleteMessage()
```

### Group Message Fanout

```
Alice                  GroupApi            Convex Backend
  |                     |                        |
  | sendGroupMessage()  |                        |
  |-------------------->|                        |
  |                     | mutation(api.groups.sendGroupMessage)
  |                     |----------------------->|
  |                     |                        | verifyAuth()
  |                     |                        | checkMembership()
  |                     |                        | insertGroupLog(seqNum)
  |                     |                        |
  |                     |                        | FOR EACH member (except sender):
  |                     |                        |   insertMessage(to: member)
  |                     |                        |
  |                     |                        | updateFanoutStatus()
  |                     |<-----------------------|
  |<--------------------|                        |
  |                     |                        |
  |                     |                        ▼
  |                     |              [Bob receives via subscribe]
  |                     |              [Carol receives via subscribe]
  |                     |              [Dave receives via subscribe]
```

## Security Model

### Authentication Flow
1. Every operation requires `AuthProof`
2. Proof contains `challengeId` + signatures + KSN
3. Server verifies:
   - Challenge exists and not used
   - Challenge not expired
   - Purpose matches operation
   - Args hash matches (prevents tampering)
   - Signatures meet threshold
   - KSN matches current state

### Authorization
- Transport: Sender can send to any AID
- Receive: Only recipient can receive their messages
- Groups: Only admins/owners can modify membership
- Router: Application-level (your handlers decide)

### Data Integrity
- Content hash (ctHash) binds auth to specific message
- Envelope hash provides audit anchor
- Sequence numbers prevent gaps/reordering
- Signatures are indexed (multi-sig support)

## Testing Strategy

### Unit Tests (51 tests)
- Test business logic in isolation
- No backend required
- Fast (< 100ms total)

### Integration Tests
- Test against live Convex backend
- Require CONVEX_URL environment variable
- Use `eventually()` pattern (no arbitrary sleeps)

### Test Helpers
```typescript
// tests/helpers/crypto-utils.ts
export { generateKeyPair, sign, verify } from "../../core/crypto";

// tests/helpers/eventually.ts
export async function eventually(condition, options);
export async function eventuallyValue(getValue, options);
```

## Deployment

### Client-Side
```typescript
import { createMeritsClient } from "./src/client";

const client = createMeritsClient(process.env.CONVEX_URL!);
```

### Server-Side (Convex)
```bash
npx convex dev  # Development
npx convex deploy  # Production
```

### Environment Variables
```bash
CONVEX_URL=https://your-deployment.convex.cloud
```

## Future Backends

Adding a new backend is straightforward:

1. Implement adapters:
   ```typescript
   class FirebaseIdentityAuth implements IdentityAuth { ... }
   class FirebaseTransport implements Transport { ... }
   class FirebaseGroupApi implements GroupApi { ... }
   ```

2. Create factory:
   ```typescript
   export function createMeritsClient(config: FirebaseConfig): MeritsClient {
     return {
       identity: new FirebaseIdentityAuth(config),
       transport: new FirebaseTransport(config),
       group: new FirebaseGroupApi(config),
       router: createMessageRouter(),
       // ... helpers
     };
   }
   ```

3. Application code **unchanged** (uses interfaces).

## Performance Characteristics

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Send message | O(1) | Single mutation |
| Receive messages | O(N) | N = unread messages |
| Group create | O(1) | Single insert |
| Group send | O(M) | M = member count (fanout) |
| Subscribe | O(1) | Real-time push |
| Router dispatch | O(1) | Hash map lookup |

## File Structure

```
merits/
├── core/
│   ├── crypto.ts              # @noble-based crypto
│   ├── types.ts               # Common types (AID, AuthProof, etc.)
│   ├── interfaces/
│   │   ├── IdentityAuth.ts    # Challenge/response
│   │   ├── Transport.ts       # Send/receive/ack/subscribe
│   │   └── GroupApi.ts        # Groups
│   └── runtime/
│       └── router.ts          # Message routing
├── convex/
│   ├── adapters/
│   │   ├── ConvexIdentityAuth.ts
│   │   ├── ConvexTransport.ts
│   │   └── ConvexGroupApi.ts
│   ├── auth.ts                # Mutations/queries
│   ├── messages.ts
│   ├── groups.ts
│   └── schema.ts
├── src/
│   └── client.ts              # Unified SDK
├── tests/
│   ├── unit/                  # Fast, isolated tests
│   ├── integration/           # Live backend tests
│   └── helpers/               # Test utilities
└── docs/
    ├── architecture.md        # THIS FILE
    ├── api-reference.md
    └── migration-plan.md
```

## Summary

Merits uses a **layered, interface-based architecture** that separates:
- **Core** (backend-agnostic interfaces + crypto)
- **Adapters** (backend-specific implementations)
- **SDK** (unified entry point with helpers)

This design enables portability, testability, and maintainability while providing a clean developer experience.
