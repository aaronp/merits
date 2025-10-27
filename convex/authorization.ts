/**
 * Authorization - Tiered access control with onboarding flow
 *
 * ## Onboarding Flow
 * 1. Unknown user contacts onboarding admin (whitelisted AID)
 * 2. Admin and user exchange messages during onboarding
 * 3. Admin promotes user to "known" with onboarding proof (SAID)
 * 4. Known users can message anyone in the system
 *
 * ## Tiers
 * - **unknown**: New user, can only message onboarding admins
 * - **known**: Onboarded by admin, can message within system
 * - **verified**: KYC complete, full access
 *
 * ## Admin Roles
 * - **onboarding_admin**: Can onboard users (unknown → known)
 * - **super_admin**: Can manage admins and all promotions
 */

import { v } from "convex/values";
import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { verifyAuth } from "./auth";
import type { Id } from "./_generated/dataModel";

export type Tier = "unknown" | "known" | "verified";
export type AdminRole = "onboarding_admin" | "super_admin";

export interface AuthzResult {
  allowed: boolean;
  reason?: string;
  tier: Tier;
}

/**
 * Get user's tier (defaults to "unknown" if not found)
 */
export async function getUserTier(
  ctx: QueryCtx | MutationCtx,
  aid: string
): Promise<Tier> {
  const tierRecord = await ctx.db
    .query("userTiers")
    .withIndex("by_aid", (q) => q.eq("aid", aid))
    .first();

  return (tierRecord?.tier as Tier) ?? "unknown";
}

/**
 * Check if AID is an active onboarding admin
 */
async function isOnboardingAdmin(
  ctx: QueryCtx | MutationCtx,
  aid: string
): Promise<boolean> {
  const admin = await ctx.db
    .query("onboardingAdmins")
    .withIndex("by_aid", (q) => q.eq("aid", aid))
    .first();

  return admin?.active ?? false;
}

/**
 * Get admin role for AID (returns highest privilege role)
 */
async function getAdminRole(
  ctx: QueryCtx | MutationCtx,
  aid: string
): Promise<AdminRole | null> {
  const roles = await ctx.db
    .query("adminRoles")
    .withIndex("by_aid", (q) => q.eq("aid", aid))
    .filter((q) => q.eq(q.field("active"), true))
    .collect();

  if (roles.length === 0) return null;

  // super_admin has highest privilege
  if (roles.some((r) => r.role === "super_admin")) {
    return "super_admin";
  }

  if (roles.some((r) => r.role === "onboarding_admin")) {
    return "onboarding_admin";
  }

  return null;
}

/**
 * Check if recipient AID matches any active authorization patterns
 * Only applies to unknown tier (known/verified have broad access)
 */
async function matchesAnyPattern(
  ctx: QueryCtx | MutationCtx,
  recipientAid: string,
  tier: Tier
): Promise<boolean> {
  // Only check patterns for unknown tier
  if (tier !== "unknown") {
    return false;
  }

  // Get active patterns for this tier, sorted by priority (descending)
  const patterns = await ctx.db
    .query("authPatterns")
    .withIndex("by_appliesTo", (q) => q.eq("appliesTo", tier).eq("active", true))
    .collect();

  // Sort by priority descending (higher priority first)
  patterns.sort((a, b) => b.priority - a.priority);

  // Check if recipient matches any pattern
  const now = Date.now();
  for (const pattern of patterns) {
    // Skip expired patterns
    if (pattern.expiresAt && pattern.expiresAt < now) {
      continue;
    }

    try {
      const regex = new RegExp(pattern.pattern);
      if (regex.test(recipientAid)) {
        return true;
      }
    } catch (err) {
      // Invalid regex - skip and continue
      console.warn(`Invalid regex pattern: ${pattern.pattern}`, err);
      continue;
    }
  }

  return false;
}

/**
 * Check rate limit for an AID (read-only for queries)
 */
async function checkRateLimitReadOnly(
  ctx: QueryCtx | MutationCtx,
  aid: string,
  tier: Tier
): Promise<boolean> {
  const now = Date.now();
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_aid", (q) => q.eq("aid", aid))
    .first();

  const defaultLimits: Record<Tier, number> = {
    unknown: 10, // Very restricted
    known: 100,
    verified: 1000,
  };

  const windowDuration = 60 * 60 * 1000; // 1 hour
  const limit = existing?.limit ?? defaultLimits[tier];

  if (!existing) return true;
  if (now - existing.windowStart > existing.windowDuration) return true;
  return existing.messagesInWindow < existing.limit;
}

/**
 * Increment rate limit counter (mutation-only)
 */
