# Interface Comparison: ConvexTransport vs Kerits Transport

## Overview

This document compares the `server/client/` Transport interface with the kerits core Transport interface to ensure compatibility.

## Type Definitions

### Kerits Core ([src/model/io/transport.ts](../../../src/model/io/transport.ts))

```typescript
export interface Message {
  id: string;             // SAID of envelope
  from: AID;
  to: AID;
  typ: string;
  body: Bytes;
  refs?: string[];        // SAIDs
  dt: string;             // ISO timestamp
  sigs?: { keyIndex: number; sig: string }[];  // OPTIONAL
}

export interface Transport {
  send(msg: Message): Promise<void>;
  channel(aid: AID): Channel;
  readUnread?(aid: AID, limit?: number): Promise<Message[]>;
  ack?(aid: AID, ids: string[]): Promise<void>;
}
```

### ConvexTransport ([server/client/types.ts](./types.ts))

```typescript
export interface Message {
  id: SAID;                   // SAID of envelope
  from: AID;
  to: AID;
  typ: string;
  body: Bytes;
  refs?: SAID[];              // SAIDs
  dt: string;
  sigs: Signature[];          // REQUIRED (at least one)
  seq?: number;               // Optional sequence
}

export interface Signature {
  ksn: number;                // Key sequence number
  sig: string;                // CESR signature
}

export interface Transport {
  send(msg: Omit<Message, 'id' | 'sigs'>): Promise<SAID>;
  channel(aid: AID): Channel;
  readUnread(aid: AID, limit?: number): Promise<Message[]>;
  ack(aid: AID, messageIds: SAID[]): Promise<void>;
}
```

## Key Differences

### 1. Signatures (BREAKING)

**Kerits**: `sigs` is **optional** with `keyIndex`
**ConvexTransport**: `sigs` is **required** with `ksn` (key sequence number)

**Impact**: ConvexTransport enforces non-repudiation (every message must be signed).

**Resolution Options**:
- **Option A**: Make kerits Transport require signatures (recommended for security)
- **Option B**: Add adapter layer that auto-signs if missing
- **Option C**: Make ConvexTransport signatures optional (not recommended)

### 2. Send Signature

**Kerits**: `send(msg: Message): Promise<void>`
**ConvexTransport**: `send(msg: Omit<Message, 'id' | 'sigs'>): Promise<SAID>`

**Impact**: ConvexTransport computes ID and signatures automatically.

**Resolution**: Adapter can accept full Message and re-compute SAID for verification.

### 3. Optional vs Required Methods

**Kerits**: `readUnread?` and `ack?` are optional
**ConvexTransport**: Both are required

**Impact**: ConvexTransport always supports polling + acknowledgments.

**Resolution**: This is compatible (more features is fine).

### 4. Sequence Numbers

**Kerits**: No sequence field
**ConvexTransport**: Optional `seq?: number` for ordering

**Impact**: None (optional field is backwards compatible).

## Compatibility Matrix

| Feature | Kerits | ConvexTransport | Compatible? |
|---------|--------|-----------------|-------------|
| Message ID (SAID) | ✅ | ✅ | ✅ Yes |
| from/to/typ/body | ✅ | ✅ | ✅ Yes |
| refs (SAIDs) | ✅ | ✅ | ✅ Yes |
| dt (timestamp) | ✅ | ✅ | ✅ Yes |
| sigs optional | ✅ | ❌ Required | ⚠️ Breaking |
| sigs.keyIndex | ✅ | ❌ Uses ksn | ⚠️ Breaking |
| seq (ordering) | ❌ | ✅ Optional | ✅ Yes |
| send() auto-signs | ❌ | ✅ | ⚠️ Different |
| send() returns SAID | ❌ void | ✅ SAID | ⚠️ Different |
| channel() | ✅ | ✅ | ✅ Yes |
| readUnread() | ✅ Optional | ✅ Required | ✅ Yes |
| ack() | ✅ Optional | ✅ Required | ✅ Yes |

## Recommended Approach

### Option 1: Evolve Kerits Transport (Recommended)

Update kerits Transport to match ConvexTransport:

```typescript
// src/model/io/transport.ts
export interface Signature {
  ksn: number;              // Was: keyIndex
  sig: string;
}

export interface Message {
  id: string;
  from: AID;
  to: AID;
  typ: string;
  body: Bytes;
  refs?: string[];
  dt: string;
  sigs: Signature[];        // Was: optional
  seq?: number;             // NEW: optional ordering
}

export interface Transport {
  send(msg: Omit<Message, 'id' | 'sigs'>): Promise<string>;  // Returns SAID
  channel(aid: AID): Channel;
  readUnread(aid: AID, limit?: number): Promise<Message[]>;  // Required
  ack(aid: AID, ids: string[]): Promise<void>;               // Required
}
```

**Benefits**:
- Single source of truth
- Enforces security (signatures required)
- Consistent across all transports

**Migration**:
- Update `memoryTransport()` in kerits
- Update any existing transport implementations
- Update consumers to provide `Signer`

### Option 2: Adapter Layer

Create adapter that wraps ConvexTransport to match kerits:

```typescript
// src/model/io/convex-transport-adapter.ts
import { ConvexTransport } from '../../../server/client';
import type { Transport as KeritTransport } from './transport';

export function adaptConvexTransport(
  convexTransport: ConvexTransport,
  signer: Signer
): KeritTransport {
  return {
    async send(msg) {
      // Add signer if not present
      await convexTransport.send(msg);
    },
    channel: convexTransport.channel.bind(convexTransport),
    readUnread: convexTransport.readUnread.bind(convexTransport),
    ack: convexTransport.ack.bind(convexTransport),
  };
}
```

**Benefits**:
- No breaking changes to kerits
- Gradual migration path

**Drawbacks**:
- Two interfaces to maintain
- Potential confusion

### Option 3: Make Them Identical (Simplest)

Copy ConvexTransport types directly into kerits:

```bash
cp server/client/types.ts src/model/io/transport-types.ts
```

Then have both import from same source.

## Decision: Option 1 (Evolve Kerits)

**Rationale**:
1. Security first: signatures should be required
2. Single source of truth
3. Better API (send returns SAID)
4. Long-term maintainability

**Migration plan**:
1. Update kerits Transport interface
2. Update memoryTransport implementation
3. Update all consumers (KEL, TEL, etc.)
4. Wire ConvexTransport into kerits
5. Test end-to-end

## Next Steps

1. [ ] Review this comparison with kerits team
2. [ ] Decide on approach (Option 1, 2, or 3)
3. [ ] Create migration plan if Option 1
4. [ ] Implement adapter if Option 2
5. [ ] Wire up ConvexTransport Phase 2 (server backend)
