/**
 * Merits Client Factory
 *
 * Creates backend-specific implementations of the MeritsClient interface.
 * The CLI uses this factory to get a client based on configuration.
 */

import type { ResolvedConfig } from '../../cli/lib/config';
import type { Credentials } from '../../cli/lib/credentials';
import { Ed25519Signer } from '../../core/Ed25519Signer';
import { ConvexMeritsClient } from './convex';
import type { MeritsClient as MeritsClientInterface, Signer } from './types';

/**
 * Create MeritsClient with signer
 *
 * Main factory method for creating authenticated clients.
 * Stores the signer and private key internally so individual operations
 * don't need credentials.
 *
 * @param aid - User's AID
 * @param signer - Signer for authentication and message signing
 * @param privateKeyBytes - Private key bytes for encryption operations (X25519 ECDH)
 * @param config - Optional backend configuration (uses defaults if omitted)
 * @returns MeritsClient instance with stored authentication context
 *
 * @example
 * ```typescript
 * const privateKey = new Uint8Array(32); // Your Ed25519 private key
 * const publicKey = new Uint8Array(32);  // Your Ed25519 public key
 * const signer = new Ed25519Signer(privateKey, publicKey);
 * const client = MeritsClient.getOrCreate(aid, signer, privateKey, config);
 *
 * // Operations use stored signer and keys automatically
 * await client.sendMessage(recipientAid, "Hello!");
 * await client.sendGroupMessage(groupId, "Hello team!");
 * ```
 */
export function getOrCreate(
  aid: string,
  signer: Signer,
  privateKeyBytes: Uint8Array,
  config?: Partial<ResolvedConfig>,
): MeritsClientInterface {
  // Use provided config or defaults
  const backendType = config?.backend?.type ?? 'convex';
  const backendUrl = config?.backend?.url ?? process.env.CONVEX_URL;

  if (!backendUrl) {
    throw new Error('Backend URL is required. Set CONVEX_URL environment variable or pass config with backend.url');
  }

  const ksn = 0; // Default to initial key

  switch (backendType) {
    case 'convex':
      return new ConvexMeritsClient(backendUrl, aid, signer, privateKeyBytes, ksn);

    case 'rest':
      throw new Error(
        'REST backend not yet implemented. ' + 'Please use Convex backend or contribute a REST implementation!',
      );

    case 'local':
      throw new Error(
        'Local backend not yet implemented. ' + 'Please use Convex backend or contribute a local implementation!',
      );

    default: {
      const exhaustiveCheck: never = backendType;
      throw new Error(`Unknown backend type: ${exhaustiveCheck}`);
    }
  }
}

/**
 * Convenience factory from CLI credentials
 *
 * Creates a client from credentials loaded via loadCredentials().
 * Automatically creates the signer from private/public key pair.
 *
 * @param credentials - Credentials from loadCredentials()
 * @param config - Optional backend configuration
 * @returns MeritsClient instance
 *
 * @example
 * ```typescript
 * const creds = loadCredentials();
 * const client = MeritsClient.fromCredentials(creds, config);
 * ```
 */
export function fromCredentials(credentials: Credentials, config?: Partial<ResolvedConfig>): MeritsClientInterface {
  // Decode private and public keys from base64url
  const privateKeyBytes = Buffer.from(credentials.privateKey, 'base64url');
  const publicKeyBytes = Buffer.from(credentials.publicKey, 'base64url');

  // Create signer
  const signer = new Ed25519Signer(privateKeyBytes, publicKeyBytes);

  // Create client with signer and private key bytes (for encryption)
  return getOrCreate(credentials.aid, signer, privateKeyBytes, config);
}

// Create a namespace-like object for the API
export const MeritsClient = {
  getOrCreate,
  fromCredentials,
};

// Re-export types for convenience
export type { IdentityRegistry, Signer } from './types';
