# Merits Messaging Permissions

**Status**: ✅ Implemented (Phase 2 Tier Refactor Complete)
**Last Updated**: 2025-10-27

## Overview

Merits uses a **unified tier-based authorization system**. All permissions (messaging, rate limits, assignment rules) are defined per-tier in database configurations, not hardcoded.

**Key Benefits**:
- Data-driven authorization (create/modify tiers without code changes)
- Pattern-based auto-assignment (regex on sender AIDs)
- Flexible rate limiting per tier
- Audit trail for all tier assignments

## Core Concept: Tiers

Every AID is assigned a **tier** (similar to a role). Each tier defines:
- **Permissions**: Which tiers can receive messages from this tier
- **Rate limits**: Messages per time window
- **Assignment rules**: Auto-assign via AID patterns, or require admin promotion

## Architecture

### Authorization Flow

When user A attempts to send a message to user B:

1. **Get sender tier**: Look up A's tier (explicit assignment or pattern-based)
2. **Get recipient tier**: Look up B's tier
3. **Check rate limit**: Verify A hasn't exceeded tier's rate limit
4. **Check permissions**: Can A's tier message B's tier?
5. **Allow/Deny**: Return result

### Tier Configuration

Each tier is defined by a configuration document:

```typescript
interface TierConfig {
  name: string;                    // "unknown", "known", "verified"
  priority: number;                // For pattern matching (higher = checked first)

  // Assignment rules
  isDefault: boolean;              // Auto-assign to AIDs with no explicit tier
  aidPatterns: string[];           // Regex patterns for auto-assignment
  requiresPromotion: boolean;      // Must be assigned by admin

  // Permissions
  canMessageTiers: string[];       // Which tiers can receive messages
  canMessageAnyone: boolean;       // Bypass tier checks

  // Rate limiting
  messagesPerWindow: number;
  windowMs: number;

  // Metadata
  description: string;
  createdBy: string;
  createdAt: number;
  active: boolean;
}
```

### AID → Tier Assignment

```typescript
interface AidTierAssignment {
  aid: string;
  tierName: string;              // References TierConfig.name
  assignedBy: string;            // "SYSTEM" | admin AID
  assignedAt: number;
  promotionProof?: string;       // SAID reference for audit
  notes?: string;
}
```

## Default Tiers

### `unknown` (Default)
Default tier for all new/unrecognized AIDs.

```json
{
  "name": "unknown",
  "priority": 0,
  "isDefault": true,
  "aidPatterns": [],
  "requiresPromotion": false,
  "canMessageTiers": ["unknown", "known"],
  "canMessageAnyone": false,
  "messagesPerWindow": 10,
  "windowMs": 3600000,
  "description": "Default tier for new users (can contact known users for onboarding)"
}
```

**Permissions**:
- Can message other `unknown` tier users (peer communication)
- **Can message `known` tier users** (enables onboarding flow where unknown users contact admins)
- Rate limit: 10 messages/hour

**Assignment**: Auto-assigned to any AID not explicitly assigned to another tier

**Onboarding Flow**: Unknown users can message known tier users to request onboarding. This is by design to enable the onboarding process where new users contact admins.

### `known`
Users who have been onboarded by an admin.

```json
{
  "name": "known",
  "priority": 10,
  "isDefault": false,
  "aidPatterns": [],
  "requiresPromotion": true,
  "canMessageTiers": ["unknown", "known", "verified"],
  "canMessageAnyone": false,
  "messagesPerWindow": 100,
  "windowMs": 3600000,
  "description": "Onboarded users (can receive from unknown for onboarding)"
}
```

**Permissions**:
- Can message `unknown`, `known`, and `verified` tiers
- Can **receive messages from `unknown`** tier (for onboarding)
- Rate limit: 100 messages/hour

**Assignment**: Requires admin promotion via `assignTier()` mutation

### `verified`
KYC-verified users with full access.

```json
{
  "name": "verified",
  "priority": 20,
  "isDefault": false,
  "aidPatterns": [],
  "requiresPromotion": true,
  "canMessageTiers": ["unknown", "known", "verified"],
  "canMessageAnyone": false,
  "messagesPerWindow": 1000,
  "windowMs": 3600000,
  "description": "KYC-verified users"
}
```

**Permissions**:
- Can message all standard tiers
- Rate limit: 1000 messages/hour

**Assignment**: Requires admin promotion with KYC proof

## Pattern-Based Assignment

Tiers can auto-assign based on sender AID patterns. This enables:
- Test tiers for E2E testing
- Special handling for specific AID formats
- Dynamic tier assignment without explicit admin action

### Example: Test Tier

```json
{
  "name": "test",
  "priority": 100,
  "isDefault": false,
  "aidPatterns": ["^TEST"],
  "requiresPromotion": false,
  "canMessageTiers": ["test"],
  "canMessageAnyone": true,
  "messagesPerWindow": 1000,
  "windowMs": 3600000,
  "description": "Test tier with unrestricted messaging (DEV ONLY)"
}
```

**Use case**: E2E tests where AIDs starting with "TEST" get unrestricted messaging.

**Pattern matching order**:
1. Check for explicit AID assignment in `aidTiers` table
2. Try tier patterns in priority order (highest first)
3. Fall back to default tier (`isDefault: true`)

