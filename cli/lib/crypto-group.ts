/**
 * Group Encryption Cryptography Module
 *
 * Implements secure group messaging using:
 * - Ed25519 → X25519 key conversion for Diffie-Hellman key exchange
 * - X25519 ECDH for shared secret derivation
 * - HKDF-SHA256 for key derivation
 * - AES-256-GCM for authenticated encryption
 *
 * Security properties:
 * - Forward secrecy: Each message uses a fresh group key
 * - Authenticated encryption: AES-GCM provides authenticity
 * - No key persistence: Group keys are ephemeral (in-memory only)
 *
 * References:
 * - RFC 7748: Elliptic Curves for Security (X25519)
 * - RFC 5869: HKDF (HMAC-based Key Derivation Function)
 * - NIST SP 800-38D: AES-GCM
 */

import * as ed from "@noble/ed25519";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { CRYPTO_DEFAULTS, KEY_FORMATS } from "./crypto-constants";

/**
 * Encrypted group message structure
 */
export interface GroupMessage {
  // Message content encrypted with group key
  encryptedContent: string; // base64url

  // Nonce for AES-GCM (96 bits)
  nonce: string; // base64url

  // Encrypted group key for each recipient
  // Map: recipient AID → encrypted group key
  encryptedKeys: Record<string, {
    encryptedKey: string; // base64url
    nonce: string; // base64url
  }>;

  // Metadata
  senderAid: string;
  groupId: string;

  // Additional Authenticated Data (AAD) for forward compatibility
  aad?: string; // base64url
}

/**
 * Convert Ed25519 private key to X25519 private key
 *
 * Ed25519 uses Edwards curve y² - x² = 1 + dx²y²
 * X25519 uses Montgomery curve y² = x³ + 486662x² + x
 *
 * These curves are birationally equivalent, allowing key conversion.
 *
 * @param ed25519PrivateKey - 32-byte Ed25519 private key
 * @returns 32-byte X25519 private key
 */
export function ed25519PrivateKeyToX25519(ed25519PrivateKey: Uint8Array): Uint8Array {
  if (ed25519PrivateKey.length !== KEY_FORMATS.ED25519_PRIVATE_KEY_BYTES) {
    throw new Error(`Invalid Ed25519 private key length: expected ${KEY_FORMATS.ED25519_PRIVATE_KEY_BYTES}, got ${ed25519PrivateKey.length}`);
  }

  // Use @noble/curves for proper Ed25519→X25519 conversion
  // This follows RFC 7748 § 5 (converting Ed25519 key to X25519)
  return ed25519.utils.toMontgomerySecret(ed25519PrivateKey);
}

/**
 * Convert Ed25519 public key to X25519 public key
 *
 * @param ed25519PublicKey - 32-byte Ed25519 public key
 * @returns 32-byte X25519 public key
 */
export function ed25519PublicKeyToX25519(ed25519PublicKey: Uint8Array): Uint8Array {
  if (ed25519PublicKey.length !== KEY_FORMATS.ED25519_PUBLIC_KEY_BYTES) {
    throw new Error(`Invalid Ed25519 public key length: expected ${KEY_FORMATS.ED25519_PUBLIC_KEY_BYTES}, got ${ed25519PublicKey.length}`);
  }

  // Use @noble/curves for proper Ed25519→X25519 public key conversion
  // This follows RFC 7748 § 5 (converting Ed25519 public key to X25519)
  return ed25519.utils.toMontgomery(ed25519PublicKey);
}

/**
 * Derive shared secret using X25519 ECDH
 *
 * Performs Diffie-Hellman key exchange:
 * sharedSecret = ourPrivateKey * theirPublicKey
 *
 * @param ourX25519PrivateKey - Our X25519 private key
 * @param theirX25519PublicKey - Their X25519 public key
 * @returns 32-byte shared secret
 */
export async function deriveSharedSecret(
  ourX25519PrivateKey: Uint8Array,
  theirX25519PublicKey: Uint8Array
): Promise<Uint8Array> {
  if (ourX25519PrivateKey.length !== KEY_FORMATS.X25519_PRIVATE_KEY_BYTES) {
    throw new Error(`Invalid X25519 private key length: expected ${KEY_FORMATS.X25519_PRIVATE_KEY_BYTES}, got ${ourX25519PrivateKey.length}`);
  }
  if (theirX25519PublicKey.length !== KEY_FORMATS.X25519_PUBLIC_KEY_BYTES) {
    throw new Error(`Invalid X25519 public key length: expected ${KEY_FORMATS.X25519_PUBLIC_KEY_BYTES}, got ${theirX25519PublicKey.length}`);
  }

  // Use @noble/curves X25519 for proper ECDH
  // This performs scalar multiplication: sharedSecret = ourPrivateKey * theirPublicKey
  const sharedSecret = x25519.getSharedSecret(ourX25519PrivateKey, theirX25519PublicKey);

  return sharedSecret;
}