async function incrementRateLimit(
  ctx: MutationCtx,
  aid: string,
  tier: Tier
): Promise<boolean> {
  const now = Date.now();
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_aid", (q) => q.eq("aid", aid))
    .first();

  const defaultLimits: Record<Tier, number> = {
    unknown: 10,
    known: 100,
    verified: 1000,
  };

  const windowDuration = 60 * 60 * 1000;
  const limit = existing?.limit ?? defaultLimits[tier];

  if (!existing) {
    await ctx.db.insert("rateLimits", {
      aid,
      tier,
      windowStart: now,
      windowDuration,
      messagesInWindow: 1,
      limit,
    });
    return true;
  }

  if (now - existing.windowStart > existing.windowDuration) {
    await ctx.db.patch(existing._id, {
      windowStart: now,
      messagesInWindow: 1,
      tier,
      limit: defaultLimits[tier],
    });
    return true;
  }

  if (existing.messagesInWindow >= existing.limit) {
    return false;
  }

  await ctx.db.patch(existing._id, {
    messagesInWindow: existing.messagesInWindow + 1,
  });

  return true;
}

/**
 * Check if sender can send message to recipient
 *
 * ## Authorization Rules
 * - **unknown**: Can ONLY message active onboarding admins
 * - **known**: Can message anyone in the system
 * - **verified**: Full access
 */
export async function canSend(
  ctx: QueryCtx | MutationCtx,
  from: string,
  to: string,
  typ: string,
  incrementRate: boolean = false
): Promise<AuthzResult> {
  const tier = await getUserTier(ctx, from);

  // Check rate limit
  const withinLimits = incrementRate
    ? await incrementRateLimit(ctx as MutationCtx, from, tier)
    : await checkRateLimitReadOnly(ctx, from, tier);

  if (!withinLimits) {
    return {
      allowed: false,
      reason: `Rate limit exceeded for tier '${tier}'`,
      tier,
    };
  }

  // Tier-specific authorization
  if (tier === "unknown") {
    // Unknown users can message:
    // 1. Onboarding admins (always)
    // 2. Recipients matching authorization patterns (e.g., TEST* for dev/testing)

    const isAdmin = await isOnboardingAdmin(ctx, to);
    if (isAdmin) {
      return { allowed: true, tier };
    }

    // Check authorization patterns
    const matchesPattern = await matchesAnyPattern(ctx, to, tier);
    if (matchesPattern) {
      return { allowed: true, tier };
    }

    // No admin match, no pattern match → deny
    return {
      allowed: false,
      reason: "Unknown users can only message onboarding admins",
      tier,
    };
  }

  if (tier === "known") {
    // Known users can message anyone in the system
    return { allowed: true, tier };
  }

  // Verified tier: full access
  return { allowed: true, tier };
}

// ============================================================================
// ADMIN MUTATIONS (with authentication)
// ============================================================================

/**
 * Grant admin role (super_admin only)
 */
export const grantAdminRole = mutation({
  args: {
    targetAid: v.string(), // AID to grant role to
    role: v.string(), // "onboarding_admin" | "super_admin"
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    // Verify authentication
    const verified = await verifyAuth(ctx, args.auth, "admin", {
      action: "grantAdminRole",
      targetAid: args.targetAid,
      role: args.role,
    });

    // Check caller is super_admin
    const callerRole = await getAdminRole(ctx, verified.aid);
    if (callerRole !== "super_admin") {
      throw new Error("Only super_admin can grant admin roles");
    }

    const now = Date.now();

    // Check if role already exists
    const existing = await ctx.db
      .query("adminRoles")
      .withIndex("by_aid", (q) => q.eq("aid", args.targetAid))
      .filter((q) => q.eq(q.field("role"), args.role))
      .first();

    if (existing) {
      // Reactivate if inactive
      if (!existing.active) {
        await ctx.db.patch(existing._id, {
          active: true,
          grantedBy: verified.aid,
          grantedAt: now,
        });
      }
      return existing._id;
    }

    // Create new role
    return await ctx.db.insert("adminRoles", {
      aid: args.targetAid,
      role: args.role,
      grantedBy: verified.aid,
      grantedAt: now,
      active: true,
    });
  },
});

/**
 * Revoke admin role (super_admin only)
 */
export const revokeAdminRole = mutation({
  args: {
    targetAid: v.string(),
    role: v.string(),
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const verified = await verifyAuth(ctx, args.auth, "admin", {
      action: "revokeAdminRole",
      targetAid: args.targetAid,
      role: args.role,
    });

    const callerRole = await getAdminRole(ctx, verified.aid);
    if (callerRole !== "super_admin") {
      throw new Error("Only super_admin can revoke admin roles");
    }

    const roleRecord = await ctx.db
      .query("adminRoles")
      .withIndex("by_aid", (q) => q.eq("aid", args.targetAid))
      .filter((q) => q.eq(q.field("role"), args.role))
      .first();

    if (!roleRecord) {
      throw new Error("Role not found");
    }

    await ctx.db.patch(roleRecord._id, { active: false });
  },
});

