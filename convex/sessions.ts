/**
 * Session Token Management (Phase 4)
 *
 * Implements short-lived bearer tokens for streaming operations.
 * Eliminates repeated signing for watch/subscribe workflows.
 *
 * Security properties:
 * - Short-lived (max 60s)
 * - Scoped to specific operations
 * - KSN-bound (invalidated on key rotation)
 * - Cryptographically random
 */

import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { verifyAuth } from "./auth";
import { resolveUserClaims } from "./permissions";

/**
 * Generate cryptographically secure random token
 * Returns 64-byte hex string (128 characters)
 */
function generateSecureToken(): string {
  // In Convex, we can use crypto.randomUUID() or generate random bytes
  // For maximum security, use 64 random bytes
  const randomBytes = new Uint8Array(64);
  crypto.getRandomValues(randomBytes);
  return Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Phase 4: Open authenticated session for streaming operations
 *
 * Creates a short-lived bearer token that can be reused for multiple
 * operations without signing. Token is scoped to specific purposes
 * and bound to AID + KSN.
 *
 * Security checks:
 * - Verifies auth proof with purpose "openSession"
 * - Enforces max TTL of 60 seconds
 * - Binds token to current KSN (invalidated on key rotation)
 * - Stores challenge ID for audit trail
 *
 * @param aid - AID requesting the session token
 * @param scopes - Operations allowed (e.g., ["receive", "ack"])
 * @param ttlMs - Token lifetime in milliseconds (max 60000)
 * @param auth - Authentication proof with purpose "openSession"
 * @returns Session token and expiry timestamp
 */
export const openSession = mutation({
  args: {
    aid: v.string(),
    scopes: v.array(v.string()),
    ttlMs: v.number(),
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, { aid, scopes, ttlMs, auth }) => {
    const now = Date.now();

    // Enforce max TTL of 60 seconds
    if (ttlMs > 60000) {
      throw new Error("Session token TTL cannot exceed 60 seconds");
    }

    // Verify authentication with purpose "openSession"
    const verified = await verifyAuth(ctx, auth, "openSession", {
      scopes,
      ttlMs,
    });

    // Ensure authenticated AID matches requested AID
    if (verified.aid !== aid) {
      throw new Error(
        `Auth AID mismatch: authenticated as ${verified.aid}, requested ${aid}`
      );
    }

    // Validate scopes
    const validScopes = ["receive", "ack"];
    for (const scope of scopes) {
      if (!validScopes.includes(scope)) {
        throw new Error(`Invalid scope: ${scope}. Must be one of: ${validScopes.join(", ")}`);
      }
    }

    // Generate cryptographically secure token
    const token = generateSecureToken();
    const expiresAt = now + ttlMs;

    // Resolve and embed claims
    const claims = await resolveUserClaims(ctx, verified.aid);

    // Store token in database with claims
    await ctx.db.insert("sessionTokens", {
      token,
      aid: verified.aid,
      ksn: verified.ksn,
      scopes,
      claims,
      createdAt: now,
      expiresAt,
      usedChallengeId: auth.challengeId,
      useCount: 0,
    });

    return {
      token,
      expiresAt,
    };
  },
});

/**
 * Validate session token and return associated AID and scopes
 *
 * Internal helper used by mutations that accept session tokens.
 * Performs security checks:
 * - Token exists
 * - Not expired
 * - KSN matches current state (key rotation check)
 * - Scope matches requested operation
 *
 * Updates lastUsedAt and useCount for audit trail.
 *
 * @param ctx - Convex context
 * @param token - Session token string
 * @param requiredScope - Operation being performed (e.g., "receive", "ack")
 * @returns Validated session info
 * @throws Error if token is invalid, expired, or lacks required scope
 */
export async function validateSessionToken(
  ctx: any,
  token: string,
  requiredScope: string
): Promise<{
  aid: string;
  ksn: number;
  sessionId: any;
  claims: { key: string; data?: any }[];
}> {
  const now = Date.now();

  // Look up token
  const session = await ctx.db
    .query("sessionTokens")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .first();

  if (!session) {
    throw new Error("Invalid session token");
  }

  // Check expiration
  if (session.expiresAt < now) {
    throw new Error("Session token expired");
  }

  // Verify scope
  if (!session.scopes.includes(requiredScope)) {
    throw new Error(
      `Session token lacks required scope: ${requiredScope}. Has: ${session.scopes.join(", ")}`
    );
  }

  // Get current key state to verify KSN
  const keyState = await ctx.db
    .query("keyStates")
    .withIndex("by_aid", (q: any) => q.eq("aid", session.aid))
    .first();

  if (!keyState) {
    throw new Error(`No key state found for AID: ${session.aid}`);
  }

  // CRITICAL: Verify KSN matches (invalidate on key rotation)
  if (keyState.ksn !== session.ksn) {
    throw new Error(
      `Session token invalidated by key rotation. Token KSN: ${session.ksn}, Current KSN: ${keyState.ksn}`
    );
  }

  // Update audit trail
  await ctx.db.patch(session._id, {
    lastUsedAt: now,
    useCount: session.useCount + 1,
  });

  return {
    aid: session.aid,
    ksn: session.ksn,
    sessionId: session._id,
    claims: session.claims ?? [],
  };
}

/**
 * Cleanup expired session tokens
 *
 * Should be called periodically (e.g., via cron) to remove
 * expired tokens from the database.
 */
export const cleanupExpiredTokens = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Find all expired tokens
    const expiredTokens = await ctx.db
      .query("sessionTokens")
      .withIndex("by_expiration")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();

    // Delete them
    for (const token of expiredTokens) {
      await ctx.db.delete(token._id);
    }

    return {
      deleted: expiredTokens.length,
    };
  },
});

