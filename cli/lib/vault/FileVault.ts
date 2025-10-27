/**
 * File-Based Vault (INSECURE - Testing Only)
 *
 * Stores private keys in encrypted files on disk.
 * Uses deterministic password from environment variable.
 *
 * ⚠️  WARNING: This is INSECURE and only for testing!
 *     - Private keys stored on disk (encrypted but weak)
 *     - Uses deterministic password
 *     - No hardware security module
 *     - Production MUST use OSKeychainVault
 */

import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { MeritsVault, IdentityData, VaultMetadata } from "./MeritsVault";
import { VaultError } from "./MeritsVault";

/**
 * FileVault implementation for testing
 *
 * Directory structure:
 * {dataDir}/
 * ├── identities.json       # Metadata (public)
 * └── keychain/
 *     ├── alice.key         # Encrypted private keys
 *     └── bob.key
 */
export class FileVault implements MeritsVault {
  private metadataPath: string;
  private keychainDir: string;
  private metadata: VaultMetadata | null = null;
  private dirty: boolean = false;

  constructor(metadataPath: string, keychainDir: string) {
    this.metadataPath = metadataPath;
    this.keychainDir = keychainDir;
    this.ensureDirectories();
  }

  /**
   * Ensure directories exist
   */
  private ensureDirectories(): void {
    const metadataDir = path.dirname(this.metadataPath);
    if (!fsSync.existsSync(metadataDir)) {
      fsSync.mkdirSync(metadataDir, { recursive: true, mode: 0o700 });
    }
    if (!fsSync.existsSync(this.keychainDir)) {
      fsSync.mkdirSync(this.keychainDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Get encryption password from environment
   */
  private getPassword(): string {
    return process.env.MERITS_VAULT_PASSWORD || "test-password-insecure";
  }

  /**
   * Encrypt private key for storage
   */
  private encryptKey(privateKey: Uint8Array): string {
    const password = this.getPassword();
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(password, salt, 32);
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(privateKey)),
      cipher.final(),
    ]);

    // Format: salt:iv:ciphertext (all base64)
    return `${salt.toString("base64")}:${iv.toString("base64")}:${encrypted.toString("base64")}`;
  }

  /**
   * Decrypt private key from storage
   */
  private decryptKey(encrypted: string): Uint8Array {
    const password = this.getPassword();
    const [saltB64, ivB64, ciphertextB64] = encrypted.split(":");

    const salt = Buffer.from(saltB64, "base64");
    const iv = Buffer.from(ivB64, "base64");
    const ciphertext = Buffer.from(ciphertextB64, "base64");

    const key = crypto.scryptSync(password, salt, 32);
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return new Uint8Array(decrypted);
  }

  /**
   * Get keychain file path for identity
   */
  private getKeyPath(name: string): string {
    return path.join(this.keychainDir, `${name}.key`);
  }

