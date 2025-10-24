/**
 * Group Chat Example
 *
 * Demonstrates:
 * - Creating a group
 * - Adding members
 * - Sending group messages (server-side fanout)
 * - All members receiving messages
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

  // Generate keypairs for Alice, Bob, and Carol
  console.log("Generating keypairs...");
  const aliceKeys = await generateKeyPair();
  const bobKeys = await generateKeyPair();
  const carolKeys = await generateKeyPair();

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

  const carol: AuthCredentials = {
    aid: createAID(carolKeys.publicKey),
    privateKey: carolKeys.privateKey,
    ksn: 0,
  };

  console.log(`Alice (owner): ${alice.aid}`);
  console.log(`Bob (member):  ${bob.aid}`);
  console.log(`Carol (member): ${carol.aid}`);

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

  await convex.mutation("auth:registerKeyState", {
    aid: carol.aid,
    ksn: 0,
    keys: [carolKeys.publicKeyCESR],
    threshold: "1",
    lastEvtSaid: "evt-carol-0",
  });

  console.log("✓ Key states registered");

  // Alice creates a group
  console.log("\n=== Alice creates a group ===");
  const createAuth = await client.createAuth(alice, "manageGroup", {
    action: "createGroup",
    name: "Project Team",
    members: [bob.aid, carol.aid].sort(),
  });

  const { groupId } = await client.group.createGroup({
    name: "Project Team",
    initialMembers: [bob.aid, carol.aid],
    auth: createAuth,
  });

  console.log(`✓ Group created (ID: ${groupId})`);
  console.log(`  Name: Project Team`);
  console.log(`  Members: Alice (owner), Bob, Carol`);

  // List groups for Alice
  const aliceGroups = await client.group.listGroups({
    for: alice.aid,
    auth: createAuth,
  });

  console.log(`\n✓ Alice is in ${aliceGroups.length} group(s)`);
  for (const group of aliceGroups) {
    console.log(`  - ${group.name} (${group.members.length} members)`);
  }

  // Alice sends a message to the group
  console.log("\n=== Alice sends message to group ===");
  const messageText = "Hello team! Let's discuss the project.";
  const ct = encrypt(messageText);
  const ctHash = client.computeCtHash(ct);

  const sendAuth = await client.createAuth(alice, "sendGroup", {
    groupId,
    ctHash,
    ttl: 60000,
  });

  const { messageId } = await client.group.sendGroupMessage({
    groupId,
    ct,
    typ: "chat.text.v1",
    ttlMs: 60000,
    auth: sendAuth,
  });

  console.log(`✓ Group message sent (ID: ${messageId})`);
  console.log(`  Content: "${messageText}"`);
  console.log(`  Server will fanout to Bob and Carol`);

  // Wait for fanout to complete
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Bob receives the group message
  console.log("\n=== Bob receives messages ===");
  const bobReceiveAuth = await client.createAuth(bob, "receive", {
    recpAid: bob.aid,
  });

  const bobMessages = await client.transport.receiveMessages({
    for: bob.aid,
    auth: bobReceiveAuth,
  });

  console.log(`✓ Bob received ${bobMessages.length} message(s)`);
  for (const msg of bobMessages) {
    const plaintext = decrypt(msg.ct);
    console.log(`  From: ${msg.from}`);
    console.log(`  Message: "${plaintext}"`);
  }

  // Carol receives the group message
  console.log("\n=== Carol receives messages ===");
  const carolReceiveAuth = await client.createAuth(carol, "receive", {
    recpAid: carol.aid,
  });

  const carolMessages = await client.transport.receiveMessages({
    for: carol.aid,
    auth: carolReceiveAuth,
  });

  console.log(`✓ Carol received ${carolMessages.length} message(s)`);
  for (const msg of carolMessages) {
    const plaintext = decrypt(msg.ct);
    console.log(`  From: ${msg.from}`);
    console.log(`  Message: "${plaintext}"`);
  }

  // Alice did NOT receive her own message (sender excluded from fanout)
  console.log("\n=== Alice checks her messages ===");
  const aliceReceiveAuth = await client.createAuth(alice, "receive", {
    recpAid: alice.aid,
  });

  const aliceMessages = await client.transport.receiveMessages({
    for: alice.aid,
    auth: aliceReceiveAuth,
  });

  console.log(`✓ Alice received ${aliceMessages.length} message(s) (should be 0 - sender excluded)`);

  // Bob sends a reply to the group
  console.log("\n=== Bob replies to the group ===");
  const replyText = "Sounds good! I'm ready to start.";
  const replyCt = encrypt(replyText);
  const replyCtHash = client.computeCtHash(replyCt);

  const bobSendAuth = await client.createAuth(bob, "sendGroup", {
    groupId,
    ctHash: replyCtHash,
    ttl: 60000,
  });

  await client.group.sendGroupMessage({
    groupId,
    ct: replyCt,
    typ: "chat.text.v1",
    ttlMs: 60000,
    auth: bobSendAuth,
  });

  console.log(`✓ Bob sent reply: "${replyText}"`);

  // Wait for fanout
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Alice and Carol receive Bob's reply
  const aliceReplies = await client.transport.receiveMessages({
    for: alice.aid,
    auth: aliceReceiveAuth,
  });

  const carolReplies = await client.transport.receiveMessages({
    for: carol.aid,
    auth: carolReceiveAuth,
  });

  console.log(`\n✓ Alice received ${aliceReplies.length} reply(ies)`);
  console.log(`✓ Carol received ${carolReplies.length} reply(ies)`);

  // Close client
  client.close();
  console.log("\n✓ Client closed");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
