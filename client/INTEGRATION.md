# Integration Architecture

## Overview

This document describes how to integrate ConvexTransport with KERI-based authentication, tiered authorization, and the kerits core Transport interface.

## Architecture Layers

```
┌────────────────────────────────────────────────────────────┐
│  Application (UI/KEL/TEL/ACDC)                              │
│  - Uses MessageBus for encrypted messaging                  │
│  - Uses Transport directly for KEL/TEL events               │
└──────────────────────┬─────────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────────┐
│  MessageBus (encrypted messaging layer)                     │
│  - Wraps body as {ct, ek, alg, aad}                         │
│  - Manages ECDH session keys                                │
│  - Optional sequence numbering (seq)                         │
└──────────────────────┬─────────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────────┐
│  AuthenticatedTransport (policy + auth layer)               │
│  - KEL state resolution (via OOBI)                          │
│  - First contact challenge-response                         │
│  - Tiered authorization (unknown/pending/verified)          │
│  - Sign messages with current KEL keys                      │
│  - Client-side policy checks (fail fast)                    │
└──────────────────────┬─────────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────────┐
│  Transport Interface                                        │
│  - send(msg) → SAID                                         │
│  - channel(aid) → Channel                                   │
│  - readUnread() / ack()                                     │
└──────────────────────┬─────────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────────┐
│  ConvexTransport Implementation                             │
│  - Low-level message delivery                               │
│  - Server-side signature verification                       │
│  - Idempotent storage (by SAID)                             │
│  - WebSocket subscriptions                                  │
│  - Server-side authorization enforcement                    │
└─────────────────────────────────────────────────────────────┘
```

## Tiered Authorization

### Trust Tiers

1. **Unknown** - No KEL state, not KYC'd
   - Can only send to onboarding endpoints
   - Rate-limited, short message expiry

2. **Pending** - KEL state resolved, awaiting KYC
   - Can send to specific services (waiting list, info requests)
   - Moderate limits

3. **Verified** - KEL state + KYC complete
   - Full access to services
   - Standard limits

### Convex Schema

```typescript
// server/convex/schema.ts
export default defineSchema({
  // ... existing tables ...

  // Onboarding allow-list
  onboardingAids: defineTable({
    aid: v.string(),              // AID of onboarding service
    description: v.string(),      // E.g., "New user registration"
    active: v.boolean(),          // Can be disabled
    createdAt: v.number()
  }).index("by_aid", ["aid"]),

  // User tiers
  userTiers: defineTable({
    aid: v.string(),              // User AID
    tier: v.string(),             // "unknown" | "pending" | "verified"
    kycStatus: v.optional(v.string()),  // KYC provider status
    updatedAt: v.number(),
    notes: v.optional(v.string())
  }).index("by_aid", ["aid"])
      .index("by_tier", ["tier"]),

  // Tier-based rate limits (optional)
  rateLimits: defineTable({
    aid: v.string(),
    tier: v.string(),
    messagesPerHour: v.number(),
    lastReset: v.number(),
    currentCount: v.number()
  }).index("by_aid", ["aid"]),
});
```

### Authorization Logic

```typescript
// server/convex/authorization.ts
export async function canSend(
  ctx: QueryCtx,
  from: AID,
  to: AID,
  typ: string
): Promise<{ allowed: boolean; reason?: string }> {
  // Get sender's tier
  const tierRecord = await ctx.db
    .query("userTiers")
    .withIndex("by_aid", q => q.eq("aid", from))
    .first();

  const tier = tierRecord?.tier ?? "unknown";

  // Unknown users can only message onboarding endpoints
  if (tier === "unknown") {
    const isOnboarding = await ctx.db
      .query("onboardingAids")
      .withIndex("by_aid", q => q.eq("aid", to).eq("active", true))
      .first();

    if (!isOnboarding) {
      return {
        allowed: false,
        reason: "Unknown users can only message onboarding services"
      };
    }
  }

  // Pending users have limited access
  if (tier === "pending") {
    // Check if recipient is approved for pending tier
    const allowedTypes = ["kel.proposal", "oobi.query", "app.info"];
    if (!allowedTypes.includes(typ)) {
      return {
        allowed: false,
        reason: "Pending users have limited message types"
      };
    }
  }

  // Verified users - check rate limits
  if (tier === "verified") {
    const withinLimits = await checkRateLimit(ctx, from, tier);
    if (!withinLimits) {
      return {
        allowed: false,
        reason: "Rate limit exceeded"
      };
    }
  }

  return { allowed: true };
}

// Server-side enforcement
export const send = mutation({
  handler: async (ctx, args) => {
    // ... authentication ...

    // AUTHORIZATION (server enforces)
    const authz = await canSend(ctx, args.message.from, args.message.to, args.message.typ);
    if (!authz.allowed) {
      throw new Error(`Unauthorized: ${authz.reason}`);
    }

    // ... store message ...
  }
});
```

### Client-Side Policy (Fail Fast)