/**
 * Add onboarding admin to whitelist (super_admin only)
 */
export const addOnboardingAdmin = mutation({
  args: {
    aid: v.string(),
    description: v.string(),
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const verified = await verifyAuth(ctx, args.auth, "admin", {
      action: "addOnboardingAdmin",
      aid: args.aid,
    });

    const callerRole = await getAdminRole(ctx, verified.aid);
    if (callerRole !== "super_admin") {
      throw new Error("Only super_admin can add onboarding admins");
    }

    const now = Date.now();

    const existing = await ctx.db
      .query("onboardingAdmins")
      .withIndex("by_aid", (q) => q.eq("aid", args.aid))
      .first();

    if (existing) {
      if (!existing.active) {
        await ctx.db.patch(existing._id, { active: true });
      }
      return existing._id;
    }

    return await ctx.db.insert("onboardingAdmins", {
      aid: args.aid,
      description: args.description,
      active: true,
      createdAt: now,
      addedBy: verified.aid,
    });
  },
});

/**
 * Remove onboarding admin from whitelist (super_admin only)
 */
export const removeOnboardingAdmin = mutation({
  args: {
    aid: v.string(),
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const verified = await verifyAuth(ctx, args.auth, "admin", {
      action: "removeOnboardingAdmin",
      aid: args.aid,
    });

    const callerRole = await getAdminRole(ctx, verified.aid);
    if (callerRole !== "super_admin") {
      throw new Error("Only super_admin can remove onboarding admins");
    }

    const admin = await ctx.db
      .query("onboardingAdmins")
      .withIndex("by_aid", (q) => q.eq("aid", args.aid))
      .first();

    if (!admin) {
      throw new Error("Onboarding admin not found");
    }

    await ctx.db.patch(admin._id, { active: false });
  },
});

/**
 * Onboard user (onboarding_admin or super_admin)
 * Promotes unknown → known with onboarding proof
 */
export const onboardUser = mutation({
  args: {
    userAid: v.string(), // AID to onboard
    onboardingProof: v.string(), // SAID reference to onboarding evidence
    notes: v.optional(v.string()),
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const verified = await verifyAuth(ctx, args.auth, "admin", {
      action: "onboardUser",
      userAid: args.userAid,
      onboardingProof: args.onboardingProof,
    });

    // Check caller has onboarding permission
    const callerRole = await getAdminRole(ctx, verified.aid);
    if (!callerRole) {
      throw new Error("Only admins can onboard users");
    }

    const now = Date.now();

    // Check current tier
    const currentTier = await getUserTier(ctx, args.userAid);
    if (currentTier !== "unknown") {
      throw new Error(`User is already tier '${currentTier}', cannot onboard`);
    }

    // Check if tier record exists
    const existing = await ctx.db
      .query("userTiers")
      .withIndex("by_aid", (q) => q.eq("aid", args.userAid))
      .first();

    if (existing) {
      // Update to known
      await ctx.db.patch(existing._id, {
        tier: "known",
        onboardingProof: args.onboardingProof,
        promotedBy: verified.aid,
        updatedAt: now,
        notes: args.notes,
      });
      return existing._id;
    }

    // Create new tier record
    return await ctx.db.insert("userTiers", {
      aid: args.userAid,
      tier: "known",
      onboardingProof: args.onboardingProof,
      promotedBy: verified.aid,
      updatedAt: now,
      notes: args.notes,
    });
  },
});

/**
 * Verify user (admin only)
 * Promotes known → verified (with KYC info)
 */
export const verifyUser = mutation({
  args: {
    userAid: v.string(),
    kycStatus: v.string(),
    kycProvider: v.string(),
    notes: v.optional(v.string()),
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const verified = await verifyAuth(ctx, args.auth, "admin", {
      action: "verifyUser",
      userAid: args.userAid,
    });

    const callerRole = await getAdminRole(ctx, verified.aid);
    if (!callerRole) {
      throw new Error("Only admins can verify users");
    }

    const now = Date.now();

    const currentTier = await getUserTier(ctx, args.userAid);
    if (currentTier === "verified") {
      throw new Error("User is already verified");
    }

    const tierRecord = await ctx.db
      .query("userTiers")
      .withIndex("by_aid", (q) => q.eq("aid", args.userAid))
      .first();

    if (!tierRecord) {
      throw new Error("User must be onboarded first (tier 'known')");
    }

    await ctx.db.patch(tierRecord._id, {
      tier: "verified",
      kycStatus: args.kycStatus,
      kycProvider: args.kycProvider,
      kycTimestamp: now,
      promotedBy: verified.aid,
      updatedAt: now,
      notes: args.notes,
    });

    return tierRecord._id;
  },
});

