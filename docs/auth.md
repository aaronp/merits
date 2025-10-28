# Authentication

**Merits v0.1.0** uses KERI-style challenge/response authentication. Users prove control of their AID by signing a challenge payload with their current keys.

## No Passwords, No Sessions

**Traditional auth**:
```
User → Username + Password → Server checks hash → Session cookie
```

**Merits auth**:
```
User → Request challenge → Sign with AID keys → Server verifies signature → Single-use proof
```

**Benefits**:
- No passwords to leak or forget
- No session state to manage
- Key rotation supported (via KSN)
- Threshold signatures (multi-sig)
- Non-repudiation (signatures are audit trail)

## Challenge/Response Flow

###  1. Issue Challenge

**Client requests challenge for specific operation**:

```typescript
const challenge = await client.identity.issueChallenge({
  aid: alice.aid,
  purpose: "send",  // What operation?
  args: {
    recpAid: bob.aid,
    ctHash: "sha256:abc123...",
    ttl: 60000,
  },
});
```

**Server response**:

```typescript
{
  challengeId: "j71ksp9kd2ndn0ow7xkef7fqp575m8ex",
  payloadToSign: {
    ver: "msg-auth/1",
    aud: "https://merits-convex.app",
    ts: 1735372800000,
    nonce: "550e8400-e29b-41d4-a716-446655440000",
    aid: alice.aid,
    purpose: "send",
    argsHash: "sha256:def456..."  // Hash of args
  }
}
```

**Key points**:
- **`argsHash`**: Computed server-side, binds challenge to specific args
- **`purpose`**: Binds to operation type (send/receive/manageGroup/etc.)
- **`nonce`**: Unique random value (replay prevention)
- **`ts`**: Timestamp (skew check, max 2 minutes)
- **`aud`**: Server URL (prevents cross-site use)

### 2. Sign Payload

**Client signs canonical JSON**:

```typescript
// Canonical JSON: sorted keys, no whitespace
const canonical = JSON.stringify(
  challenge.payloadToSign,
  Object.keys(challenge.payloadToSign).sort()
);

// Sign with AID's current keys
const sigs = await signIndexed(canonical, alice.privateKeys);
// → ["0-<base64url-sig>", "1-<base64url-sig>", ...]
```

**Indexed signatures**:
- Format: `"<key-index>-<base64url-signature>"`
- Supports threshold signing (N-of-M keys)
- Index maps to `keyState.keys[index]`

### 3. Submit AuthProof

**Include proof in operation**:

```typescript
const auth: AuthProof = {
  challengeId,
  sigs,
  ksn: alice.ksn,  // Key Sequence Number
};

await client.transport.sendMessage({
  to: bob.aid,
  ct: encrypt("Hello"),
  auth,  // ← Proves alice controls her AID
});
```

### 4. Verify Auth

**Server verifies proof**:

```typescript
async function verifyAuth(
  ctx: MutationCtx,
  auth: AuthProof,
  expectedPurpose: string,
  args: Record<string, any>
): Promise<{ aid, ksn, evtSaid }> {
  // 1. Fetch challenge
  const challenge = await ctx.db.get(auth.challengeId);
  if (!challenge) throw new Error("Challenge not found");
  if (challenge.used) throw new Error("Challenge already used");
  if (challenge.expiresAt < Date.now()) throw new Error("Challenge expired");

  // 2. Verify purpose
  if (challenge.purpose !== expectedPurpose) {
    throw new Error(`Invalid purpose: expected ${expectedPurpose}`);
  }

  // 3. Recompute args hash (NEVER trust client!)
  const argsHash = computeArgsHash(args);
  if (challenge.argsHash !== argsHash) {
    throw new Error("Args hash mismatch");
  }

  // 4. Fetch key state
  const keyState = await ensureKeyState(ctx, challenge.aid);
  if (auth.ksn !== keyState.ksn) {
    throw new Error("Invalid KSN");
  }

  // 5. Reconstruct payload
  const payload = {
    ver: "msg-auth/1",
    aud: "https://merits-convex.app",
    ts: challenge.createdAt,
    nonce: challenge.nonce,
    aid: challenge.aid,
    purpose: challenge.purpose,
    argsHash: challenge.argsHash,
  };

  // 6. Verify threshold signatures
  const valid = await verifyIndexedSigs(payload, auth.sigs, keyState);
  if (!valid) throw new Error("Invalid signatures");

  // 7. Mark challenge as used
  await ctx.db.patch(auth.challengeId, { used: true });

  // 8. Return verified AID (NEVER trust client values!)
  return {
    aid: challenge.aid,
    ksn: keyState.ksn,
    evtSaid: keyState.lastEvtSaid,
  };
}
```

