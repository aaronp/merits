/**
 * MessageRouter Unit Tests
 *
 * Tests the router logic in isolation (no Convex, no network).
 */

import { describe, test, expect } from "bun:test";
import {
  createMessageRouter,
  createTypedHandler,
  MessageRouter,
  MessageHandlerContext,
} from "../../core/runtime/router";
import { EncryptedMessage } from "../../core/interfaces/Transport";

describe("MessageRouter", () => {
  // Mock encrypted message
  function mockMessage(typ: string, ct: string = "encrypted"): EncryptedMessage {
    return {
      id: "msg-123",
      from: "Ealice",
      to: "Ebob",
      ct,
      typ,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
      envelopeHash: "hash",
      senderProof: {
        sigs: ["0-sig"],
        ksn: 0,
        evtSaid: "evt",
      },
    };
  }

  // Mock context that "decrypts" by JSON parsing
  const mockCtx: MessageHandlerContext = {
    decrypt: async (msg) => JSON.parse(msg.ct),
  };

  test("register and dispatch to handler", async () => {
    const router = createMessageRouter();
    const handled: any[] = [];

    router.register("chat.text.v1", (msg, plaintext) => {
      handled.push({ msg, plaintext });
    });

    const msg = mockMessage("chat.text.v1", JSON.stringify({ text: "hello" }));
    await router.dispatch(mockCtx, msg);

    expect(handled.length).toBe(1);
    expect(handled[0].plaintext.text).toBe("hello");
    expect(handled[0].msg.id).toBe("msg-123");
  });

  test("multiple handlers for different types", async () => {
    const router = createMessageRouter();
    const chatMessages: string[] = [];
    const kelProposals: string[] = [];

    router.register("chat.text.v1", (msg, plaintext: any) => {
      chatMessages.push(plaintext.text);
    });

    router.register("kel.proposal", (msg, plaintext: any) => {
      kelProposals.push(plaintext.type);
    });

    await router.dispatch(
      mockCtx,
      mockMessage("chat.text.v1", JSON.stringify({ text: "Hello!" }))
    );

    await router.dispatch(
      mockCtx,
      mockMessage("kel.proposal", JSON.stringify({ type: "rotation" }))
    );

    expect(chatMessages).toEqual(["Hello!"]);
    expect(kelProposals).toEqual(["rotation"]);
  });

  test("unhandled message type calls onUnhandled", async () => {
    const unhandled: string[] = [];

    const router = createMessageRouter({
      onUnhandled: (msg, typ) => {
        unhandled.push(typ);
      },
    });

    router.register("chat.text.v1", () => {});

    await router.dispatch(mockCtx, mockMessage("unknown.type", "{}"));

    expect(unhandled).toEqual(["unknown.type"]);
  });

  test("missing typ uses defaultHandler", async () => {
    const defaultHandled: any[] = [];

    const router = createMessageRouter({
      defaultHandler: (msg, plaintext) => {
        defaultHandled.push(plaintext);
      },
    });

    const msgNoTyp = mockMessage("", JSON.stringify({ data: "test" }));
    msgNoTyp.typ = undefined; // Explicitly no typ

    await router.dispatch(mockCtx, msgNoTyp);

    expect(defaultHandled.length).toBe(1);
    expect(defaultHandled[0].data).toBe("test");
  });

  test("handler errors call onError", async () => {
    const errors: Error[] = [];

    const router = createMessageRouter({
      onError: (error) => {
        errors.push(error);
      },
    });

    router.register("bad.type", () => {
      throw new Error("Handler failed");
    });

    await router.dispatch(mockCtx, mockMessage("bad.type", "{}"));

    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe("Handler failed");
  });

  test("handler errors re-throw if no onError", async () => {
    const router = createMessageRouter();

    router.register("bad.type", () => {
      throw new Error("Handler failed");
    });

    await expect(
      router.dispatch(mockCtx, mockMessage("bad.type", "{}"))
    ).rejects.toThrow("Handler failed");
  });

  test("unregister removes handler", async () => {
    const router = createMessageRouter();
    const handled: string[] = [];

    router.register("test.type", () => {
      handled.push("called");
    });

    await router.dispatch(mockCtx, mockMessage("test.type", "{}"));
    expect(handled.length).toBe(1);

    const removed = router.unregister("test.type");
    expect(removed).toBe(true);

    await router.dispatch(mockCtx, mockMessage("test.type", "{}"));
    expect(handled.length).toBe(1); // Not called again
  });

  test("unregister non-existent handler returns false", () => {
    const router = createMessageRouter();
    const removed = router.unregister("nonexistent");
    expect(removed).toBe(false);
  });

  test("hasHandler checks for registered handlers", () => {
    const router = createMessageRouter();

    router.register("chat.text.v1", () => {});

    expect(router.hasHandler("chat.text.v1")).toBe(true);
    expect(router.hasHandler("unknown")).toBe(false);
  });

  test("getRegisteredTypes returns all types", () => {
    const router = createMessageRouter();

    router.register("chat.text.v1", () => {});
    router.register("kel.proposal", () => {});
    router.register("app.custom", () => {});

    const types = router.getRegisteredTypes();

    expect(types).toContain("chat.text.v1");
    expect(types).toContain("kel.proposal");
    expect(types).toContain("app.custom");
    expect(types.length).toBe(3);
  });

  test("register with empty typ throws", () => {
    const router = createMessageRouter();

    expect(() => {
      router.register("", () => {});
    }).toThrow("Message type cannot be empty");
  });

  test("async handlers are awaited", async () => {
    const router = createMessageRouter();
    const results: number[] = [];

    router.register("async.type", async (msg, plaintext: any) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      results.push(plaintext.value);
    });

    await router.dispatch(
      mockCtx,
      mockMessage("async.type", JSON.stringify({ value: 42 }))
    );

    expect(results).toEqual([42]);
  });

  test("createTypedHandler provides type safety", async () => {
    const router = createMessageRouter();
    const handled: string[] = [];

    // TypeScript will enforce plaintext has { text: string }
    const chatHandler = createTypedHandler<{ text: string }>((msg, plaintext) => {
      handled.push(plaintext.text);
    });

    router.register("chat.text.v1", chatHandler);

    await router.dispatch(
      mockCtx,
      mockMessage("chat.text.v1", JSON.stringify({ text: "typed!" }))
    );

    expect(handled).toEqual(["typed!"]);
  });

  test("router handles multiple messages in sequence", async () => {
    const router = createMessageRouter();
    const order: string[] = [];

    router.register("type1", () => {
      order.push("type1");
    });

    router.register("type2", () => {
      order.push("type2");
    });

    await router.dispatch(mockCtx, mockMessage("type1", "{}"));
    await router.dispatch(mockCtx, mockMessage("type2", "{}"));
    await router.dispatch(mockCtx, mockMessage("type1", "{}"));

    expect(order).toEqual(["type1", "type2", "type1"]);
  });

  test("decrypt errors propagate to caller", async () => {
    const router = createMessageRouter();
    const failCtx: MessageHandlerContext = {
      decrypt: async () => {
        throw new Error("Decryption failed");
      },
    };

    router.register("test.type", () => {});

    await expect(
      router.dispatch(failCtx, mockMessage("test.type", "{}"))
    ).rejects.toThrow("Decryption failed");
  });
});