  /**
   * Load metadata from disk
   */
  private getMetadata(): VaultMetadata {
    if (this.metadata) return this.metadata;

    if (fsSync.existsSync(this.metadataPath)) {
      const data = fsSync.readFileSync(this.metadataPath, "utf-8");
      this.metadata = JSON.parse(data);
    } else {
      this.metadata = {
        version: 1,
        identities: {},
        defaultIdentity: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    return this.metadata;
  }

  /**
   * Mark metadata as dirty (needs flush)
   */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Flush metadata to disk
   */
  async flush(): Promise<void> {
    if (!this.dirty || !this.metadata) return;

    this.metadata.updatedAt = Date.now();

    await fs.writeFile(
      this.metadataPath,
      JSON.stringify(this.metadata, null, 2),
      { mode: 0o600 }
    );

    this.dirty = false;
  }

  /**
   * Store identity (writes private key to encrypted file)
   */
  async storeIdentity(name: string, identity: IdentityData): Promise<void> {
    const metadata = this.getMetadata();

    if (metadata.identities[name]) {
      throw new VaultError(`Identity '${name}' already exists`, "DUPLICATE");
    }

    // Encrypt and write private key to file
    const encrypted = this.encryptKey(identity.privateKey);
    const keyPath = this.getKeyPath(name);
    await fs.writeFile(keyPath, encrypted, { mode: 0o600 });

    // Store metadata (no private key!)
    metadata.identities[name] = {
      aid: identity.aid,
      ksn: identity.ksn,
      metadata: identity.metadata || {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.markDirty();
    await this.flush();
  }

  /**
   * Get identity (reads private key from encrypted file)
   */
  async getIdentity(name: string): Promise<IdentityData> {
    const metadata = this.getMetadata();
    const identity = metadata.identities[name];

    if (!identity) {
      throw new VaultError(`Identity '${name}' not found`, "NOT_FOUND");
    }

    // Read and decrypt private key
    const keyPath = this.getKeyPath(name);
    if (!fsSync.existsSync(keyPath)) {
      throw new VaultError(
        `Private key file not found for '${name}'`,
        "NOT_FOUND"
      );
    }

    const encrypted = await fs.readFile(keyPath, "utf-8");
    const privateKey = this.decryptKey(encrypted);

    return {
      aid: identity.aid,
      privateKey,
      ksn: identity.ksn,
      metadata: identity.metadata,
    };
  }

  /**
   * List all identities (metadata only, no private keys)
   */
  async listIdentities(): Promise<string[]> {
    const metadata = this.getMetadata();
    return Object.keys(metadata.identities);
  }

  /**
   * Sign data with identity's private key
   */
  async signIndexed(name: string, data: Uint8Array): Promise<string[]> {
    const identity = await this.getIdentity(name);

    // Import sign from core/crypto
    const { sign, createIndexedSignature } = await import("../../../core/crypto");

    const signature = await sign(data, identity.privateKey);
    const indexedSig = createIndexedSignature(identity.ksn, signature);

    return [indexedSig];
  }

  /**
   * Export private key (DANGEROUS!)
   */
  async exportPrivateKey(name: string): Promise<Uint8Array> {
    const identity = await this.getIdentity(name);
    return identity.privateKey;
  }

  /**
   * Delete identity (removes encrypted key file)
   */
  async deleteIdentity(name: string): Promise<void> {
    const metadata = this.getMetadata();

    if (!metadata.identities[name]) {
      throw new VaultError(`Identity '${name}' not found`, "NOT_FOUND");
    }

    // Delete encrypted key file
    const keyPath = this.getKeyPath(name);
    if (fsSync.existsSync(keyPath)) {
      await fs.unlink(keyPath);
    }

    // Remove from metadata
    delete metadata.identities[name];

    // Clear default if this was it
    if (metadata.defaultIdentity === name) {
      metadata.defaultIdentity = null;
    }

    this.markDirty();
    await this.flush();
  }

  /**
   * Update metadata without touching private key
   */
  async updateMetadata(name: string, patch: Partial<Record<string, any>>): Promise<void> {
    const metadata = this.getMetadata();
    const identity = metadata.identities[name];

    if (!identity) {
      throw new VaultError(`Identity '${name}' not found`, "NOT_FOUND");
    }

    identity.metadata = {
      ...identity.metadata,
      ...patch,
    };
    identity.updatedAt = Date.now();

    this.markDirty();
    await this.flush();
  }

  /**
   * Get public key from metadata
   */
  async getPublicKey(name: string): Promise<Uint8Array> {
    const metadata = this.getMetadata();
    const identity = metadata.identities[name];

    if (!identity) {
      throw new VaultError(`Identity '${name}' not found`, "NOT_FOUND");
    }

    if (!identity.metadata?.publicKey) {
      throw new VaultError(
        `Public key for '${name}' not found in metadata`,
        "NOT_FOUND"
      );
    }

    const pk = identity.metadata.publicKey;
    if (typeof pk === "string") {
      return Buffer.from(pk, "base64");
    }
    if (pk instanceof Uint8Array) {
      return pk;
    }
    if (typeof pk === "object" && !Array.isArray(pk)) {
      const arr = Object.values(pk) as number[];
      return new Uint8Array(arr);
    }

    throw new VaultError(`Invalid public key format for '${name}'`, "INVALID_KEY");
  }

  /**
   * Set default identity
   */
  async setDefaultIdentity(name: string): Promise<void> {
    const metadata = this.getMetadata();

    if (!metadata.identities[name]) {
      throw new VaultError(`Identity '${name}' not found`, "NOT_FOUND");
    }

    metadata.defaultIdentity = name;
    this.markDirty();
    await this.flush();
  }

  /**
   * Get default identity name
   */
  async getDefaultIdentity(): Promise<string | null> {
    const metadata = this.getMetadata();
    return metadata.defaultIdentity;
  }

  /**
   * Decrypt message (placeholder - not implemented)
   */
  async decrypt(identityName: string, ciphertext: string): Promise<string> {
    throw new VaultError(
      "Decryption not yet implemented",
      "NOT_IMPLEMENTED"
    );
  }
}
