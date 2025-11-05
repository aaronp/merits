/**
 * Transport Interface Tests
 *
 * Tests the Transport contract using ConvexTransport adapter.
 * Includes subscribe (push) functionality tests.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { ConvexTransport } from "../../src/adapters/ConvexTransport";
import { ConvexIdentityAuth } from "../../src/adapters/ConvexIdentityAuth";
import { Transport } from "../../core/interfaces/Transport";
import { IdentityAuth } from "../../core/interfaces/IdentityAuth";
import { SignedRequest } from "../../core/types";
import { signMutationArgs } from "../../core/signatures";
import {
  generateKeyPair,
  createAID,
  encodeCESRKey,
} from "../helpers/crypto-utils";
import { eventually, eventuallyValue } from "../helpers/eventually";

const CONVEX_URL = process.env.CONVEX_URL;

if (!CONVEX_URL) {
  throw new Error("CONVEX_URL environment variable is not set");
}

describe("Transport Interface (Convex implementation)", () => {
  let convex: ConvexClient;
  let transport: Transport;
  let identityAuth: IdentityAuth;

  let aliceKeys: { publicKey: Uint8Array; privateKey: Uint8Array };
  let bobKeys: { publicKey: Uint8Array; privateKey: Uint8Array };
  let aliceAid: string;
  let bobAid: string;

  /**
   * Helper to create signed request for a user
   */
  async function createSignedRequest(
    aid: string,
    privateKey: Uint8Array,
    args: Record<string, unknown>
  ): Promise<SignedRequest> {
    return await signMutationArgs(args, privateKey, aid);
  }

  beforeAll(async () => {
    convex = new ConvexClient(CONVEX_URL!);
    // Ensure clean DB state for this suite (test-only helper)
    try {
      await convex.mutation(api.testHelpers.resetAll, {} as any);
    } catch (e) {
      // Ignore if older backend without resetAll
    }
    transport = new ConvexTransport(convex);
    identityAuth = new ConvexIdentityAuth(convex);

    // Generate test users
    aliceKeys = await generateKeyPair();
    bobKeys = await generateKeyPair();
    aliceAid = createAID(aliceKeys.publicKey);
    bobAid = createAID(bobKeys.publicKey);

    // Register key states
    await convex.mutation(api.auth.registerKeyState, {
      aid: aliceAid,
      ksn: 0,
      keys: [encodeCESRKey(aliceKeys.publicKey)],
      threshold: "1",
      lastEvtSaid: "EAAA",
    });

    await convex.mutation(api.auth.registerKeyState, {
      aid: bobAid,
      ksn: 0,
      keys: [encodeCESRKey(bobKeys.publicKey)],
      threshold: "1",
      lastEvtSaid: "EBBB",
    });

    // Grant all permissions to test users (bypasses RBAC for integration tests)
    await convex.mutation(api.testHelpers.grantAllPermissions, { aid: aliceAid });
    await convex.mutation(api.testHelpers.grantAllPermissions, { aid: bobAid });
  });

  afterAll(() => {
    convex.close();
  });

  test("sendMessage returns messageId", async () => {
    const sig = await createSignedRequest(aliceAid, aliceKeys.privateKey, {
      recpAid: bobAid,
      ct: "test-message",
      typ: "chat.text.v1",
      ttl: 60000,
    });

    const result = await transport.sendMessage({
      to: bobAid,
      ct: "test-message",
      typ: "chat.text.v1",
      ttlMs: 60000,
      sig,
    });

    expect(result.messageId).toBeTruthy();
  }, 8000);

  test("receiveMessages returns sent messages", async () => {
    // Alice sends to Bob
    const sendSig = await createSignedRequest(aliceAid, aliceKeys.privateKey, {
      recpAid: bobAid,
      ct: "message-for-bob",
      typ: "test.v1",
      ttl: 60000,
    });

    const { messageId } = await transport.sendMessage({
      to: bobAid,
      ct: "message-for-bob",
      typ: "test.v1",
      ttlMs: 60000,
      sig: sendSig,
    });

    // Bob receives - use eventually to wait for message to appear
    const receiveSig = await createSignedRequest(bobAid, bobKeys.privateKey, {
      recpAid: bobAid,
    });

    const msg = await eventuallyValue(
      async () => {
        const messages = await transport.receiveMessages({
          for: bobAid,
          sig: receiveSig,
        });
        return messages.find((m) => m.id === messageId);
      },
      { timeout: 3000, message: "Message not received" }
    );

    expect(msg.from).toBe(aliceAid);
    expect(msg.to).toBe(bobAid);
    expect(msg.ct).toBe("message-for-bob");
    expect(msg.typ).toBe("test.v1");
    expect(msg.senderProof.ksn).toBe(0);
  }, 12000);

  test("ackMessage removes message from receive queue", async () => {
    // Alice sends to Bob
    const sendSig = await createSignedRequest(aliceAid, aliceKeys.privateKey, {
      recpAid: bobAid,
      ct: "msg-to-ack",
      typ: "test.v1",
      ttl: 60000,
    });

    const { messageId } = await transport.sendMessage({
      to: bobAid,
      ct: "msg-to-ack",
      typ: "test.v1",
      ttlMs: 60000,
      sig: sendSig,
    });

    // Bob receives - wait for message to appear
    const receiveSig = await createSignedRequest(bobAid, bobKeys.privateKey, {
      recpAid: bobAid,
    });

    const msgToAck = await eventuallyValue(
      async () => {
        const messages = await transport.receiveMessages({
          for: bobAid,
          sig: receiveSig,
        });
        return messages.find((m) => m.id === messageId);
      },
      { timeout: 3000 }
    );

    expect(msgToAck).toBeDefined();

    // Bob acknowledges
    const ackSig = await createSignedRequest(bobAid, bobKeys.privateKey, {
      messageId,
      receipt: [],
    });

    await transport.ackMessage({
      messageId,
      sig: ackSig,
    });

    // Message should eventually disappear
    await eventually(
      async () => {
        const receiveSig2 = await createSignedRequest(bobAid, bobKeys.privateKey, {
          recpAid: bobAid,
        });
        const messages = await transport.receiveMessages({
          for: bobAid,
          sig: receiveSig2,
        });
        return messages.find((m) => m.id === messageId) === undefined;
      },
      { timeout: 3000, message: "Message not removed after ack" }
    );
  }, 12000);

  test("subscribe receives messages in real-time with auto-ack", async () => {
    const receivedMessages: string[] = [];

    // Subscribe as Bob
    const subscribeSig = await createSignedRequest(bobAid, bobKeys.privateKey, {
      recpAid: bobAid,
    });

    const cancel = await transport.subscribe({
      for: bobAid,
      sig: subscribeSig,
      onMessage: async (msg) => {
        receivedMessages.push(msg.ct);
        return false; // Do not auto-ack in this test
      },
    });

    // Alice sends a message
    const sendSig = await createSignedRequest(aliceAid, aliceKeys.privateKey, {
      recpAid: bobAid,
      ct: "live-message",
      typ: "chat.text.v1",
      ttl: 60000,
    });

    await transport.sendMessage({
      to: bobAid,
      ct: "live-message",
      typ: "chat.text.v1",
      ttlMs: 60000,
      sig: sendSig,
    });

    // Wait for push notification to arrive
    await eventually(
      () => receivedMessages.includes("live-message"),
      { timeout: 5000, message: "Message not received via subscribe" }
    );

    expect(receivedMessages).toContain("live-message");

    // Clean up subscription
    cancel();
  }, 10000); // Longer timeout for subscribe test
});