**Security Note**: The test tier should be disabled in production or use a pattern that won't match real AIDs.

## API / Mutations

### `bootstrapDefaultTiers()`
Creates the default tier configurations (`unknown`, `known`, `verified`, `test`).

**Usage**: Call once after schema deployment to initialize tiers.

```typescript
await ctx.db.mutation(api.authorization.bootstrapDefaultTiers, {});
```

**Implementation**: [convex/authorization.ts:520](../convex/authorization.ts#L520)

### `assignTier()`
Assign a tier to an AID (admin only).

**Usage**:
```typescript
await ctx.db.mutation(api.authorization.assignTier, {
  aid: "DHytGsw0r...",
  tierName: "known",
  promotionProof: "EPROOF_SAID",
  notes: "Onboarded via chat",
  auth: { challengeId, sigs, ksn }
});
```

**Implementation**: [convex/authorization.ts:347](../convex/authorization.ts#L347)

### `onboardUser()` (Backward Compatibility)
Wrapper around `assignTier()` that assigns "known" tier.

**Usage**:
```typescript
await ctx.db.mutation(api.authorization.onboardUser, {
  userAid: "DHytGsw0r...",
  onboardingProof: "EPROOF_SAID",
  notes: "Onboarded",
  auth: { challengeId, sigs, ksn }
});
```

**Implementation**: [convex/authorization.ts:421](../convex/authorization.ts#L421)

### `createTier()`
Create a new custom tier configuration (super_admin only).

**Usage**:
```typescript
await ctx.db.mutation(api.authorization.createTier, {
  name: "premium",
  priority: 30,
  isDefault: false,
  aidPatterns: [],
  requiresPromotion: true,
  canMessageTiers: ["unknown", "known", "verified", "premium"],
  canMessageAnyone: false,
  messagesPerWindow: 5000,
  windowMs: 3600000,
  description: "Premium tier users",
  auth: { challengeId, sigs, ksn }
});
```

**Implementation**: [convex/authorization.ts:487](../convex/authorization.ts#L487)

## Query API

### `getTierInfo()`
Get tier information for an AID.

**Usage**:
```typescript
const tierInfo = await ctx.db.query(api.authorization.getTierInfo, {
  aid: "DHytGsw0r..."
});

// Returns:
// {
//   tier: "known",
//   explicit: true,  // true if explicitly assigned, false if pattern-based
//   assignedBy: "admin-aid",
//   permissions: {
//     canMessageTiers: ["unknown", "known", "verified"],
//     canMessageAnyone: false
//   },
//   rateLimit: {
//     messagesPerWindow: 100,
//     windowMs: 3600000
//   }
// }
```

**Implementation**: [convex/authorization.ts:618](../convex/authorization.ts#L618)

### `listTiers()`
List all active tier configurations.

**Usage**:
```typescript
const tiers = await ctx.db.query(api.authorization.listTiers, {});
```

**Implementation**: [convex/authorization.ts:644](../convex/authorization.ts#L644)

### `getTierStats()`
Get counts of AIDs per tier (explicit assignments only).

**Usage**:
```typescript
const stats = await ctx.db.query(api.authorization.getTierStats, {});

// Returns: { known: 5, verified: 2 }
```

**Implementation**: [convex/authorization.ts:655](../convex/authorization.ts#L655)

## Core Functions

### `getTierConfig()`
Internal helper that resolves an AID's tier configuration using the priority system.

**Priority**:
1. Explicit assignment in `aidTiers` table
2. Pattern-based match (by priority, highest first)
3. Default tier fallback

**Implementation**: [convex/authorization.ts:48](../convex/authorization.ts#L48)

### `canSend()`
Authorization check for message sending.

**Checks**:
1. Rate limit (from sender's tier config)
2. Sender tier can message recipient tier
3. Returns `{ allowed: boolean, reason?: string, tier: string }`

**Implementation**: [convex/authorization.ts:201](../convex/authorization.ts#L201)

## Code References

- **Schema**: [convex/schema.ts](../convex/schema.ts) - `tierConfigs` and `aidTiers` tables
- **Authorization**: [convex/authorization.ts](../convex/authorization.ts) - Core tier logic
- **Tests (Onboarding)**: [tests/integration/onboarding-flow.test.ts](../tests/integration/onboarding-flow.test.ts) - 12 tests covering tier assignment and permissions
- **Tests (SDK)**: [tests/integration/sdk-integration.test.ts](../tests/integration/sdk-integration.test.ts) - Integration with tier system
- **Tests (Messaging)**: [tests/integration/messaging-flow.test.ts](../tests/integration/messaging-flow.test.ts) - Message flow with tiers

## Migration from Old System

**Old System** (Removed):
- `userTiers` table - Simple AID→tier mapping
- `authPatterns` table - Recipient patterns only
- `onboardingAdmins` table - Whitelist for unknown→known promotion
- Hardcoded rate limits in authorization logic

**New System** (Current):
- `tierConfigs` table - Complete tier configuration
- `aidTiers` table - Explicit AID assignments
- Pattern matching on **sender AIDs** (not recipients)
- Data-driven rate limits from tier configs
- Admin roles via `adminRoles` table (unchanged)

**Backward Compatibility**:
- `onboardUser()` mutation maintained as wrapper around `assignTier()`
- Tests updated to use new system
- No data migration needed (clean slate OK per requirements)
