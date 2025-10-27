# Unified Tier System - Implementation Plan

## Status: Schema Complete, Authorization Logic Pending

### ✅ Completed
1. Updated [docs/permissions.md](./permissions.md) with unified tier model
2. Refactored schema:
   - Added `tierConfigs` table
   - Added `aidTiers` table
   - Removed `userTiers` table
   - Removed `authPatterns` table
   - Removed `onboardingAdmins` table
   - Updated `rateLimits` to reference tierName

### 📋 Remaining Work

#### 1. authorization.ts - Core Functions

**Replace `getUserTier()` with `getTierConfig()`**:
```typescript
async function getTierConfig(
  ctx: QueryCtx | MutationCtx,
  aid: string
): Promise<TierConfig> {
  // 1. Check explicit assignment
  const assignment = await ctx.db
    .query("aidTiers")
    .withIndex("by_aid", (q) => q.eq("aid", aid))
    .first();

  if (assignment) {
    const config = await ctx.db
      .query("tierConfigs")
      .withIndex("by_name", (q) => q.eq("name", assignment.tierName).eq("active", true))
      .first();
    if (config) return config;
  }

  // 2. Check pattern-based assignment (sorted by priority)
  const configs = await ctx.db
    .query("tierConfigs")
    .withIndex("by_priority", (q) => q.eq("active", true))
    .order("desc")
    .collect();

  for (const config of configs) {
    // Check AID patterns
    for (const pattern of config.aidPatterns) {
      try {
        if (new RegExp(pattern).test(aid)) {
          return config;
        }
      } catch {}
    }
  }

  // 3. Return default tier
  for (const config of configs) {
    if (config.isDefault) {
      return config;
    }
  }

  throw new Error(`No tier found for AID: ${aid}`);
}
```

**Update `canSend()`**:
```typescript
export async function canSend(
  ctx: QueryCtx | MutationCtx,
  from: string,
  to: string,
  typ: string,
  incrementRate: boolean = false
): Promise<AuthzResult> {
  // Get tier configs
  const senderTier = await getTierConfig(ctx, from);
  const recipientTier = await getTierConfig(ctx, to);

  // Check rate limit (use tier config values)
  const withinLimits = incrementRate
    ? await incrementRateLimit(ctx as MutationCtx, from, senderTier)
    : await checkRateLimitReadOnly(ctx, from, senderTier);

  if (!withinLimits) {
    return {
      allowed: false,
      reason: `Rate limit exceeded for tier '${senderTier.name}'`,
      tier: senderTier.name,
    };
  }

  // Check permissions
  if (senderTier.canMessageAnyone) {
    return { allowed: true, tier: senderTier.name };
  }

  if (senderTier.canMessageTiers.includes(recipientTier.name)) {
    return { allowed: true, tier: senderTier.name };
  }

  return {
    allowed: false,
    reason: `Tier '${senderTier.name}' cannot message tier '${recipientTier.name}'`,
    tier: senderTier.name,
  };
}
```

**Update rate limit functions**:
```typescript
async function checkRateLimitReadOnly(
  ctx: QueryCtx | MutationCtx,
  aid: string,
  tierConfig: TierConfig
): Promise<boolean> {
  const now = Date.now();
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_aid", (q) => q.eq("aid", aid))
    .first();

  if (!existing) return true;
  if (now - existing.windowStart > existing.windowDuration) return true;
  return existing.messagesInWindow < existing.limit;
}

async function incrementRateLimit(
  ctx: MutationCtx,
  aid: string,
  tierConfig: TierConfig
): Promise<boolean> {
  const now = Date.now();
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_aid", (q) => q.eq("aid", aid))
    .first();

  if (!existing) {
    // Create new rate limit entry
    await ctx.db.insert("rateLimits", {
      aid,
      tierName: tierConfig.name,
      windowStart: now,
      windowDuration: tierConfig.windowMs,
      messagesInWindow: 1,
      limit: tierConfig.messagesPerWindow,
    });
    return true;
  }

  // Check if window expired
  if (now - existing.windowStart > existing.windowDuration) {
    // Reset window
    await ctx.db.patch(existing._id, {
      tierName: tierConfig.name,
      windowStart: now,
      windowDuration: tierConfig.windowMs,
      messagesInWindow: 1,
      limit: tierConfig.messagesPerWindow,
    });
    return true;
  }

  // Check limit
  if (existing.messagesInWindow >= existing.limit) {
    return false;
  }

  // Increment
  await ctx.db.patch(existing._id, {
    tierName: tierConfig.name,
    messagesInWindow: existing.messagesInWindow + 1,
    limit: tierConfig.messagesPerWindow,
  });
  return true;
}
```

