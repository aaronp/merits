# Merits Messaging Permissions

## Overview

Merits uses a **unified tier-based authorization system**. All permissions (messaging, rate limits, patterns) are defined per-tier, not hardcoded.

## Core Concept: Tiers

Every AID is assigned a **tier** (like a role). Each tier defines:
- Who can message whom (allowed recipient tiers)
- Rate limits
- Assignment rules (auto-assign via AID patterns, or require admin promotion)

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
  "canMessageTiers": ["unknown"],
  "canMessageAnyone": false,
  "messagesPerWindow": 10,
  "windowMs": 3600000,
  "description": "Default tier for new users"
}
```

**Permissions**:
- Can only message other `unknown` tier users
- Cannot message `known` or `verified` without admin intervention
- Rate limit: 10 messages/hour

**Assignment**: Auto-assigned to any AID not explicitly assigned to another tier

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
  "description": "Onboarded users"
}
```

**Permissions**:
- Can message `unknown`, `known`, and `verified` tiers
- Rate limit: 100 messages/hour

**Assignment**: Requires admin promotion

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
  "aidPatterns": [".*"],
  "requiresPromotion": false,
  "canMessageTiers": ["test"],
  "canMessageAnyone": true,
  "messagesPerWindow": 1000,
  "windowMs": 3600000,
  "description": "Test tier with unrestricted messaging"
}
```

**Use case**: E2E tests where pattern matches all AIDs, giving them test tier with unrestricted messaging.

**Pattern matching order**:
1. Check for explicit AID assignment
2. Try patterns in priority order (highest first)
3. Fall back to default tier

## Code References

- **Schema**: [convex/schema.ts](../convex/schema.ts)
- **Authorization**: [convex/authorization.ts](../convex/authorization.ts)
- **Tests**: [tests/integration/onboarding-flow.test.ts](../tests/integration/onboarding-flow.test.ts)
