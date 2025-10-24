# @kerits/convex-transport

Clean KERI message transport over Convex with challenge-response authentication.

## Features

- **Challenge-Response Authentication**: Every operation authenticated via KERI signatures
- **Message Integrity**: SAID-based message IDs with required signatures for non-repudiation
- **At-Least-Once Delivery**: Idempotent sends (duplicate SAIDs are no-ops)
- **WebSocket + Polling**: Real-time subscriptions with poll-based fallback
- **Key Rotation**: Supports key state updates with sequence numbers

## Installation

```bash
# From kerits root
cd server/client
bun install
```

## Usage

### 1. Register Key State

Before using the transport, register your AID's key state:

```typescript
import { registerKeyState } from '@kerits/convex-transport';

await registerKeyState(convexUrl, {
  aid: 'EAlice...',
  ksn: 0,
  verfer: 'DBkgs...',  // CESR public key
  estEventSaid: 'EAbc...',
  signer: mySigner
});
```

### 2. Create Transport

```typescript
import { ConvexTransport } from '@kerits/convex-transport';
import type { Signer } from '@kerits/convex-transport';

const signer: Signer = {
  async sign(data: Uint8Array): Promise<string> {
    // Sign with your KERI key
    return cesrSignature;
  },
  verifier(): string {
    return 'DBkgs...';  // Your CESR public key
  }
};

const transport = new ConvexTransport({
  convexUrl: 'https://accurate-penguin-901.convex.cloud',
  aid: 'EAlice...',
  signer,
  ksn: 0,
  estEventSaid: 'EAbc...'
});
```

### 3. Send Messages

```typescript
const messageId = await transport.send({
  from: 'EAlice...',
  to: 'EBob...',
  typ: 'app.message',
  body: new TextEncoder().encode(JSON.stringify({ text: 'Hello!' })),
  dt: new Date().toISOString()
});

console.log('Sent:', messageId);
```

### 4. Receive Messages

```typescript
// WebSocket subscription
const channel = transport.channel('EAlice...');
const unsubscribe = channel.subscribe((msg) => {
  console.log('Received:', msg);
});

// Poll-based (fallback)
const unread = await transport.readUnread('EAlice...');
console.log('Unread:', unread);

// Acknowledge
await transport.ack('EAlice...', unread.map(m => m.id));
```

### 5. Cleanup

```typescript
transport.close();
```

## Security Properties

### Message Integrity

- Message ID = `SAID({ from, to, typ, refs, dt, bodyHash })`
- Each message requires at least one signature over envelope SAID
- Signatures are verifiable by current key state

### Challenge-Response

- Every mutation (send, ack) requires challenge-response auth
- Challenge binds to: `SAID(challengeId || mutationName || argsHash || nonce)`
- Single-use challenges (marked `used=true` atomically)
- 60-second expiration

### Key Rotation

- Key states stored with sequence number `ksn`
- Sends rejected if `providedKsn < storedKsn` (stale key)
- Rotation increments `ksn` atomically

### Delivery Semantics

- **At-least-once**: Client can retry sends safely
- **Idempotent**: Duplicate SAIDs are no-ops
- **Acknowledgments**: Idempotent receipt tracking

## Architecture

```
┌─────────────────┐
│   kerits core   │  (imports Transport interface)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ ConvexTransport │  (implements Transport)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Convex Backend │  (mutations, queries, subscriptions)
└─────────────────┘
```

## Development

```bash
# Run tests
cd server
bun test tests/client-integration.test.ts

# Type check
bunx tsc --noEmit
```

## TODO

- [ ] Implement challenge-response in ConvexTransport
- [ ] Add Convex schema for messages, challenges, keyStates
- [ ] Implement WebSocket subscription with cursor
- [ ] Add relationship-based authorization
- [ ] Integrate with kerits Signer implementation
- [ ] Add E2E tests with real Convex backend
