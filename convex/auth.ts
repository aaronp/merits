import { v } from 'convex/values';
import {
  base64UrlToUint8Array,
  computeArgsHash as coreComputeArgsHash,
  decodeCESRKey,
  sha256Hex,
  uint8ArrayToBase64Url,
  verify,
} from '../core/crypto';
import { verifyMutationSignature } from '../core/signatures';
import type { SignedRequest } from '../core/types';
import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { AlreadyExistsError, ChallengeError, NotFoundError, SignatureError, ValidationError } from './errors';

/**
 * KERI Key State
 */
export type KeyState = {
  aid: string;
  ksn: number;
  keys: string[];
  threshold: string;
  lastEvtSaid: string;
  updatedAt: number;
};

/**
 * Compute SHA256 hash of arguments to bind challenge to specific operation
 */
function computeArgsHash(args: Record<string, any>): string {
  return coreComputeArgsHash(args);
}

/**
 * Compute content hash (for ct binding)
 */
export function computeCtHash(ct: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(ct);
  return sha256Hex(data);
}

/**
 * Compute envelope hash (audit anchor)
 *
 * Uses canonical deterministic JSON with fixed field order and versioning.
 * NOTE: This uses server-computed timestamps (createdAt, expiresAt) since it's
 * computed AFTER authentication, not during the challenge binding.
 */
export function computeEnvelopeHash(
  recpAid: string,
  senderAid: string,
  ctHash: string,
  alg: string | undefined,
  ek: string | undefined,
  createdAt: number,
  expiresAt: number,
): string {
  // Canonical envelope with version (deterministic order)
  const envelope = {
    ver: 'envelope/1',
    recpAid,
    senderAid,
    ctHash,
    alg: alg ?? '',
    ek: ek ?? '',
    createdAt,
    expiresAt,
  };
  // Deterministic JSON: sorted keys, no whitespace
  const canonical = JSON.stringify(envelope, Object.keys(envelope).sort());
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);
  return sha256Hex(data);
}

/**
 * Resolve and cache key state for an AID
 *
 * In production, this should resolve via OOBI/resolver.
 * For now, we cache key states with 60s TTL.
 */
export async function ensureKeyState(ctx: MutationCtx | QueryCtx, aid: string): Promise<KeyState> {
  const now = Date.now();
  const TTL = 60_000; // 60 seconds

  // Check cache
  const cached = await ctx.db
    .query('keyStates')
    .withIndex('by_aid', (q) => q.eq('aid', aid))
    .first();

  if (cached && cached.updatedAt > now - TTL) {
    return {
      aid: cached.aid,
      ksn: cached.ksn,
      keys: cached.keys,
      threshold: cached.threshold,
      lastEvtSaid: cached.lastEvtSaid,
      updatedAt: cached.updatedAt,
    };
  }

  // TODO: In production, resolve via OOBI/resolver
  // For now, throw error requiring explicit key state registration
  throw new NotFoundError('Key state', aid, {
    hint: 'Register the key state first using create-user or registerKeyState',
    aid,
  });
}

/**
 * Register or update key state for an AID (admin/setup function)
 */
export const registerKeyState = mutation({
  args: {
    aid: v.string(),
    ksn: v.number(),
    keys: v.array(v.string()),
    threshold: v.string(),
    lastEvtSaid: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const existing = await ctx.db
      .query('keyStates')
      .withIndex('by_aid', (q) => q.eq('aid', args.aid))
      .first();

    console.log('[REGISTER-KEY-STATE] AID:', args.aid);
    console.log('[REGISTER-KEY-STATE] Keys being registered:', args.keys);
    if (existing) {
      console.log('[REGISTER-KEY-STATE] Updating existing key state');
      console.log('[REGISTER-KEY-STATE] Old keys:', existing.keys);
      await ctx.db.patch(existing._id, {
        ksn: args.ksn,
        keys: args.keys,
        threshold: args.threshold,
        lastEvtSaid: args.lastEvtSaid,
        updatedAt: now,
      });
      console.log('[REGISTER-KEY-STATE] Updated keys:', args.keys);
      return existing._id;
    } else {
      console.log('[REGISTER-KEY-STATE] Creating new key state');
      return await ctx.db.insert('keyStates', {
        aid: args.aid,
        ksn: args.ksn,
        keys: args.keys,
        threshold: args.threshold,
        lastEvtSaid: args.lastEvtSaid,
        updatedAt: now,
      });
    }
  },
});

