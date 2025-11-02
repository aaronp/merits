/**
 * Session Token Management
 *
 * Handles storage, retrieval, and refresh of session tokens.
 * Session tokens are short-lived (60s max) and bound to a user's public key.
 *
 * Features:
 * - Secure file storage with 0600 permissions
 * - Environment variable fallback (MERITS_TOKEN)
 * - Automatic token refresh (when needed)
 * - Default path: .merits/session.json
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

/**
 * Session token structure
 */
export interface SessionToken {
  token: string;
  expiresAt: number;
  aid: string;
  ksn?: number;
  keys?: {
    privateKey: string;
    publicKey: string;
  };
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
  session: {
    token: string;
    aid: string;
    expiresAt: number;
  };
}

/**
 * Default session token path
 */
const DEFAULT_TOKEN_PATH = ".merits/session.json";

/**
 * Get the absolute path for session token storage
 *
 * @param path - Optional path override (relative or absolute)
 * @returns Absolute path to session token file
 */
export function getSessionTokenPath(path?: string): string {
  if (path) {
    // If absolute path, use as-is
    if (path.startsWith("/") || path.startsWith("~")) {
      return path.replace("~", homedir());
    }
    // Otherwise, relative to cwd
    return join(process.cwd(), path);
  }

  // Default: .merits/session.json in cwd
  return join(process.cwd(), DEFAULT_TOKEN_PATH);
}

/**
 * Ensure the .merits directory exists with proper permissions
 *
 * @param tokenPath - Path to session token file
 */
function ensureSessionDir(tokenPath: string): void {
  const dir = dirname(tokenPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Load session token from file or environment
 *
 * Priority:
 * 1. MERITS_TOKEN environment variable (for scripting)
 * 2. File at specified path
 * 3. File at default path
 *
 * @param path - Optional path to session token file
 * @returns Session token object or null if not found
 *
 * @example
 * ```typescript
 * const session = loadSessionToken();
 * if (session && session.expiresAt > Date.now()) {
 *   // Token is valid
 * }
 * ```
 */
export function loadSessionToken(path?: string): SessionToken | null {
  // Check environment variable first (for scripting)
  const envToken = process.env.MERITS_TOKEN;
  if (envToken) {
    try {
      const parsed = JSON.parse(envToken);
      return {
        token: parsed.token || envToken, // Support both raw token and JSON
        expiresAt: parsed.expiresAt || Date.now() + 60000, // Default to 60s expiry
        aid: parsed.aid || "unknown",
        ksn: parsed.ksn,
      };
    } catch {
      // If not JSON, treat as raw token
      return {
        token: envToken,
        expiresAt: Date.now() + 60000, // Default to 60s expiry
        aid: "unknown",
      };
    }
  }

  // Load from file
  const tokenPath = getSessionTokenPath(path);

  if (!existsSync(tokenPath)) {
    return null;
  }

  try {
    const content = readFileSync(tokenPath, "utf-8");
    const parsed = JSON.parse(content);

    // Handle two formats:
    // 1. New format from incept: { aid, keys: {...}, session: { token, aid, expiresAt } }
    // 2. Old flat format: { token, aid, expiresAt, ksn? }

    if (parsed.session && parsed.keys) {
      // New incept format
      const identity: IdentityFile = parsed;
      return {
        token: identity.session.token,
        expiresAt: identity.session.expiresAt,
        aid: identity.aid,
        keys: identity.keys,
      };
    } else if (parsed.token && parsed.expiresAt && parsed.aid) {
      // Old flat format (backward compat)
      return {
        token: parsed.token,
        expiresAt: parsed.expiresAt,
        aid: parsed.aid,
        ksn: parsed.ksn,
        keys: parsed.keys, // May be undefined
      };
    } else {
      throw new Error("Invalid session token structure");
    }
  } catch (err) {
    console.error(`Failed to load session token from ${tokenPath}:`, err);
    return null;
  }
}

/**
 * Save session token to file with secure permissions
 *
 * @param session - Session token object to save
 * @param path - Optional path to session token file
 *
 * @example
 * ```typescript
 * saveSessionToken({
 *   token: "abc123",
 *   expiresAt: Date.now() + 60000,
 *   aid: "alice",
 * });
 * ```
 */
export function saveSessionToken(session: SessionToken, path?: string): void {
  const tokenPath = getSessionTokenPath(path);

  // Ensure .merits directory exists
  ensureSessionDir(tokenPath);

  // Write token file
  const content = JSON.stringify(session, null, 2);
  writeFileSync(tokenPath, content, { mode: 0o600 });

  // Explicitly set permissions (some systems don't respect mode in writeFileSync)
  try {
    chmodSync(tokenPath, 0o600);
  } catch (err) {
    console.warn(`Warning: Could not set permissions on ${tokenPath}:`, err);
  }
}

/**
 * Check if session token is expired
 *
 * @param session - Session token to check
 * @param bufferMs - Buffer time in milliseconds (refresh before actual expiry)
 * @returns True if token is expired or about to expire
 */
export function isTokenExpired(session: SessionToken, bufferMs: number = 5000): boolean {
  return Date.now() + bufferMs >= session.expiresAt;
}

/**
 * Refresh session token if needed
 *
 * This function will be implemented in Phase 2.2 when we integrate with the backend.
 * For now, it's a placeholder that returns the existing token.
 *
 * @param session - Current session token
 * @param client - Merits client (for backend communication)
 * @returns Refreshed session token
 */
export async function refreshSessionTokenIfNeeded(
  session: SessionToken,
  client: any // TODO: Type this as MeritsClient when available
): Promise<SessionToken> {
  // Check if token needs refresh (within 5s of expiry)
  if (!isTokenExpired(session, 5000)) {
    return session;
  }

  // TODO: Implement token refresh via backend (Phase 2.2)
  // For now, just return the existing token
  console.warn("Token refresh not yet implemented. Token may be expired.");
  return session;
}

/**
 * Load or throw error if session token is missing
 *
 * Convenience function for commands that require authentication.
 *
 * @param path - Optional path to session token file
 * @returns Session token
 * @throws Error if token not found or expired
 *
 * @example
 * ```typescript
 * const session = requireSessionToken(opts.token);
 * // Use session.token for API calls
 * ```
 */
export function requireSessionToken(path?: string): SessionToken {
  const session = loadSessionToken(path);

  if (!session) {
    throw new Error(
      `No session token found. Please authenticate first:\n` +
        `  merits incept --seed <your-seed> > identity.json\n` +
        `  merits <command> --token identity.json`
    );
  }

  if (isTokenExpired(session, 0)) {
    throw new Error(
      `Session token expired. Please authenticate again:\n` +
        `  merits sign-in --id ${session.aid} > challenge.json\n` +
        `  merits sign --file challenge.json --keys <keys.json> > response.json\n` +
        `  merits confirm-challenge --file response.json > new-session.json`
    );
  }

  return session;
}
