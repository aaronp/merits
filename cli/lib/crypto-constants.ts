/**
 * Cryptographic Constants
 *
 * This module documents all cryptographic primitives used in the Merits CLI.
 * It serves as a single source of truth for crypto choices and provides
 * constants reused across all crypto commands.
 *
 * References:
 * - KERI Spec: https://github.com/WebOfTrust/keri
 * - CESR Spec: https://github.com/WebOfTrust/cesr
 * - RFC8785: JSON Canonicalization Scheme (JCS)
 */

/**
 * Cryptographic Algorithm Defaults
 *
 * All encryption and key derivation operations use these primitives:
 * - Ed25519: Digital signatures (Edwards curve)
 * - X25519: Key exchange (Montgomery curve, derived from Ed25519)
 * - AES-256-GCM: Authenticated encryption with associated data (AEAD)
 * - HKDF-SHA256: Key derivation function
 * - SHA-256: Hashing
 */
export const CRYPTO_DEFAULTS = {
  /**
   * Signature algorithm: Ed25519
   * - Fast, secure digital signatures
   * - 32-byte public keys, 64-byte signatures
   * - Used for message signing and authentication
   */
  SIGNATURE_ALGORITHM: "Ed25519" as const,

  /**
   * Key exchange algorithm: X25519
   * - Elliptic curve Diffie-Hellman (ECDH)
   * - Derived from Ed25519 keys
   * - Used for deriving shared secrets in group encryption
   */
  KEY_EXCHANGE_ALGORITHM: "X25519" as const,

  /**
   * Symmetric encryption: AES-256-GCM
   * - Authenticated encryption with associated data (AEAD)
   * - 256-bit keys, 96-bit nonces
   * - Used for message content encryption
   */
  ENCRYPTION_ALGORITHM: "AES-256-GCM" as const,

  /**
   * Key derivation: HKDF-SHA256
   * - HMAC-based Key Derivation Function
   * - SHA-256 as the hash function
   * - Used for deriving group keys from shared secrets
   */
  KEY_DERIVATION_FUNCTION: "HKDF-SHA256" as const,

  /**
   * Hash function: SHA-256
   * - 256-bit cryptographic hash
   * - Used for content hashing and integrity checks
   */
  HASH_ALGORITHM: "SHA-256" as const,
} as const;

/**
 * Key Format Constants
 *
 * Merits uses CESR (Composable Event Streaming Representation) for key encoding.
 * CESR provides self-describing, compact encoding with type prefixes.
 */
export const KEY_FORMATS = {
  /**
   * CESR Ed25519 Public Key Prefix
   * - 'D' prefix indicates Ed25519 non-transferable identifier
   * - Format: D + base64url(publicKey)
   * - Example: DqU5mb1SmwpsLq7Wbvc3lA6qyoqcE-0vKLGC_kGrHzIH
   */
  ED25519_PUBLIC_KEY_PREFIX: "D" as const,

  /**
   * Ed25519 Key Sizes
   */
  ED25519_PUBLIC_KEY_BYTES: 32,
  ED25519_PRIVATE_KEY_BYTES: 32,
  ED25519_SIGNATURE_BYTES: 64,

  /**
   * X25519 Key Sizes
   */
  X25519_PUBLIC_KEY_BYTES: 32,
  X25519_PRIVATE_KEY_BYTES: 32,

  /**
   * AES-256-GCM Parameters
   */
  AES_KEY_BYTES: 32, // 256 bits
  AES_NONCE_BYTES: 12, // 96 bits (recommended for GCM)
  AES_TAG_BYTES: 16, // 128 bits authentication tag
} as const;

/**
 * Session Token Constants
 */
export const SESSION_CONSTANTS = {
  /**
   * Default session token TTL (60 seconds)
   * Tokens are short-lived for security
   */
  DEFAULT_TTL_MS: 60_000,

  /**
   * Token refresh buffer (5 seconds before expiry)
   * Tokens should be refreshed before they expire
   */
  REFRESH_BUFFER_MS: 5_000,

  /**
   * Default session token file path
   */
  DEFAULT_TOKEN_PATH: ".merits/session.json",
} as const;

/**
 * Message Constants
 */
export const MESSAGE_CONSTANTS = {
  /**
   * Default message TTL (24 hours)
   * Messages expire and are deleted after this period
   */
  DEFAULT_TTL_MS: 24 * 60 * 60 * 1000,

  /**
   * Message types
   */
  TYPES: {
    TEXT: "text",
    ENCRYPTED: "encrypted",
    GROUP: "group",
  } as const,
} as const;

/**
 * File Permission Constants
 */
export const FILE_PERMISSIONS = {
  /**
   * Secure file permissions (owner read/write only)
   * Used for session tokens and private keys
   */
  SECURE: 0o600,

  /**
   * Directory permissions (owner rwx)
   * Used for .merits/ directory
   */
  SECURE_DIR: 0o700,
} as const;

/**
 * Cryptographic Info for Documentation
 *
 * This object provides human-readable documentation for all crypto choices.
 * It's used in help text and error messages.
 */
export const CRYPTO_INFO = {
  signatures: {
    algorithm: "Ed25519",
    description: "Fast, secure digital signatures using Edwards curve",
    keySize: "32 bytes (256 bits)",
    signatureSize: "64 bytes (512 bits)",
    encoding: "CESR format with 'D' prefix",
  },
  keyExchange: {
    algorithm: "X25519",
    description: "Elliptic curve Diffie-Hellman for key exchange",
    keySize: "32 bytes (256 bits)",
    derivation: "Converted from Ed25519 keys",
  },
  encryption: {
    algorithm: "AES-256-GCM",
    description: "Authenticated encryption with associated data (AEAD)",
    keySize: "32 bytes (256 bits)",
    nonceSize: "12 bytes (96 bits)",
    tagSize: "16 bytes (128 bits)",
  },
  keyDerivation: {
    algorithm: "HKDF-SHA256",
    description: "HMAC-based Key Derivation Function with SHA-256",
    usage: "Deriving group keys from shared secrets",
  },
  hashing: {
    algorithm: "SHA-256",
    description: "Cryptographic hash function",
    outputSize: "32 bytes (256 bits)",
  },
} as const;

/**
 * Type exports for TypeScript
 */
export type SignatureAlgorithm = typeof CRYPTO_DEFAULTS.SIGNATURE_ALGORITHM;
export type KeyExchangeAlgorithm = typeof CRYPTO_DEFAULTS.KEY_EXCHANGE_ALGORITHM;
export type EncryptionAlgorithm = typeof CRYPTO_DEFAULTS.ENCRYPTION_ALGORITHM;
export type KeyDerivationFunction = typeof CRYPTO_DEFAULTS.KEY_DERIVATION_FUNCTION;
export type HashAlgorithm = typeof CRYPTO_DEFAULTS.HASH_ALGORITHM;
export type MessageType = (typeof MESSAGE_CONSTANTS.TYPES)[keyof typeof MESSAGE_CONSTANTS.TYPES];
