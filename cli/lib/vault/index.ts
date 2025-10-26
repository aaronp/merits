/**
 * Vault Factory
 *
 * Creates appropriate vault implementation based on environment.
 * Future: Add EncryptedFileVault for headless/unsupported systems.
 */

export type { MeritsVault, IdentityMetadata } from "./MeritsVault";
export { VaultError } from "./MeritsVault";
export { OSKeychainVault, setupFlushOnExit } from "./OSKeychainVault";

import { OSKeychainVault, setupFlushOnExit } from "./OSKeychainVault";
import type { MeritsVault } from "./MeritsVault";

/**
 * Create a vault instance
 *
 * @param options.type - Vault type ('keychain' | 'encrypted-file')
 * @param options.meritsDir - Base directory for metadata (default: ~/.merits)
 * @returns MeritsVault implementation
 *
 * @example
 * ```typescript
 * const vault = createVault();
 * setupFlushOnExit(vault); // Auto-flush on process exit
 * ```
 */
export function createVault(options?: {
  type?: "keychain" | "encrypted-file";
  meritsDir?: string;
}): MeritsVault {
  const type = options?.type || "keychain";

  switch (type) {
    case "keychain": {
      const vault = new OSKeychainVault(options?.meritsDir);
      setupFlushOnExit(vault);
      return vault;
    }

    case "encrypted-file":
      // TODO: Implement in future milestone
      throw new Error("EncryptedFileVault not yet implemented");

    default:
      throw new Error(`Unknown vault type: ${type}`);
  }
}
