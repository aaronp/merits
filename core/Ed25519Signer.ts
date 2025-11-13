/**
 * Ed25519Signer - Production Signer Implementation
 *
 * Implements the Signer interface for Ed25519 cryptographic operations.
 * Encapsulates private key and provides signing without exposing key material.
 *
 * Features:
 * - Secure private key encapsulation
 * - Ed25519 signature generation
 * - CESR-formatted signatures and verifiers
 * - Compatible with @noble/ed25519
 */

import type { Signer } from '../client/types';
import { sign } from './crypto';

/**
 * Base64URL encode a Uint8Array
 */
function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/**
 * Ed25519 Signer Implementation
 *
 * Wraps an Ed25519 private key and provides signing operations.
 * Private key is stored internally and never exposed.
 *
 * @example
 * ```typescript
 * const privateKey = new Uint8Array(32); // Your private key
 * const publicKey = new Uint8Array(32);  // Your public key
 * const signer = new Ed25519Signer(privateKey, publicKey);
 *
 * const signature = await signer.sign(message);
 * const verifier = signer.verifier();
 * ```
 */
export class Ed25519Signer implements Signer {
  private readonly privateKey: Uint8Array;
  private readonly publicKey: Uint8Array;

  /**
   * Create a new Ed25519Signer
   *
   * @param privateKey - Ed25519 private key (32 bytes)
   * @param publicKey - Ed25519 public key (32 bytes)
   */
  constructor(privateKey: Uint8Array, publicKey: Uint8Array) {
    if (privateKey.length !== 32) {
      throw new Error(`Invalid Ed25519 private key length: expected 32 bytes, got ${privateKey.length}`);
    }

    if (publicKey.length !== 32) {
      throw new Error(`Invalid Ed25519 public key length: expected 32 bytes, got ${publicKey.length}`);
    }

    this.privateKey = privateKey;
    this.publicKey = publicKey;
  }

  /**
   * Sign data with Ed25519 private key
   *
   * @param data - Data to sign
   * @returns CESR-encoded signature
   *
   * @example
   * ```typescript
   * const message = new TextEncoder().encode("Hello");
   * const signature = await signer.sign(message);
   * // Returns: "0BB4yxn..." (CESR format)
   * ```
   */
  async sign(data: Uint8Array): Promise<string> {
    const signature = await sign(data, this.privateKey);

    // CESR encoding: Base64URL with derivation code prefix
    // For Ed25519 signatures: "0B" prefix + base64url(64-byte signature)
    const signatureB64 = uint8ArrayToBase64Url(signature);
    return `0B${signatureB64}`;
  }

  /**
   * Get public key (verifier) in CESR format
   *
   * @returns CESR-encoded public key (basic prefix)
   *
   * @example
   * ```typescript
   * const verifier = signer.verifier();
   * // Returns: "DaGhlbGxvIHdvcmxk..." (CESR format with 'D' prefix)
   * ```
   */
  verifier(): string {
    // CESR encoding for Ed25519 public key: "D" prefix + base64url(32-byte key)
    // 'D' is the derivation code for Ed25519 non-transferable prefix (basic)
    const publicKeyB64 = uint8ArrayToBase64Url(this.publicKey);
    return `D${publicKeyB64}`;
  }
}