/**
 * Decode CESR-encoded key to raw bytes
 *
 * Simplified CESR for testing: just 'D' prefix + base64url(publicKey)
 * Production CESR would use proper lead-byte padding, but for now we keep it simple.
 */
// Crypto helper functions are now imported from core/crypto.ts
// All using @noble/ed25519 instead of Web Crypto API

/**
 * Verify KERI indexed signatures against key state
 *
 * @param payload - Canonical payload that was signed
 * @param sigs - Array of indexed signatures (format: "idx-base64url")
 * @param keyState - Current key state with keys and threshold
 * @returns true if signatures meet threshold, false otherwise
 */
async function verifyIndexedSigs(payload: Record<string, any>, sigs: string[], keyState: KeyState): Promise<boolean> {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);

  const uint8ArrayToHex = (bytes: Uint8Array): string => {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  };

  // DEBUG: Log verification details
  console.log('[VERIFY-INDEXED] Payload bytes (hex):', uint8ArrayToHex(data));
  console.log('[VERIFY-INDEXED] Key state keys:', keyState.keys);
  console.log('[VERIFY-INDEXED] Threshold:', keyState.threshold);
  console.log('[VERIFY-INDEXED] Signatures to verify:', sigs);

  const threshold = parseInt(keyState.threshold, 16);
  let validSigs = 0;

  for (const sig of sigs) {
    // Parse indexed signature: "idx-signature"
    // Split on first hyphen only, as base64url may contain hyphens
    const hyphenIndex = sig.indexOf('-');
    if (hyphenIndex === -1) {
      console.error('[VERIFY-INDEXED] Invalid signature format (no hyphen):', sig);
      continue; // Invalid format
    }

    const idxStr = sig.substring(0, hyphenIndex);
    const sigB64 = sig.substring(hyphenIndex + 1);
    const idx = parseInt(idxStr, 10);

    console.log('[VERIFY-INDEXED] Parsed signature - index:', idx, 'sig (base64url):', sigB64);

    if (idx >= keyState.keys.length) {
      console.error('[VERIFY-INDEXED] Invalid index:', idx, 'keyState.keys.length:', keyState.keys.length);
      continue; // Invalid index
    }

    const sigBytes = base64UrlToUint8Array(sigB64);
    const keyBytes = decodeCESRKey(keyState.keys[idx]);

    console.log('[VERIFY-INDEXED] Signature bytes (hex):', uint8ArrayToHex(sigBytes));
    console.log('[VERIFY-INDEXED] Public key bytes (hex):', uint8ArrayToHex(keyBytes));
    console.log('[VERIFY-INDEXED] Public key CESR:', keyState.keys[idx]);

    try {
      const valid = await verify(sigBytes, data, keyBytes);
      console.log('[VERIFY-INDEXED] Verification result:', valid);
      if (valid) {
        validSigs++;
      } else {
        console.error('[VERIFY-INDEXED] Signature verification returned false');
      }
    } catch (error) {
      console.error('[VERIFY-INDEXED] Verification error:', error);
    }
  }

  console.log('[VERIFY-INDEXED] Valid signatures:', validSigs, 'Threshold:', threshold);
  return validSigs >= threshold;
}

/**
 * Issue a challenge for authentication
 */
export const issueChallenge = mutation({
  args: {
    aid: v.string(),
    purpose: v.string(), // "send" | "receive" | "ack"
    argsHash: v.string(),
    ttl: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const ttl = args.ttl ?? 120_000; // Default 120 seconds
    const expiresAt = now + ttl;

    // Verify AID has registered key state
    await ensureKeyState(ctx, args.aid);

    const nonce = crypto.randomUUID();

    const challengeId = await ctx.db.insert('challenges', {
      aid: args.aid,
      purpose: args.purpose,
      argsHash: args.argsHash,
      nonce,
      createdAt: now,
      expiresAt,
      used: false,
    });

    // Canonical payload for KERI signing (with version and audience)
    const payload = {
      ver: 'msg-auth/1', // Payload schema version
      aud: 'https://merits-convex.app', // Audience - your server origin
      ts: now,
      nonce,
      aid: args.aid,
      purpose: args.purpose,
      argsHash: args.argsHash,
    };

    return { challengeId, payload };
  },
});

