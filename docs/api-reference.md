# Merits API Reference

Complete API documentation for the Merits messaging system.

## Table of Contents

- [Unified SDK](#unified-sdk)
- [Core Interfaces](#core-interfaces)
  - [IdentityAuth](#identityauth)
  - [Transport](#transport)
  - [GroupApi](#groupapi)
  - [MessageRouter](#messagerouter)
- [Core Crypto](#core-crypto)
- [Types](#types)

---

## Unified SDK

### createMeritsClient()

Factory function to create a configured Merits client with all interfaces.

```typescript
function createMeritsClient(convexUrl: string): MeritsClient
```

**Parameters**:
- `convexUrl: string` - Convex deployment URL

**Returns**: `MeritsClient`

**Example**:
```typescript
import { createMeritsClient } from "./src/client";

const client = createMeritsClient(process.env.CONVEX_URL!);
```

### MeritsClient

Unified client interface providing access to all Merits operations.

```typescript
interface MeritsClient {
  identity: IdentityAuth;
  transport: Transport;
  group: GroupApi;
  router: MessageRouter;

  createAuth(credentials, purpose, args): Promise<AuthProof>;
  computeArgsHash(args): string;
  computeCtHash(ct): string;
  close(): void;
}
```

#### client.identity

Access to challenge/response authentication.
Type: `IdentityAuth`

#### client.transport

Access to message transport operations.
Type: `Transport`

#### client.group

Access to group management operations.
Type: `GroupApi`

#### client.router

Access to message routing.
Type: `MessageRouter`

#### client.createAuth()

Helper to create authenticated proof for operations.

```typescript
createAuth(
  credentials: AuthCredentials,
  purpose: string,
  args: Record<string, any>
): Promise<AuthProof>
```

**Parameters**:
- `credentials: AuthCredentials` - User credentials (AID, private key, KSN)
- `purpose: string` - Operation purpose ("send" | "receive" | "ack" | "admin" | "sendGroup" | "manageGroup")
- `args: Record<string, any>` - Arguments to bind to authentication

**Returns**: `Promise<AuthProof>`

**Example**:
```typescript
const auth = await client.createAuth(alice, "send", {
  recpAid: bob.aid,
  ctHash: client.computeCtHash(ct),
  ttl: 60000,
});
```

#### client.computeArgsHash()

Compute deterministic hash of arguments.

```typescript
computeArgsHash(args: Record<string, any>): string
```

**Parameters**:
- `args: Record<string, any>` - Arguments to hash

**Returns**: `string` - Base64url-encoded SHA-256 hash

**Example**:
```typescript
const hash = client.computeArgsHash({ recpAid: "Dabc...", ctHash: "..." });
```

#### client.computeCtHash()

Compute content hash for authentication binding.

```typescript
computeCtHash(ct: string): string
```

**Parameters**:
- `ct: string` - Ciphertext content

**Returns**: `string` - Hex-encoded SHA-256 hash

**Example**:
```typescript
const ct = encrypt(message);
const ctHash = client.computeCtHash(ct);
```

#### client.close()

Close client connection and cleanup resources.

```typescript
close(): void
```

**Example**:
```typescript
client.close();
```

---

## Core Interfaces

### IdentityAuth

Challenge/response authentication for KERI AIDs.

```typescript
interface IdentityAuth {
  issueChallenge(req: IssueChallengeRequest): Promise<IssueChallengeResponse>;
  verifyAuth(req: VerifyAuthRequest): Promise<VerifyAuthResult>;
}
```

#### issueChallenge()

Issue an authentication challenge.

```typescript
issueChallenge(req: IssueChallengeRequest): Promise<IssueChallengeResponse>
```

**Request**:
```typescript
interface IssueChallengeRequest {
  aid: AID;                      // AID requesting authentication
  purpose: Purpose;              // Operation purpose
  args: Record<string, unknown>; // Arguments to bind
  ttlMs?: number;                // Challenge TTL (default: 120s)
}
```

**Response**:
```typescript
interface IssueChallengeResponse {
  challengeId: string;           // Challenge identifier
  payloadToSign: {               // Payload to sign
    ver: "msg-auth/1";
    aud: string;
    ts: number;
    nonce: string;
    aid: AID;
    purpose: Purpose;
    argsHash: string;
  };
}
```

**Example**:
```typescript
const challenge = await client.identity.issueChallenge({
  aid: alice.aid,
  purpose: "send",
  args: { recpAid: bob.aid, ctHash },
});
```

#### verifyAuth()

Verify an authentication proof (server-side only).

```typescript
verifyAuth(req: VerifyAuthRequest): Promise<VerifyAuthResult>
```

**Note**: This is called internally by the server during mutations. Client code typically doesn't call this directly.

---

### Transport

Message transport with send/receive/ack/subscribe operations.

```typescript
interface Transport {
  sendMessage(req: MessageSendRequest): Promise<{messageId: string}>;
  receiveMessages(req: {for: AID; auth: AuthProof}): Promise<EncryptedMessage[]>;
  ackMessage(req: {messageId: string; auth: AuthProof}): Promise<void>;
  subscribe(opts: SubscribeOptions): Promise<() => void>;
}
```

#### sendMessage()

Send an encrypted message to a recipient.

```typescript
sendMessage(req: MessageSendRequest): Promise<{messageId: string}>
```

**Request**:
```typescript
interface MessageSendRequest {
  to: AID;            // Recipient AID
  ct: string;         // Ciphertext
  typ?: string;       // Message type for routing
  ek?: string;        // Ephemeral key (for PFS)
  alg?: string;       // Encryption algorithm
  ttlMs?: number;     // Time to live (default: 24h)
  auth: AuthProof;    // Authentication proof
}
```

**Response**:
```typescript
{
  messageId: string   // Message identifier
}
```

**Example**:
```typescript
const { messageId } = await client.transport.sendMessage({
  to: bob.aid,
  ct: encrypt("Hello!"),
  typ: "chat.text.v1",
  ttlMs: 60000,
  auth: sendAuth,
});
```

#### receiveMessages()

Receive messages for an AID.

```typescript
receiveMessages(req: {for: AID; auth: AuthProof}): Promise<EncryptedMessage[]>
```

**Request**:
```typescript
{
  for: AID;         // Recipient AID
  auth: AuthProof;  // Authentication proof (purpose: "receive")
}
```

**Response**:
```typescript
EncryptedMessage[] // Array of encrypted messages

interface EncryptedMessage {
  id: string;
  from: AID;
  ct: string;
  typ?: string;
  createdAt: number;
  envelopeHash: string;
  // ... additional fields
}
```

**Example**:
```typescript
const messages = await client.transport.receiveMessages({
  for: bob.aid,
  auth: receiveAuth,
});
```

#### ackMessage()

Acknowledge message receipt (removes from queue).

```typescript
ackMessage(req: {messageId: string; auth: AuthProof}): Promise<void>
```

**Request**:
```typescript
{
  messageId: string;      // Message to acknowledge
  auth: AuthProof;        // Authentication proof (purpose: "ack")
  receiptSig?: string[];  // Optional receipt signature
}
```

**Example**:
```typescript
await client.transport.ackMessage({
  messageId: msg.id,
  auth: ackAuth,
});
```

#### subscribe()

Subscribe to real-time message delivery.

```typescript
subscribe(opts: SubscribeOptions): Promise<() => void>
```

**Options**:
```typescript
interface SubscribeOptions {
  for: AID;                               // Recipient AID
  auth: AuthProof;                        // Authentication proof
  onMessage: (msg: EncryptedMessage) => Promise<boolean>;
}
```

**Returns**: `Promise<() => void>` - Unsubscribe function

**Example**:
```typescript
const unsubscribe = await client.transport.subscribe({
  for: bob.aid,
  auth: bobAuth,
  onMessage: async (msg) => {
    await handleMessage(msg);
    return true; // Auto-ack
  },
});

// Later: unsubscribe();
```

---

### GroupApi

Group management and messaging with server-side fanout.

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

#### createGroup()

Create a new group.

```typescript
createGroup(req: CreateGroupRequest): Promise<{groupId: GroupId}>
```

**Request**:
```typescript
interface CreateGroupRequest {
  name: string;          // Group name
  initialMembers: AID[]; // Initial member AIDs
  auth: AuthProof;       // Authentication (purpose: "manageGroup")
}
```

**Response**:
```typescript
{
  groupId: GroupId       // Created group identifier
}
```

**Example**:
```typescript
const { groupId } = await client.group.createGroup({
  name: "Project Team",
  initialMembers: [bob.aid, carol.aid],
  auth: createAuth,
});
```

#### sendGroupMessage()

Send message to all group members (server-side fanout).

```typescript
sendGroupMessage(req: GroupSendRequest): Promise<{messageId: string}>
```

**Request**:
```typescript
interface GroupSendRequest {
  groupId: GroupId;    // Target group
  ct: string;          // Ciphertext
  typ?: string;        // Message type
  ttlMs?: number;      // Time to live
  auth: AuthProof;     // Authentication (purpose: "sendGroup")
}
```

**Response**:
```typescript
{
  messageId: string    // Group log entry ID
}
```

**Example**:
```typescript
await client.group.sendGroupMessage({
  groupId,
  ct: encrypt("Hello team!"),
  typ: "chat.text.v1",
  auth: sendAuth,
});
```

#### listGroups()

List all groups for an AID.

```typescript
listGroups(req: ListGroupsRequest): Promise<Group[]>
```

**Request**:
```typescript
interface ListGroupsRequest {
  for: AID;         // AID to list groups for
  auth: AuthProof;  // Authentication
}
```

**Response**:
```typescript
Group[] // Array of groups

interface Group {
  id: GroupId;
  name: string;
  members: GroupMember[];
  createdAt: number;
  createdBy: AID;
}
```

---

### MessageRouter

Application-level message routing by type.

```typescript
interface MessageRouter {
  register(typ: string, handler: MessageHandler): void;
  unregister(typ: string): boolean;
  dispatch(ctx: MessageHandlerContext, msg: EncryptedMessage): Promise<void>;
  hasHandler(typ: string): boolean;
  getRegisteredTypes(): string[];
}
```

#### register()

Register a handler for a message type.

```typescript
register(typ: string, handler: MessageHandler): void
```

**Parameters**:
- `typ: string` - Message type (e.g., "chat.text.v1")
- `handler: MessageHandler` - Handler function

**Handler Signature**:
```typescript
type MessageHandler = (
  msg: EncryptedMessage,
  plaintext: any
) => void | Promise<void>;
```

**Example**:
```typescript
client.router.register("chat.text.v1", (msg, plaintext) => {
  console.log(`Chat from ${msg.from}: ${plaintext.text}`);
});
```

#### dispatch()

Dispatch a message to its registered handler.

```typescript
dispatch(
  ctx: MessageHandlerContext,
  msg: EncryptedMessage
): Promise<void>
```

**Context**:
```typescript
interface MessageHandlerContext {
  decrypt: (encrypted: EncryptedMessage) => Promise<any>;
}
```

**Example**:
```typescript
await client.router.dispatch(
  {
    decrypt: async (msg) => JSON.parse(decrypt(msg.ct)),
  },
  message
);
```

#### hasHandler()

Check if a handler is registered for a type.

```typescript
hasHandler(typ: string): boolean
```

#### getRegisteredTypes()

Get all registered message types.

```typescript
getRegisteredTypes(): string[]
```

---

## Core Crypto

Cryptographic operations using `@noble` libraries.

### generateKeyPair()

Generate Ed25519 keypair.

```typescript
function generateKeyPair(): Promise<KeyPair>
```

**Returns**:
```typescript
interface KeyPair {
  publicKey: Uint8Array;      // 32-byte public key
  privateKey: Uint8Array;     // 32-byte private key
  publicKeyCESR: string;      // CESR-encoded public key
}
```

**Example**:
```typescript
import { generateKeyPair } from "./core/crypto";

const keys = await generateKeyPair();
```

### sign()

Sign data with Ed25519 private key.

```typescript
function sign(
  message: Uint8Array,
  privateKey: Uint8Array
): Promise<Uint8Array>
```

### verify()

Verify Ed25519 signature.

```typescript
function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array
): Promise<boolean>
```

### signPayload()

Sign JSON payload and return indexed signatures.

```typescript
function signPayload(
  payload: Record<string, any>,
  privateKey: Uint8Array,
  keyIndex: number
): Promise<string[]>
```

**Example**:
```typescript
const sigs = await signPayload(challenge.payloadToSign, privateKey, 0);
```

### createAID()

Create AID from public key.

```typescript
function createAID(publicKey: Uint8Array): string
```

**Returns**: `string` - AID with 'D' prefix (Ed25519 non-transferable)

### computeArgsHash()

Compute deterministic args hash.

```typescript
function computeArgsHash(args: Record<string, any>): string
```

### sha256Hex()

Compute SHA-256 hash as hex string.

```typescript
function sha256Hex(data: Uint8Array): string
```

---

## Types

### AID

Autonomic Identifier (KERI).

```typescript
type AID = string; // Format: "D" + base64url(publicKey)
```

### AuthProof

Authentication proof for operations.

```typescript
interface AuthProof {
  challengeId: string;   // Challenge identifier
  sigs: IndexedSig[];    // Indexed signatures
  ksn: number;           // Key sequence number
}
```

### IndexedSig

Indexed signature format.

```typescript
type IndexedSig = string; // Format: "idx-base64url(signature)"
```

### Purpose

Authentication purpose.

```typescript
type Purpose =
  | "send"        // Send a message
  | "receive"     // Receive messages
  | "ack"         // Acknowledge receipt
  | "admin"       // Admin operations
  | "sendGroup"   // Send group message
  | "manageGroup" // Manage group
```

### AuthCredentials

User credentials for operations.

```typescript
interface AuthCredentials {
  aid: string;              // User's AID
  privateKey: Uint8Array;   // Ed25519 private key (32 bytes)
  ksn: number;              // Key sequence number
}
```

---

## Error Handling

All async operations may throw errors:

```typescript
try {
  await client.transport.sendMessage({...});
} catch (error) {
  if (error.message.includes("Challenge expired")) {
    // Retry with new challenge
  } else if (error.message.includes("Invalid signatures")) {
    // Check credentials
  } else {
    // Handle other errors
  }
}
```

Common error messages:
- `"Challenge not found"` - Challenge ID invalid or expired
- `"Challenge already used"` - Replay attempt
- `"Invalid signatures or threshold not met"` - Signature verification failed
- `"Only group members can send messages"` - Authorization failed

---

## Best Practices

### 1. Always Close Clients

```typescript
const client = createMeritsClient(url);
try {
  // ... use client
} finally {
  client.close();
}
```

### 2. Cache Auth Proofs

Auth proofs are single-use, but you can cache credentials:

```typescript
const credentials = await loadCredentials();
const auth = await client.createAuth(credentials, "send", args);
```

### 3. Use Subscribe for Real-Time

Prefer `subscribe()` over polling with `receiveMessages()`:

```typescript
// Good: Real-time
const unsub = await client.transport.subscribe({...});

// Less efficient: Polling
setInterval(async () => {
  const msgs = await client.transport.receiveMessages({...});
}, 1000);
```

### 4. Type Your Messages

Use consistent type strings and type-safe handlers:

```typescript
interface ChatMessage {
  text: string;
}

client.router.register("chat.text.v1", (msg, plaintext: ChatMessage) => {
  // TypeScript knows plaintext.text exists
});
```

### 5. Handle Errors Gracefully

```typescript
client.router.onError = (error, typ, msg) => {
  console.error(`Handler error for ${typ}:`, error);
  // Log to monitoring service
};
```

---

## See Also

- [Architecture](./architecture.md) - System design
- [Migration Plan](./migration-plan.md) - Development roadmap
- [Examples](../examples/) - Working code examples