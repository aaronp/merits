import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { MessageBusClient, mockEncrypt, mockDecrypt, type AuthCredentials } from "../../src/client";
import {
  generateKeyPair,
  encodeCESRKey,
  createAID,
} from "../helpers/crypto-utils";
import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { eventuallyValue } from "../helpers/eventually";

const CONVEX_URL = process.env.CONVEX_URL;

if (!CONVEX_URL) {
  throw new Error("CONVEX_URL environment variable is not set");
}

describe("MessageBus Integration Tests with KERI Authentication", () => {
  let client: MessageBusClient;
  let convex: ConvexClient;
  let aliceKeys: { publicKey: Uint8Array; privateKey: Uint8Array };
  let bobKeys: { publicKey: Uint8Array; privateKey: Uint8Array };
  let aliceAid: string;
  let bobAid: string;
  let aliceCreds: AuthCredentials;
  let bobCreds: AuthCredentials;

  beforeAll(async () => {
    client = new MessageBusClient(CONVEX_URL!);
    convex = new ConvexClient(CONVEX_URL!);

    // Generate keypairs for Alice and Bob
    aliceKeys = await generateKeyPair();
    bobKeys = await generateKeyPair();

    // Create AIDs
    aliceAid = createAID(aliceKeys.publicKey);
    bobAid = createAID(bobKeys.publicKey);

    // Register key states
    await client.registerKeyState(
      aliceAid,
      0,
      [encodeCESRKey(aliceKeys.publicKey)],
      "1",
      "EAAA"
    );

    await client.registerKeyState(
      bobAid,
      0,
      [encodeCESRKey(bobKeys.publicKey)],
      "1",
      "EBBB"
    );

    // For testing, use test helper to set users as "known" tier
    // In production, users would go through onboarding flow
    // We'll insert tier records directly to simulate this
    await convex.mutation(api._test_helpers.resetAdminRoles, {});

    // Bootstrap a super admin for test setup
    await convex.mutation(api._test_helpers.bootstrapSuperAdmin, {
      aid: aliceAid, // Use Alice as admin for test
    });

    // Manually create tier records for both users (simulating completed onboarding)
    // In real flow, this would be done via onboardUser mutation
    // For integration tests, we just want to test message flow, not onboarding
    // So we'll set them as "known" which allows messaging
    const tierDoc = {
      aid: bobAid,
      tier: "known",
      updatedAt: Date.now(),
    };

    // Use verifyUser to promote them (requires them to be "known" first)
    // Actually, let's just insert the tier record directly via test helper
    // We need a simpler approach - let's use onboardUser

    // For now, set both as "known" by creating the records
    // This is test scaffolding - in production they'd go through onboarding
    await convex.mutation(api.authorization.onboardUser, {
      userAid: bobAid,
      onboardingProof: "ETEST_PROOF_BOB",
      notes: "Test user",
      auth: await client.createAuth(
        {
          aid: aliceAid,
          privateKey: aliceKeys.privateKey,
          ksn: 0,
        },
        "admin",
        {
          action: "onboardUser",
          userAid: bobAid,
          onboardingProof: "ETEST_PROOF_BOB",
        }
      ),
    });

    // Alice is already super_admin, so she's effectively "verified"
    // Let's also onboard Alice herself
    await convex.mutation(api.authorization.onboardUser, {
      userAid: aliceAid,
      onboardingProof: "ETEST_PROOF_ALICE",
      notes: "Test admin user",
      auth: await client.createAuth(
        {
          aid: aliceAid,
          privateKey: aliceKeys.privateKey,
          ksn: 0,
        },
        "admin",
        {
          action: "onboardUser",
          userAid: aliceAid,
          onboardingProof: "ETEST_PROOF_ALICE",
        }
      ),
    });

    // Create credentials
    aliceCreds = {
      aid: aliceAid,
      privateKey: aliceKeys.privateKey,
      ksn: 0,
    };

    bobCreds = {
      aid: bobAid,
      privateKey: bobKeys.privateKey,
      ksn: 0,
    };
  });

  afterAll(() => {
    client.close();
    convex.close();
  });

  test("should send and receive a message with authentication", async () => {
    const message = "Hello from Alice to Bob!";
    const ciphertext = mockEncrypt(message);

    // Alice sends a message to Bob
    const messageId = await client.send(bobAid, ciphertext, aliceCreds);
    expect(messageId).toBeDefined();

    // Bob receives the message (poll for eventual consistency)
    const receivedMessage = await eventuallyValue(
      async () => {
        const messages = await client.receive(bobAid, bobCreds);
        return messages.find((m) => m.id === messageId);
      },
      { timeout: 2000, interval: 50, message: "Waiting for message delivery" }
    );

    expect(receivedMessage).toBeDefined();
    expect(receivedMessage!.ct).toBe(ciphertext);
    expect(receivedMessage!.senderAid).toBe(aliceAid);

    // Decrypt and verify
    const decrypted = mockDecrypt(receivedMessage!.ct);
    expect(decrypted).toBe(message);
  });

  test("should acknowledge a message with authentication", async () => {
    const message = "Test acknowledgment";
    const ciphertext = mockEncrypt(message);

    // Alice sends a message to Bob
    const messageId = await client.send(bobAid, ciphertext, aliceCreds);

    // Wait for the message to be stored
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Bob receives the message
    let messages = await client.receive(bobAid, bobCreds);
    expect(messages.length).toBeGreaterThan(0);
    const msgToAck = messages.find((m) => m.id === messageId);
    expect(msgToAck).toBeDefined();

    // Bob acknowledges the message
    await client.acknowledge(messageId, bobAid, msgToAck!.envelopeHash, bobCreds);

    // Wait for acknowledgment to process
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Message should no longer appear in receive query
    messages = await client.receive(bobAid, bobCreds);
    const acknowledgedMessage = messages.find((m) => m.id === messageId);
    expect(acknowledgedMessage).toBeUndefined();
  });

  test("should handle custom TTL", async () => {
    const message = "Short-lived message";
    const ciphertext = mockEncrypt(message);
    const ttl = 5 * 60 * 1000; // 5 minutes

    // Alice sends a message with custom TTL to Bob
    const messageId = await client.send(bobAid, ciphertext, aliceCreds, { ttl });

    // Wait for the message to be stored
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Bob receives and verifies
    const messages = await client.receive(bobAid, bobCreds);
    const receivedMessage = messages.find((m) => m.id === messageId);
    expect(receivedMessage).toBeDefined();

    // Verify expiration time is approximately ttl from now
    const expectedExpiry = Date.now() + ttl;
    const actualExpiry = receivedMessage!.expiresAt;
    const diff = Math.abs(expectedExpiry - actualExpiry);
    expect(diff).toBeLessThan(1000); // Within 1 second
  });

  test("should prevent receiving messages for different AID", async () => {
    const message = "Private message for Bob";
    const ciphertext = mockEncrypt(message);

    // Alice sends to Bob
    await client.send(bobAid, ciphertext, aliceCreds);

    // Wait for the message to be stored
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Alice tries to receive Bob's messages - should fail
    await expect(client.receive(bobAid, aliceCreds)).rejects.toThrow(
      "Cannot receive messages for different AID"
    );
  });

  test("should prove sender control of AID", async () => {
    const message = "Authenticated message";
    const ciphertext = mockEncrypt(message);

    // Alice sends to Bob
    const messageId = await client.send(bobAid, ciphertext, aliceCreds);

    // Wait for the message to be stored
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Bob receives the message
    const messages = await client.receive(bobAid, bobCreds);
    const receivedMessage = messages.find((m) => m.id === messageId);

    // Verify sender AID is Alice
    expect(receivedMessage!.senderAid).toBe(aliceAid);

    // Verify signature bundle is present (proves Alice signed)
    expect(receivedMessage!.senderSig).toBeDefined();
    expect(receivedMessage!.senderSig.length).toBeGreaterThan(0);
  });

  test("should prevent unauthorized acknowledgment", async () => {
    const message = "Test message";
    const ciphertext = mockEncrypt(message);

    // Alice sends to Bob
    const messageId = await client.send(bobAid, ciphertext, aliceCreds);

    // Wait for the message to be stored
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get the message to extract envelopeHash
    const messages = await client.receive(bobAid, bobCreds);
    const msgToAck = messages.find((m) => m.id === messageId);
    expect(msgToAck).toBeDefined();

    // Alice tries to acknowledge Bob's message - should fail
    await expect(
      client.acknowledge(messageId, bobAid, msgToAck!.envelopeHash, aliceCreds)
    ).rejects.toThrow("Cannot acknowledge message for different AID");
  });

  test("should handle multiple messages from different senders", async () => {
    const messages = [
      { sender: aliceCreds, text: "Message 1 from Alice" },
      { sender: aliceCreds, text: "Message 2 from Alice" },
      { sender: bobCreds, text: "Message from Bob to Alice" },
    ];

    // Alice sends 2 messages to Bob, Bob sends 1 to Alice
    const aliceMessageIds = await Promise.all([
      client.send(bobAid, mockEncrypt(messages[0].text), aliceCreds),
      client.send(bobAid, mockEncrypt(messages[1].text), aliceCreds),
    ]);
    const bobMessageId = await client.send(aliceAid, mockEncrypt(messages[2].text), bobCreds);

    // Wait for messages to be stored
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Bob receives his messages (from Alice)
    const bobMessages = await client.receive(bobAid, bobCreds);
    const bobReceivedAliceMessages = bobMessages.filter((m) =>
      aliceMessageIds.includes(m.id)
    );
    expect(bobReceivedAliceMessages.length).toBe(2);
    for (const msg of bobReceivedAliceMessages) {
      expect(msg.senderAid).toBe(aliceAid);
    }

    // Alice receives her messages (from Bob)
    const aliceMessages = await client.receive(aliceAid, aliceCreds);
    const aliceReceivedBobMessage = aliceMessages.find((m) => m.id === bobMessageId);
    expect(aliceReceivedBobMessage).toBeDefined();
    expect(aliceReceivedBobMessage!.senderAid).toBe(bobAid);
  });

  test("should reject messages without valid authentication", async () => {
    const message = "Unauthenticated attempt";
    const ciphertext = mockEncrypt(message);

    // Create invalid credentials (wrong private key)
    const invalidCreds: AuthCredentials = {
      aid: aliceAid,
      privateKey: bobKeys.privateKey, // Wrong key!
      ksn: 0,
    };

    // Try to send with invalid credentials - should fail signature verification
    await expect(
      client.send(bobAid, ciphertext, invalidCreds)
    ).rejects.toThrow();
  });
});