**Remove obsolete functions**:
- `matchesAnyPattern()` - Merged into getTierConfig
- `isOnboardingAdmin()` - No longer needed (use admin roles directly)

#### 2. authorization.ts - Mutations

**Replace `onboardUser()` mutation**:
```typescript
export const assignTier = mutation({
  args: {
    aid: v.string(),
    tierName: v.string(),
    promotionProof: v.optional(v.string()),
    notes: v.optional(v.string()),
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    // Verify authentication
    const verified = await verifyAuth(ctx, args.auth, "assign_tier", {
      aid: args.aid,
      tierName: args.tierName,
    });

    // Check admin role
    const role = await getAdminRole(ctx, verified.aid);
    if (!role) {
      throw new Error("Only admins can assign tiers");
    }

    // Check if tier exists and requires promotion
    const tierConfig = await ctx.db
      .query("tierConfigs")
      .withIndex("by_name", (q) => q.eq("name", args.tierName).eq("active", true))
      .first();

    if (!tierConfig) {
      throw new Error(`Tier '${args.tierName}' not found`);
    }

    if (tierConfig.requiresPromotion && role !== "super_admin") {
      throw new Error(`Tier '${args.tierName}' requires super_admin`);
    }

    // Check if already assigned
    const existing = await ctx.db
      .query("aidTiers")
      .withIndex("by_aid", (q) => q.eq("aid", args.aid))
      .first();

    if (existing) {
      // Update existing assignment
      await ctx.db.patch(existing._id, {
        tierName: args.tierName,
        assignedBy: verified.aid,
        assignedAt: Date.now(),
        promotionProof: args.promotionProof,
        notes: args.notes,
      });
    } else {
      // Create new assignment
      await ctx.db.insert("aidTiers", {
        aid: args.aid,
        tierName: args.tierName,
        assignedBy: verified.aid,
        assignedAt: Date.now(),
        promotionProof: args.promotionProof,
        notes: args.notes,
      });
    }

    return { success: true };
  },
});
```

**Add `createTier()` mutation**:
```typescript
export const createTier = mutation({
  args: {
    name: v.string(),
    priority: v.number(),
    isDefault: v.boolean(),
    aidPatterns: v.array(v.string()),
    requiresPromotion: v.boolean(),
    canMessageTiers: v.array(v.string()),
    canMessageAnyone: v.boolean(),
    messagesPerWindow: v.number(),
    windowMs: v.number(),
    description: v.string(),
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    // Verify authentication
    const verified = await verifyAuth(ctx, args.auth, "create_tier", {
      name: args.name,
    });

    // Only super_admins can create tiers
    const role = await getAdminRole(ctx, verified.aid);
    if (role !== "super_admin") {
      throw new Error("Only super_admins can create tiers");
    }

    // Validate patterns
    for (const pattern of args.aidPatterns) {
      try {
        new RegExp(pattern);
      } catch {
        throw new Error(`Invalid regex pattern: ${pattern}`);
      }
    }

    // Check for duplicate
    const existing = await ctx.db
      .query("tierConfigs")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .first();

    if (existing) {
      throw new Error(`Tier '${args.name}' already exists`);
    }

    // Create tier
    await ctx.db.insert("tierConfigs", {
      name: args.name,
      priority: args.priority,
      isDefault: args.isDefault,
      aidPatterns: args.aidPatterns,
      requiresPromotion: args.requiresPromotion,
      canMessageTiers: args.canMessageTiers,
      canMessageAnyone: args.canMessageAnyone,
      messagesPerWindow: args.messagesPerWindow,
      windowMs: args.windowMs,
      description: args.description,
      createdBy: verified.aid,
      createdAt: Date.now(),
      active: true,
    });

    return { success: true };
  },
});
```