/**
 * Prove challenge by providing signatures
 */
export const proveChallenge = mutation({
  args: {
    challengeId: v.id('challenges'),
    sigs: v.array(v.string()),
    ksn: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Fetch challenge
    const challenge = await ctx.db.get(args.challengeId);
    if (!challenge) {
      throw new NotFoundError('Challenge', args.challengeId, {
        hint: 'The challenge may have expired or been used already',
      });
    }

    if (challenge.used) {
      throw new ChallengeError('Challenge already used', {
        challengeId: args.challengeId,
        hint: 'Request a new challenge to authenticate',
      });
    }

    if (challenge.expiresAt < now) {
      throw new ChallengeError('Challenge expired', {
        challengeId: args.challengeId,
        expiresAt: challenge.expiresAt,
        now,
        hint: 'Request a new challenge to authenticate',
      });
    }

    // Fetch key state
    const keyState = await ensureKeyState(ctx, challenge.aid);

    // Verify KSN is not ahead of current state (prevent future key use)
    if (args.ksn > keyState.ksn) {
      throw new ValidationError('ksn', 'KSN ahead of current state', {
        providedKsn: args.ksn,
        currentKsn: keyState.ksn,
        hint: 'Use the current key sequence number',
      });
    }

    // Reconstruct payload - use the original timestamp from when challenge was issued
    const payload = {
      nonce: challenge.nonce,
      aid: challenge.aid,
      purpose: challenge.purpose,
      argsHash: challenge.argsHash,
      aud: 'merits-convex',
      ts: challenge.createdAt,
    };

    // Verify signatures
    const valid = await verifyIndexedSigs(payload, args.sigs, keyState);
    if (!valid) {
      throw new SignatureError('Invalid signatures or threshold not met', {
        aid: challenge.aid,
        ksn: args.ksn,
        threshold: keyState.threshold,
        providedSignatures: args.sigs.length,
        hint: "Verify that you're signing with the correct private key",
      });
    }

    // Mark challenge as used
    await ctx.db.patch(args.challengeId, { used: true });

    // Return auth token (in production, sign this with server key)
    // For now, return proof of authentication
    return {
      authenticated: true,
      aid: challenge.aid,
      purpose: challenge.purpose,
      argsHash: challenge.argsHash,
    };
  },
});

/**
 * Verify auth for a mutation/query
 *
 * @param ctx - Mutation or query context
 * @param auth - Auth object with challengeId and sigs
 * @param expectedPurpose - Expected purpose ("send" | "receive" | "ack")
 * @param args - Arguments to hash and verify
 * @returns Verification result with AID, KSN, and event SAID
 */
