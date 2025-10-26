/**
 * OSKeychainVault
 *
 * Stores private keys in OS credential store:
 * - macOS: Keychain
 * - Linux: Secret Service API (libsecret)
 * - Windows: Credential Manager
 *
 * Metadata (public data) stored in ~/.merits/identities.json
 * with lazy-loading and flush-on-dirty for performance.
 */

import * as keytar from "keytar";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { signPayload } from "../../../core/crypto";
import type {
  MeritsVault,
  IdentityMetadata,
} from "./MeritsVault";
import { VaultError } from "./MeritsVault";

const SERVICE_NAME = "com.merits.cli";
const METADATA_FILENAME = "identities.json";

export class OSKeychainVault implements MeritsVault {
  private metadataPath: string;
  private metadata: IdentityMetadata | null = null; // Lazy-loaded
  private metadataDirty = false;

  constructor(meritsDir?: string) {
    const baseDir = meritsDir || path.join(os.homedir(), ".merits");
    this.metadataPath = path.join(baseDir, METADATA_FILENAME);

    // Ensure directory exists with secure permissions
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Store identity with private key in OS keychain
   */
  async storeIdentity(
    name: string,
    identity: {
      aid: string;
      privateKey: Uint8Array;
      ksn: number;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const metadata = this.getMetadata();

    // Check if identity already exists
    if (metadata.identities[name]) {
      throw new VaultError(
        `Identity '${name}' already exists`,
        "ALREADY_EXISTS"
      );
    }

    // Store private key in OS keychain
    const privateKeyBase64 = Buffer.from(identity.privateKey).toString(
      "base64"
    );
    await keytar.setPassword(SERVICE_NAME, name, privateKeyBase64);

    // Store metadata (public data only)
    const now = Date.now();
    metadata.identities[name] = {
      aid: identity.aid,
      ksn: identity.ksn,
      metadata: identity.metadata,
      createdAt: now,
      updatedAt: now,
    };

    this.markDirty();
    await this.flush();
  }

  /**
   * Get identity metadata (no private key)
   */
  async getIdentity(name: string): Promise<{
    aid: string;
    ksn: number;
    metadata?: Record<string, any>;
  }> {
    const metadata = this.getMetadata();
    const identity = metadata.identities[name];

    if (!identity) {
      throw new VaultError(
        `Identity '${name}' not found`,
        "NOT_FOUND"
      );
    }

    return {
      aid: identity.aid,
      ksn: identity.ksn,
      metadata: identity.metadata,
    };
  }

  /**
   * List all identity names
   */
  async listIdentities(): Promise<string[]> {
    const metadata = this.getMetadata();
    return Object.keys(metadata.identities);
  }

  /**
   * Sign data with indexed signature (key stays in keychain)
   */
  async signIndexed(name: string, data: Uint8Array): Promise<string[]> {
    const privateKey = await this.getPrivateKey(name);
    return await signPayload(
      { raw: Buffer.from(data).toString("base64") },
      privateKey,
      0
    );
  }

  /**
   * Decrypt ciphertext (key stays in keychain)
   */
  async decrypt(
    name: string,
    ct: string,
    opts?: { ek?: string; alg?: string }
  ): Promise<string> {
    // TODO: Implement ECDH-ES + AES-GCM decryption in Milestone 2
    // For now, placeholder that throws
    throw new Error(
      "Decryption not yet implemented (Milestone 2)"
    );
  }

  /**
   * Export private key (use sparingly)
   */
  async exportPrivateKey(name: string): Promise<Uint8Array> {
    return await this.getPrivateKey(name);
  }

  /**
   * Delete identity from keychain and metadata
   */
  async deleteIdentity(name: string): Promise<void> {
    const metadata = this.getMetadata();

    if (!metadata.identities[name]) {
      throw new VaultError(
        `Identity '${name}' not found`,
        "NOT_FOUND"
      );
    }

    // Delete from keychain
    await keytar.deletePassword(SERVICE_NAME, name);

    // Delete from metadata
    delete metadata.identities[name];
    this.markDirty();
    await this.flush();
  }

  /**
   * Update identity metadata without touching private key
   */
  async updateMetadata(name: string, patch: Partial<Record<string, any>>): Promise<void> {
    const metadata = this.getMetadata();
    const identity = metadata.identities[name];

    if (!identity) {
      throw new VaultError(
        `Identity '${name}' not found`,
        "NOT_FOUND"
      );
    }

    // Merge patch into existing metadata
    identity.metadata = {
      ...identity.metadata,
      ...patch,
    };
    identity.updatedAt = Date.now();

    this.markDirty();
    await this.flush();
  }

  /**
   * Get public key from metadata (no private key access)
   */
  async getPublicKey(name: string): Promise<Uint8Array> {
    const identity = await this.getIdentity(name);

    if (!identity.metadata?.publicKey) {
      throw new VaultError(
        `Public key for '${name}' not found in metadata. ` +
        `This identity may have been created with an older version. ` +
        `Please re-import or re-register the identity.`,
        "NOT_FOUND"
      );
    }

    // Public key is stored as Uint8Array in metadata
    // If it was serialized as base64, convert it back
    const pk = identity.metadata.publicKey;
    if (typeof pk === "string") {
      return Buffer.from(pk, "base64");
    }

    // If it's already a buffer/Uint8Array
    if (pk instanceof Uint8Array) {
      return pk;
    }

    // If it's a plain object with numeric keys (JSON serialization of Uint8Array)
    if (typeof pk === "object" && !Array.isArray(pk)) {
      const arr = Object.values(pk) as number[];
      return new Uint8Array(arr);
    }

    throw new VaultError(
      `Invalid public key format for '${name}'`,
      "INVALID_KEY"
    );
  }

  /**
   * Flush metadata to disk if dirty
   */
  async flush(): Promise<void> {
    if (!this.metadataDirty || !this.metadata) {
      return;
    }

    try {
      const json = JSON.stringify(this.metadata, null, 2);
      fs.writeFileSync(this.metadataPath, json, { mode: 0o600 });
      this.metadataDirty = false;
    } catch (err) {
      throw new VaultError(
        `Failed to write metadata: ${err}`,
        "STORAGE_ERROR"
      );
    }
  }

  // --- Private methods ---

  /**
   * Get metadata (lazy-load from disk)
   */
  private getMetadata(): IdentityMetadata {
    if (!this.metadata) {
      this.metadata = this.loadMetadata();
    }
    return this.metadata;
  }

  /**
   * Load metadata from disk
   */
  private loadMetadata(): IdentityMetadata {
    if (!fs.existsSync(this.metadataPath)) {
      return {
        version: 1,
        identities: {},
      };
    }

    try {
      const json = fs.readFileSync(this.metadataPath, "utf-8");
      return JSON.parse(json);
    } catch (err) {
      throw new VaultError(
        `Failed to load metadata: ${err}`,
        "STORAGE_ERROR"
      );
    }
  }

  /**
   * Mark metadata as dirty (needs flush)
   */
  private markDirty(): void {
    this.metadataDirty = true;
  }

  /**
   * Get private key from keychain
   */
  private async getPrivateKey(name: string): Promise<Uint8Array> {
    const privateKeyBase64 = await keytar.getPassword(SERVICE_NAME, name);

    if (!privateKeyBase64) {
      throw new VaultError(
        `Private key for '${name}' not found in keychain`,
        "NOT_FOUND"
      );
    }

    return Buffer.from(privateKeyBase64, "base64");
  }
}

/**
 * Flush vault on process exit (best-effort)
 */
export function setupFlushOnExit(vault: OSKeychainVault): void {
  const handler = async () => {
    try {
      await vault.flush();
    } catch (err) {
      // Ignore errors during shutdown
    }
  };

  process.on("exit", () => {
    handler();
  });
  process.on("SIGINT", () => {
    handler();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    handler();
    process.exit(0);
  });
}
