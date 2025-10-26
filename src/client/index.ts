/**
 * Merits Client Factory
 *
 * Creates backend-specific implementations of the MeritsClient interface.
 * The CLI uses this factory to get a client based on configuration.
 */

import type { MeritsClient } from "./types";
import { ConvexMeritsClient } from "./convex";
import type { ResolvedConfig } from "../../cli/lib/config";

/**
 * Create a Merits client based on backend configuration
 *
 * @param config - Resolved configuration with backend settings
 * @returns Backend-specific MeritsClient implementation
 *
 * @example
 * ```typescript
 * const config = loadConfig();
 * const client = createMeritsClient(config);
 *
 * // Use backend-agnostic interface
 * await client.identityRegistry.registerIdentity({...});
 * await client.transport.sendMessage({...});
 * ```
 */
export function createMeritsClient(config: ResolvedConfig): MeritsClient {
  switch (config.backend.type) {
    case "convex":
      return new ConvexMeritsClient(config.backend.url);

    case "rest":
      // Future: implement REST client
      throw new Error(
        "REST backend not yet implemented. " +
        "Please use Convex backend or contribute a REST implementation!"
      );

    case "local":
      // Future: implement local dev backend
      throw new Error(
        "Local backend not yet implemented. " +
        "Please use Convex backend or contribute a local implementation!"
      );

    default:
      // TypeScript should ensure this is unreachable
      const exhaustiveCheck: never = config.backend.type;
      throw new Error(`Unknown backend type: ${exhaustiveCheck}`);
  }
}

// Re-export types for convenience
export type { MeritsClient, IdentityRegistry, AuthCredentials } from "./types";