/**
 * Revoke all session tokens for an AID
 *
 * Used when:
 * - AID rotates keys (KSN increment)
 * - User explicitly logs out
 * - Security incident
 */
export const revokeTokensForAid = mutation({
  args: {
    aid: v.string(),
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, { aid, auth }) => {
    // Verify authentication
    const verified = await verifyAuth(ctx, auth, "admin", {
      action: "revokeTokens",
      targetAid: aid,
    });

    // Only allow revoking own tokens or admin operation
    if (verified.aid !== aid) {
      // Check if authenticated AID is admin
      // For now, just allow self-revocation
      throw new Error("Can only revoke your own session tokens");
    }

    // Find all tokens for this AID
    const tokens = await ctx.db
      .query("sessionTokens")
      .withIndex("by_aid", (q: any) => q.eq("aid", aid))
      .collect();

    // Delete them
    for (const token of tokens) {
      await ctx.db.delete(token._id);
    }

    return {
      revoked: tokens.length,
    };
  },
});

/**
 * Phase 4: Refresh session token for active subscription
 *
 * Allows updating session token mid-stream without tearing down
 * the WebSocket connection. Used for long-lived watch sessions.
 *
 * Note: This is a placeholder. The actual implementation requires
 * WebSocket state management which depends on the Convex transport layer.
 * For now, this is a no-op that validates the new token.
 */
export const refreshSessionToken = mutation({
  args: {
    forAid: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, { forAid, sessionToken }) => {
    // Validate the new session token
    const session = await validateSessionToken(ctx, sessionToken, "receive");

    // Verify it's for the correct AID
    if (session.aid !== forAid) {
      throw new Error(
        `Session token AID mismatch: token is for ${session.aid}, but subscription is for ${forAid}`
      );
    }

    // In a real implementation, we would update the WebSocket subscription
    // to use the new token. For now, just validate it.

    return {
      success: true,
      expiresAt: (
        await ctx.db.get(session.sessionId)
      )?.expiresAt,
    };
  },
});
