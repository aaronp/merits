/**
 * ConvexIdentityAuth - Convex implementation of IdentityAuth interface
 *
 * Wraps Convex mutations/queries to provide the IdentityAuth contract.
 */

import { ConvexClient } from "convex/browser";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  IdentityAuth,
  IssueChallengeRequest,
  IssueChallengeResponse,
  VerifyAuthRequest,
  VerifyAuthResult,
} from "../../core/interfaces/IdentityAuth";

/**
 * Client-side adapter for IdentityAuth using Convex
 */
export class ConvexIdentityAuth implements IdentityAuth {
  constructor(private client: ConvexClient) {}

  async issueChallenge(req: IssueChallengeRequest): Promise<IssueChallengeResponse> {
    // Compute argsHash on server (ensures consistency)
    const argsHash = await this.client.query(api.auth.computeHash, {
      args: req.args,
    });

    // Issue challenge
    const result = await this.client.mutation(api.auth.issueChallenge, {
      aid: req.aid,
      purpose: req.purpose,
      argsHash,
      ttl: req.ttlMs,
    });

    return {
      challengeId: result.challengeId,
      payloadToSign: result.payload,
    };
  }

  async verifyAuth(req: VerifyAuthRequest): Promise<VerifyAuthResult> {
    // verifyAuth is server-side only - called within Convex mutations
    // This method should not be called from client code
    throw new Error(
      "verifyAuth is server-side only. It's called internally by Convex mutations."
    );
  }
}

/**
 * Helper to compute args hash (client-side utility)
 */
export async function computeArgsHash(
  client: ConvexClient,
  args: Record<string, unknown>
): Promise<string> {
  return await client.query(api.auth.computeHash, { args });
}
