/**
 * In-Process CLI Test Runner
 *
 * Runs CLI commands in-process for fast, debuggable testing.
 * This approach is 10-100x faster than spawning subprocesses.
 *
 * Key features:
 * - Uses Commander's exitOverride() to prevent process.exit
 * - Captures stdout/stderr with configureOutput()
 * - Intercepts console.log/error during execution
 * - Parses JSON output automatically
 * - Preserves error details and exit codes
 * - Allows setting breakpoints in command code
 *
 * Usage:
 * ```typescript
 * const result = await runCliInProcess(["gen-key", "--seed", "test123"], {
 *   env: { CONVEX_URL: "https://test.convex.cloud" }
 * });
 *
 * expect(result.code).toBe(0);
 * expect(result.json.publicKey).toBeDefined();
 * ```
 */

import { createMeritsProgram } from "../../../cli/build-program";
import { CommanderError } from "commander";

/**
 * Result from running a CLI command in-process
 */
export interface CliResult {
  /** Exit code (0 = success, non-zero = error) */
  code: number;
  /** Standard output (includes console.log) */
  stdout: string;
  /** Standard error (includes console.error) */
  stderr: string;
  /** Parsed JSON output (if stdout is valid JSON) */
  json?: any;
  /** Error object (if command threw) */
  error?: Error;
}

/**
 * Options for running CLI commands in-process
 */
export interface RunOptions {
  /** Current working directory */
  cwd?: string;
  /** Environment variables (merged with process.env) */
  env?: Record<string, string>;
  /** Input text (for stdin) */
  input?: string;
}

/**
 * Run a CLI command in-process without spawning a subprocess
 *
 * This function:
 * 1. Creates a fresh Commander program
 * 2. Configures it to throw instead of exiting
 * 3. Captures all output (stdout, stderr, console.log/error)
 * 4. Parses JSON output if possible
 * 5. Returns result with exit code and output
 *
 * @param args - Command arguments (e.g., ["gen-key", "--seed", "test123"])
 * @param opts - Options (cwd, env, input)
 * @returns CliResult with code, stdout, stderr, json, error
 *
 * @example
 * ```typescript
 * // Test key generation
 * const result = await runCliInProcess(["gen-key", "--seed", "test123"]);
 * expect(result.code).toBe(0);
 * expect(result.json.aid).toStartWith("D");
 *
 * // Test with custom environment
 * const result = await runCliInProcess(["incept"], {
 *   env: { CONVEX_URL: "https://test.convex.cloud" }
 * });
 *
 * // Test error handling
 * const result = await runCliInProcess(["invalid-command"]);
 * expect(result.code).not.toBe(0);
 * expect(result.stderr).toContain("unknown command");
 * ```
 */
export async function runCliInProcess(
  args: string[],
  opts: RunOptions = {}
): Promise<CliResult> {
  // Save original environment and cwd
  const originalEnv = { ...process.env };
  const originalCwd = process.cwd();

  // Buffers for capturing output
  let stdoutBuffer = "";
  let stderrBuffer = "";

  // Save original console methods
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  // Track exit code
  let exitCode = 0;
  let caughtError: Error | undefined;

  try {
    // Apply environment overrides
    if (opts.env) {
      Object.assign(process.env, opts.env);
    }

    // Change working directory if specified
    if (opts.cwd) {
      process.chdir(opts.cwd);
    }

    // Intercept console.log (captures output from commands)
    console.log = (...args: any[]) => {
      const text = args.map(String).join(" ");
      stdoutBuffer += text + "\n";
    };

    // Intercept console.error (captures error messages)
    console.error = (...args: any[]) => {
      const text = args.map(String).join(" ");
      stderrBuffer += text + "\n";
    };

    // Create fresh program instance
    const program = createMeritsProgram();

    // Configure Commander to throw instead of exiting
    program.exitOverride((err) => {
      throw err;
    });

    // Configure output capture (Commander's built-in output)
    program.configureOutput({
      writeOut: (str: string) => {
        stdoutBuffer += str;
      },
      writeErr: (str: string) => {
        stderrBuffer += str;
      },
    });

    // Build argv: ["node", "merits", ...args]
    const argv = ["node", "merits", ...args];

    // Parse and execute
    await program.parseAsync(argv);

    // Success: exit code 0
    exitCode = 0;
  } catch (error: any) {
    // Capture error details
    caughtError = error;

    // Extract exit code from CommanderError
    if (error instanceof CommanderError) {
      exitCode = error.exitCode;
    } else if (error.code === "commander.unknownCommand") {
      exitCode = 1;
    } else if (error.code === "commander.missingArgument") {
      exitCode = 1;
    } else if (error.code === "commander.optionMissingArgument") {
      exitCode = 1;
    } else {
      // Generic error: exit code 1
      exitCode = 1;

      // Add error message to stderr if not already there
      const errorMsg = error.message || String(error);
      if (!stderrBuffer.includes(errorMsg)) {
        stderrBuffer += `Error: ${errorMsg}\n`;
      }
    }
  } finally {
    // Restore environment
    process.env = originalEnv;

    // Restore working directory
    process.chdir(originalCwd);

    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  }

  // Parse JSON output if possible
  let json: any;
  const trimmedStdout = stdoutBuffer.trim();
  if (trimmedStdout) {
    try {
      json = JSON.parse(trimmedStdout);
    } catch {
      // Not JSON, that's fine
    }
  }

  return {
    code: exitCode,
    stdout: stdoutBuffer,
    stderr: stderrBuffer,
    json,
    error: caughtError,
  };
}

/**
 * Assert that a CLI command succeeded (exit code 0)
 *
 * Throws if the command failed, with helpful error details.
 *
 * @param result - Result from runCliInProcess
 * @throws Error if command failed
 *
 * @example
 * ```typescript
 * const result = await runCliInProcess(["gen-key", "--seed", "test"]);
 * assertSuccess(result); // Throws if failed
 * ```
 */
export function assertSuccess(result: CliResult): void {
  if (result.code !== 0) {
    throw new Error(
      `Command failed with exit code ${result.code}\n` +
      `Stdout: ${result.stdout}\n` +
      `Stderr: ${result.stderr}`
    );
  }
}

/**
 * Assert that a CLI command failed (exit code non-zero)
 *
 * Throws if the command succeeded when it should have failed.
 *
 * @param result - Result from runCliInProcess
 * @throws Error if command succeeded
 *
 * @example
 * ```typescript
 * const result = await runCliInProcess(["invalid-command"]);
 * assertFailure(result); // Throws if succeeded
 * ```
 */
export function assertFailure(result: CliResult): void {
  if (result.code === 0) {
    throw new Error(
      `Command succeeded when it should have failed\n` +
      `Stdout: ${result.stdout}\n` +
      `Stderr: ${result.stderr}`
    );
  }
}
