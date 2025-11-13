/**
 * CLI Context
 *
 * Shared context for all commands (created by preAction hook).
 * Provides access to config and client.
 */

import type { MeritsClient } from '../../src/client/types';
import type { ResolvedConfig } from './config';

/**
 * CLI context passed to all commands
 *
 * Note: client may be null for commands that don't require authentication
 * (e.g., incept, gen-key). Commands that need the client should check for null.
 */
export interface CLIContext {
  config: ResolvedConfig;
  client: MeritsClient | null;
}

/**
 * Get context from commander options (set by preAction hook)
 */
export function getContext(opts: any): CLIContext {
  const ctx = opts._ctx as CLIContext | undefined;

  if (!ctx) {
    throw new Error('CLI context not initialized. This is a bug in the CLI framework.');
  }

  return ctx;
}
