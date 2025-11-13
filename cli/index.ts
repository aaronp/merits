#!/usr/bin/env bun
/**
 * Merits CLI Entry Point
 *
 * Production entry point that creates the CLI program and executes it.
 * This is a thin wrapper around the program factory (build-program.ts).
 *
 * Responsibilities:
 * - Create the CLI program (via factory)
 * - Parse command-line arguments
 * - Handle top-level errors
 * - Exit with appropriate codes
 *
 * For testing, use the factory directly to avoid process.exit.
 */

import { createMeritsProgram } from './build-program';

/**
 * Main entry point
 */
async function main() {
  const program = createMeritsProgram();
  await program.parseAsync(process.argv);
}

// Execute with error handling
main().catch((error) => {
  // Extract error details
  const errorMessage = error.message || 'Unknown error';
  const errorCode = error.code || 'CLI_ERROR';
  const errorContext = error.context || {};

  // Format error for stderr
  console.error('');
  console.error(`❌ Error: ${errorMessage}`);

  // Show error code if available
  if (error.code) {
    console.error(`   Code: ${error.code}`);
  }

  // Show hint if available
  if (errorContext.hint || error.hint) {
    console.error(`   Hint: ${errorContext.hint || error.hint}`);
  }

  // Show additional context in debug mode
  if (process.env.DEBUG || process.env.MERITS_DEBUG) {
    console.error('');
    console.error('Debug information:');
    console.error(JSON.stringify({ errorCode, errorContext }, null, 2));
    console.error('');
    console.error('Stack trace:');
    console.error(error.stack);
  }

  console.error('');

  // Exit with non-zero code
  process.exit(1);
});
