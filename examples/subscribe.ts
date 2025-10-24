/**
 * Real-Time Subscribe Example
 *
 * Demonstrates:
 * - Real-time message delivery via subscribe
 * - Message routing by type
 * - Auto-acknowledgment
 * - Graceful shutdown
 */

import { createMeritsClient, type AuthCredentials } from "../src/client";
import { generateKeyPair, createAID } from "../core/crypto";

// Mock encryption
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

  const client = createMeritsClient(convexUrl);

  // Generate keypairs
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

  console.log(`Alice: ${alice.aid}`);
  console.log(`Bob:   ${bob.aid}`);

  // Register key states
  console.log("\nRegistering key states...");
  const convex = (client as any).identity.client;

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

  // Bob sets up message handlers
  console.log("\n=== Bob sets up message handlers ===");

  client.router.register("chat.text.v1", (msg, plaintext) => {
    console.log(`\n💬 [Chat Message]`);
    console.log(`   From: ${msg.from}`);
    console.log(`   Text: "${plaintext.text}"`);
  });

  client.router.register("file.upload.v1", (msg, plaintext) => {
    console.log(`\n📎 [File Upload]`);
    console.log(`   From: ${msg.from}`);
    console.log(`   Filename: ${plaintext.filename}`);
    console.log(`   Size: ${plaintext.size} bytes`);
  });

  client.router.register("typing.indicator.v1", (msg, plaintext) => {
    console.log(`\n⌨️  [Typing Indicator]`);
    console.log(`   ${plaintext.from} is typing...`);
  });

  console.log("✓ Handlers registered:");
  console.log("  - chat.text.v1");
  console.log("  - file.upload.v1");
  console.log("  - typing.indicator.v1");

  // Bob subscribes to messages with auto-routing
  console.log("\n=== Bob subscribes to real-time messages ===");

  const bobReceiveAuth = await client.createAuth(bob, "receive", {
    recpAid: bob.aid,
  });

  const unsubscribe = await client.transport.subscribe({
    for: bob.aid,
    auth: bobReceiveAuth,
    onMessage: async (msg) => {
      // Decrypt message
      const plaintext = JSON.parse(decrypt(msg.ct));

      // Route to handler based on type
      await client.router.dispatch(
        {
          decrypt: async () => plaintext,
        },
        msg
      );

      // Auto-ack after successful handling
      return true;
    },
  });

  console.log("✓ Subscribed (waiting for messages...)");
  console.log("  Press Ctrl+C to stop\n");

  // Alice sends various messages
  console.log("=== Alice sends messages ===\n");

  // Send chat message
  await sendMessage(client, alice, bob.aid, "chat.text.v1", {
    text: "Hey Bob! How's it going?",
  });

  await delay(1000);

  // Send typing indicator
  await sendMessage(client, alice, bob.aid, "typing.indicator.v1", {
    from: "Alice",
  });

  await delay(500);

  // Send another chat message
  await sendMessage(client, alice, bob.aid, "chat.text.v1", {
    text: "I just uploaded a document for you.",
  });

  await delay(500);

  // Send file upload notification
  await sendMessage(client, alice, bob.aid, "file.upload.v1", {
    filename: "project-spec.pdf",
    size: 245600,
    url: "https://example.com/files/project-spec.pdf",
  });

  // Wait a bit for all messages to be processed
  await delay(2000);

  // Cleanup
  console.log("\n=== Cleanup ===");
  unsubscribe();
  console.log("✓ Unsubscribed");

  client.close();
  console.log("✓ Client closed");
}

// Helper: Send a typed message
async function sendMessage(
  client: ReturnType<typeof createMeritsClient>,
  sender: AuthCredentials,
  recipientAid: string,
  typ: string,
  payload: any
) {
  const ct = encrypt(JSON.stringify(payload));
  const ctHash = client.computeCtHash(ct);

  const sendAuth = await client.createAuth(sender, "send", {
    recpAid: recipientAid,
    ctHash,
    ttl: 60000,
    alg: "",
    ek: "",
  });

  await client.transport.sendMessage({
    to: recipientAid,
    ct,
    typ,
    ttlMs: 60000,
    auth: sendAuth,
  });
}

// Helper: Delay
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
