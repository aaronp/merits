# Merits Messaging Permissions

## Overview

Merits uses a tiered authorization system that controls who can message whom. This document defines the complete permission model.

## Authorization Flow

When user A attempts to send a message to user B:

1. **Rate Limit Check** - Verify sender hasn't exceeded tier-specific rate limits
2. **Pattern Check** - Check if recipient matches any authorization patterns (unknown tier only)
3. **Tier Check** - Apply tier-specific rules
4. **Allow/Deny** - Return authorization result

## User Tiers

Every AID has a tier that determines their messaging privileges:

### `unknown` (Default)
- **Default state** for all newly registered identities
- **Can message**: Onboarding admins + recipients matching authorization patterns
- **Cannot message**: Regular users, other unknown users (unless pattern matches)
- **Rate limit**: Low (e.g., 10 messages/hour)
- **Transition**: Admin promotes to `known` via onboarding proof

### `known`
- **Status**: Onboarded by an admin
- **Can message**: Anyone in the system
- **Rate limit**: Medium (e.g., 100 messages/hour)
- **Transition**: Admin promotes to `verified` with KYC proof

### `verified`
- **Status**: KYC completed
- **Can message**: Anyone in the system
- **Rate limit**: High (e.g., 1000 messages/hour)
- **Transition**: None (highest tier)

## Authorization Patterns

Patterns provide flexible allow-lists for recipient AIDs. They apply **only to `unknown` tier**.

### Schema
```typescript
{
  pattern: string,        // Regex pattern (e.g., "^TEST")
  description: string,    // Human description
  appliesTo: "unknown",   // Only unknown tier supported
  priority: number,       // Higher = checked first
  active: boolean,        // Enable/disable without deleting
  createdBy: string,      // Admin AID
  createdAt: number,
  expiresAt?: number,     // Optional TTL
}
```

### Matching Logic

For `unknown` tier senders:
1. Fetch active patterns sorted by priority (descending)
2. Test recipient AID against each pattern's regex
3. If any pattern matches → **Allow**
4. If no patterns match → Fall back to tier logic (onboarding admins only)

For `known` and `verified` tiers:
- Patterns are **not checked** (these tiers already have broad access)

### Default Patterns

**Development/Testing Pattern**:
```javascript
{
  pattern: "^TEST",
  description: "Allow messaging to test identities (development only)",
  appliesTo: "unknown",
  priority: 100,
  active: true,
}
```

This allows unknown users to message any AID starting with `TEST`, enabling:
- E2E tests without onboarding flows
- Local development with test accounts
- Parallel test isolation

**Production**: Remove or deactivate test patterns in production deployments.

## Onboarding Flow

The standard way for unknown users to gain messaging access:

```
1. Unknown user registers → tier: unknown
2. Unknown user messages onboarding admin
3. Admin verifies identity/intent
4. Admin calls onboardUser(aid, proof) → tier: known
5. Known user can now message anyone
```

**Code**: [convex/authorization.ts](../convex/authorization.ts)
**Tests**: [tests/integration/onboarding-flow.test.ts](../tests/integration/onboarding-flow.test.ts)

## Admin Roles

### `onboarding_admin`
- Listed in `onboardingAdmins` table (active=true)
- Unknown users can message them
- Can promote unknown → known

### `super_admin`
- Listed in `adminRoles` table with role="super_admin"
- Can manage admins (add/remove onboarding_admins)
- Can manage authorization patterns
- Can promote to any tier

## Implementation

### Backend
- **Schema**: [convex/schema.ts](../convex/schema.ts)
  - `userTiers` - AID → tier mapping
  - `onboardingAdmins` - Allow-list for unknown messaging
  - `adminRoles` - Admin privilege management
  - `authPatterns` - Regex patterns for recipient matching
  - `rateLimits` - Per-AID rate tracking

- **Authorization Logic**: [convex/authorization.ts](../convex/authorization.ts)
  - `canSend(from, to, typ)` - Main authorization function
  - `getUserTier(aid)` - Get user's tier
  - `matchesAnyPattern(recipientAid, tier)` - Pattern matching
  - `isOnboardingAdmin(aid)` - Check admin status

