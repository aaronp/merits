# Setting Up Authorization for Testing

**Status**: ✅ Updated for Phase 2.5 Tier Refactor
**Last Updated**: 2025-10-27

## Overview

The unified tier system (Phase 2.5) automatically creates a "test" tier during bootstrap that provides unrestricted messaging for development and testing.

## Default Test Tier

When you run `bootstrapDefaultTiers()`, a test tier is automatically created:

```typescript
{
  name: "test",
  priority: 100,
  isDefault: false,
  aidPatterns: ["^TEST"],  // Matches AIDs starting with "TEST"
  requiresPromotion: false,
  canMessageTiers: ["test"],
  canMessageAnyone: true,  // Unrestricted messaging
  messagesPerWindow: 1000,
  windowMs: 3600000,
  description: "Test tier with unrestricted messaging (DEV ONLY)"
}
```

**Key Features**:
- Pattern `^TEST` matches AIDs starting with "TEST"
- `canMessageAnyone: true` bypasses tier restrictions
- High priority (100) so it's checked first
- No promotion required (auto-assigned by pattern)

## How It Works

### Pattern Matching on Sender AIDs

The tier system checks patterns against **sender AIDs**, not identity names:

1. When Alice sends a message, system looks up Alice's tier
2. Checks for explicit assignment in `aidTiers` table
3. If not found, tries pattern matching (by priority)
4. If Alice's AID matches `^TEST`, she gets "test" tier
5. Test tier has `canMessageAnyone: true`, so message is allowed

### AID Format

**Important**: AIDs are derived from Ed25519 public keys and always start with `D` (CESR format):

```
Identity name: TESTAlice
AID: DzOY9bFUgdrOcP5BWFNbNMRLfuze2qPqk5YRKL3Y06P8
      ↑
      Always starts with 'D', not 'TEST'
```

The pattern `^TEST` in the default config **will NOT match** because AIDs start with `D`, not `TEST`.

## Setup Options

### Option 1: Use Default Unknown Tier Permissions (Recommended)

The simplest approach is to leverage the default permissions:

**Default unknown tier can message**:
- Other unknown users (peer-to-peer)
- Known users (for onboarding)

This is sufficient for most E2E tests:

```typescript
// Alice (unknown) can message Bob (unknown)
await client.send(bobAid, message, aliceCreds);

// No additional setup needed!
```

**Example**: [tests/integration/onboarding-flow.test.ts](../tests/integration/onboarding-flow.test.ts)

### Option 2: Modify Test Tier Pattern (Development)

Update the test tier to match all AIDs:

1. **Via Convex Dashboard**:
   - Navigate to: Data → `tierConfigs`
   - Find tier with `name: "test"`
   - Edit `aidPatterns`: Change `["^TEST"]` to `[".*"]`
   - Save

2. **Via Mutation** (programmatic):
   ```typescript
   import { ConvexClient } from "convex/browser";
   import { api } from "./convex/_generated/api";

   const convex = new ConvexClient(process.env.CONVEX_URL);

   // Get the test tier
   const tiers = await convex.query(api.authorization.listTiers, {});
   const testTier = tiers.find(t => t.name === "test");

   // Update pattern to match all AIDs
   await convex.mutation(api.authorization.updateTierPatterns, {
     tierName: "test",
     aidPatterns: [".*"],  // Match all AIDs
     auth: adminAuth
   });
   ```

**⚠️ WARNING**: Pattern `.*` matches ALL AIDs and bypasses authorization. Only use in local development.

### Option 3: Explicitly Assign Test Tier

Assign specific AIDs to the test tier:

```typescript
// During test setup
await convex.mutation(api.authorization.assignTier, {
  aid: aliceAid,
  tierName: "test",
  promotionProof: "TEST_SETUP",
  notes: "E2E test user",
  auth: adminAuth
});
```

This is more controlled but requires admin credentials.

### Option 4: Use Onboarding Flow (Most Realistic)

For testing the real onboarding flow:

```typescript
// 1. Create admin
await convex.mutation(api._test_helpers.bootstrapSuperAdmin, {
  aid: adminAid
});

// 2. Admin assigns known tier to users
await convex.mutation(api.authorization.assignTier, {
  aid: aliceAid,
  tierName: "known",
  promotionProof: "EPROOF123",
  notes: "Onboarded",
  auth: adminAuth
});

// 3. Now Alice (known) can message anyone
await client.send(bobAid, message, aliceCreds);
```