export async function verifyAuth(
  ctx: MutationCtx,
  auth: { challengeId: Id<'challenges'>; sigs: string[]; ksn: number },
  expectedPurpose: string,
  args: Record<string, any>,
): Promise<{
  aid: string;
  ksn: number;
  evtSaid: string;
  challengeId: Id<'challenges'>;
}> {
  const now = Date.now();

  // Fetch challenge
  const challenge = await ctx.db.get(auth.challengeId);
  if (!challenge) {
    throw new NotFoundError('Challenge', auth.challengeId, {
      hint: 'The challenge may have expired or been used already',
    });
  }

  if (challenge.used) {
    throw new ChallengeError('Challenge already used', {
      challengeId: auth.challengeId,
      hint: 'Request a new challenge to authenticate',
    });
  }

  if (challenge.expiresAt < now) {
    throw new ChallengeError('Challenge expired', {
      challengeId: auth.challengeId,
      expiresAt: challenge.expiresAt,
      now,
      hint: 'Request a new challenge to authenticate',
    });
  }

  // Enforce timestamp skew (max 2 minutes)
  const MAX_SKEW = 2 * 60 * 1000;
  const skew = Math.abs(now - challenge.createdAt);
  if (skew > MAX_SKEW) {
    throw new ChallengeError('Challenge timestamp skew too large', {
      challengeCreatedAt: challenge.createdAt,
      now,
      skew,
      maxSkew: MAX_SKEW,
      hint: 'Check system clock synchronization',
    });
  }

  if (challenge.purpose !== expectedPurpose) {
    throw new ValidationError('purpose', 'Purpose mismatch', {
      expected: expectedPurpose,
      actual: challenge.purpose,
      hint: `This challenge was created for '${challenge.purpose}', not '${expectedPurpose}'`,
    });
  }

  // Verify argsHash matches (ALWAYS recompute server-side)
  const argsHash = await computeArgsHash(args);
  if (challenge.argsHash !== argsHash) {
    throw new ValidationError('argsHash', 'Arguments hash mismatch', {
      expected: challenge.argsHash,
      actual: argsHash,
      hint: 'The signed challenge does not match the provided arguments',
    });
  }

  // Fetch key state
  const keyState = await ensureKeyState(ctx, challenge.aid);

  // Verify KSN (only allow current KSN for strict verification)
  if (auth.ksn !== keyState.ksn) {
    throw new ValidationError('ksn', 'KSN mismatch', {
      expected: keyState.ksn,
      actual: auth.ksn,
      hint: 'Use the current key sequence number',
    });
  }

  // Reconstruct canonical payload (MUST match what client signed)
  const payload = {
    ver: 'msg-auth/1',
    aud: 'https://merits-convex.app',
    ts: challenge.createdAt,
    nonce: challenge.nonce,
    aid: challenge.aid,
    purpose: challenge.purpose,
    argsHash: challenge.argsHash,
  };

  // DEBUG: Log payload being verified
  console.log('[VERIFY-AUTH] Payload being verified:', JSON.stringify(payload, null, 2));
  const sortedKeys = Object.keys(payload).sort();
  const canonical = JSON.stringify(payload, sortedKeys);
  console.log('[VERIFY-AUTH] Canonical payload (sorted keys):', canonical);
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);
  const uint8ArrayToHex = (bytes: Uint8Array): string => {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  };
  console.log('[VERIFY-AUTH] Payload bytes (hex):', uint8ArrayToHex(data));

  // Verify signatures
  console.log('[VERIFY-AUTH] About to call verifyIndexedSigs');
  console.log('[VERIFY-AUTH] Payload:', JSON.stringify(payload, null, 2));
  console.log('[VERIFY-AUTH] Auth sigs:', auth.sigs);
  console.log('[VERIFY-AUTH] Key state:', JSON.stringify(keyState, null, 2));

  const valid = await verifyIndexedSigs(payload, auth.sigs, keyState);
  console.log('[VERIFY-AUTH] verifyIndexedSigs returned:', valid);

  if (!valid) {
    console.error('[VERIFY-AUTH] Signature verification FAILED');
    console.error('[VERIFY-AUTH] Challenge:', JSON.stringify(challenge, null, 2));
    console.error('[VERIFY-AUTH] Auth:', JSON.stringify(auth, null, 2));
    throw new SignatureError('Invalid signatures or threshold not met', {
      aid: challenge.aid,
      ksn: auth.ksn,
      threshold: keyState.threshold,
      providedSignatures: auth.sigs.length,
      hint: "Verify that you're signing with the correct private key and the payload matches",
    });
  }

  // Mark challenge as used
  await ctx.db.patch(auth.challengeId, { used: true });

  // Return verified AID and key state info (NEVER trust client values!)
  return {
    aid: challenge.aid,
    ksn: keyState.ksn,
    evtSaid: keyState.lastEvtSaid,
    challengeId: auth.challengeId,
  };
}

/**
 * Verify signed request (replaces session tokens)
 *
 * Verifies per-request signatures for Convex mutations.
 * Checks:
 * - Signature is cryptographically valid
 * - Timestamp within acceptable skew (±5 minutes)
 * - Nonce hasn't been seen before (replay protection)
 * - Public key exists and is active
 *
 * @param ctx - Mutation context
 * @param args - Full mutation arguments (must include 'sig' field)
 * @returns Verified AID and key state info
 * @throws SignatureError if signature invalid
 * @throws ValidationError if timestamp/nonce invalid
 *
 * @example
 * ```typescript
 * // In a mutation
 * const { aid, ksn } = await verifySignedRequest(ctx, args);
 * // Now use verified AID for authorization checks
 * ```
 */
