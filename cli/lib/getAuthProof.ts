/**
 * Auth Helper
 *
 * Simplifies authentication for CLI commands.
 * Creates auth proofs using vault + client, with forward-compatible types.
 */

import type { MeritsClient } from "../../src/client";
import type { MeritsVault } from "./vault/MeritsVault";
import type { AuthProof } from "../../core/types";

/**
 * Auth purpose types (forward-compatible)
 */
export type AuthPurpose =
  | "send"
  | "receive"
  | "ack"
  | "receiveAndAck" // Milestone 3: Combined receive + ack
  | "openSession" // Milestone 3: Session tokens
  | "admin"
  | "manageGroup";

/**
 * Get authentication proof for an operation
 *
 * @param params.client - Merits client
 * @param params.vault - Vault for signing
 * @param params.identityName - Identity name in vault
 * @param params.purpose - Auth purpose
 * @param params.args - Operation-specific args
 * @returns AuthProof ready for mutation
 *
 * @example
 * ```typescript
 * const auth = await getAuthProof({
 *   client,
 *   vault,
 *   identityName: 'alice',
 *   purpose: 'send',
 *   args: {
 *     recpAid: bob.aid,
 *     ctHash: client.computeCtHash(ct),
 *     ttl: 60000,
 *     alg: '',
 *     ek: '',
 *   },
 * });
 *
 * await client.transport.sendMessage({ ..., auth });
 * ```
 */
export async function getAuthProof(params: {
  client: MeritsClient;
  vault: MeritsVault;
  identityName: string;
  purpose: AuthPurpose;
  args?: Record<string, unknown>;
}): Promise<AuthProof> {
  const { client, vault, identityName, purpose, args = {} } = params;

  // Get identity metadata (no private key)
  const identity = await vault.getIdentity(identityName);

  // Issue challenge
  const challenge = await client.identity.issueChallenge({
    aid: identity.aid,
    purpose: purpose as any, // Cast for now, will be refined in future
    args,
  });

  // Sign payload with vault (key never leaves vault)
  const data = encodePayload(challenge.payloadToSign);
  const sigs = await vault.signIndexed(identityName, data);

  return {
    challengeId: challenge.challengeId,
    sigs,
    ksn: identity.ksn,
  };
}

/**
 * Get session token (Milestone 3 placeholder)
 *
 * Session tokens allow streaming receive + batch ack without
 * issuing a fresh proof for every message.
 *
 * @param params.client - Merits client
 * @param params.vault - Vault for signing
 * @param params.identityName - Identity name in vault
 * @param params.scopes - Token scopes (e.g., ['receive', 'ack'])
 * @param params.ttl - Token lifetime in ms (max 60s)
 * @returns Session token + expiration
 *
 * @throws Error - Not yet implemented
 */
export async function getSessionToken(params: {
  client: MeritsClient;
  vault: MeritsVault;
  identityName: string;
  scopes: string[];
  ttl?: number;
}): Promise<{ sessionToken: string; expiresAt: number }> {
  // TODO: Implement in Milestone 3
  throw new Error("Session tokens not yet implemented (Milestone 3)");
}

/**
 * Create combined receiveAndAck proof (Milestone 3 placeholder)
 *
 * Single proof for atomic receive + ack operation.
 *
 * @param params.client - Merits client
 * @param params.vault - Vault for signing
 * @param params.identityName - Identity name in vault
 * @param params.recpAid - Recipient AID
 * @returns AuthProof for receiveAndAck mutation
 *
 * @throws Error - Not yet implemented
 */
export async function getReceiveAndAckProof(params: {
  client: MeritsClient;
  vault: MeritsVault;
  identityName: string;
  recpAid: string;
}): Promise<AuthProof> {
  // TODO: Implement in Milestone 3
  throw new Error("receiveAndAck not yet implemented (Milestone 3)");
}

// --- Private helpers ---

/**
 * Encode payload for signing (canonical JSON)
 */
function encodePayload(payload: any): Uint8Array {
  // Sort keys deterministically for canonical encoding
  const sorted = JSON.stringify(
    payload,
    Object.keys(payload).sort()
  );
  return new TextEncoder().encode(sorted);
}
