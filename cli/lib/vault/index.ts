/**
 * Vault Factory
 *
 * Creates appropriate vault implementation based on environment.
 * - OSKeychainVault: Production (macOS/Linux/Windows)
 * - FileVault: Testing with dataDir (INSECURE)
 */

export type { MeritsVault, IdentityMetadata } from "./MeritsVault";
export { VaultError } from "./MeritsVault";
export { OSKeychainVault, setupFlushOnExit } from "./OSKeychainVault";
export { FileVault } from "./FileVault";

import { OSKeychainVault, setupFlushOnExit } from "./OSKeychainVault";
import { FileVault } from "./FileVault";
import type { MeritsVault } from "./MeritsVault";
import type { ResolvedConfig } from "../config";
import { resolveVaultPath, resolveDataDir } from "../config";
import * as path from "path";

/**
 * Create a vault instance
 *
 * @param config - Resolved configuration
 * @returns MeritsVault implementation
 *
 * Selection logic:
 * - If config.dataDir is set → FileVault (for testing)
 * - Otherwise → OSKeychainVault (production)
 *
 * @example
 * ```typescript
 * // Production: Uses OS Keychain
 * const vault = createVault(config);
 *
 * // Testing: Uses FileVault
 * const testConfig = { ...config, dataDir: './test-data/alice' };
 * const testVault = createVault(testConfig);
 * ```
 */
export function createVault(config: Partial<ResolvedConfig>): MeritsVault {
  const metadataPath = resolveVaultPath(config);

  // If dataDir is set, use FileVault for testing
  if (config.dataDir) {
    const keychainDir = path.join(resolveDataDir(config), "keychain");
    const vault = new FileVault(metadataPath, keychainDir);
    setupFlushOnExit(vault);

    // Warn about insecure vault
    if (!process.env.MERITS_VAULT_QUIET) {
      console.warn("⚠️  WARNING: Using file-based vault (INSECURE)");
      console.warn("   This is for testing only. Production should use OS Keychain.");
      console.warn("   Set MERITS_VAULT_PASSWORD to change encryption password.");
      console.warn("   Set MERITS_VAULT_QUIET=1 to suppress this warning.");
    }

    return vault;
  }

  // Production: Use OS Keychain
  const vault = new OSKeychainVault(metadataPath);
  setupFlushOnExit(vault);
  return vault;
}