export async function verifySignedRequest(
  ctx: MutationCtx,
  args: Record<string, any>,
): Promise<{
  aid: string;
  ksn: number;
  evtSaid: string;
}> {
  const sig = args.sig as SignedRequest | undefined;

  if (!sig) {
    throw new ValidationError('sig', 'No signature in request', {
      hint: "All authenticated mutations require a 'sig' field with SignedRequest data",
    });
  }

  // Fetch key state for the signer
  const keyState = await ensureKeyState(ctx, sig.keyId);

  // Get public key (first key in key state)
  if (!keyState.keys[0]) {
    throw new NotFoundError('Public key', sig.keyId, {
      hint: 'No keys registered for this AID',
    });
  }

  const publicKeyBytes = decodeCESRKey(keyState.keys[0]);
  const publicKeyCESR = keyState.keys[0];

  // Helper to convert Uint8Array to hex (Convex-compatible, no Buffer)
  const uint8ArrayToHex = (bytes: Uint8Array): string => {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  };

  // DEBUG: Log verification attempt (always log on server for debugging)
  console.log('[VERIFY-SERVER] Verifying signature for AID:', sig.keyId);
  console.log('[VERIFY-SERVER] Args keys:', Object.keys(args).sort());
  console.log('[VERIFY-SERVER] Args (full):', JSON.stringify(args, null, 2));
  console.log('[VERIFY-SERVER] Sig object:', JSON.stringify(sig, null, 2));
  console.log('[VERIFY-SERVER] Public key CESR:', publicKeyCESR);
  console.log('[VERIFY-SERVER] Public key bytes (base64url):', uint8ArrayToBase64Url(publicKeyBytes));
  console.log('[VERIFY-SERVER] Public key bytes (hex):', uint8ArrayToHex(publicKeyBytes));

  // Verify signature (throws on invalid signature or timestamp skew)
  let valid: boolean;
  try {
    valid = await verifyMutationSignature(args, publicKeyBytes, 5 * 60 * 1000);
  } catch (error: any) {
    // Log detailed error information
    console.error('[VERIFY-SERVER] Signature verification threw error:', error);
    // Helper to convert Uint8Array to hex (Convex-compatible, no Buffer)
    const uint8ArrayToHex = (bytes: Uint8Array): string => {
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    };

    console.error('[VERIFY-SERVER] Error message:', error?.message);
    console.error('[VERIFY-SERVER] Args received:', JSON.stringify(args, null, 2));
    console.error('[VERIFY-SERVER] Sig received:', JSON.stringify(sig, null, 2));
    console.error('[VERIFY-SERVER] Public key CESR:', publicKeyCESR);
    console.error('[VERIFY-SERVER] Public key bytes (hex):', uint8ArrayToHex(publicKeyBytes));
    throw new SignatureError('Signature verification failed', {
      aid: sig.keyId,
      timestamp: sig.timestamp,
      hint: `Signature verification error: ${error?.message || 'Unknown error'}`,
    });
  }

  if (!valid) {
    // Log failure details (always log on server for debugging)
    // Helper to convert Uint8Array to hex (Convex-compatible, no Buffer)
    const uint8ArrayToHex = (bytes: Uint8Array): string => {
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    };

    console.error('[VERIFY-SERVER] Signature verification FAILED (returned false)');
    console.error('[VERIFY-SERVER] Args:', JSON.stringify(args, null, 2));
    console.error('[VERIFY-SERVER] Sig:', JSON.stringify(sig, null, 2));
    console.error('[VERIFY-SERVER] Public key CESR:', publicKeyCESR);
    console.error('[VERIFY-SERVER] Public key bytes (hex):', uint8ArrayToHex(publicKeyBytes));
    throw new SignatureError('Signature verification failed', {
      aid: sig.keyId,
      timestamp: sig.timestamp,
      hint: 'Signature does not match the provided arguments',
    });
  }

  if (process.env.DEBUG_SIGNATURES === 'true') {
    console.log('[VERIFY-SERVER] Signature verification SUCCESS');
  }

  // Check nonce replay (prevent reuse of signatures)
  const now = Date.now();
  const NONCE_TTL = 10 * 60 * 1000; // 10 minutes

  // Look for existing nonce in the last 10 minutes
  const existingNonce = await ctx.db
    .query('usedNonces')
    .withIndex('by_keyId_nonce', (q) => q.eq('keyId', sig.keyId).eq('nonce', sig.nonce))
    .first();

  if (existingNonce) {
    throw new ValidationError('nonce', 'Nonce already used (replay detected)', {
      nonce: sig.nonce,
      keyId: sig.keyId,
      previousUse: existingNonce.usedAt,
      hint: 'Each request must have a unique nonce. This appears to be a replayed request.',
    });
  }

  // Store nonce to prevent replay
  await ctx.db.insert('usedNonces', {
    keyId: sig.keyId,
    nonce: sig.nonce,
    usedAt: now,
    expiresAt: now + NONCE_TTL,
  });

  // Return verified identity info
  return {
    aid: sig.keyId,
    ksn: keyState.ksn,
    evtSaid: keyState.lastEvtSaid,
  };
}

