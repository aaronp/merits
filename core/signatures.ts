/**
 * Request Signature Utilities
 *
 * Implements per-request signing for Convex mutations.
 * Replaces bearer tokens with cryptographic signatures on each request.
 *
 * Security properties:
 * - Each request is self-authenticating
 * - No bearer tokens that can be stolen
 * - Replay protection via nonce + timestamp
 * - Immediate revocation (disable public key)
 *
 * Design:
 * - Signs canonical representation of mutation arguments
 * - Embeds signature metadata in mutation args (Convex-compatible)
 * - Server verifies signature before executing mutation
 */

import {
  sign,
  verify,
  sha256Hex,
  uint8ArrayToBase64Url,
  base64UrlToUint8Array,
} from "./crypto";
import type { SignedRequest } from "./types";

/**
 * Canonicalize mutation arguments for signing
 *
 * Creates a deterministic string representation of arguments.
 * Field order is sorted alphabetically for consistency.
 *
 * @param args - Mutation arguments to canonicalize
 * @param excludeFields - Fields to exclude from signing (e.g., 'sig' itself)
 * @returns Canonical JSON string
 */
export function canonicalizeMutationArgs(
  args: Record<string, any>,
  excludeFields: string[] = []
): string {
  // Filter out excluded fields
  const filtered: Record<string, any> = {};
  for (const key of Object.keys(args)) {
    if (!excludeFields.includes(key)) {
      filtered[key] = args[key];
    }
  }

  // Sort keys and stringify
  const sortedKeys = Object.keys(filtered).sort();
  const canonical = JSON.stringify(filtered, sortedKeys);
  return canonical;
}

/**
 * Build signature payload for signing
 *
 * Combines canonicalized args with metadata for comprehensive binding.
 *
 * Format:
 * ```
 * timestamp: 1699027200000
 * nonce: 6c3f0a2f-1234-5678-90ab-cdef12345678
 * keyId: Dabcd1234...
 * args: {"field1":"value1","field2":"value2"}
 * ```
 *
 * @param canonicalArgs - Canonical JSON of arguments
 * @param timestamp - Unix timestamp in milliseconds
 * @param nonce - UUID v4
 * @param keyId - AID of signer
 * @returns Payload string to sign
 */
export function buildSignaturePayload(
  canonicalArgs: string,
  timestamp: number,
  nonce: string,
  keyId: string
): string {
  return `timestamp: ${timestamp}\nnonce: ${nonce}\nkeyId: ${keyId}\nargs: ${canonicalArgs}`;
}

/**
 * Sign mutation arguments
 *
 * Creates a signature over canonicalized arguments with metadata.
 * Returns SignedRequest to be embedded in mutation args.
 *
 * @param args - Mutation arguments to sign
 * @param privateKey - Signer's private key (raw bytes)
 * @param keyId - AID of the signer
 * @param nonce - Optional nonce (generates UUID if not provided)
 * @param timestamp - Optional timestamp (uses Date.now() if not provided)
 * @returns SignedRequest with signature and metadata
 *
 * @example
 * ```typescript
 * const sig = await signMutationArgs(
 *   { recpAid: "D123...", ct: "encrypted" },
 *   privateKeyBytes,
 *   "Dabc123..."
 * );
 *
 * // Embed in mutation call
 * await convex.mutation(api.messages.send, {
 *   recpAid: "D123...",
 *   ct: "encrypted",
 *   sig
 * });
 * ```
 */
export async function signMutationArgs(
  args: Record<string, any>,
  privateKey: Uint8Array,
  keyId: string,
  nonce?: string,
  timestamp?: number
): Promise<SignedRequest> {
  // Generate metadata
  const ts = timestamp ?? Date.now();
  const n = nonce ?? crypto.randomUUID();

  // Get list of fields being signed (all except 'sig')
  const signedFields = Object.keys(args).filter((k) => k !== "sig").sort();

  // Canonicalize arguments (exclude 'sig' field)
  const canonicalArgs = canonicalizeMutationArgs(args, ["sig"]);

  // Build payload
  const payload = buildSignaturePayload(canonicalArgs, ts, n, keyId);

  // Sign
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(payload);
  const signatureBytes = await sign(payloadBytes, privateKey);
  const signature = uint8ArrayToBase64Url(signatureBytes);

  return {
    signature,
    timestamp: ts,
    nonce: n,
    keyId,
    signedFields,
  };
}

/**
 * Verify mutation signature
 *
 * Server-side verification of signed requests.
 * Checks:
 * - Signature is valid
 * - Timestamp is within acceptable skew (±5 minutes)
 * - All required fields were signed
 *
 * Note: Nonce replay checking must be done separately (requires DB lookup)
 *
 * @param args - Full mutation arguments (including 'sig' field)
 * @param publicKey - Signer's public key (raw bytes)
 * @param maxSkewMs - Maximum allowed timestamp skew (default: 5 minutes)
 * @returns True if signature is valid
 * @throws Error if signature invalid or timestamp too old/new
 *
 * @example
 * ```typescript
 * // In Convex mutation
 * const valid = await verifyMutationSignature(
 *   args,
 *   publicKeyBytes,
 *   5 * 60 * 1000 // 5 minutes
 * );
 * if (!valid) throw new Error("Invalid signature");
 * ```
 */
export async function verifyMutationSignature(
  args: Record<string, any>,
  publicKey: Uint8Array,
  maxSkewMs: number = 5 * 60 * 1000
): Promise<boolean> {
  const sig = args.sig as SignedRequest | undefined;

  if (!sig) {
    throw new Error("No signature found in request");
  }

  // Check timestamp skew
  const now = Date.now();
  const skew = Math.abs(now - sig.timestamp);
  if (skew > maxSkewMs) {
    throw new Error(
      `Timestamp skew too large: ${skew}ms (max ${maxSkewMs}ms). ` +
        `Request time: ${new Date(sig.timestamp).toISOString()}, ` +
        `Server time: ${new Date(now).toISOString()}`
    );
  }

  // Rebuild canonical args (exclude 'sig' field)
  const canonicalArgs = canonicalizeMutationArgs(args, ["sig"]);

  // Rebuild payload
  const payload = buildSignaturePayload(
    canonicalArgs,
    sig.timestamp,
    sig.nonce,
    sig.keyId
  );

  // Verify signature
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(payload);
  const signatureBytes = base64UrlToUint8Array(sig.signature);

  try {
    return await verify(signatureBytes, payloadBytes, publicKey);
  } catch (error) {
    throw new Error(`Signature verification failed: ${error}`);
  }
}

/**
 * Compute signature hash for logging/debugging
 *
 * Returns a short hash of the signature for audit logs.
 *
 * @param sig - SignedRequest
 * @returns Hex-encoded SHA-256 hash (first 16 chars)
 */
export function computeSignatureHash(sig: SignedRequest): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(
    `${sig.signature}:${sig.timestamp}:${sig.nonce}:${sig.keyId}`
  );
  const hash = sha256Hex(data);
  return hash.substring(0, 16); // First 16 hex chars for compact logging
}