**Example**: [tests/integration/onboarding-flow.test.ts](../tests/integration/onboarding-flow.test.ts)

## Recommended Approaches by Use Case

### For Unit/Integration Tests
**Use Default Permissions** (Option 1)
- No setup required
- Unknown users can message each other
- Fast and simple

### For E2E CLI Tests
**Modify Test Tier Pattern** (Option 2)
- Change pattern to `.*` in test environment
- Unrestricted messaging for all test users
- Easy cleanup (revert pattern or disable tier)

### For CI/Production Testing
**Use Onboarding Flow** (Option 4)
- Tests the real authorization flow
- No special test tier configuration
- Validates the actual user experience

### For Local Development
**Modify Test Tier Pattern** (Option 2)
- Set `aidPatterns: [".*"]` via Dashboard
- All users get unrestricted messaging
- Remember to revert before production deploy

## Cleanup

### Disable Test Tier

Via Dashboard:
1. Navigate to: Data → `tierConfigs`
2. Find tier with `name: "test"`
3. Set `active: false`
4. Save

Via Mutation:
```typescript
await convex.mutation(api.authorization.updateTierStatus, {
  tierName: "test",
  active: false,
  auth: adminAuth
});
```

### Reset Test Tier Pattern

Revert to safe default:

```typescript
await convex.mutation(api.authorization.updateTierPatterns, {
  tierName: "test",
  aidPatterns: ["^D$"],  // Will never match (AIDs are 44 chars)
  auth: adminAuth
});
```

### Remove Explicit Assignments

```typescript
await convex.mutation(api.authorization.removeTierAssignment, {
  aid: testAid,
  auth: adminAuth
});
```

## Security Notes

- ⚠️ **Never deploy test tier with `.*` pattern to production**
- ⚠️ **Always disable test tier or use non-matching pattern in production**
- Pattern matching is case-sensitive
- Higher priority patterns are checked first
- Invalid regex patterns are silently skipped
- All tier assignments are logged with `assignedBy` audit trail

## Verification

Check which tier an AID is assigned to:

```typescript
const tierInfo = await convex.query(api.authorization.getTierInfo, {
  aid: aliceAid
});

console.log({
  tier: tierInfo.tier,           // "test", "unknown", "known", etc.
  explicit: tierInfo.explicit,   // true if explicitly assigned, false if pattern-based
  assignedBy: tierInfo.assignedBy,
  permissions: tierInfo.permissions,
  rateLimit: tierInfo.rateLimit
});
```

## Migration from Old System

**Old System** (removed in Phase 2.5):
- `authPatterns` table with recipient patterns
- `onboardingAdmins` table for whitelist
- `bootstrapTestPattern` mutation

**New System**:
- `tierConfigs` table with sender AID patterns
- `aidTiers` table for explicit assignments
- `bootstrapDefaultTiers` mutation creates test tier automatically

**Key Difference**: Pattern matching now works on **sender AIDs** (who is sending), not recipient AIDs (who is receiving).

## See Also

- [docs/permissions.md](./permissions.md) - Complete tier system documentation
- [convex/authorization.ts](../convex/authorization.ts) - Tier implementation
- [convex/schema.ts](../convex/schema.ts) - `tierConfigs` and `aidTiers` tables
- [tests/integration/onboarding-flow.test.ts](../tests/integration/onboarding-flow.test.ts) - Complete onboarding flow example
- [tests/integration/sdk-integration.test.ts](../tests/integration/sdk-integration.test.ts) - Uses default permissions

## Quick Reference

```typescript
// Bootstrap default tiers (includes test tier)
await convex.mutation(api.authorization.bootstrapDefaultTiers, {});

// Check tier for an AID
const info = await convex.query(api.authorization.getTierInfo, { aid });

// Assign explicit tier
await convex.mutation(api.authorization.assignTier, {
  aid, tierName, promotionProof, notes, auth
});

// List all tiers
const tiers = await convex.query(api.authorization.listTiers, {});

// Get tier statistics
const stats = await convex.query(api.authorization.getTierStats, {});
```
