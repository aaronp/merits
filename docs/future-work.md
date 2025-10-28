# Future Work

**What v0.1.0 does NOT include** - Known limitations, deferred features, and prioritized roadmap.

---

## Critical (Security & Correctness)

### 1. Real Encryption

**Current**: Base64 encoding (NOT SECURE)

**Needed**: ECDH-ES + AES-GCM

```typescript
// TODO: Implement proper encryption
async function encrypt(plaintext: string, recipientPublicKey: Uint8Array): Promise<string> {
  // 1. Generate ephemeral ECDH keypair
  // 2. Derive shared secret (ECDH with recipient's public key)
  // 3. Encrypt plaintext with AES-256-GCM (shared secret as key)
  // 4. Return: { ek: ephemeralPublicKey, ct: ciphertext, tag: authTag }
}
```

**Files**:
- `core/crypto.ts` - Add `encrypt()` / `decrypt()`
- `cli/commands/send.ts` - Use real encryption
- `convex/groups.ts` - Re-encrypt for each member in fanout

**Priority**: **HIGH** - v0.1.0 encryption is not secure.

---

### 2. Key Rotation (KEL Processing)

**Current**: KSN tracked but not enforced

**Needed**: Process Key Event Log (KEL) events

```typescript
// TODO: Implement KEL event processing
interface KeyRotationEvent {
  aid: string;
  ksn: number;
  keys: string[];  // New keys
  sigs: string[];  // Signed with OLD keys
  prior: string;   // SAID of previous event
}

// Backend should:
// 1. Validate rotation event (signed with current keys)
// 2. Update keyStates with new keys
// 3. Invalidate old challenges
// 4. Invalidate session tokens
```

**Files**:
- `convex/kel.ts` (new) - KEL event processing
- `convex/auth.ts` - Check KEL before verification
- `core/interfaces/KEL.ts` (new) - KEL interface

**Priority**: **HIGH** - Without this, keys can never be safely rotated.

---

### 3. OOBI Resolution

**Current**: Keys manually registered via `registerKeyState`

**Needed**: Resolve keys from witnesses via OOBI

```typescript
// TODO: Implement OOBI resolution
async function resolveAID(aid: string, oobi: string): Promise<KeyState> {
  // 1. Parse OOBI URL
  // 2. Fetch key state from witness
  // 3. Verify witness signatures
  // 4. Cache in keyStates table
}
```

**Files**:
- `core/oobi.ts` (new) - OOBI resolution logic
- `convex/auth.ts` - Use OOBI instead of manual registration
- `cli/commands/identity/register.ts` - Add `--oobi` flag

**Priority**: **MEDIUM** - Manual registration works for MVP, but not scalable.

---

### 4. Message Expiry & Cleanup

**Current**: Messages accumulate forever

**Needed**: Cron job to delete expired messages

```typescript
// TODO: Add cleanup cron
export const cleanupExpiredMessages = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("messages")
      .withIndex("by_expiry", (q) => q.lt("expiresAt", now))
      .collect();

    for (const msg of expired) {
      await ctx.db.delete(msg._id);
    }

    return { deleted: expired.length };
  },
});
```

**Files**:
- `convex/cron.ts` (new) - Scheduled cleanup jobs
- `convex.json` - Configure cron schedule

**Priority**: **MEDIUM** - Database will fill up over time.

---

## Important (Features)

### 5. Rate Limiting

**Current**: Structure exists, not enforced

**Needed**: Enforce per-AID rate limits

```typescript
// TODO: Implement rate limiting
async function checkRateLimit(ctx: MutationCtx, aid: string, operation: string) {
  const limit = await ctx.db
    .query("rateLimits")
    .withIndex("by_aid", (q) => q.eq("aid", aid))
    .first();

  if (!limit) {
    // Create default limit
    await ctx.db.insert("rateLimits", {
      aid,
      maxMessagesPerHour: 100,
      currentHourCount: 0,
      lastResetHour: Date.now(),
    });
    return;
  }

  // Check and increment
  const hoursSinceReset = (Date.now() - limit.lastResetHour) / (1000 * 60 * 60);
  if (hoursSinceReset >= 1) {
    // Reset counter
    await ctx.db.patch(limit._id, {
      currentHourCount: 1,
      lastResetHour: Date.now(),
    });
  } else if (limit.currentHourCount >= limit.maxMessagesPerHour) {
    throw new Error("Rate limit exceeded");
  } else {
    await ctx.db.patch(limit._id, {
      currentHourCount: limit.currentHourCount + 1,
    });
  }
}
```