/**
 * Derive group encryption key from multiple shared secrets
 *
 * Uses HKDF-SHA256 to combine shared secrets into a single group key.
 * This ensures all group members derive the same key.
 *
 * @param sharedSecrets - Array of shared secrets (one per member)
 * @returns 32-byte group encryption key
 */
export function deriveGroupKey(sharedSecrets: Uint8Array[]): Uint8Array {
  if (sharedSecrets.length === 0) {
    throw new Error("Cannot derive group key from empty shared secrets array");
  }

  // Concatenate all shared secrets
  const combined = new Uint8Array(
    sharedSecrets.reduce((acc, secret) => acc + secret.length, 0)
  );

  let offset = 0;
  for (const secret of sharedSecrets) {
    combined.set(secret, offset);
    offset += secret.length;
  }

  // Derive group key using HKDF-SHA256
  const salt = new TextEncoder().encode("merits-group-key-v1");
  const info = new TextEncoder().encode("aes-256-gcm");

  const groupKey = hkdf(sha256, combined, salt, info, KEY_FORMATS.AES_KEY_BYTES);

  return groupKey;
}

/**
 * Encrypt data using AES-256-GCM
 *
 * @param plaintext - Data to encrypt
 * @param key - 32-byte AES key
 * @param aad - Additional Authenticated Data (optional)
 * @returns Object containing ciphertext and nonce
 */
export async function encryptAESGCM(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad?: Uint8Array
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  if (key.length !== KEY_FORMATS.AES_KEY_BYTES) {
    throw new Error(`Invalid AES key length: expected ${KEY_FORMATS.AES_KEY_BYTES}, got ${key.length}`);
  }

  // Generate random nonce (96 bits for GCM)
  const nonce = crypto.getRandomValues(new Uint8Array(KEY_FORMATS.AES_NONCE_BYTES));

  // Import key for Web Crypto API
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  // Encrypt with AES-GCM
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: aad,
      tagLength: KEY_FORMATS.AES_TAG_BYTES * 8, // bits
    },
    cryptoKey,
    plaintext
  );

  return {
    ciphertext: new Uint8Array(ciphertext),
    nonce,
  };
}

/**
 * Decrypt data using AES-256-GCM
 *
 * @param ciphertext - Data to decrypt
 * @param key - 32-byte AES key
 * @param nonce - 12-byte nonce
 * @param aad - Additional Authenticated Data (optional)
 * @returns Decrypted plaintext
 */
export async function decryptAESGCM(
  ciphertext: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
  aad?: Uint8Array
): Promise<Uint8Array> {
  if (key.length !== KEY_FORMATS.AES_KEY_BYTES) {
    throw new Error(`Invalid AES key length: expected ${KEY_FORMATS.AES_KEY_BYTES}, got ${key.length}`);
  }
  if (nonce.length !== KEY_FORMATS.AES_NONCE_BYTES) {
    throw new Error(`Invalid nonce length: expected ${KEY_FORMATS.AES_NONCE_BYTES}, got ${nonce.length}`);
  }

  // Import key for Web Crypto API
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  // Decrypt with AES-GCM
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: aad,
      tagLength: KEY_FORMATS.AES_TAG_BYTES * 8, // bits
    },
    cryptoKey,
    ciphertext
  );

  return new Uint8Array(plaintext);
}

/**
 * Encrypt message for a group
 *
 * Process:
 * 1. Generate random group key
 * 2. Encrypt message with group key (AES-256-GCM)
 * 3. For each member:
 *    a. Convert their Ed25519 public key to X25519
 *    b. Derive shared secret via ECDH
 *    c. Encrypt group key with shared secret (AES-256-GCM)
 *
 * Security: Group keys are ephemeral and never persisted.
 *
 * @param message - Plaintext message
 * @param memberPublicKeys - Ed25519 public keys of group members (base64url)
 * @param ourEd25519PrivateKey - Our Ed25519 private key
 * @param groupId - Group identifier
 * @param senderAid - Sender's AID
 * @returns Encrypted group message
 */