/**
 * Get key state for an identity
 */
export const getKeyState = query({
  args: {
    aid: v.string(),
  },
  handler: async (ctx, { aid }) => {
    return await ctx.db
      .query('keyStates')
      .withIndex('by_aid', (q) => q.eq('aid', aid))
      .first();
  },
});

/**
 * Compute args hash (helper for clients)
 */
export const computeHash = query({
  args: {
    args: v.any(),
  },
  handler: async (_ctx, { args }) => {
    return await computeArgsHash(args);
  },
});

/**
 * Cleanup expired challenges (can be called periodically)
 */
export const cleanupExpiredChallenges = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const expiredChallenges = await ctx.db
      .query('challenges')
      .withIndex('by_expiration')
      .filter((q) => q.lt(q.field('expiresAt'), now))
      .collect();

    for (const ch of expiredChallenges) {
      await ctx.db.delete(ch._id);
    }

    return { deleted: expiredChallenges.length };
  },
});

/**
 * Register a new user (AID + publicKey) after proving control via challenge
 */
export const registerUser = mutation({
  args: {
    aid: v.string(),
    publicKey: v.string(),
    auth: v.object({
      challengeId: v.id('challenges'),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Verify authentication with purpose "registerUser"
    await verifyAuth(ctx as any, args.auth, 'registerUser', {
      aid: args.aid,
      publicKey: args.publicKey,
    });

    // Ensure user doesn't already exist
    const existing = await ctx.db
      .query('users')
      .withIndex('by_aid', (q) => q.eq('aid', args.aid))
      .first();
    if (existing) {
      throw new AlreadyExistsError('User', args.aid, {
        hint: 'Use sign-in to authenticate with an existing user',
      });
    }

    // Insert user
    await ctx.db.insert('users', {
      aid: args.aid,
      publicKey: args.publicKey,
      createdAt: now,
    });

    // Assign default role 'anon' - create role if it doesn't exist
    let anonRole = await ctx.db
      .query('roles')
      .withIndex('by_roleName', (q) => q.eq('roleName', 'anon'))
      .first();

    if (!anonRole) {
      // Create anon role if it doesn't exist (should be created by bootstrap, but handle gracefully)
      console.log(`[REGISTER-USER] 'anon' role not found, creating it for user ${args.aid}`);
      const roleId = await ctx.db.insert('roles', {
        roleName: 'anon',
        adminAID: 'SYSTEM',
        actionSAID: 'registerUser/auto-create',
        timestamp: now,
      });
      anonRole = await ctx.db.get(roleId);
    }

    if (anonRole) {
      await ctx.db.insert('userRoles', {
        userAID: args.aid,
        roleId: anonRole._id,
        adminAID: 'SYSTEM',
        actionSAID: 'bootstrap/auto-assign',
        timestamp: now,
      });
      console.log(`[REGISTER-USER] Assigned 'anon' role to user ${args.aid}`);
    } else {
      console.error(`[REGISTER-USER] ERROR: Failed to create or find 'anon' role for user ${args.aid}`);
    }

    // Best-effort: add user to onboarding group if present
    const onboardingGroup = await ctx.db
      .query('groupChats')
      .withIndex('by_tag', (q) => q.eq('tag', 'onboarding'))
      .first();
    if (onboardingGroup) {
      // Check if user is already a member (shouldn't happen, but be defensive)
      const existingMembership = await ctx.db
        .query('groupMembers')
        .withIndex('by_group_aid', (q) => q.eq('groupChatId', onboardingGroup._id).eq('aid', args.aid))
        .first();
      if (!existingMembership) {
        // Get current max seqNo so new members only see NEW messages
        const allMessages = await ctx.db
          .query('groupMessages')
          .withIndex('by_group_seq', (q) => q.eq('groupChatId', onboardingGroup._id))
          .collect();
        const currentSeqNo = allMessages.length > 0 ? Math.max(...allMessages.map((m) => m.seqNo)) : -1;

        await ctx.db.insert('groupMembers', {
          groupChatId: onboardingGroup._id,
          aid: args.aid,
          latestSeqNo: currentSeqNo, // Start from current seqNo, so they only see NEW messages
          joinedAt: now,
          role: 'member',
        });
      }
    }

    return { aid: args.aid };
  },
});

/**
 * Helper query: get AID for a given challengeId
 *
 * Note: This does NOT verify signatures or mark the challenge as used.
 * It is intended for read-only contexts (e.g., queries) that need to know
 * the caller's AID to perform authorization checks.
 */
export const getAidForChallenge = query({
  args: {
    challengeId: v.id('challenges'),
  },
  handler: async (ctx, { challengeId }) => {
    const challenge = await ctx.db.get(challengeId);
    if (!challenge) {
      throw new Error('Challenge not found');
    }
    return { aid: challenge.aid };
  },
});

/**
 * Get public key for any AID
 *
 * Returns the Ed25519 public key for a given AID along with key state information.
 * Public keys are public information - no authentication required.
 *
 * Use Cases:
 * 1. Direct message encryption: Fetch recipient's public key before sending
 * 2. Signature verification: Verify signatures on messages
 * 3. Key discovery: CLI `key-for` command to display user's public key
 * 4. Group encryption: Already handled by groups.getMembers() for efficiency
 *
 * Public Key Usage:
 * - Ed25519 public key in base64url format
 * - Can be converted to X25519 for ECDH key agreement
 * - Used for both encryption (via ECDH) and signature verification
 *
 * Key State:
 * - ksn (Key Sequence Number): Tracks key rotations
 * - updatedAt: Timestamp of last key update
 * - If no key state exists, returns ksn=0 and createdAt timestamp
 *
 * Security:
 * - No authentication required (public keys are public)
 * - Returns current active key only (historical keys not exposed)
 * - Key rotation tracked via KERI key events
 *
 * @param aid - The AID to get the public key for
 *
 * @returns Object containing:
 *   - aid: The AID
 *   - publicKey: Ed25519 public key (base64url)
 *   - ksn: Key sequence number (0 if no rotations)
 *   - updatedAt: Timestamp of last key update
 *
 * @throws Error if user not found for the given AID
 *
 * @see schema.ts users and keyStates tables
 * @see registerUser() for key registration
 * @see cli/lib/crypto-group.ts for key usage in encryption
 */
export const getPublicKey = query({
  args: {
    aid: v.string(),
  },
  handler: async (ctx, { aid }) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_aid', (q) => q.eq('aid', aid))
      .first();

    if (!user) {
      throw new NotFoundError('User', aid, {
        hint: 'The user must be registered before you can fetch their public key',
      });
    }

    // Also fetch key state for additional context
    const keyState = await ctx.db
      .query('keyStates')
      .withIndex('by_aid', (q) => q.eq('aid', aid))
      .first();

    return {
      aid: user.aid,
      publicKey: user.publicKey, // Ed25519 public key (base64url)
      ksn: keyState?.ksn ?? 0, // Key sequence number
      updatedAt: keyState?.updatedAt ?? user.createdAt,
    };
  },
});