**Files**:
- `convex/rateLimit.ts` (new) - Rate limit logic
- `convex/messages.ts` - Call `checkRateLimit()` before send
- `convex/auth.ts` - Rate limit challenge creation

**Priority**: **MEDIUM** - Prevents spam/DoS.

---

### 6. ACLs (Allowlists/Blocklists)

**Current**: Anyone can message anyone

**Needed**: Per-AID access control

```typescript
// TODO: Implement ACLs
interface ACL {
  aid: string;
  mode: "allowlist" | "blocklist" | "open";
  allowlist?: string[];  // Only these can message me
  blocklist?: string[];  // These cannot message me
}

// In sendMessage:
const recipientACL = await ctx.db
  .query("acls")
  .withIndex("by_aid", (q) => q.eq("aid", args.to))
  .first();

if (recipientACL?.mode === "allowlist" && !recipientACL.allowlist?.includes(senderAid)) {
  throw new Error("Sender not in recipient's allowlist");
}

if (recipientACL?.mode === "blocklist" && recipientACL.blocklist?.includes(senderAid)) {
  throw new Error("Sender is blocked by recipient");
}
```

**Files**:
- `convex/schema.ts` - Add `acls` table
- `convex/messages.ts` - Check ACLs before send
- `cli/commands/acl.ts` (new) - Manage allowlist/blocklist

**Priority**: **MEDIUM** - Privacy feature.

---

### 7. Onboarding Proofs (SAID-based)

**Current**: Onboarding table exists, not enforced

**Needed**: Require SAID proof for registration

```typescript
// TODO: Enforce onboarding proofs
export const onboardUser = mutation({
  args: {
    userAid: v.string(),
    onboardingProof: v.string(),  // SAID of welcome message
    auth: v.object({ ... }),
  },
  handler: async (ctx, args) => {
    // 1. Verify auth is from admin
    const verified = await verifyAuth(ctx, args.auth, "admin", {
      action: "onboard",
      userAid: args.userAid,
    });

    const adminTier = await ctx.db
      .query("userTiers")
      .withIndex("by_aid", (q) => q.eq("aid", verified.aid))
      .first();

    if (adminTier?.tier !== "admin") {
      throw new Error("Only admins can onboard users");
    }

    // 2. Verify SAID proof (welcome message exists)
    const welcomeMsg = await ctx.db
      .query("messages")
      .withIndex("by_envelope_hash", (q) => q.eq("envelopeHash", args.onboardingProof))
      .first();

    if (!welcomeMsg || welcomeMsg.senderAid !== verified.aid) {
      throw new Error("Invalid onboarding proof");
    }

    // 3. Create user tier
    await ctx.db.insert("userTiers", {
      aid: args.userAid,
      tier: "registered",
      onboardingProof: args.onboardingProof,
      onboardedBy: verified.aid,
      createdAt: Date.now(),
    });
  },
});
```

**Files**:
- `convex/onboarding.ts` - Enforce SAID verification
- `convex/messages.ts` - Check tier before send
- `cli/commands/admin.ts` (new) - Admin commands

**Priority**: **LOW** - Nice-to-have for controlled deployments.

---

## Nice-to-Have (Enhancements)

### 8. Message Filtering (Watch Command)

**Current**: Watch receives all messages

**Needed**: Filter by sender, type, etc.

```bash
# Filter by sender
merits watch --from alice --filter-sender $BOB_AID

# Filter by type
merits watch --from alice --filter-type "chat.text.v1"

# Filter by time range
merits watch --from alice --since "2025-01-01"
```

**Files**:
- `cli/commands/watch.ts` - Add filter flags
- `convex/adapters/ConvexTransport.ts` - Add filter params to subscribe

**Priority**: **LOW** - Convenience feature.

---

### 9. Group Roles (Full Admin Support)

**Current**: Owner/admin distinction not fully enforced

**Needed**: Complete role-based permissions

```typescript
// Admin role should:
// - Add/remove members (non-owners)
// - Promote members to admin
// - Cannot remove owners
// - Cannot leave if last admin

// Update addMembers with role param
await client.group.addMembers({
  groupId,
  members: [{ aid, role: "admin" }],
  auth,
});
```

**Files**:
- `convex/groups.ts` - Enforce admin role logic
- `cli/commands/group.ts` - Add `--role` flag back
- `core/interfaces/GroupApi.ts` - Support roles in interface

