/**
 * Basic Chat Client Example
 *
 * Demonstrates:
 * - Sending messages
 * - Receiving messages
 * - Acknowledging receipt
 * - Basic encryption/decryption (mock)
 */

import { createMeritsClient, type AuthCredentials } from "../src/client";
import { generateKeyPair, createAID } from "../core/crypto";

// Mock encryption (replace with real crypto in production)
function encrypt(plaintext: string): string {
  return Buffer.from(plaintext).toString("base64");
}

function decrypt(ciphertext: string): string {
  return Buffer.from(ciphertext, "base64").toString("utf-8");
}

async function main() {
  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    throw new Error("CONVEX_URL environment variable required");
  }

  // Create client
  const client = createMeritsClient(convexUrl);

  // Generate keypairs for Alice and Bob
  console.log("Generating keypairs...");
  const aliceKeys = await generateKeyPair();
  const bobKeys = await generateKeyPair();

  const alice: AuthCredentials = {
    aid: createAID(aliceKeys.publicKey),
    privateKey: aliceKeys.privateKey,
    ksn: 0,
  };

  const bob: AuthCredentials = {
    aid: createAID(bobKeys.publicKey),
    privateKey: bobKeys.privateKey,
    ksn: 0,
  };

  console.log(`Alice AID: ${alice.aid}`);
  console.log(`Bob AID: ${bob.aid}`);

  // Register key states (setup - only needed once per AID)
  console.log("\nRegistering key states...");
  const convex = (client as any).identity.client; // Access underlying client for setup
  await convex.mutation("auth:registerKeyState", {
    aid: alice.aid,
    ksn: 0,
    keys: [aliceKeys.publicKeyCESR],
    threshold: "1",
    lastEvtSaid: "evt-alice-0",
  });

  await convex.mutation("auth:registerKeyState", {
    aid: bob.aid,
    ksn: 0,
    keys: [bobKeys.publicKeyCESR],
    threshold: "1",
    lastEvtSaid: "evt-bob-0",
  });

  console.log("✓ Key states registered");

  // Alice sends a message to Bob
  console.log("\n=== Alice sends message to Bob ===");
  const messageText = "Hello Bob! How are you?";
  const ct = encrypt(messageText);
  const ctHash = client.computeCtHash(ct);

  const sendAuth = await client.createAuth(alice, "send", {
    recpAid: bob.aid,
    ctHash,
    ttl: 60000,
    alg: "",
    ek: "",
  });

  const { messageId } = await client.transport.sendMessage({
    to: bob.aid,
    ct,
    typ: "chat.text.v1",
    ttlMs: 60000,
    auth: sendAuth,
  });

  console.log(`✓ Message sent (ID: ${messageId})`);
  console.log(`  Content: "${messageText}"`);

  // Bob receives messages
  console.log("\n=== Bob receives messages ===");
  const receiveAuth = await client.createAuth(bob, "receive", {
    recpAid: bob.aid,
  });

  // Poll for messages (in production, use subscribe for real-time)
  await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for propagation

  const messages = await client.transport.receiveMessages({
    for: bob.aid,
    auth: receiveAuth,
  });

  console.log(`✓ Bob received ${messages.length} message(s)`);

  for (const msg of messages) {
    const plaintext = decrypt(msg.ct);
    console.log(`\nFrom: ${msg.from}`);
    console.log(`Type: ${msg.typ}`);
    console.log(`Message: "${plaintext}"`);
    console.log(`Envelope Hash: ${msg.envelopeHash}`);

    // Acknowledge receipt
    console.log("\n=== Bob acknowledges message ===");
    const ackAuth = await client.createAuth(bob, "ack", {
      recpAid: bob.aid,
      messageId: msg.id,
    });

    await client.transport.ackMessage({
      messageId: msg.id,
      auth: ackAuth,
    });

    console.log("✓ Message acknowledged");
  }

  // Verify message was removed after ack
  const messagesAfterAck = await client.transport.receiveMessages({
    for: bob.aid,
    auth: receiveAuth,
  });

  console.log(`\n✓ Messages after ack: ${messagesAfterAck.length} (should be 0)`);

  // Close client
  client.close();
  console.log("\n✓ Client closed");
}

// Run the example
main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