```typescript
// client/policy.ts
export class PolicyLayer {
  constructor(private transport: Transport) {}

  async send(msg: Omit<Message, 'id' | 'sigs'>): Promise<SAID> {
    // Client-side check (fail fast before network call)
    const tier = await this.getTier(msg.from);

    if (tier === 'unknown') {
      const isOnboarding = await this.isOnboardingAid(msg.to);
      if (!isOnboarding) {
        throw new Error('Can only message onboarding services');
      }
    }

    // Proceed if client-side check passes
    // (server will enforce again - defense in depth)
    return await this.transport.send(msg);
  }
}
```

## First Contact / Challenge-Response

### When C/R Happens

- **First send to unknown recipient**: Recipient doesn't have sender's KEL
- **After key rotation**: Sender hint (evt) doesn't match recipient's cached state
- **Periodic re-verification**: After X days, re-challenge

### Flow

1. **Attempt send** → Server returns `NEED_OOBI` error
2. **Client provides OOBI** + completes challenge
3. **Server fetches KEL** via OOBI resolver
4. **Server caches KEL state** (with TTL)
5. **Retry send** → Succeeds

```typescript
// client/authenticated-transport.ts
export class AuthenticatedTransport {
  async send(msg: Omit<Message, 'id' | 'sigs'>): Promise<SAID> {
    try {
      return await this.transport.send(msg);
    } catch (e) {
      if (e.code === 'NEED_OOBI') {
        // First contact - provide OOBI
        await this.firstContact(msg.to, e.challenge);

        // Retry
        return await this.transport.send(msg);
      }
      throw e;
    }
  }

  private async firstContact(recipientAid: AID, challenge: Challenge) {
    // Get our OOBI
    const oobi = await this.oobi.getOOBI(this.config.aid);

    // Sign challenge
    const sig = await this.config.signer.sign(challenge.data);

    // Submit OOBI + proof
    await this.transport.submitOOBI(recipientAid, oobi, {
      challengeId: challenge.id,
      signature: sig
    });
  }
}
```

## KEL State Resolution

Transport layer stays simple. KEL resolution happens in a separate resolver:

```typescript
// Separate from transport
export interface KeriResolver {
  /**
   * Resolve current KEL state for an AID
   * Uses OOBI endpoints or cached state
   */
  resolveCurrentState(aid: AID): Promise<KelState | null>;

  /**
   * Sync to a specific KEL hint
   * Used when recipient receives evt hint after rotation
   */
  syncToHint(aid: AID, hint: { est: string; s: number }): Promise<void>;

  /**
   * Cache KEL state with TTL
   */
  cacheState(aid: AID, state: KelState, ttl?: number): Promise<void>;
}

// Auth layer uses resolver
export class AuthenticatedTransport {
  constructor(
    private transport: Transport,
    private resolver: KeriResolver,
    private signer: Signer
  ) {}

  async send(msg: Omit<Message, 'id' | 'sigs'>): Promise<SAID> {
    // If we recently rotated, include hint
    const latestEst = await this.getLatestEstEvent();
    if (latestEst && this.wasRecentRotation(latestEst)) {
      msg.evt = {
        est: latestEst.said,
        s: latestEst.s
      };
    }

    // Sign with current keys from our KEL
    return await this.transport.send(msg);
  }
}
```

## Integration Checklist

### Phase 1: ✅ Complete
- [x] Clean Transport interface with `evt`, `nonce` fields
- [x] Comprehensive field documentation
- [x] Tests passing (8/8)
- [x] CESR encoding/decoding fixed

### Phase 2: Server Schema
- [ ] Add `onboardingAids` table to Convex schema
- [ ] Add `userTiers` table
- [ ] Add `rateLimits` table (optional)
- [ ] Seed onboarding AIDs

### Phase 3: Authorization
- [ ] Implement `canSend()` authorization logic
- [ ] Add tier checks to `messages.send` mutation
- [ ] Add client-side policy layer (fail fast)
- [ ] Add admin mutations for managing tiers

### Phase 4: Challenge-Response
- [ ] Add `NEED_OOBI` error code
- [ ] Implement `submitOOBI` mutation
- [ ] Add OOBI resolver integration
- [ ] Handle C/R transparently in AuthenticatedTransport

### Phase 5: KEL Resolver
- [ ] Implement KeriResolver interface
- [ ] OOBI endpoint integration
- [ ] KEL state caching (with TTL)
- [ ] Rotation hint handling

### Phase 6: Testing
- [ ] Tier-based authorization tests
- [ ] First contact / C/R tests
- [ ] KEL rotation tests
- [ ] Rate limiting tests
- [ ] E2E integration tests

## Next Steps

1. Review this integration plan
2. Implement Phase 2 (server schema)
3. Deploy schema changes to Convex
4. Seed initial onboarding AIDs
5. Implement authorization logic (Phase 3)
6. Build incrementally with tests

## Questions?

- **Tier transitions**: How does a user move from unknown → pending → verified?
- **KYC integration**: Which KYC provider? Webhook or poll?
- **OOBI endpoints**: Self-hosted or public resolver?
- **Rate limits**: Per-hour? Per-day? Sliding window?
