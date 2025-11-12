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
import type { Signer } from "../client/types";

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
  // Recursively sort object keys for deterministic canonicalization
  const canonicalizeValue = (value: any): any => {
    if (value === null || value === undefined) {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(canonicalizeValue);
    }
    if (typeof value === 'object') {
      // Sort object keys and recursively canonicalize values
      const sortedKeys = Object.keys(value).sort();
      const sorted: Record<string, any> = {};
      for (const key of sortedKeys) {
        sorted[key] = canonicalizeValue(value[key]);
      }
      return sorted;
    }
    return value;
  };

  // Filter out excluded fields
  const filtered: Record<string, any> = {};
  for (const key of Object.keys(args)) {
    if (!excludeFields.includes(key)) {
      filtered[key] = args[key];
    }
  }

  // Sort top-level keys and recursively canonicalize nested objects
  const sortedKeys = Object.keys(filtered).sort();
  const sorted: Record<string, any> = {};
  for (const key of sortedKeys) {
    sorted[key] = canonicalizeValue(filtered[key]);
  }
  const canonical = JSON.stringify(sorted);
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

  // Verify signature
  const signatureBytes = base64UrlToUint8Array(sig.signature);

  // Helper to convert Uint8Array to hex (works in both Node and Convex)
  const uint8ArrayToHex = (bytes: Uint8Array): string => {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  };

  // DEBUG: Log verification details (always log on server for debugging)
  console.log('[VERIFY] Verifying with keyId:', sig.keyId);
  console.log('[VERIFY] Args:', JSON.stringify(args, null, 2));
  console.log('[VERIFY] Canonical args:', canonicalArgs);
  console.log('[VERIFY] Payload to verify (full):', payload);
  console.log('[VERIFY] Payload bytes length:', payloadBytes.length);
  console.log('[VERIFY] Payload bytes (hex):', uint8ArrayToHex(payloadBytes));
  console.log('[VERIFY] Timestamp:', sig.timestamp);
  console.log('[VERIFY] Nonce:', sig.nonce);
  console.log('[VERIFY] Signature (base64url):', sig.signature);
  console.log('[VERIFY] Public key (hex):', uint8ArrayToHex(publicKey));
  console.log('[VERIFY] Signature bytes (hex):', uint8ArrayToHex(signatureBytes));

  try {
    const result = await verify(signatureBytes, payloadBytes, publicKey);
    if (process.env.DEBUG_SIGNATURES === 'true') {
      console.log('[VERIFY] Verification result:', result);
    }
    return result;
  } catch (error) {
    // Helper to convert Uint8Array to hex (works in both Node and Convex)
    const uint8ArrayToHex = (bytes: Uint8Array): string => {
      return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    };

    if (process.env.DEBUG_SIGNATURES === 'true') {
      console.error('[VERIFY] Verification error:', error);
      console.error('[VERIFY] Payload bytes (hex):', uint8ArrayToHex(payloadBytes));
      console.error('[VERIFY] Signature bytes (hex):', uint8ArrayToHex(signatureBytes));
    }
    throw new Error(`Signature verification failed: ${error}`);
  }
}

/**
 * Sign mutation arguments using Signer interface
 *
 * Similar to signMutationArgs but uses the Signer abstraction instead of raw private keys.
 * This is the preferred method as it keeps private keys encapsulated.
 *
 * @param args - Mutation arguments to sign
 * @param signer - Signer instance for signing
 * @param keyId - AID of the signer
 * @param nonce - Optional nonce (generates UUID if not provided)
 * @param timestamp - Optional timestamp (uses Date.now() if not provided)
 * @returns SignedRequest with signature and metadata
 *
 * @example
 * ```typescript
 * const signer = new Ed25519Signer(privateKey, publicKey);
 * const sig = await signMutationArgsWithSigner(
 *   { recpAid: "D123...", ct: "encrypted" },
 *   signer,
 *   "Dabc123..."
 * );
 * ```
 */
export async function signMutationArgsWithSigner(
  args: Record<string, any>,
  signer: Signer,
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

  // DEBUG: Log signing details
  if (process.env.DEBUG_SIGNATURES === 'true') {
    console.log('[SIGN] Signing with keyId:', keyId);
    console.log('[SIGN] Args:', JSON.stringify(args, null, 2));
    console.log('[SIGN] Canonical args:', canonicalArgs);
    console.log('[SIGN] Payload to sign:', payload);
    console.log('[SIGN] Timestamp:', ts);
    console.log('[SIGN] Nonce:', n);
    console.log('[SIGN] Signed fields:', signedFields);
  }

  // Sign using Signer
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(payload);

  // DEBUG: Log payload bytes for comparison
  if (process.env.DEBUG_SIGNATURES === 'true') {
    const uint8ArrayToHex = (bytes: Uint8Array): string => {
      return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    };
    console.log('[SIGN] Payload bytes length:', payloadBytes.length);
    console.log('[SIGN] Payload bytes (hex):', uint8ArrayToHex(payloadBytes));
  }

  const signatureCESR = await signer.sign(payloadBytes);

  // Extract signature from CESR format
  // CESR signatures from @kv4/codex are proper qb64 format (not just "0B" + base64url)
  // We need to properly decode the CESR signature to get raw bytes, then re-encode as base64url
  // NOTE: This function is only called on the client side, not in Convex
  let signature: string;

  // Try to decode using @kv4/codex if available (client-side only)
  // Use a function-based dynamic import to avoid static analysis by Convex bundler
  try {
    // Use Function constructor to create a truly dynamic import that bundlers can't analyze
    // This prevents Convex bundler from trying to resolve @kv4/codex
    const dynamicImport = new Function('specifier', 'return import(specifier)');
    const codexModule = '@kv4/codex';
    const codex = await dynamicImport(codexModule);
    const decoded = codex.decodeSignature(signatureCESR);

    if (process.env.DEBUG_SIGNATURES === 'true') {
      console.log('[SIGN] Decoded CESR signature - raw bytes length:', decoded.raw.length);
    }

    // Re-encode as base64url for transport (server expects base64url, not CESR)
    const { uint8ArrayToBase64Url } = await import("./crypto");
    signature = uint8ArrayToBase64Url(decoded.raw);
  } catch (error: any) {
    // If decodeSignature fails (e.g., @kv4/codex not available in Convex bundler),
    // fall back to simple "0B" removal for compatibility
    if (process.env.DEBUG_SIGNATURES === 'true') {
      console.warn('[SIGN] Failed to decode CESR signature with codex, using fallback:', error?.message);
      console.warn('[SIGN] CESR signature:', signatureCESR);
    }
    // Fallback: simple "0B" removal (assumes simple format)
    // This works because CESR Ed25519 signatures start with "0B" followed by base64url-encoded signature
    signature = signatureCESR.startsWith("0B")
      ? signatureCESR.substring(2)
      : signatureCESR;
  }

  if (process.env.DEBUG_SIGNATURES === 'true') {
    console.log('[SIGN] CESR signature:', signatureCESR);
    console.log('[SIGN] Extracted signature (base64url):', signature);
  }

  return {
    signature,
    timestamp: ts,
    nonce: n,
    keyId,
    signedFields,
  };
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
