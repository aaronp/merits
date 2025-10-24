/**
 * Crypto utilities for testing KERI authentication
 */

import { generateKeyPair as nobleGenerate, sign as nobleSign } from "../../core/crypto";

export async function generateKeyPair(): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  publicKeyCESR: string;
}> {
  const { publicKey, privateKey } = await nobleGenerate();
  return {
    publicKey,
    privateKey,
    publicKeyCESR: encodeCESRKey(publicKey),
  };
}

/**
 * Sign data with Ed25519 private key
 */
export async function sign(
  data: Uint8Array,
  privateKey: Uint8Array
): Promise<Uint8Array> {
  return await nobleSign(data, privateKey);
}

/**
 * Reconstruct PKCS8 format from raw 32-byte Ed25519 private key
 */
// PKCS8 reconstruction no longer needed with noble

/**
 * Encode public key in CESR format (simplified)
 */
export function encodeCESRKey(publicKey: Uint8Array): string {
  // CESR Ed25519 public key: 'D' prefix + base64url
  const b64 = uint8ArrayToBase64Url(publicKey);
  return `D${b64}`;
}

/**
 * Create AID from public key
 *
 * NOTE: In production KERI, AID = SAID of inception event.
 * For testing, we use the public key directly with 'D' prefix (Ed25519 non-transferable identifier).
 * This makes AID === verifier key, which simplifies test setup.
 */
export function createAID(publicKey: Uint8Array): string {
  return `D${uint8ArrayToBase64Url(publicKey)}`;  // 'D' prefix = Ed25519 public key (CESR)
}

/**
 * Base64url encoding
 */
export function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Base64url decoding
 */
export function base64UrlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = base64 + padding;
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Create indexed signature (format: "idx-signature_base64url")
 */
export function createIndexedSignature(
  idx: number,
  signature: Uint8Array
): string {
  return `${idx}-${uint8ArrayToBase64Url(signature)}`;
}

/**
 * Compute SHA256 hash
 */
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer);
}

/**
 * Compute args hash for authentication
 */
export async function computeArgsHash(args: Record<string, any>): Promise<string> {
  const canonical = JSON.stringify(args, Object.keys(args).sort());
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);
  const hash = await sha256(data);
  return uint8ArrayToBase64Url(hash);
}

/**
 * Sign a payload and return indexed signatures
 *
 * @param payload The payload object to sign
 * @param privateKey The private key to sign with
 * @param keyIndex The index of the key (for indexed signatures)
 * @returns Array of indexed signatures (format: "idx-signature_base64url")
 */
export async function signPayload(
  payload: Record<string, any>,
  privateKey: Uint8Array,
  keyIndex: number
): Promise<string[]> {
  // Canonicalize payload (sort keys deterministically)
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);

  // Sign the data
  const signature = await sign(data, privateKey);

  // Create indexed signature
  const indexedSig = createIndexedSignature(keyIndex, signature);

  return [indexedSig];
}
