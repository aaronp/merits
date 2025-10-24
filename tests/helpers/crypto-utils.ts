/**
 * Crypto utilities for testing KERI authentication
 *
 * This file now re-exports from core/crypto.ts which uses @noble/ed25519.
 * All Web Crypto API usage has been replaced with @noble implementations.
 */

export {
  generateKeyPair,
  sign,
  verify,
  signPayload,
  encodeCESRKey,
  decodeCESRKey,
  createAID,
  createIndexedSignature,
  parseIndexedSignature,
  sha256,
  computeArgsHash,
  sha256Hex,
  uint8ArrayToBase64Url,
  base64UrlToUint8Array,
  type KeyPair,
} from "../../core/crypto";
