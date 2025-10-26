/**
 * Core Crypto Module
 *
 * All cryptographic operations using @noble/ed25519 and @noble/hashes.
 * This module is backend-agnostic and has zero dependencies on Convex.
 */

import * as ed from "@noble/ed25519";
import { sha256 as sha256Hash } from "@noble/hashes/sha2.js";

// ============================================================================
// Types
// ============================================================================

export interface KeyPair {
  publicKey: Uint8Array; // 32 bytes
  privateKey: Uint8Array; // 32 bytes
  publicKeyCESR: string; // CESR-encoded public key (D prefix + base64url)
}

// ============================================================================
// Key Generation
// ============================================================================

/**
 * Generate Ed25519 keypair using @noble/ed25519
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const privateKey = ed.utils.randomSecretKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return {
    publicKey,
    privateKey,
    publicKeyCESR: encodeCESRKey(publicKey),
  };
}

// ============================================================================
// Signing & Verification
// ============================================================================

/**
 * Sign a message with Ed25519 private key
 */
export async function sign(
  message: Uint8Array,
  privateKey: Uint8Array
): Promise<Uint8Array> {
  return await ed.signAsync(message, privateKey);
}

/**
 * Verify an Ed25519 signature
 */
export async function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array
): Promise<boolean> {
  try {
    return await ed.verifyAsync(signature, message, publicKey);
  } catch {
    return false;
  }
}

/**
 * Sign a payload object and return indexed signatures
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
  const data = new TextEncoder().encode(canonical);

  // Sign the data
  const signature = await sign(data, privateKey);

  // Create indexed signature
  const indexedSig = createIndexedSignature(keyIndex, signature);

  return [indexedSig];
}

// ============================================================================
// CESR Encoding (KERI)
// ============================================================================

/**
 * Encode public key in CESR format
 * CESR Ed25519 public key: 'D' prefix + base64url
 */
export function encodeCESRKey(publicKey: Uint8Array): string {
  return `D${uint8ArrayToBase64Url(publicKey)}`;
}

/**
 * Decode CESR-encoded public key to raw bytes
 */
export function decodeCESRKey(cesrKey: string): Uint8Array {
  if (!cesrKey.startsWith("D")) {
    throw new Error("Invalid CESR key: must start with 'D'");
  }
  return base64UrlToUint8Array(cesrKey.slice(1));
}

/**
 * Create AID from public key
 *
 * NOTE: In production KERI, AID = SAID of inception event.
 * For testing, we use the public key directly with 'D' prefix (Ed25519 non-transferable identifier).
 * This makes AID === verifier key, which simplifies test setup.
 */
export function createAID(publicKey: Uint8Array): string {
  return `D${uint8ArrayToBase64Url(publicKey)}`;
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
 * Parse indexed signature into index and signature bytes
 */
export function parseIndexedSignature(indexedSig: string): {
  index: number;
  signature: Uint8Array;
} {
  const [idxStr, sigB64] = indexedSig.split("-");
  return {
    index: parseInt(idxStr, 10),
    signature: base64UrlToUint8Array(sigB64),
  };
}

// ============================================================================
// Hashing
// ============================================================================

/**
 * Compute SHA-256 hash using @noble/hashes
 */
export function sha256(data: Uint8Array): Uint8Array {
  return sha256Hash(data);
}

/**
 * Compute args hash for authentication (deterministic JSON + SHA-256)
 */
export function computeArgsHash(args: Record<string, any>): string {
  const canonical = JSON.stringify(args, Object.keys(args).sort());
  const data = new TextEncoder().encode(canonical);
  const hash = sha256(data);
  return uint8ArrayToBase64Url(hash);
}

/**
 * Compute SHA-256 hash and return as hex string
 */
export function sha256Hex(data: Uint8Array): string {
  const hash = sha256(data);
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Canonicalize payload to bytes for signing
 * (deterministic JSON encoding with sorted keys)
 */
export function canonicalizeToBytes(payload: any): Uint8Array {
  const sorted = JSON.stringify(payload, Object.keys(payload).sort());
  return new TextEncoder().encode(sorted);
}

/**
 * Get public key from private key
 * (wrapper around @noble/ed25519)
 */
export async function getPublicKeyFromPrivate(
  privateKey: Uint8Array
): Promise<Uint8Array> {
  return await ed.getPublicKeyAsync(privateKey);
}

// ============================================================================
// Base64URL Encoding
// ============================================================================

/**
 * Encode Uint8Array to base64url (RFC 4648)
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
 * Decode base64url to Uint8Array
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