**Add `bootstrapDefaultTiers()` mutation**:
```typescript
export const bootstrapDefaultTiers = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Check if tiers already exist
    const existing = await ctx.db.query("tierConfigs").collect();
    if (existing.length > 0) {
      return { message: "Tiers already exist", count: existing.length };
    }

    // Create unknown tier (default)
    await ctx.db.insert("tierConfigs", {
      name: "unknown",
      priority: 0,
      isDefault: true,
      aidPatterns: [],
      requiresPromotion: false,
      canMessageTiers: ["unknown"],
      canMessageAnyone: false,
      messagesPerWindow: 10,
      windowMs: 3600000,
      description: "Default tier for new users",
      createdBy: "SYSTEM",
      createdAt: now,
      active: true,
    });

    // Create known tier
    await ctx.db.insert("tierConfigs", {
      name: "known",
      priority: 10,
      isDefault: false,
      aidPatterns: [],
      requiresPromotion: true,
      canMessageTiers: ["unknown", "known", "verified"],
      canMessageAnyone: false,
      messagesPerWindow: 100,
      windowMs: 3600000,
      description: "Onboarded users",
      createdBy: "SYSTEM",
      createdAt: now,
      active: true,
    });

    // Create verified tier
    await ctx.db.insert("tierConfigs", {
      name: "verified",
      priority: 20,
      isDefault: false,
      aidPatterns: [],
      requiresPromotion: true,
      canMessageTiers: ["unknown", "known", "verified"],
      canMessageAnyone: false,
      messagesPerWindow: 1000,
      windowMs: 3600000,
      description: "KYC-verified users",
      createdBy: "SYSTEM",
      createdAt: now,
      active: true,
    });

    // Create test tier (for E2E)
    await ctx.db.insert("tierConfigs", {
      name: "test",
      priority: 100,
      isDefault: false,
      aidPatterns: [".*"], // Matches all AIDs - DISABLE IN PRODUCTION
      requiresPromotion: false,
      canMessageTiers: ["test"],
      canMessageAnyone: true,
      messagesPerWindow: 1000,
      windowMs: 3600000,
      description: "Test tier with unrestricted messaging (DEV ONLY)",
      createdBy: "SYSTEM",
      createdAt: now,
      active: true,
    });

    return { message: "Default tiers created", count: 4 };
  },
});
```

**Remove obsolete mutations**:
- `addPattern` - No longer needed
- `bootstrapTestPattern` - Replaced by bootstrapDefaultTiers
- `listPatterns` - Replace with `listTiers`
- `addOnboardingAdmin`, `removeOnboardingAdmin` - Use adminRoles instead

#### 3. Update Query Functions

```typescript
export const getTierInfo = query({
  args: { aid: v.string() },
  handler: async (ctx, args) => {
    const tierConfig = await getTierConfig(ctx, args.aid);

    const assignment = await ctx.db
      .query("aidTiers")
      .withIndex("by_aid", (q) => q.eq("aid", args.aid))
      .first();

    return {
      tier: tierConfig.name,
      explicit: !!assignment,
      assignedBy: assignment?.assignedBy,
      permissions: {
        canMessageTiers: tierConfig.canMessageTiers,
        canMessageAnyone: tierConfig.canMessageAnyone,
      },
      rateLimit: {
        messagesPerWindow: tierConfig.messagesPerWindow,
        windowMs: tierConfig.windowMs,
      },
    };
  },
});

export const listTiers = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("tierConfigs")
      .filter((q) => q.eq(q.field("active"), true))
      .order("desc") // By priority
      .collect();
  },
});

export const getTierStats = query({
  args: {},
  handler: async (ctx) => {
    const assignments = await ctx.db.query("aidTiers").collect();
    const tierCounts: Record<string, number> = {};

    for (const assignment of assignments) {
      tierCounts[assignment.tierName] = (tierCounts[assignment.tierName] || 0) + 1;
    }

    return tierCounts;
  },
});
```

#### 4. Update Integration Tests

Tests that need updating:
- `tests/integration/onboarding-flow.test.ts` - Use `assignTier` instead of `onboardUser`
- Any tests checking `userTiers` table
- Any tests using patterns

#### 5. Deployment Steps

1. Deploy schema changes (will create new tables)
2. Call `bootstrapDefaultTiers()` mutation
3. Run tests to verify
4. (Optional) Disable test tier in production

### Testing Checklist

- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] E2E tests pass (with test tier enabled)
- [ ] Can create custom tier
- [ ] Can assign AID to tier
- [ ] Pattern-based assignment works
- [ ] Rate limits work with new tier configs
- [ ] Admin operations work

### Rollback Plan

If issues occur:
1. Revert schema.ts
2. Revert authorization.ts
3. Redeploy
4. Old tables will still exist (Convex doesn't delete tables on schema removal)