**Security checks**:
- ✅ Challenge exists and not expired
- ✅ Challenge not already used (replay prevention)
- ✅ Purpose matches operation type
- ✅ Args hash matches (binds to specific params)
- ✅ KSN matches current key state
- ✅ Signatures meet threshold
- ✅ Challenge marked as used (single-use)

## Auth Purposes

Each purpose binds authentication to a specific operation type:

| Purpose | Used For | Args |
|---------|----------|------|
| `"send"` | Send direct message | `{ recpAid, ctHash, ttl, alg?, ek? }` |
| `"receive"` | Receive messages | `{ forAid }` |
| `"ack"` | Acknowledge message | `{ messageId, envelopeHash }` |
| `"sendGroup"` | Send group message | `{ groupId, ctHash, ttl }` |
| `"manageGroup"` | Create/modify group | `{ action, groupId, members?, ... }` |
| `"openSession"` | Create session token | `{ forAid, purpose, ttl }` |

**Why purpose-bound?**
- Prevents replay across operations (can't reuse "send" proof for "receive")
- Explicit intent (signature clearly states what it authorizes)
- Audit trail (purpose logged with challenge)

## Args Hash Binding

**Every challenge is bound to specific args**:

```typescript
function computeArgsHash(args: Record<string, any>): string {
  // 1. Remove auth field (not part of hash)
  const { auth, ...argsToHash } = args;

  // 2. Canonical JSON: sorted keys, no whitespace
  const canonical = JSON.stringify(
    argsToHash,
    Object.keys(argsToHash).sort()
  );

  // 3. SHA256
  return sha256Hex(new TextEncoder().encode(canonical));
}
```

**Example**: Send message auth

```typescript
// Client args
const args = {
  recpAid: bob.aid,
  ctHash: "sha256:abc123...",
  ttl: 60000,
  alg: "ECDH-ES+A256GCM",
  ek: "D5f...",
};

// Server recomputes hash
const argsHash = computeArgsHash(args);

// Signature covers argsHash in payload
// → Can't modify args without invalidating signature
```

**Security**: Client cannot change args after signing challenge.

## Key State Resolution

**Server maintains cached key states**:

```typescript
interface KeyState {
  aid: string;
  ksn: number;  // Key Sequence Number
  keys: string[];  // CESR-encoded public keys
  threshold: string;  // Hex threshold (e.g., "1" for 1-of-N)
  lastEvtSaid: string;  // SAID of last key event
  updatedAt: number;
}
```

**Registration flow** (v0.1.0):

```
CLI: merits identity new alice
  → Generate keys locally

CLI: merits identity register alice
  → client.identity.registerKeyState({
      aid: alice.aid,
      ksn: 0,
      keys: [alicePublicKey],
      threshold: "1",
      lastEvtSaid: "initial",
    })
  → Backend caches in keyStates table
```

**Future (not v0.1.0)**:
- OOBI resolution (fetch keys from witnesses)
- KEL event processing (handle rotations)
- Witness consensus (verify key state with multiple witnesses)

## Session Tokens (Watch Command)

**Problem**: Signing every ack in real-time watch is expensive.

**Solution**: Long-lived session token that authorizes server-side auto-ack.

### Session Token Flow

```
1. CLI: Create session token
   → auth = createAuth(identity, "openSession", { forAid, purpose: "receive", ttl })
   → token = await openSession({ forAid, purpose, ttl, auth })
   ← { sessionToken, expiresAt }

2. CLI: Subscribe with session token
   → subscribe({ for, sessionToken, onMessage })
   ← Stream of messages via Convex subscription

3. Server: On new message
   → Validate session token (not expired, matches recipient)
   → Call onMessage(msg)
   → If onMessage returns true:
      → Mark message as retrieved (auto-ack)
      → No client signing needed!

4. CLI: Auto-refresh before expiry
   → refreshToken = await refreshSessionToken({ sessionToken, auth })
   ← { sessionToken: newToken, expiresAt: newExpiry }
```

**Session token structure**:

```typescript
{
  _id: "sessionToken123",
  forAid: alice.aid,
  purpose: "receive",
  createdAt: Date.now(),
  expiresAt: Date.now() + 60000,  // 60s
  usedChallengeId: originalChallengeId,
  ksn: alice.ksn,
  lastUsedAt: Date.now(),
}
```

**Security**:
- ✅ Bound to specific AID (`forAid`)
- ✅ Bound to purpose (`"receive"` only)
- ✅ Short TTL (60s, auto-refresh)
- ✅ KSN-bound (invalid if keys rotate)
- ✅ Created via challenge/response (initial auth required)

**Trade-off**: Less secure than per-ack signing, but acceptable for watch use case.

## KSN (Key Sequence Number)

**Purpose**: Track key rotations, prevent use of revoked keys.

```typescript
// Initial key state
{ aid, ksn: 0, keys: [key0] }

// After rotation
{ aid, ksn: 1, keys: [key1] }

// After another rotation
{ aid, ksn: 2, keys: [key2] }
```

**Current behavior (v0.1.0)**:
- ✅ KSN tracked in database
- ✅ Client must provide correct KSN in auth proof
- ✅ Server validates KSN matches current state
- ❌ **Not enforced**: Rotations not implemented, old keys not invalidated

**Future**:
- Process KEL (Key Event Log) events
- Invalidate old keys after rotation
- Support key pre-rotation
- Witness resolution for key state

## Security Properties

### ✅ What's Protected

**Replay Attacks**:
- ✅ Single-use challenges (marked `used: true`)
- ✅ Nonce prevents duplicate challenges
- ✅ Timestamp skew check (max 2 minutes)
- ✅ Expiry (default 120s)

**Parameter Tampering**:
- ✅ Args hash in signed payload
- ✅ Server recomputes hash (never trusts client)
- ✅ Signature invalid if args change

**Cross-Operation Replay**:
- ✅ Purpose bound (can't use "send" auth for "receive")
- ✅ Purpose in signed payload

**Cross-Site Replay**:
- ✅ Audience (`aud`) in signed payload
- ✅ Server validates audience matches

**Key Rotation**:
- ✅ KSN validation (must use current keys)
- ⚠️ **Not enforced yet** (v0.1.0 doesn't process rotations)

### ⚠️ What's NOT Protected (v0.1.0)

**Message Content**:
- ❌ Encryption is stub (base64, not secure)
- Future: ECDH-ES + AES-GCM

**Key Storage**:
- ❌ Filesystem vault weak encryption
- Future: OS keychain integration

**Rate Limiting**:
- ❌ Challenge creation not rate-limited
- ❌ Message sending not rate-limited
- Future: Per-AID rate limits

**Denial of Service**:
- ❌ No challenge cleanup (accumulate in DB)
- ❌ No message expiry (accumulate in DB)
- Future: TTL enforcement + cleanup cron

## Testing

**See**:
- [tests/integration/identity-auth-interface.test.ts](../tests/integration/identity-auth-interface.test.ts) - Challenge/response flow
- [tests/integration/auth-integration.test.ts](../tests/integration/auth-integration.test.ts) - End-to-end auth
- [convex/auth.ts](../convex/auth.ts) - Backend verification logic

## Implementation References

**Core interfaces**:
- [core/interfaces/IdentityAuth.ts](../core/interfaces/IdentityAuth.ts) - Auth contract
- [core/crypto.ts](../core/crypto.ts) - Sign/verify primitives

**Backend**:
- [convex/auth.ts](../convex/auth.ts) - Challenge/proof mutations
- [convex/sessions.ts](../convex/sessions.ts) - Session token management

**CLI helpers**:
- [cli/lib/getAuthProof.ts](../cli/lib/getAuthProof.ts) - Convenience wrappers
