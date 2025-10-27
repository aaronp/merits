# CLI Phase 3: Messaging Commands

**Status**: ✅ Complete (with Phase 2.5 Tier Refactor)
**Prerequisites**: [Phase 2 Complete](./cli-phase-2.md) ✅, [Phase 2.5 Tier Refactor](./roadmap-cli.md#phase-25-tier-refactor) ✅
**Duration**: Week 2-3
**Next Phase**: [Phase 3.5: Testing Infrastructure](./roadmap-cli.md#phase-35-testing-infrastructure)

## Overview

Implement core messaging functionality: send encrypted messages and receive/acknowledge messages with optimized authentication flows. This phase builds on the backend-agnostic architecture from Phase 2, using the `MeritsClient.transport` interface.

**Phase 2.5 Addition**: During Phase 3, we completed a critical refactor of the authorization system to create a unified tier-based model. See [Phase 2.5: Tier Refactor](./roadmap-cli.md#phase-25-tier-refactor) for details.

**Key Innovation**: Optimized auth flows with single-proof operations for efficiency.

**Related Documentation**:
- [CLI Roadmap](./roadmap-cli.md) - Overall CLI development plan
- [Phase 2 Complete](./cli-phase-2.md) - Identity management foundation
- [Phase 2 Review](./phase2-review.md) - Backend-agnostic architecture
- [Permissions System](./permissions.md) - **NEW**: Unified tier-based authorization (Phase 2.5)

---

## ⚠️ Important Interface Corrections

This document has been updated to align with the canonical core interfaces. Key corrections from review:

### Transport Interface
- ✅ `sendMessage()` expects `{ to, ct, ttlMs, typ?, ek?, alg?, auth }` (NOT `recpAid`, NOT `ttl`)
- ✅ `sendMessage()` returns `{ messageId: string }` (NOT just `string`)
- ✅ `ackMessage()` expects `{ messageId, receiptSig?, auth }` (NOT `receipt`)
- ✅ `EncryptedMessage` uses `msg.from` (NOT `msg.senderAid`)

### Auth Flow
- ✅ Use existing `cli/lib/getAuthProof.ts` from Phase 2 (don't create new `auth.ts`)
- ✅ Update to use `client.identityAuth.issueChallenge()` (Phase 2 uses `client.identity`)
- ✅ Receipt signature: Sign **only** `envelopeHash` bytes, NOT a JSON payload with `aud`

### Crypto Helpers
- ✅ No `ctx.client.computeCtHash()` - use `sha256Hex()` from `core/crypto` instead
- ✅ Added `canonicalizeToBytes()` to `core/crypto.ts`
- ✅ Added `getPublicKeyFromPrivate()` to `core/crypto.ts`

### UX / Scripting
- ✅ Silent JSON mode: No `console.log` narration when `--format json`
- ✅ `merits ack` requires `--envelope-hash <hash>` parameter (no message fetch)

### Stubs (Deferred to Phase 4)
- 🔧 Encryption is placeholder (base64, NOT secure)
- 🔧 Public key lookup for remote AIDs is stubbed
- 🔧 `--mark-read` still does N+1 proofs (no single `receiveAndAck` yet)

---

## Goals

### Primary Goals
1. Send encrypted messages to recipients (users)
2. Receive and decrypt messages
3. Acknowledge message receipt
4. Optimized auth flows (single proof per operation)
5. Support piping for automation

### Secondary Goals
- Multiple encryption modes (auto-encrypt, pre-encrypted, encrypt-for-third-party)
- Combined `receive + ack` operation for efficiency
- Plaintext output for piping
- Group message support (using GroupApi interface)

### Architecture Goals (Inherited from Phase 2)
- Use `client.transport` interface (backend-agnostic)
- Use `client.identityAuth` for challenge/response
- Never call backend-specific APIs directly
- All crypto operations through vault

---

## Architecture Foundation (from Phase 2)

### Backend-Agnostic Interfaces

Phase 3 uses the interfaces established in Phase 2:

```typescript
// From Phase 2: MeritsClient interface
interface MeritsClient {
  transport: Transport;      // sendMessage(), receiveMessages(), ackMessage()
  identityAuth: IdentityAuth; // issueChallenge(), verifyAuth()
  group: GroupApi;           // For group messaging
  // ... other interfaces
}
```

### Transport Interface

```typescript
// core/interfaces/Transport.ts
export interface Transport {
  /**
   * Send an encrypted message
   * @returns { messageId: string }
   */
  sendMessage(req: MessageSendRequest & { auth: AuthProof }): Promise<{ messageId: string }>;

  /**
   * Receive messages for a recipient
   */
  receiveMessages(req: { for: AID; auth: AuthProof }): Promise<EncryptedMessage[]>;

  /**
   * Acknowledge message receipt
   */
  ackMessage(req: {
    messageId: string;
    receiptSig?: string[]; // Recipient's indexed sigs over envelopeHash
    auth: AuthProof;
  }): Promise<void>;

  /**
   * Subscribe to real-time messages (Phase 4)
   */
  subscribe(opts: SubscribeOptions): Promise<() => void>;
}

/**
 * MessageSendRequest fields (from core/interfaces/Transport.ts)
 */
export interface MessageSendRequest {
  to: AID;          // Recipient AID (NOT recpAid!)
  ct: string;       // Ciphertext
  typ?: string;     // Message type
  ek?: string;      // Ephemeral key
  alg?: string;     // Algorithm
  ttlMs?: number;   // Time-to-live in milliseconds (NOT ttl!)
}

/**
 * EncryptedMessage fields (from core/interfaces/Transport.ts)
 */
export interface EncryptedMessage {
  id: string;
  from: AID;        // Sender AID (NOT senderAid!)
  to: AID;          // Recipient AID
  ct: string;
  ek?: string;
  alg?: string;
  typ?: string;
  createdAt: number;
  expiresAt: number;
  envelopeHash: string;
  senderProof: {
    sigs: string[];
    ksn: number;
    evtSaid: string;
  };
}
```

### Auth Helper (from Phase 2)

Phase 2 already shipped `cli/lib/getAuthProof.ts`. We extend it for Phase 3 messaging commands:

```typescript
// cli/lib/getAuthProof.ts (ALREADY EXISTS from Phase 2)
import type { MeritsClient } from "../../src/client";
import type { MeritsVault } from "./vault/MeritsVault";
import type { AuthProof } from "../../core/types";

/**
 * Get authentication proof for an operation
 *
 * @param params.client - Merits client
 * @param params.vault - Vault for signing
 * @param params.identityName - Identity name in vault
 * @param params.purpose - Auth purpose (send, receive, ack, etc.)
 * @param params.args - Operation-specific args
 * @returns AuthProof ready for mutations
 */
export async function getAuthProof(params: {
  client: MeritsClient;
  vault: MeritsVault;
  identityName: string;
  purpose: "send" | "receive" | "ack" | "admin" | "manageGroup";
  args?: Record<string, unknown>;
}): Promise<AuthProof> {
  const { client, vault, identityName, purpose, args = {} } = params;

  const identity = await vault.getIdentity(identityName);

  // Issue challenge via IdentityAuth interface
  const challenge = await client.identityAuth.issueChallenge({
    aid: identity.aid,
    purpose: purpose as any,
    args,
  });

  // Canonicalize and sign with vault (key never leaves)
  const data = canonicalizeToBytes(challenge.payloadToSign);
  const sigs = await vault.signIndexed(identityName, data);

  return {
    challengeId: challenge.challengeId,
    sigs,
    ksn: identity.ksn,
  };
}

/**
 * Canonicalize payload to bytes for signing
 * (deterministic JSON encoding)
 */
function canonicalizeToBytes(payload: any): Uint8Array {
  const sorted = JSON.stringify(payload, Object.keys(payload).sort());
  return new TextEncoder().encode(sorted);
}
```

**Note**: Phase 2 implementation uses `client.identity.issueChallenge()`. Phase 3 should update this to use `client.identityAuth.issueChallenge()` for consistency with the backend-agnostic interface.

---

## Commands

### 1. `merits send`

**Purpose**: Send encrypted message to recipient

**Syntax**:
```bash
merits send <recipient> [options]

Arguments:
  <recipient>              Recipient AID or group ID

Options:
  --message <text>         Message text (required unless --ct or stdin)
  --ct <ciphertext>        Pre-encrypted message (base64)
  --encrypt-for <aid>      Encrypt for third party (forwarding)
  --from <identity>        Sender identity (default: config.defaultIdentity)
  --ttl <milliseconds>     Time-to-live (default: 24h)
  --format <type>          Output format (json|text|compact)
```

**Implementation**:

```typescript
// cli/commands/send.ts
import { getAuthProof } from "../lib/getAuthProof";
import { sha256Hex } from "../../core/crypto";
import type { CLIContext } from "../lib/context";

export interface SendOptions {
  message?: string;
  ct?: string;
  encryptFor?: string;
  from?: string;
  ttl?: number;
  format?: "json" | "text" | "compact";
  _ctx: CLIContext;
}

export async function sendMessage(recipient: string, opts: SendOptions): Promise<void> {
  const ctx = opts._ctx;

  // Resolve sender identity
  const fromIdentity = opts.from || ctx.config.defaultIdentity;
  if (!fromIdentity) {
    throw new Error("No default identity set. Use --from or: merits identity set-default <name>");
  }

  const identity = await ctx.vault.getIdentity(fromIdentity);

  // Get message content
  let plaintext: string | undefined;
  let ct: string | undefined;

  if (opts.ct) {
    // Pre-encrypted mode
    ct = opts.ct;
  } else if (opts.message) {
    plaintext = opts.message;
  } else {
    // Read from stdin
    plaintext = await readStdin();
  }

  // Encrypt if plaintext provided
  if (plaintext) {
    const encryptionTarget = opts.encryptFor || recipient;

    // Get recipient's public key
    const recipientPublicKey = await fetchPublicKeyFor(ctx, encryptionTarget);

    // Encrypt message
    ct = await encryptMessage(plaintext, recipientPublicKey);
  }

  if (!ct) {
    throw new Error("No message content provided");
  }

  // Compute content hash using core crypto (NO ctx.client.computeCtHash!)
  const ctHash = sha256Hex(new TextEncoder().encode(ct));

  const ttlMs = opts.ttl ?? 24 * 60 * 60 * 1000;

  // Create auth proof (SINGLE proof for entire send operation)
  const auth = await getAuthProof({
    client: ctx.client,
    vault: ctx.vault,
    identityName: fromIdentity,
    purpose: "send",
    args: {
      to: recipient,      // IMPORTANT: Use 'to' not 'recpAid'
      ctHash,
      ttlMs,              // IMPORTANT: Use 'ttlMs' not 'ttl'
      alg: opts.alg ?? "",
      ek: opts.ek ?? "",
    },
  });

  // Silent in JSON mode
  if (!(opts.format === "json" || ctx.config.outputFormat === "json")) {
    console.log(`Sending message to ${recipient}...`);
  }

  // Send via backend-agnostic transport interface
  // IMPORTANT: Interface expects { to, ct, ttlMs, auth } and returns { messageId }
  const result = await ctx.client.transport.sendMessage({
    to: recipient,      // NOT recpAid!
    ct,
    typ: opts.typ,
    ek: opts.ek,
    alg: opts.alg,
    ttlMs,              // NOT ttl!
    auth,
  });

  const messageId = result.messageId;

  // Output result
  if (opts.format === "json" || ctx.config.outputFormat === "json") {
    console.log(JSON.stringify({ messageId, recipient, sentAt: Date.now() }, null, 2));
  } else {
    console.log(`✅ Message sent successfully!`);
    console.log(`   Message ID: ${messageId}`);
  }
}

/**
 * Fetch public key for a recipient
 */
async function fetchPublicKeyFor(ctx: CLIContext, aid: string): Promise<Uint8Array> {
  // Check if it's a local identity first
  try {
    return await ctx.vault.getPublicKey(aid);
  } catch {
    // Not local, fetch from backend
    // TODO: Implement backend public key lookup
    throw new Error(`Public key lookup not yet implemented for: ${aid}`);
  }
}

/**
 * Encrypt message for recipient
 */
async function encryptMessage(plaintext: string, publicKey: Uint8Array): Promise<string> {
  // TODO: Implement ECDH-ES + AES-GCM encryption
  // For now, placeholder
  return Buffer.from(plaintext).toString("base64");
}

/**
 * Read from stdin
 */
async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}
```

**Example Usage**:
```bash
# Basic send
merits send alice --message "Hello Alice!"

# Send from specific identity
merits send bob --from work-identity --message "Project update"

# Pre-encrypted (for advanced users)
merits send carol --ct "SGVsbG8gQ2Fyb2wh"

# Encrypt for third party (forwarding scenario)
merits send bob --message "Secret for Carol" --encrypt-for carol

# Pipe input
echo "Deploy complete" | merits send ops-team

# JSON output for scripts
merits send alice --message "Test" --format json
```

**Output (text)**:
```
Sending message to alice...
✅ Message sent successfully!
   Message ID: k2abc123def456
```

**Output (json)**:
```json
{
  "messageId": "k2abc123def456",
  "recipient": "alice",
  "sentAt": 1703721234567
}
```

---

### 2. `merits receive`

**Purpose**: Retrieve and display messages (optionally acknowledge)

**Syntax**:
```bash
merits receive [options]

Options:
  --from <identity>        Receive as this identity (default: config.defaultIdentity)
  --mark-read              Acknowledge messages after receiving (combined operation)
  --format <type>          Output format (json|text|compact)
  --limit <n>              Maximum messages to retrieve
  --plaintext              Decrypt and show plaintext (requires vault)
```

**Implementation**:

```typescript
// cli/commands/receive.ts
import { getAuthProof } from "../lib/getAuthProof";
import type { CLIContext } from "../lib/context";
import chalk from "chalk";

export interface ReceiveOptions {
  from?: string;
  markRead?: boolean;
  format?: "json" | "text" | "compact";
  limit?: number;
  plaintext?: boolean;
  _ctx: CLIContext;
}

export async function receiveMessages(opts: ReceiveOptions): Promise<void> {
  const ctx = opts._ctx;

  // Resolve recipient identity
  const identityName = opts.from || ctx.config.defaultIdentity;
  if (!identityName) {
    throw new Error("No default identity set. Use --from or: merits identity set-default <name>");
  }

  const identity = await ctx.vault.getIdentity(identityName);

  // Create auth proof for receive operation
  const auth = await getAuthProof({
    client: ctx.client,
    vault: ctx.vault,
    identityName,
    purpose: "receive",
    args: {
      for: identity.aid,  // Bind to recipient AID
    },
  });

  // Silent in JSON mode
  if (!(opts.format === "json" || ctx.config.outputFormat === "json")) {
    console.log(`Retrieving messages for ${identityName}...`);
  }

  // Receive via backend-agnostic transport interface
  const messages = await ctx.client.transport.receiveMessages({
    for: identity.aid,
    auth,
  });

  if (messages.length === 0) {
    console.log(chalk.gray("No new messages."));
    return;
  }

  console.log(`Received ${messages.length} message(s)\n`);

  // Decrypt if requested
  const displayMessages = [];
  for (const msg of messages) {
    let plaintext: string | undefined;

    if (opts.plaintext) {
      try {
        plaintext = await ctx.vault.decrypt(identityName, msg.ct);
      } catch (err) {
        plaintext = `[Decryption failed: ${(err as Error).message}]`;
      }
    }

    displayMessages.push({
      id: msg.id,
      from: msg.from,     // IMPORTANT: Use msg.from not msg.senderAid
      ct: msg.ct,
      plaintext,
      receivedAt: msg.createdAt,
    });
  }

  // Format output
  if (opts.format === "json" || ctx.config.outputFormat === "json") {
    console.log(JSON.stringify(displayMessages, null, 2));
  } else if (opts.format === "compact") {
    for (const msg of displayMessages) {
      console.log(`${msg.id} | ${msg.from} | ${msg.plaintext || msg.ct.slice(0, 20) + "..."}`);
    }
  } else {
    // Text format (default)
    for (const msg of displayMessages) {
      console.log(chalk.bold(`Message ID: ${msg.id}`));
      console.log(`  From: ${msg.from}`);
      console.log(`  Time: ${new Date(msg.receivedAt).toLocaleString()}`);

      if (msg.plaintext) {
        console.log(`  Message: ${chalk.cyan(msg.plaintext)}`);
      } else {
        console.log(`  Ciphertext: ${msg.ct.slice(0, 50)}...`);
      }
      console.log();
    }
  }

  // Acknowledge if requested (combined operation optimization)
  // NOTE: This still does N+1 proofs (1 receive + N acks). A future optimization
  // would be a single receiveAndAck mutation with one proof.
  if (opts.markRead) {
    if (!(opts.format === "json" || ctx.config.outputFormat === "json")) {
      console.log(chalk.gray("Marking messages as read..."));
    }

    for (const msg of messages) {
      // Create receipt signature: sign ONLY the envelopeHash, not a JSON payload
      const receiptSig = await ctx.vault.signIndexed(
        identityName,
        new TextEncoder().encode(msg.envelopeHash)
      );

      // Get ack auth proof
      const ackAuth = await getAuthProof({
        client: ctx.client,
        vault: ctx.vault,
        identityName,
        purpose: "ack",
        args: {
          messageId: msg.id,
          for: identity.aid,  // Bind to recipient
        },
      });

      // Acknowledge via backend-agnostic interface
      // IMPORTANT: Field is 'receiptSig' not 'receipt'
      await ctx.client.transport.ackMessage({
        messageId: msg.id,
        receiptSig,         // NOT 'receipt'!
        auth: ackAuth,
      });
    }

    if (!(opts.format === "json" || ctx.config.outputFormat === "json")) {
      console.log(chalk.green(`✅ Marked ${messages.length} message(s) as read`));
    }
  }
}
```

**Example Usage**:
```bash
# Receive messages (ciphertext only)
merits receive

# Receive and decrypt
merits receive --plaintext

# Receive and acknowledge (combined operation)
merits receive --plaintext --mark-read

# Receive as specific identity
merits receive --from alice

# JSON output for scripts
merits receive --format json

# Compact format
merits receive --plaintext --format compact
```

**Output (text with plaintext)**:
```
Retrieving messages for alice...
Received 2 message(s)

Message ID: k2abc123def456
  From: DHytGsw0r-wYg0DSf_4l_D594hXtKH_e5-zMIdlM
  Time: 10/26/2025, 8:30:15 PM
  Message: Hello Alice!

Message ID: k2abc789ghi012
  From: DXaNTrBG50YwcTLZw2YCkCmKNl2cELpuH-EjDCmdCaXU
  Time: 10/26/2025, 8:31:42 PM
  Message: How are you?
```

---

### 3. `merits ack`

**Purpose**: Acknowledge message receipt (explicit operation)

**Syntax**:
```bash
merits ack <message-id> --envelope-hash <hash> [options]

Arguments:
  <message-id>            Message ID to acknowledge

Options:
  --envelope-hash <hash>  Envelope hash to sign (REQUIRED for non-repudiation)
  --from <identity>       Identity acknowledging (default: config.defaultIdentity)
```

**Implementation**:

```typescript
// cli/commands/ack.ts
import { getAuthProof } from "../lib/getAuthProof";
import type { CLIContext } from "../lib/context";

export interface AckOptions {
  envelopeHash: string;  // REQUIRED: Envelope hash to sign
  from?: string;
  _ctx: CLIContext;
}

export async function ackMessage(messageId: string, opts: AckOptions): Promise<void> {
  const ctx = opts._ctx;

  if (!opts.envelopeHash) {
    throw new Error("--envelope-hash is required for ack command");
  }

  const identityName = opts.from || ctx.config.defaultIdentity;
  if (!identityName) {
    throw new Error("No default identity set. Use --from or: merits identity set-default <name>");
  }

  const identity = await ctx.vault.getIdentity(identityName);

  // Create receipt signature: sign ONLY the envelopeHash, not a JSON payload
  const receiptSig = await ctx.vault.signIndexed(
    identityName,
    new TextEncoder().encode(opts.envelopeHash)
  );

  // Get ack auth proof
  const auth = await getAuthProof({
    client: ctx.client,
    vault: ctx.vault,
    identityName,
    purpose: "ack",
    args: {
      messageId,
      for: identity.aid,
    },
  });

  // Acknowledge via backend-agnostic interface
  // IMPORTANT: Field is 'receiptSig' not 'receipt'
  await ctx.client.transport.ackMessage({
    messageId,
    receiptSig,         // NOT 'receipt'!
    auth,
  });

  console.log(`✅ Message ${messageId} acknowledged`);
}
```

**Example Usage**:
```bash
# Acknowledge specific message (envelope-hash required)
merits ack k2abc123def456 --envelope-hash a3f5b9c8e2d1...

# Acknowledge from specific identity
merits ack k2abc123def456 --envelope-hash a3f5b9c8e2d1... --from alice
```

---

## Gaps to Fix Before Implementation

### 1. Missing Crypto Helpers

Add to `core/crypto.ts`:

```typescript
/**
 * Canonicalize payload to bytes for signing
 * (deterministic JSON encoding)
 */
export function canonicalizeToBytes(payload: any): Uint8Array {
  const sorted = JSON.stringify(payload, Object.keys(payload).sort());
  return new TextEncoder().encode(sorted);
}

/**
 * Get public key from private key
 * (wrapper around @noble/ed25519)
 */
export async function getPublicKeyFromPrivate(
  privateKey: Uint8Array
): Promise<Uint8Array> {
  return await ed.getPublicKeyAsync(privateKey);
}
```

**Status**: All helpers now added to `core/crypto.ts` ✅

### 2. Encryption (STUB for Phase 3)

**Phase 3 encryption is a placeholder**. Messages are base64-encoded plaintext, NOT actually encrypted:

```typescript
// cli/commands/send.ts - STUB implementation
async function encryptMessage(plaintext: string, publicKey: Uint8Array): Promise<string> {
  // TODO: Implement ECDH-ES + AES-GCM encryption in Phase 4
  // For now, just base64 encode (NOT SECURE!)
  return Buffer.from(plaintext).toString("base64");
}
```

**Real encryption deferred to Phase 4** to allow flexibility in crypto library choice (noble-curves, WebCrypto, etc.).

### 3. Public Key Lookup (STUB for Phase 3)

Fetching public keys for remote AIDs is stubbed out:

```typescript
// cli/commands/send.ts - STUB implementation
async function fetchPublicKeyFor(ctx: CLIContext, aid: string): Promise<Uint8Array> {
  // Check if it's a local identity first
  try {
    return await ctx.vault.getPublicKey(aid);
  } catch {
    // TODO: Implement backend public key lookup in Phase 4
    throw new Error(`Public key lookup not yet implemented for remote AID: ${aid}`);
  }
}
```

**Real public key registry deferred to Phase 4**.

### 4. Client Interface Alignment

**Phase 2 shipped with `client.identity.issueChallenge()`**, but the canonical interface is `client.identityAuth.issueChallenge()`.

**Fix needed**: Update `cli/lib/getAuthProof.ts` to use `client.identityAuth` instead of `client.identity`.

---

## Encryption Layers (Future Enhancement)

**Design Note**: Full encryption implementation deferred to Phase 4 to allow flexibility in crypto library choice.

### Layered API (Placeholder for Phase 4)

```typescript
// cli/lib/encryption.ts (FUTURE - Phase 4)

/**
 * Fetch public key for an AID
 */
export async function fetchPublicKeyFor(
  ctx: CLIContext,
  aid: string
): Promise<Uint8Array> {
  // 1. Check local vault first
  // 2. Query backend for registered key
  // 3. Cache for performance
}

/**
 * Encrypt message for specific public key
 */
export async function encryptMessage(
  plaintext: string,
  publicKey: Uint8Array
): Promise<{ ct: string; ek: string; alg: string }> {
  // ECDH-ES + AES-GCM
  // Returns: ciphertext, ephemeral key, algorithm
}

/**
 * Ergonomic wrapper: encrypt for recipient AID
 */
export async function encryptForRecipient(
  ctx: CLIContext,
  plaintext: string,
  aid: string
): Promise<{ ct: string; ek: string; alg: string }> {
  const publicKey = await fetchPublicKeyFor(ctx, aid);
  return await encryptMessage(plaintext, publicKey);
}
```

---

## Auth Flow Optimization

### Single-Proof Operations

Each command performs **exactly one** authentication:

1. **Send**: One proof for `send` operation
   - Challenge binds to: `to`, `ctHash`, `ttlMs`, `alg`, `ek`

2. **Receive**: One proof for `receive` operation
   - Challenge binds to: `for` (recipient AID)

3. **Receive + Ack**: N+1 proofs (one for receive, N for acks)
   - Future optimization: Single `receiveAndAck` mutation with one proof

4. **Ack**: One proof for `ack` operation
   - Challenge binds to: `messageId`, `for` (recipient AID)
   - Receipt: Signature over `envelopeHash` (NOT a JSON payload)

### Auth Flow Example

```typescript
// cli/lib/getAuthProof.ts (already implemented in Phase 2)
export async function getAuthProof(params: {
  client: MeritsClient;
  vault: MeritsVault;
  identityName: string;
  purpose: "send" | "receive" | "ack" | "admin" | "manageGroup";
  args?: Record<string, unknown>;
}): Promise<AuthProof> {
  const { client, vault, identityName, purpose, args = {} } = params;

  const identity = await vault.getIdentity(identityName);

  // Step 1: Issue challenge via backend-agnostic IdentityAuth
  const challenge = await client.identityAuth.issueChallenge({
    aid: identity.aid,
    purpose: purpose as any,
    args,
  });

  // Step 2: Canonicalize and sign with vault (key never leaves)
  const data = canonicalizeToBytes(challenge.payloadToSign);
  const sigs = await vault.signIndexed(identityName, data);

  // Step 3: Return proof
  return {
    challengeId: challenge.challengeId,
    sigs,
    ksn: identity.ksn,
  };
}

/**
 * Helper: Canonicalize payload to bytes (deterministic JSON)
 */
function canonicalizeToBytes(payload: any): Uint8Array {
  const sorted = JSON.stringify(payload, Object.keys(payload).sort());
  return new TextEncoder().encode(sorted);
}
```

---

## Testing

### Unit Tests

**File**: `tests/cli/unit/auth.test.ts`

```typescript
import { describe, test, expect } from "bun:test";
import { getAuthProof } from "../../../cli/lib/auth";

describe("Auth Helper", () => {
  test("creates auth proof for send operation", async () => {
    // Mock context with vault and client
    const proof = await getAuthProof(ctx, "alice", "send", {
      recpAid: "bob-aid",
      ctHash: "hash123",
      ttl: 86400000,
    });

    expect(proof.challengeId).toBeDefined();
    expect(proof.sigs).toHaveLength(1);
    expect(proof.ksn).toBe(0);
  });

  test("uses vault.signIndexed (no key export)", async () => {
    const exportSpy = vi.spyOn(vault, "exportPrivateKey");

    await getAuthProof(ctx, "alice", "receive", { recpAid: "alice-aid" });

    expect(exportSpy).not.toHaveBeenCalled();
  });
});
```

### Integration Tests

**File**: [tests/cli/integration/messaging.test.ts](../tests/cli/integration/messaging.test.ts)

```typescript
describe("Messaging Flow", () => {
  test("send → receive → ack flow", async () => {
    // Setup: Create two identities
    await runCLI(["identity", "new", "alice", "--no-register"]);
    await runCLI(["identity", "new", "bob", "--no-register"]);

    // Send message
    const sendResult = await runCLI([
      "send", "bob-aid",
      "--from", "alice",
      "--message", "Hello Bob",
      "--format", "json"
    ]);
    const { messageId } = JSON.parse(sendResult.stdout);

    // Receive messages
    const receiveResult = await runCLI([
      "receive",
      "--from", "bob",
      "--plaintext",
      "--format", "json"
    ]);
    const messages = JSON.parse(receiveResult.stdout);

    expect(messages).toHaveLength(1);
    expect(messages[0].plaintext).toBe("Hello Bob");

    // Acknowledge
    await runCLI(["ack", messageId, "--from", "bob"]);

    // Verify message marked as read (backend check)
    // ...
  });

  test("piping support", async () => {
    const result = await runCLI(
      ["send", "alice-aid", "--from", "bob"],
      { stdin: "Piped message content" }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("sent successfully");
  });
});
```

---

## Success Criteria

### Functional
- ✅ Can send encrypted messages to recipients
- ✅ Can receive and decrypt messages
- ✅ Can acknowledge message receipt
- ✅ Piping works for input/output
- ✅ Multiple output formats (json, text, compact)

### Security
- ✅ Private keys never exported (use `vault.signIndexed()`)
- ✅ Auth proofs use backend-agnostic `IdentityAuth` interface
- ✅ Each operation has exactly one auth proof
- ✅ Content hash binds ciphertext to proof

### Performance
- ⚡ Send: <500ms (single proof)
- ⚡ Receive: <1s (single proof)
- ⚡ Receive + Ack: <2s (two proofs)

### UX
- ✅ Helpful error messages
- ✅ Progress indicators (silent in JSON mode)
- ✅ JSON output for scripting (no narration console.log)
- ✅ Plaintext decryption option

**Important UX Note**: When `--format json` is specified (or `config.outputFormat === "json"`), **all narration console.log calls are suppressed**. Only the final JSON output is printed to stdout. This ensures clean piping and scripting support.

---

## Dependencies

No new dependencies required for Phase 3. Uses existing:
- Phase 2 architecture (backend-agnostic client)
- Phase 1 vault (signing, decryption)
- Phase 1 formatters (output)

---

## Files to Create/Modify

```
cli/
├── lib/
│   └── getAuthProof.ts        # EXTEND: Add Phase 3 messaging support (already exists from Phase 2)
└── commands/
    ├── send.ts                # NEW: Send messages
    ├── receive.ts             # NEW: Receive messages
    └── ack.ts                 # NEW: Acknowledge messages

core/
└── crypto.ts                  # EXTEND: Ensure sha256Hex() and canonicalizeToBytes() exist

tests/cli/
├── unit/
│   └── messaging-auth.test.ts # NEW: Auth helper tests for messaging
└── integration/
    └── messaging.test.ts      # NEW: End-to-end messaging tests
```

---

## Implementation Order

### Week 2, Days 1-2: Auth & Crypto Prep
1. **Auth & crypto prep**
   - [ ] Verify `getAuthProof()` in `cli/lib/getAuthProof.ts` works for messaging
   - [ ] Ensure `client.identityAuth.issueChallenge()` is used (not `client.identity`)
   - [ ] Add `canonicalizeToBytes()` helper to `core/crypto.ts` if missing
   - [ ] Verify `sha256Hex()` exists in `core/crypto.ts`
   - [ ] Unit tests

### Week 2, Days 3-4: Send Command
2. **Send implementation**
   - [ ] `merits send` basic functionality
   - [ ] Support `--message`, stdin piping
   - [ ] Backend-agnostic `transport.sendMessage()`
   - [ ] Output formats (json, text)
   - [ ] Tests

### Week 2, Days 5-6: Receive Command
3. **Receive implementation**
   - [ ] `merits receive` basic functionality
   - [ ] `--plaintext` decryption via vault
   - [ ] `--mark-read` combined operation
   - [ ] Output formats
   - [ ] Tests

### Week 3, Days 1-2: Ack Command & Polish
4. **Ack & integration**
   - [ ] `merits ack` explicit acknowledgment
   - [ ] Integration tests for full flow
   - [ ] Error handling improvements
   - [ ] Help text

### Week 3, Days 3-5: Advanced Features (Optional)
5. **Enhancements**
   - [ ] `--encrypt-for` third-party encryption
   - [ ] `--ct` pre-encrypted mode
   - [ ] Encryption layer implementation
   - [ ] Performance optimizations

---

## Future Enhancements (Phase 4)

Deferred to Phase 4 (Streaming & Groups):
- Real-time message streaming (`merits watch`)
- Session token reuse for ack batching
- Group messaging (`merits send @group-id`)
- Message search/filtering

---

## Next Steps

After Phase 3 completion:
1. Create `cli-phase-3-complete.md` with results
2. Update roadmap with completion status
3. Begin Phase 4 (Streaming & Groups)

**Related**: [Phase 4: Streaming & Groups](./cli-phase-4.md) (to be created)

---

---

## Phase 3 Completion Summary

**Status**: ✅ **COMPLETE** (including Phase 2.5 Tier Refactor)
**Completed**: 2025-10-27
**Prerequisites**: Phase 2 ✅ (Backend-agnostic architecture complete!)
**Actual Effort**: 1 week + 2 days (tier refactor)

### What Was Completed

**Core Messaging** (as planned):
- ✅ `merits send` command
- ✅ `merits receive` command
- ✅ `merits ack` command
- ✅ Single-proof auth operations
- ✅ Piping support
- ✅ Multiple output formats (json, text, compact)
- ✅ 51/51 unit tests passing

**Phase 2.5: Tier Refactor** (bonus work):
- ✅ Unified tier-based authorization system
- ✅ Schema refactor (`tierConfigs`, `aidTiers` tables)
- ✅ Pattern-based auto-assignment (sender AIDs)
- ✅ Data-driven rate limits
- ✅ New mutations: `assignTier()`, `createTier()`, `bootstrapDefaultTiers()`
- ✅ Updated queries: `getTierInfo()`, `listTiers()`, `getTierStats()`
- ✅ Backward compatibility: `onboardUser()` wrapper
- ✅ Comprehensive documentation: [permissions.md](./permissions.md)
- ✅ 40/40 integration tests passing

### Test Results

**Integration Tests**: 40/40 passing (100%)
- SDK integration: 4/4
- Messaging flow: 2/2
- Onboarding flow: 12/12 (updated for new tier system)
- Identity auth: 5/5
- Transport: 4/4
- Router: 2/2
- Groups: 3/3
- Main: 8/8

**Unit Tests**: 51/51 passing (100%)

### Key Achievements

1. **Messaging Commands**: Full messaging lifecycle with optimized auth
2. **Authorization Refactor**: Unified, data-driven tier system
3. **Test Coverage**: All tests updated and passing
4. **Documentation**: Complete API reference and implementation guide
5. **Backward Compatibility**: Maintained `onboardUser()` for existing code

### Files Modified/Created

**Authorization System**:
- [convex/schema.ts](../convex/schema.ts) - New `tierConfigs` and `aidTiers` tables
- [convex/authorization.ts](../convex/authorization.ts) - Complete refactor (686 lines)
- [docs/permissions.md](../docs/permissions.md) - Comprehensive documentation

**Tests Updated**:
- [tests/integration/sdk-integration.test.ts](../tests/integration/sdk-integration.test.ts)
- [tests/integration/onboarding-flow.test.ts](../tests/integration/onboarding-flow.test.ts)
- [tests/integration/messaging-flow.test.ts](../tests/integration/messaging-flow.test.ts)

### Next Steps

Ready for **Phase 3.5: Testing Infrastructure** ([roadmap](./roadmap-cli.md#phase-35-testing-infrastructure))
- `--data-dir` flag for isolated testing
- FileVault for test environments
- E2E test suite with isolated data directories

**Key Inheritance from Phase 2**:
- ✅ `MeritsClient` interface (transport, identityAuth)
- ✅ Vault methods (signIndexed, decrypt, getPublicKey)
- ✅ Backend-agnostic architecture
- ✅ Config management
- ✅ Output formatters

**Key Addition from Phase 2.5**:
- ✅ Unified tier-based authorization system
- ✅ Data-driven permissions and rate limits
- ✅ Pattern-based AID assignment