- **Integration**: [convex/messages.ts](../convex/messages.ts)
  - `send` mutation calls `canSend()` before accepting message
  - Server-verified sender AID (never trust client)

### Testing

**Unit Tests**: [tests/unit/groups.test.ts](../tests/unit/groups.test.ts)
- Tier logic validation
- Admin role hierarchy

**Integration Tests**: [tests/integration/onboarding-flow.test.ts](../tests/integration/onboarding-flow.test.ts)
- Full onboarding flow (unknown → known → verified)
- Admin operations
- Rate limiting
- Authorization denials

**E2E Tests**: [tests/cli/e2e/messaging.test.ts](../tests/cli/e2e/messaging.test.ts)
- CLI messaging with isolated test accounts
- Uses TEST prefix AIDs + authorization patterns

## Rate Limits

Rate limits are tier-specific and enforced per-AID:

| Tier      | Limit (default) | Window  |
|-----------|-----------------|---------|
| unknown   | 10 messages     | 1 hour  |
| known     | 100 messages    | 1 hour  |
| verified  | 1000 messages   | 1 hour  |

**Implementation**: Sliding window per AID, incremented on successful `send`.

**Code**: `incrementRateLimit()` in [convex/authorization.ts](../convex/authorization.ts)

## Security Considerations

1. **Server-side enforcement**: All authorization checks happen server-side (never trust client)
2. **Verified sender**: Server extracts sender AID from authenticated proof, never from request args
3. **Immutable tiers**: Users cannot self-promote (requires admin action)
4. **Admin-only patterns**: Only super_admins can create/modify authorization patterns
5. **Pattern expiration**: Patterns can have TTL for temporary access grants
6. **Audit trail**: All tier changes and pattern additions are logged with admin AID

## Example Authorization Checks

### Unknown user → Regular user
```
Sender: unknown tier
Recipient: DEpJbqv7k2... (regular AID)
Pattern check: No match
Onboarding admin: No
Result: DENIED ("Unknown users can only message onboarding admins")
```

### Unknown user → Onboarding admin
```
Sender: unknown tier
Recipient: DAdm1n... (in onboardingAdmins table, active=true)
Pattern check: N/A (admin check takes precedence)
Result: ALLOWED
```

### Unknown user → Test AID (with pattern)
```
Sender: unknown tier
Recipient: TESTAlice... (starts with "TEST")
Pattern check: Matches "^TEST" pattern
Result: ALLOWED
```

### Known user → Anyone
```
Sender: known tier
Recipient: DEpJbqv7k2... (any AID)
Pattern check: Skipped (known tier has broad access)
Result: ALLOWED
```

## Managing Patterns

Patterns are managed via Convex mutations (super_admin only):

```typescript
// Add pattern
await ctx.runMutation(api.authorization.addPattern, {
  pattern: "^TEST",
  description: "Test identities",
  appliesTo: "unknown",
  priority: 100,
  auth: {...}
});

// Deactivate pattern
await ctx.runMutation(api.authorization.deactivatePattern, {
  patternId: "...",
  auth: {...}
});
```

**Dashboard**: Patterns can be manually added via Convex Dashboard → Data → authPatterns table

## Testing Conventions

When writing tests that need messaging between unknown users:

1. **Use TEST prefix**: AIDs should start with `TEST` (e.g., `TESTAlice`, `TESTBob`)
2. **Add pattern once**: Create `^TEST` pattern in test setup (or rely on default)
3. **Isolated environments**: Use `--data-dir` to create separate test vaults
4. **Cleanup**: Test patterns should have expiration or be manually cleaned up

**Example**:
```typescript
// tests/cli/e2e/messaging.test.ts
const aliceAid = "TESTAlice" + randomSuffix(39); // Total 44 chars
const bobAid = "TESTBob" + randomSuffix(41);     // Total 44 chars

// Both can message each other via ^TEST pattern
```

## Future Enhancements

- [ ] Per-group authorization (group admins control membership)
- [ ] Reputation-based tier progression
- [ ] Message type-specific authorization (e.g., `typ: "payment"` requires verified)
- [ ] Allowlist/blocklist per user
- [ ] Time-based restrictions (e.g., business hours only)