export async function encryptForGroup(
  message: string,
  memberPublicKeys: Record<string, string>, // AID → base64url public key
  ourEd25519PrivateKey: Uint8Array,
  groupId: string,
  senderAid: string
): Promise<GroupMessage> {
  // Generate ephemeral group key (AES-256)
  const groupKey = crypto.getRandomValues(new Uint8Array(KEY_FORMATS.AES_KEY_BYTES));

  // Encrypt message with group key
  const messageBytes = new TextEncoder().encode(message);
  const aad = new TextEncoder().encode(`${groupId}:${senderAid}`);
  const { ciphertext: encryptedContent, nonce: contentNonce } = await encryptAESGCM(
    messageBytes,
    groupKey,
    aad
  );

  // Convert our Ed25519 private key to X25519
  const ourX25519PrivateKey = ed25519PrivateKeyToX25519(ourEd25519PrivateKey);

  // Encrypt group key for each member
  const encryptedKeys: Record<string, { encryptedKey: string; nonce: string }> = {};

  for (const [memberAid, memberPublicKeyB64] of Object.entries(memberPublicKeys)) {
    // Decode member's Ed25519 public key
    const memberEd25519PublicKey = base64UrlToUint8Array(memberPublicKeyB64);

    // Convert to X25519
    const memberX25519PublicKey = ed25519PublicKeyToX25519(memberEd25519PublicKey);

    // Derive shared secret
    const sharedSecret = await deriveSharedSecret(ourX25519PrivateKey, memberX25519PublicKey);

    // Encrypt group key with shared secret
    const { ciphertext: encryptedKey, nonce: keyNonce } = await encryptAESGCM(
      groupKey,
      sharedSecret
    );

    encryptedKeys[memberAid] = {
      encryptedKey: uint8ArrayToBase64Url(encryptedKey),
      nonce: uint8ArrayToBase64Url(keyNonce),
    };
  }

  // Clear group key from memory (best effort)
  groupKey.fill(0);

  return {
    encryptedContent: uint8ArrayToBase64Url(encryptedContent),
    nonce: uint8ArrayToBase64Url(contentNonce),
    encryptedKeys,
    senderAid,
    groupId,
    aad: uint8ArrayToBase64Url(aad),
  };
}

/**
 * Decrypt group message
 *
 * Process:
 * 1. Find our encrypted group key in the message
 * 2. Convert keys to X25519
 * 3. Derive shared secret with sender
 * 4. Decrypt group key
 * 5. Decrypt message content
 *
 * @param groupMessage - Encrypted group message
 * @param ourEd25519PrivateKey - Our Ed25519 private key
 * @param ourAid - Our AID
 * @param senderEd25519PublicKey - Sender's Ed25519 public key (base64url)
 * @returns Decrypted plaintext message
 */
export async function decryptGroupMessage(
  groupMessage: GroupMessage,
  ourEd25519PrivateKey: Uint8Array,
  ourAid: string,
  senderEd25519PublicKey: string
): Promise<string> {
  // Find our encrypted key
  const ourEncryptedKey = groupMessage.encryptedKeys[ourAid];
  if (!ourEncryptedKey) {
    throw new Error(`No encrypted key found for AID: ${ourAid}`);
  }

  // Convert keys to X25519
  const ourX25519PrivateKey = ed25519PrivateKeyToX25519(ourEd25519PrivateKey);
  const senderEd25519PublicKeyBytes = base64UrlToUint8Array(senderEd25519PublicKey);
  const senderX25519PublicKey = ed25519PublicKeyToX25519(senderEd25519PublicKeyBytes);

  // Derive shared secret with sender
  const sharedSecret = await deriveSharedSecret(ourX25519PrivateKey, senderX25519PublicKey);

  // Decrypt group key
  const encryptedKeyBytes = base64UrlToUint8Array(ourEncryptedKey.encryptedKey);
  const keyNonce = base64UrlToUint8Array(ourEncryptedKey.nonce);
  const groupKey = await decryptAESGCM(encryptedKeyBytes, sharedSecret, keyNonce);

  // Decrypt message content
  const encryptedContent = base64UrlToUint8Array(groupMessage.encryptedContent);
  const contentNonce = base64UrlToUint8Array(groupMessage.nonce);
  const aad = groupMessage.aad ? base64UrlToUint8Array(groupMessage.aad) : undefined;

  const plaintextBytes = await decryptAESGCM(encryptedContent, groupKey, contentNonce, aad);

  // Clear sensitive data from memory
  groupKey.fill(0);
  sharedSecret.fill(0);

  return new TextDecoder().decode(plaintextBytes);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Encode Uint8Array to base64url (RFC 4648)
 */
function uint8ArrayToBase64Url(bytes: Uint8Array): string {
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
function base64UrlToUint8Array(base64url: string): Uint8Array {
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
