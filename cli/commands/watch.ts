/**
 * Watch Command - Stream messages in real-time
 *
 * Phase 4: Uses session tokens to eliminate repeated signing overhead
 *
 * Usage:
 *   merits watch
 *   merits watch --plaintext
 *   merits watch --plaintext --no-auto-ack
 *   merits watch --format json > messages.log
 */

import { getSessionToken } from "../lib/getAuthProof";
import type { CLIContext } from "../lib/context";
import chalk from "chalk";
import type { EncryptedMessage } from "../../core/interfaces/Transport";
import { normalizeFormat, type GlobalOptions } from "../lib/options";

export interface WatchOptions extends GlobalOptions {
  from?: string;
  autoAck?: boolean;
  plaintext?: boolean;
  filter?: string;
}

export async function watchMessages(opts: WatchOptions): Promise<void> {
  const ctx = opts._ctx;
  const format = normalizeFormat(opts.format || ctx.config.outputFormat);
  const identityName = opts.from || ctx.config.defaultIdentity;

  if (!identityName) {
    throw new Error(
      "No default identity set. Use --from or: merits identity set-default <name>"
    );
  }

  const identity = await ctx.vault.getIdentity(identityName);

  // Silent in JSON mode (for scripting/logging)
  const isJsonMode = format === "json" || format === "pretty" || format === "raw";

  if (!isJsonMode) {
    console.log(chalk.cyan(`👀 Watching for messages as ${identityName}...`));
    console.log(chalk.gray("Press Ctrl+C to stop\n"));
  }

  // Open authenticated session with short-lived token
  let { sessionToken, expiresAt } = await getSessionToken({
    client: ctx.client,
    vault: ctx.vault,
    identityName,
    scopes: ["receive", "ack"],
    ttlMs: 60000, // 60 second token
  });

  let messageCount = 0;
  let ackCount = 0;
  let refreshInterval: NodeJS.Timeout | undefined;

  // Subscribe with session token (no repeated auth needed)
  const unsubscribe = await ctx.client.transport.subscribe({
    for: identity.aid,
    sessionToken,

    // Auto-ack preference (server-side)
    // If true: server acks after onMessage returns successfully
    // If false: messages remain unread until explicit ack
    autoAck: opts.autoAck !== false,

    onMessage: async (msg: EncryptedMessage) => {
      messageCount++;

      // Decrypt if requested (using vault from Phase 2/3)
      let plaintext: string | undefined;
      if (opts.plaintext) {
        try {
          plaintext = await ctx.vault.decrypt(identityName, msg.ct);
        } catch (err) {
          plaintext = `[Decryption failed: ${(err as Error).message}]`;
        }
      }

      // Display message
      displayMessage(msg, plaintext, format, isJsonMode);

      // Return true for server-side auto-ack
      // (Server will ack using session token, no client signing needed)
      if (opts.autoAck !== false) {
        ackCount++;
        return true;
      }
      return false;
    },

    onError: (error: Error) => {
      if (!isJsonMode) {
        console.error(chalk.red("Stream error:"), error.message);
      }
    },

    onClose: () => {
      if (!isJsonMode) {
        console.log(
          chalk.gray(
            `\n📊 Session ended: ${messageCount} messages, ${ackCount} acknowledged`
          )
        );
      }
    },
  });

  // Handle Ctrl+C gracefully
  const cleanup = async () => {
    if (!isJsonMode) {
      console.log(chalk.yellow("\nStopping watch..."));
    }
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
    await unsubscribe();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Auto-refresh token before expiry
  refreshInterval = setInterval(async () => {
    const timeLeft = expiresAt - Date.now();
    if (timeLeft < 10000) {
      // Refresh token with 10s buffer
      try {
        const newSession = await getSessionToken({
          client: ctx.client,
          vault: ctx.vault,
          identityName,
          scopes: ["receive", "ack"],
          ttlMs: 60000,
        });
        sessionToken = newSession.sessionToken;
        expiresAt = newSession.expiresAt;

        // Update subscription with new token
        await ctx.client.transport.refreshSessionToken({
          for: identity.aid,
          sessionToken,
        });

        if (!isJsonMode) {
          console.log(chalk.gray("🔄 Session token refreshed"));
        }
      } catch (err) {
        if (!isJsonMode) {
          console.error(
            chalk.red("Failed to refresh session token:"),
            (err as Error).message
          );
        }
        await cleanup();
      }
    }
  }, 5000); // Check every 5 seconds

  // Wait indefinitely (cleanup on SIGINT/SIGTERM)
  await new Promise(() => {});
}

/**
 * Display message in requested format
 */
function displayMessage(
  msg: EncryptedMessage,
  plaintext: string | undefined,
  format: "json" | "pretty" | "raw",
  isJsonMode: boolean
) {
  const data = {
    createdAt: msg.createdAt,
    ct: msg.ct,
    expiresAt: msg.expiresAt,
    from: msg.from,
    id: msg.id,
    plaintext,
    to: msg.to,
  };

  if (format === "json") {
    // Canonicalized JSON (RFC8785)
    const canonical = JSON.stringify(data, Object.keys(data).sort());
    console.log(canonical);
  } else if (format === "pretty") {
    console.log(JSON.stringify(data, null, 2));
  } else if (format === "raw") {
    console.log(JSON.stringify(data));
  } else {
    // Fallback to pretty
    console.log(JSON.stringify(data, null, 2));
  }

  // Force flush stdout for file redirection in tests
  // When stdout is redirected to a file, it becomes fully buffered
  // We need to flush after each message for real-time output
  if (process.stdout.write("")) {
    // write() returns true if flushed, triggers flush cycle
  }
}