// ============================================================================
// QUERIES (for client-side checks)
// ============================================================================

export const checkCanSend = query({
  args: {
    from: v.string(),
    to: v.string(),
    typ: v.string(),
  },
  handler: async (ctx, args) => {
    return await canSend(ctx, args.from, args.to, args.typ, false);
  },
});

export const getUserTierInfo = query({
  args: {
    aid: v.string(),
  },
  handler: async (ctx, args) => {
    const tierRecord = await ctx.db
      .query("userTiers")
      .withIndex("by_aid", (q) => q.eq("aid", args.aid))
      .first();

    if (!tierRecord) {
      return { tier: "unknown", aid: args.aid };
    }

    return tierRecord;
  },
});

export const getAdminInfo = query({
  args: {
    aid: v.string(),
  },
  handler: async (ctx, args) => {
    const roles = await ctx.db
      .query("adminRoles")
      .withIndex("by_aid", (q) => q.eq("aid", args.aid))
      .filter((q) => q.eq(q.field("active"), true))
      .collect();

    const isOnboarding = await isOnboardingAdmin(ctx, args.aid);

    return {
      aid: args.aid,
      roles: roles.map((r) => r.role),
      isOnboardingAdmin: isOnboarding,
    };
  },
});

export const listOnboardingAdmins = query({
  args: {
    activeOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const query = ctx.db.query("onboardingAdmins");

    if (args.activeOnly) {
      return await query
        .withIndex("by_active", (q) => q.eq("active", true))
        .collect();
    }

    return await query.collect();
  },
});

export const getTierStats = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("userTiers").collect();

    return {
      unknown: 0, // Default tier, not in DB
      known: all.filter((t) => t.tier === "known").length,
      verified: all.filter((t) => t.tier === "verified").length,
      total: all.length,
    };
  },
});

/**
 * Add authorization pattern (super_admin only)
 */
export const addPattern = mutation({
  args: {
    pattern: v.string(),
    description: v.string(),
    appliesTo: v.string(), // "unknown" only for now
    priority: v.number(),
    expiresAt: v.optional(v.number()),
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    // Verify authentication
    const verified = await verifyAuth(ctx, args.auth, "admin_operation", {
      operation: "addPattern",
      pattern: args.pattern,
    });

    // Only super_admins can add patterns
    const role = await getAdminRole(ctx, verified.aid);
    if (role !== "super_admin") {
      throw new Error("Only super_admins can add authorization patterns");
    }

    // Validate regex
    try {
      new RegExp(args.pattern);
    } catch (err) {
      throw new Error(`Invalid regex pattern: ${args.pattern}`);
    }

    // Validate appliesTo
    if (args.appliesTo !== "unknown") {
      throw new Error("Currently only 'unknown' tier is supported for patterns");
    }

    // Check for duplicate pattern
    const existing = await ctx.db
      .query("authPatterns")
      .filter((q) => q.eq(q.field("pattern"), args.pattern))
      .first();

    if (existing) {
      throw new Error(`Pattern already exists: ${args.pattern}`);
    }

    const now = Date.now();
    await ctx.db.insert("authPatterns", {
      pattern: args.pattern,
      description: args.description,
      appliesTo: args.appliesTo,
      priority: args.priority,
      active: true,
      createdBy: verified.aid,
      createdAt: now,
      expiresAt: args.expiresAt,
    });

    return { success: true };
  },
});

/**
 * Bootstrap default TEST pattern (no auth required - for initial setup)
 * Should be called once during development setup
 */
export const bootstrapTestPattern = mutation({
  args: {},
  handler: async (ctx) => {
    // Check if TEST pattern already exists
    const existing = await ctx.db
      .query("authPatterns")
      .filter((q) => q.eq(q.field("pattern"), "^TEST"))
      .first();

    if (existing) {
      return { message: "TEST pattern already exists", patternId: existing._id };
    }

    // Add default TEST pattern
    const patternId = await ctx.db.insert("authPatterns", {
      pattern: "^TEST",
      description: "Allow messaging to test identities (development/testing only)",
      appliesTo: "unknown",
      priority: 100,
      active: true,
      createdBy: "SYSTEM",
      createdAt: Date.now(),
    });

    return { message: "TEST pattern created", patternId };
  },
});

/**
 * List all authorization patterns
 */
export const listPatterns = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("authPatterns")
      .order("desc") // Most recent first
      .collect();
  },
});
