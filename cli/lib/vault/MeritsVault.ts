/**
 * MeritsVault Interface
 *
 * Abstract interface for secure credential storage.
 * Implementations can use OS keychain, encrypted files, HSM, etc.
 *
 * Design principle: Private keys never leave the vault.
 * All cryptographic operations (signing, decryption) happen inside the vault.
 */

export interface MeritsVault {
  /**
   * Store an identity (AID + private key + metadata)
   *
   * @param name - Human-friendly name for the identity
   * @param identity - Identity data including private key
   */
  storeIdentity(
    name: string,
    identity: {
      aid: string;
      privateKey: Uint8Array;
      ksn: number;
      metadata?: Record<string, any>;
    }
  ): Promise<void>;

  /**
   * Retrieve identity metadata (public data only, no private key)
   *
   * @param name - Identity name
   * @returns Public identity data
   * @throws Error if identity not found
   */
  getIdentity(name: string): Promise<{
    aid: string;
    ksn: number;
    metadata?: Record<string, any>;
  }>;

  /**
   * List all stored identity names
   *
   * @returns Array of identity names
   */
  listIdentities(): Promise<string[]>;

  /**
   * Sign data with indexed signature format (key stays in vault)
   *
   * @param name - Identity name
   * @param data - Data to sign (raw bytes)
   * @returns Indexed signature array (e.g., ["0-<base64url>"])
   * @throws Error if identity not found
   */
  signIndexed(name: string, data: Uint8Array): Promise<string[]>;

  /**
   * Decrypt ciphertext using stored private key (key stays in vault)
   *
   * @param name - Identity name
   * @param ct - Ciphertext (base64)
   * @param opts - Decryption options (algorithm, ephemeral key)
   * @returns Plaintext (string)
   * @throws Error if identity not found or decryption fails
   */
  decrypt(
    name: string,
    ct: string,
    opts?: { ek?: string; alg?: string }
  ): Promise<string>;

  /**
   * Export private key (use sparingly, for migration/backup only)
   *
   * @param name - Identity name
   * @returns Raw private key bytes
   * @throws Error if identity not found
   */
  exportPrivateKey(name: string): Promise<Uint8Array>;

  /**
   * Delete an identity (irreversible)
   *
   * @param name - Identity name
   * @throws Error if identity not found
   */
  deleteIdentity(name: string): Promise<void>;

  /**
   * Flush any cached metadata to persistent storage
   *
   * Called automatically on process exit, but can be called manually
   * to ensure durability after critical operations.
   */
  flush(): Promise<void>;
}

/**
 * Identity metadata structure (stored outside vault)
 */
export interface IdentityMetadata {
  version: number;
  identities: Record<
    string,
    {
      aid: string;
      ksn: number;
      metadata?: Record<string, any>;
      createdAt: number;
      updatedAt: number;
    }
  >;
}

/**
 * Vault factory error types
 */
export class VaultError extends Error {
  constructor(
    message: string,
    public code:
      | "NOT_FOUND"
      | "INVALID_KEY"
      | "DECRYPT_FAILED"
      | "STORAGE_ERROR"
      | "ALREADY_EXISTS"
  ) {
    super(message);
    this.name = "VaultError";
  }
}
