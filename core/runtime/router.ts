/**
 * MessageRouter - Application-level message routing by type
 *
 * The message bus moves encrypted blobs. The router decrypts and dispatches
 * to application handlers based on the `typ` field.
 *
 * This keeps the bus thin and apps rich - business logic lives in handlers,
 * not in the transport layer.
 */

import { EncryptedMessage } from "../interfaces/Transport";

/**
 * Context provided to router for decryption
 */
export interface MessageHandlerContext {
  /**
   * Decrypt an encrypted message and return the plaintext payload.
   * Implementation is app-specific (keys, algorithms, etc.)
   */
  decrypt: (msg: EncryptedMessage) => Promise<unknown>;
}

/**
 * Handler function for a specific message type
 *
 * @param msg - The encrypted message envelope (metadata)
 * @param plaintext - The decrypted application payload
 */
export type MessageHandler = (
  msg: EncryptedMessage,
  plaintext: unknown
) => Promise<void> | void;

/**
 * MessageRouter - Route messages to handlers by type
 *
 * Usage:
 * ```typescript
 * const router = createMessageRouter();
 *
 * router.register("chat.text.v1", (msg, plaintext: any) => {
 *   ui.addChatBubble(msg.from, plaintext.text);
 * });
 *
 * router.register("kel.proposal", (msg, plaintext: any) => {
 *   rotationUI.showProposal(msg.from, plaintext);
 * });
 *
 * // Later, when messages arrive:
 * for (const msg of messages) {
 *   await router.dispatch(ctx, msg);
 * }
 * ```
 */
export interface MessageRouter {
  /**
   * Register a handler for a specific message type.
   *
   * @param typ - Message type (e.g., "chat.text.v1", "kel.proposal")
   * @param handler - Function to handle messages of this type
   */
  register(typ: string, handler: MessageHandler): void;

  /**
   * Unregister a handler for a message type.
   *
   * @param typ - Message type to unregister
   * @returns True if handler was found and removed
   */
  unregister(typ: string): boolean;

  /**
   * Dispatch a message to its registered handler.
   *
   * Flow:
   * 1. Decrypt the message using ctx.decrypt()
   * 2. Look up handler by msg.typ
   * 3. Call handler with (msg, plaintext)
   *
   * If no handler is registered for the type, silently ignores.
   * (Optional: call onUnhandled callback if configured)
   *
   * @param ctx - Context with decrypt function
   * @param msg - Encrypted message to route
   */
  dispatch(ctx: MessageHandlerContext, msg: EncryptedMessage): Promise<void>;

  /**
   * Check if a handler is registered for a type
   *
   * @param typ - Message type to check
   * @returns True if handler exists
   */
  hasHandler(typ: string): boolean;

  /**
   * Get all registered message types
   *
   * @returns Array of registered type strings
   */
  getRegisteredTypes(): string[];
}

/**
 * Options for creating a MessageRouter
 */
export interface MessageRouterOptions {
  /**
   * Called when a message has no registered handler.
   * Useful for logging/metrics.
   */
  onUnhandled?: (msg: EncryptedMessage, typ: string) => void;

  /**
   * Called when a handler throws an error.
   * If not provided, errors are re-thrown.
   */
  onError?: (error: Error, msg: EncryptedMessage, typ: string) => void;

  /**
   * Default handler for messages with no typ field.
   * If not provided, messages without typ are ignored.
   */
  defaultHandler?: MessageHandler;
}

/**
 * Create a new MessageRouter instance
 *
 * @param options - Configuration options
 * @returns MessageRouter instance
 */
export function createMessageRouter(
  options: MessageRouterOptions = {}
): MessageRouter {
  const handlers = new Map<string, MessageHandler>();

  return {
    register(typ: string, handler: MessageHandler): void {
      if (!typ) {
        throw new Error("Message type cannot be empty");
      }
      handlers.set(typ, handler);
    },

    unregister(typ: string): boolean {
      return handlers.delete(typ);
    },

    async dispatch(
      ctx: MessageHandlerContext,
      msg: EncryptedMessage
    ): Promise<void> {
      // Decrypt the message
      const plaintext = await ctx.decrypt(msg);

      // Determine message type
      const typ = msg.typ ?? "unknown";

      // Look up handler
      const handler = handlers.get(typ);

      if (!handler) {
        // No handler registered for this type
        if (typ === "unknown" && options.defaultHandler) {
          // Use default handler for messages without typ
          try {
            await options.defaultHandler(msg, plaintext);
          } catch (error) {
            if (options.onError) {
              options.onError(error as Error, msg, typ);
            } else {
              throw error;
            }
          }
          return;
        }

        // Call unhandled callback if configured
        if (options.onUnhandled) {
          options.onUnhandled(msg, typ);
        }
        return;
      }

      // Dispatch to handler
      try {
        await handler(msg, plaintext);
      } catch (error) {
        if (options.onError) {
          options.onError(error as Error, msg, typ);
        } else {
          throw error;
        }
      }
    },

    hasHandler(typ: string): boolean {
      return handlers.has(typ);
    },

    getRegisteredTypes(): string[] {
      return Array.from(handlers.keys());
    },
  };
}

/**
 * Helper to create a typed handler
 *
 * Provides type safety for plaintext payloads.
 *
 * @example
 * const chatHandler = createTypedHandler<{ text: string; ts: number }>(
 *   (msg, plaintext) => {
 *     console.log(plaintext.text); // TypeScript knows this exists
 *   }
 * );
 */
export function createTypedHandler<TPlaintext>(
  handler: (msg: EncryptedMessage, plaintext: TPlaintext) => Promise<void> | void
): MessageHandler {
  return handler as MessageHandler;
}
