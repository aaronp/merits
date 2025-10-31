/**
 * Shared Global Options Module
 *
 * Provides centralized handling of global CLI options with type safety
 * and a wrapper pattern for command handlers.
 */

import type { CLIContext } from "./context";

/**
 * Global options available to all commands
 */
export interface GlobalOptions {
  format?: "json" | "pretty" | "raw";
  token?: string;
  noBanner?: boolean;
  verbose?: boolean;
  config?: string;
  convexUrl?: string;
  noColor?: boolean;
  debug?: boolean;
  dataDir?: string;
  _ctx: CLIContext;
}

/**
 * Normalized format type (after processing)
 */
export type NormalizedFormat = "json" | "pretty" | "raw";

/**
 * Normalize format option (defaults to "json")
 */
export function normalizeFormat(format?: string): NormalizedFormat {
  if (format === "pretty" || format === "raw") {
    return format;
  }
  return "json"; // Default to json
}

/**
 * Wrap a command handler with global options processing
 *
 * Normalizes options, provides type safety, and handles common patterns
 * like format normalization and banner suppression.
 *
 * @param handler - Command handler function
 * @returns Wrapped handler with normalized options
 *
 * @example
 * ```typescript
 * export const myCommand = withGlobalOptions(async (opts) => {
 *   const format = normalizeFormat(opts.format);
 *   // ... command logic
 * });
 * ```
 */
export function withGlobalOptions<T extends Record<string, any>>(
  handler: (opts: GlobalOptions & T) => Promise<void>
): (opts: GlobalOptions & T) => Promise<void> {
  return async (opts: GlobalOptions & T) => {
    // Normalize format (ensure it's set and valid)
    const normalizedFormat = normalizeFormat(opts.format);
    
    // Ensure _ctx is present
    if (!opts._ctx) {
      throw new Error(
        "CLI context not initialized. This is a bug in the CLI framework."
      );
    }

    // Suppress banner if requested
    if (!opts.noBanner && opts._ctx.config.outputFormat === "json") {
      opts.noBanner = true; // Suppress banners in JSON mode automatically
    }

    // Call handler with normalized options
    await handler({ ...opts, format: normalizedFormat } as GlobalOptions & T);
  };
}