**Priority**: **LOW** - Owner role sufficient for MVP.

---

### 10. OS Keychain Integration

**Current**: Filesystem vault (weak encryption)

**Needed**: Store keys in OS keychain

```typescript
// macOS: Keychain Access
// Windows: Credential Manager
// Linux: Secret Service API (libsecret)

class OSKeychainVault implements MeritsVault {
  async storePrivateKey(name: string, key: Uint8Array): Promise<void> {
    // Store in OS keychain
  }

  async getPrivateKey(name: string): Promise<Uint8Array> {
    // Retrieve from OS keychain
  }
}
```

**Files**:
- `cli/lib/vault/OSKeychainVault.ts` - Implement keychain storage
- Use `keytar` npm package for cross-platform support

**Priority**: **LOW** - Filesystem vault acceptable for dev/testing.

---

### 11. Multi-Backend Support

**Current**: Convex only

**Needed**: Firebase, Supabase, REST API adapters

**Example - Firebase adapter**:

```typescript
// firebase/adapters/FirebaseIdentityAuth.ts
export class FirebaseIdentityAuth implements IdentityAuth {
  async issueChallenge(req: IssueChallengeRequest): Promise<IssueChallengeResponse> {
    const result = await firebase.functions().httpsCallable("issueChallenge")(req);
    return result.data;
  }

  async verifyAuth(req: VerifyAuthRequest): Promise<VerifyAuthResult> {
    // Called server-side only
    throw new Error("Client cannot verify auth");
  }
}
```

**Files**:
- `firebase/` (new) - Firebase backend
- `supabase/` (new) - Supabase backend
- `rest/` (new) - Generic REST API adapter
- Update `src/client.ts` to support backend selection

**Priority**: **LOW** - Convex sufficient for MVP.

---

## Testing Gaps

### 12. E2E Testing Improvements

**Known Issues**:
- Watch E2E tests timeout (Bun stdout buffering)
- CLI tests require manual `CONVEX_URL` setup

**Improvements**:
- Mock backend for CLI tests
- Dedicated test backend deployment
- Automated test Convex deployment

**Priority**: **LOW** - Manual testing sufficient for v0.1.0.

---

## Performance Optimizations

### 13. Batch Operations

**Current**: One message at a time

**Needed**: Batch send/receive/ack

```typescript
// Batch send
await client.transport.sendMessages([
  { to: bob.aid, ct: "msg1", auth: auth1 },
  { to: carol.aid, ct: "msg2", auth: auth2 },
]);

// Batch ack
await client.transport.ackMessages({
  messageIds: [id1, id2, id3],
  auth,
});
```

**Priority**: **LOW** - Performance not a bottleneck yet.

---

### 14. Message Compression

**Current**: Full message bodies in database

**Needed**: Compress large messages

**Priority**: **LOW** - Not needed unless messages are very large.

---

## Documentation Gaps

### 15. API Reference

**Current**: Inline JSDoc only

**Needed**: Generated API docs

```bash
# Generate with TypeDoc
npm run docs
# → docs/api/index.html
```

**Priority**: **LOW** - Code is well-commented, generated docs nice-to-have.

---

### 16. Deployment Guide

**Current**: Basic `bunx convex dev` instructions

**Needed**: Production deployment guide

Topics:
- Convex Pro setup
- Environment variables
- Monitoring
- Backup/restore
- Scaling considerations

**Priority**: **LOW** - v0.1.0 is dev/testing focused.

---

## Prioritized Roadmap

Based on real-world usage of v0.1.0, prioritize:

### Phase 1: Security (Critical)
1. Real encryption (ECDH-ES + AES-GCM)
2. Key rotation / KEL processing
3. Message expiry cleanup

### Phase 2: Scale (Important)
4. Rate limiting enforcement
5. ACLs (allowlist/blocklist)
6. OOBI resolution

### Phase 3: Polish (Nice-to-Have)
7. Onboarding proofs
8. Message filtering
9. Group roles
10. OS keychain integration

### Phase 4: Expand (Optional)
11. Multi-backend support
12. Batch operations
13. Performance optimization

---

## How to Contribute

Found a gap? Want to implement a feature?

1. Check [GitHub Issues](https://github.com/your-repo/merits/issues)
2. Create an issue if not exists
3. Discuss approach before coding
4. Submit PR with tests

**High-impact, low-effort wins welcome!**

---

**Version**: v0.1.0 roadmap
**Last Updated**: 2025-10-28
