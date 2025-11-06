/**
 * Credentials Management
 *
 * Handles storage, retrieval of signing credentials for authenticated requests.
 * Replaces session tokens with private keys for per-request signing.
 *
 * Features:
 * - Secure file storage with 0600 permissions
 * - Environment variable fallback (MERITS_CREDENTIALS)
 * - Default path: .merits/credentials.json
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

/**
 * Credentials structure for signing requests
 */
export interface Credentials {
  /** User's AID (public key identifier) */
  aid: string;

  /** Private key for signing (base64url encoded) */
  privateKey: string;

  /** Public key (base64url encoded) */
  publicKey: string;

  /** Key sequence number */
  ksn: number;
}

/**
 * Full identity file structure (from incept command)
 */
export interface IdentityFile {
  aid: string;
  keys: {
    privateKey: string;
    publicKey: string;
  };
  ksn?: number;
}

/**
 * Default credentials path
 */
const DEFAULT_CREDENTIALS_PATH = ".merits/credentials.json";

/**
 * Get the absolute path for credentials storage
 *
 * @param path - Optional path override (relative or absolute)
 * @returns Absolute path to credentials file
 */
export function getCredentialsPath(path?: string): string {
  if (path) {
    // If absolute path, use as-is
    if (path.startsWith("/") || path.startsWith("~")) {
      return path.replace("~", homedir());
    }
    // Otherwise, relative to cwd
    return join(process.cwd(), path);
  }

  // Default: .merits/credentials.json in cwd
  return join(process.cwd(), DEFAULT_CREDENTIALS_PATH);
}

/**
 * Ensure the .merits directory exists with proper permissions
 *
 * @param credentialsPath - Path to credentials file
 */
function ensureCredentialsDir(credentialsPath: string): void {
  const dir = dirname(credentialsPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Load credentials from file or environment
 *
 * Priority:
 * 1. MERITS_CREDENTIALS environment variable (for scripting)
 * 2. .merits file in CWD (project-level config from incept)
 * 3. File at specified path
 * 4. File at default path
 *
 * @param path - Optional path to credentials file
 * @returns Credentials object or null if not found
 *
 * @example
 * ```typescript
 * const creds = loadCredentials();
 * if (creds) {
 *   // Use creds.privateKey for signing
 * }
 * ```
 */
export function loadCredentials(path?: string): Credentials | null {
  // Check environment variable first (for scripting)
  const envCreds = process.env.MERITS_CREDENTIALS;
  if (envCreds) {
    try {
      const parsed = JSON.parse(envCreds);

      // Support both flat format and identity file format
      if (parsed.keys) {
        return {
          aid: parsed.aid,
          privateKey: parsed.keys.privateKey,
          publicKey: parsed.keys.publicKey,
          ksn: parsed.ksn ?? 0,
        };
      } else {
        return {
          aid: parsed.aid,
          privateKey: parsed.privateKey,
          publicKey: parsed.publicKey,
          ksn: parsed.ksn ?? 0,
        };
      }
    } catch (err) {
      console.error("Failed to parse MERITS_CREDENTIALS environment variable:", err);
      return null;
    }
  }

  // Check .merits file in CWD (project-level config)
  const projectConfigPath = join(process.cwd(), ".merits");
  if (!path && existsSync(projectConfigPath)) {
    try {
      const content = readFileSync(projectConfigPath, "utf-8");
      const parsed = JSON.parse(content);

      if (parsed.credentials) {
        return {
          aid: parsed.credentials.aid,
          privateKey: parsed.credentials.privateKey,
          publicKey: parsed.credentials.publicKey,
          ksn: parsed.credentials.ksn ?? 0,
        };
      }
    } catch (err) {
      // Silently ignore - will try other paths
    }
  }

  // Load from file
  const credentialsPath = getCredentialsPath(path);

  if (!existsSync(credentialsPath)) {
    return null;
  }

  try {
    const content = readFileSync(credentialsPath, "utf-8");
    const parsed = JSON.parse(content);

    // Handle two formats:
    // 1. Identity file format: { aid, keys: { privateKey, publicKey }, ksn? }
    // 2. Flat credentials format: { aid, privateKey, publicKey, ksn }

    if (parsed.keys) {
      // Identity file format
      const identity: IdentityFile = parsed;
      return {
        aid: identity.aid,
        privateKey: identity.keys.privateKey,
        publicKey: identity.keys.publicKey,
        ksn: identity.ksn ?? 0,
      };
    } else if (parsed.aid && parsed.privateKey && parsed.publicKey) {
      // Flat credentials format
      return {
        aid: parsed.aid,
        privateKey: parsed.privateKey,
        publicKey: parsed.publicKey,
        ksn: parsed.ksn ?? 0,
      };
    } else {
      throw new Error("Invalid credentials structure");
    }
  } catch (err) {
    console.error(`Failed to load credentials from ${credentialsPath}:`, err);
    return null;
  }
}

/**
 * Save credentials to file with secure permissions
 *
 * @param credentials - Credentials object to save
 * @param path - Optional path to credentials file
 *
 * @example
 * ```typescript
 * saveCredentials({
 *   aid: "Dabc123...",
 *   privateKey: "...",
 *   publicKey: "...",
 *   ksn: 0,
 * });
 * ```
 */
export function saveCredentials(credentials: Credentials, path?: string): void {
  const credentialsPath = getCredentialsPath(path);

  // Ensure .merits directory exists
  ensureCredentialsDir(credentialsPath);

  // Write credentials file
  const content = JSON.stringify(credentials, null, 2);
  writeFileSync(credentialsPath, content, { mode: 0o600 });

  // Explicitly set permissions (some systems don't respect mode in writeFileSync)
  try {
    chmodSync(credentialsPath, 0o600);
  } catch (err) {
    console.warn(`Warning: Could not set permissions on ${credentialsPath}:`, err);
  }
}

/**
 * Load or throw error if credentials are missing
 *
 * Convenience function for commands that require authentication.
 *
 * @param path - Optional path to credentials file
 * @returns Credentials
 * @throws Error if credentials not found
 *
 * @example
 * ```typescript
 * const creds = requireCredentials(opts.credentials);
 * // Use creds.privateKey for signing
 * ```
 */
export function requireCredentials(path?: string): Credentials {
  const creds = loadCredentials(path);

  if (!creds) {
    throw new Error(
      `No credentials found. Please authenticate first:\n` +
        `  merits incept --seed <your-seed> > identity.json\n` +
        `  merits <command> --credentials identity.json\n\n` +
        `Or set MERITS_CREDENTIALS environment variable with your identity JSON.`
    );
  }

  return creds;
}
