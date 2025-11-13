/**
 * Crypto utilities for testing KERI authentication
 *
 * This file now re-exports from core/crypto.ts which uses @noble/ed25519.
 * All Web Crypto API usage has been replaced with @noble implementations.
 */

export {
  base64UrlToUint8Array,
  computeArgsHash,
  createAID,
  createIndexedSignature,
  decodeCESRKey,
  encodeCESRKey,
  generateKeyPair,
  type KeyPair,
  parseIndexedSignature,
  sha256,
  sha256Hex,
  sign,
  signPayload,
  uint8ArrayToBase64Url,
  verify,
} from '../../core/crypto';
