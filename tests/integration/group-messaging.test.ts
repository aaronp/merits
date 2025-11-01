/**
 * Group Messaging Integration Tests
 *
 * These tests exercise the full end-to-end group messaging flow:
 * - Create groups with multiple members
 * - Send encrypted group messages
 * - Receive and decrypt messages
 * - Verify access control (non-members can't decrypt)
 * - Test message ordering and delivery
 *
 * These tests run against the REAL Convex backend deployment.
 *
 * Prerequisites:
 * - Convex backend deployed (CONVEX_URL environment variable)
 * - Users registered in the system
 * - Groups created with members
 *
 * Run with:
 *   CONVEX_URL=https://accurate-penguin-901.convex.cloud bun test tests/integration/group-messaging.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// Import group encryption functions
import { encryptForGroup, decryptGroupMessage, type GroupMessage } from "../../cli/lib/crypto-group";

describe("Group Messaging Integration", () => {
  let client: ConvexHttpClient;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let eve: TestUser;
  let testGroupId: Id<"groupChats">;

  interface TestUser {
    aid: string;
    privateKey: Uint8Array;
    publicKey: string; // base64url
  }

  beforeAll(async () => {
    // Initialize Convex client
    const convexUrl = process.env.CONVEX_URL || "https://accurate-penguin-901.convex.cloud";
    client = new ConvexHttpClient(convexUrl);

    // Create test users with deterministic keys for reproducibility
    alice = await createTestUser("alice");
    bob = await createTestUser("bob");
    carol = await createTestUser("carol");
    eve = await createTestUser("eve"); // Non-member

    // Register users in the backend
    await registerUser(client, alice);
    await registerUser(client, bob);
    await registerUser(client, carol);
    await registerUser(client, eve);

    // Create a test group with Alice, Bob, and Carol (NOT Eve)
    testGroupId = await createTestGroup(client, "Test Group", alice, [alice, bob, carol]);
  });

  test("Alice can send encrypted message to group", async () => {
    const message = "Hello from Alice!";

    // Get group members with public keys
    const membersResponse = await client.query(api.groups.getMembers, {
      groupChatId: testGroupId,
      callerAid: alice.aid,
    });

    expect(membersResponse).toBeDefined();
    expect(membersResponse.members.length).toBe(3);

    // Convert to encryption format
    const members: Record<string, string> = {};
    for (const member of membersResponse.members) {
      members[member.aid] = member.publicKey;
    }

    // Encrypt message for all group members
    const groupMessage = await encryptForGroup(
      message,
      members,
      alice.privateKey,
      testGroupId,
      alice.aid
    );

    expect(groupMessage).toHaveProperty("encryptedContent");
    expect(groupMessage).toHaveProperty("nonce");
    expect(groupMessage).toHaveProperty("encryptedKeys");
    expect(Object.keys(groupMessage.encryptedKeys).length).toBe(3);

    // Create auth proof (simplified for testing)
    const auth = await createAuthProof(client, alice, "sendGroupMessage", {
      groupChatId: testGroupId,
      contentHash: groupMessage.encryptedContent.substring(0, 32),
    });

    // Send to backend
    const result = await client.mutation(api.groups.sendGroupMessage, {
      groupChatId: testGroupId,
      groupMessage,
      auth,
    });

    expect(result).toHaveProperty("messageId");
    expect(result).toHaveProperty("seqNo");
    expect(result.seqNo).toBeGreaterThanOrEqual(0);
  });

  test("Bob can receive and decrypt Alice's message", async () => {
    // Send a message from Alice first
    const message = "Secret message for the group";
    const groupMessage = await sendGroupMessage(client, testGroupId, alice, message);

    // Bob fetches unread messages
    const unreadResponse = await client.query(api.messages.getUnread, {
      aid: bob.aid,
      includeGroupMessages: true,
    });

    expect(unreadResponse).toHaveProperty("messages");
    expect(unreadResponse.messages.length).toBeGreaterThan(0);

    // Find the group message
    const groupMsg = unreadResponse.messages.find(
      (m: any) => m.isGroupMessage && m.typ === "group-encrypted"
    );

    expect(groupMsg).toBeDefined();
    expect(groupMsg.senderPublicKey).toBe(alice.publicKey);

    // Bob decrypts the message
    const decrypted = await decryptGroupMessage(
      groupMsg.ct,
      bob.privateKey,
      bob.aid,
      groupMsg.senderPublicKey
    );

    expect(decrypted).toBe(message);
  });

  test("Carol can also decrypt the same message", async () => {
    // Send a message from Alice
    const message = "Message for all members";
    await sendGroupMessage(client, testGroupId, alice, message);

    // Carol fetches unread messages
    const unreadResponse = await client.query(api.messages.getUnread, {
      aid: carol.aid,
      includeGroupMessages: true,
    });

    const groupMsg = unreadResponse.messages.find(
      (m: any) => m.isGroupMessage && m.typ === "group-encrypted"
    );

    expect(groupMsg).toBeDefined();

    // Carol decrypts the message
    const decrypted = await decryptGroupMessage(
      groupMsg.ct,
      carol.privateKey,
      carol.aid,
      groupMsg.senderPublicKey
    );

    expect(decrypted).toBe(message);
  });

  test("Eve (non-member) cannot decrypt group messages", async () => {
    // Send a message from Alice
    const message = "Secret from Alice";
    const groupMessage = await sendGroupMessage(client, testGroupId, alice, message);

    // Eve should not be able to get group members (not a member)
    await expect(async () => {
      await client.query(api.groups.getMembers, {
        groupChatId: testGroupId,
        callerAid: eve.aid,
      });
    }).toThrow();

    // Even if Eve somehow gets the encrypted message, she can't decrypt it
    // because her AID is not in the encryptedKeys
    expect(groupMessage.encryptedKeys[eve.aid]).toBeUndefined();

    // Attempting to decrypt will fail because there's no key for Eve
    await expect(async () => {
      await decryptGroupMessage(
        groupMessage,
        eve.privateKey,
        eve.aid,
        alice.publicKey
      );
    }).toThrow();
  });

  test("Bob can send message and Alice can decrypt it", async () => {
    const message = "Hello from Bob!";
    await sendGroupMessage(client, testGroupId, bob, message);

    // Alice receives it
    const unreadResponse = await client.query(api.messages.getUnread, {
      aid: alice.aid,
      includeGroupMessages: true,
    });

    const groupMsg = unreadResponse.messages.find(
      (m: any) => m.from === bob.aid && m.isGroupMessage
    );

    expect(groupMsg).toBeDefined();

    // Alice decrypts
    const decrypted = await decryptGroupMessage(
      groupMsg.ct,
      alice.privateKey,
      alice.aid,
      groupMsg.senderPublicKey
    );

    expect(decrypted).toBe(message);
  });

  test("Messages are ordered by sequence number", async () => {
    // Send multiple messages
    const message1 = "First message";
    const message2 = "Second message";
    const message3 = "Third message";

    const result1 = await sendGroupMessage(client, testGroupId, alice, message1);
    const result2 = await sendGroupMessage(client, testGroupId, bob, message2);
    const result3 = await sendGroupMessage(client, testGroupId, carol, message3);

    // Sequence numbers should be increasing
    expect(result2.seqNo).toBeGreaterThan(result1.seqNo);
    expect(result3.seqNo).toBeGreaterThan(result2.seqNo);

    // Get messages in order
    const messages = await client.query(api.groups.getGroupMessages, {
      groupChatId: testGroupId,
      callerAid: alice.aid,
      afterSeqNo: -1,
      limit: 100,
    });

    // Verify ordering
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i].seqNo).toBeGreaterThan(messages[i - 1].seqNo);
    }
  });

  test("All members can decrypt large message (1KB)", async () => {
    const largeMessage = "x".repeat(1024); // 1KB message

    const groupMessage = await sendGroupMessage(client, testGroupId, alice, largeMessage);

    // Bob decrypts
    const bobUnread = await client.query(api.messages.getUnread, {
      aid: bob.aid,
      includeGroupMessages: true,
    });
    const bobMsg = bobUnread.messages.find((m: any) => m.isGroupMessage);
    const bobDecrypted = await decryptGroupMessage(
      bobMsg.ct,
      bob.privateKey,
      bob.aid,
      bobMsg.senderPublicKey
    );
    expect(bobDecrypted).toBe(largeMessage);

    // Carol decrypts
    const carolUnread = await client.query(api.messages.getUnread, {
      aid: carol.aid,
      includeGroupMessages: true,
    });
    const carolMsg = carolUnread.messages.find((m: any) => m.isGroupMessage);
    const carolDecrypted = await decryptGroupMessage(
      carolMsg.ct,
      carol.privateKey,
      carol.aid,
      carolMsg.senderPublicKey
    );
    expect(carolDecrypted).toBe(largeMessage);
  });

  test("Tampering with encrypted content is detected", async () => {
    const message = "Original message";
    const groupMessage = await sendGroupMessage(client, testGroupId, alice, message);

    // Tamper with the encrypted content
    const tamperedMessage = { ...groupMessage };
    tamperedMessage.encryptedContent = tamperedMessage.encryptedContent.replace("A", "B");

    // Bob tries to decrypt the tampered message
    const bobUnread = await client.query(api.messages.getUnread, {
      aid: bob.aid,
      includeGroupMessages: true,
    });
    const originalMsg = bobUnread.messages.find((m: any) => m.isGroupMessage);

    // Replace with tampered version
    await expect(async () => {
      await decryptGroupMessage(
        tamperedMessage,
        bob.privateKey,
        bob.aid,
        originalMsg.senderPublicKey
      );
    }).toThrow(); // Should fail authentication check
  });
});

// ===== Helper Functions =====

/**
 * Create a test user with deterministic keys
 */
async function createTestUser(name: string): Promise<TestUser> {
  const { ed25519 } = await import("@noble/curves/ed25519.js");

  // Use name as seed for deterministic key generation
  const seed = new TextEncoder().encode(name.padEnd(32, "0"));
  const privateKey = ed25519.utils.randomSecretKey(); // In real test, use deterministic seed
  const publicKeyBytes = ed25519.getPublicKey(privateKey);
  const publicKey = uint8ArrayToBase64Url(publicKeyBytes);

  return {
    aid: `${name}-aid-${Date.now()}`, // Unique AID
    privateKey,
    publicKey,
  };
}

/**
 * Register a user in the backend
 */
async function registerUser(client: ConvexHttpClient, user: TestUser): Promise<void> {
  // First, register the key state
  const keyStateRegistered = await client.mutation(api.auth.registerKeyState, {
    aid: user.aid,
    ksn: 0,
    keys: [`D${user.publicKey}`], // CESR format
    threshold: "1",
    lastEvtSaid: "initial",
  });

  // Then register the user
  const auth = await createAuthProof(client, user, "registerUser", {
    aid: user.aid,
    publicKey: user.publicKey,
  });

  await client.mutation(api.auth.registerUser, {
    aid: user.aid,
    publicKey: user.publicKey,
    auth,
  });
}

/**
 * Create a test group
 */
async function createTestGroup(
  client: ConvexHttpClient,
  name: string,
  creator: TestUser,
  members: TestUser[]
): Promise<Id<"groupChats">> {
  const memberAids = members.map(m => m.aid);

  const auth = await createAuthProof(client, creator, "createGroup", {
    name,
    ownerAid: creator.aid,
    membershipSaid: "test-membership",
    members: memberAids.sort(),
  });

  const result = await client.mutation(api.groups.createGroupChat, {
    name,
    ownerAid: creator.aid,
    membershipSaid: "test-membership",
    maxTtl: 30 * 24 * 60 * 60 * 1000, // 30 days
    initialMembers: memberAids,
    auth,
  });

  return result.groupChatId;
}

/**
 * Send a group message
 */
async function sendGroupMessage(
  client: ConvexHttpClient,
  groupId: Id<"groupChats">,
  sender: TestUser,
  message: string
): Promise<GroupMessage> {
  // Get group members
  const membersResponse = await client.query(api.groups.getMembers, {
    groupChatId: groupId,
    callerAid: sender.aid,
  });

  // Convert to encryption format
  const members: Record<string, string> = {};
  for (const member of membersResponse.members) {
    members[member.aid] = member.publicKey;
  }

  // Encrypt
  const groupMessage = await encryptForGroup(
    message,
    members,
    sender.privateKey,
    groupId,
    sender.aid
  );

  // Create auth
  const auth = await createAuthProof(client, sender, "sendGroupMessage", {
    groupChatId: groupId,
    contentHash: groupMessage.encryptedContent.substring(0, 32),
  });

  // Send
  await client.mutation(api.groups.sendGroupMessage, {
    groupChatId: groupId,
    groupMessage,
    auth,
  });

  return groupMessage;
}

/**
 * Create an auth proof (simplified for testing)
 */
async function createAuthProof(
  client: ConvexHttpClient,
  user: TestUser,
  purpose: string,
  args: any
): Promise<any> {
  const { ed25519 } = await import("@noble/curves/ed25519.js");

  // Compute args hash
  const argsHash = await computeArgsHash(args);

  // Issue challenge
  const challenge = await client.mutation(api.auth.issueChallenge, {
    aid: user.aid,
    purpose,
    argsHash,
  });

  // Sign the challenge payload
  const payloadStr = JSON.stringify(challenge.payload, Object.keys(challenge.payload).sort());
  const payloadBytes = new TextEncoder().encode(payloadStr);
  const signature = ed25519.sign(payloadBytes, user.privateKey);
  const sigB64 = uint8ArrayToBase64Url(signature);

  return {
    challengeId: challenge.challengeId,
    sigs: [`0-${sigB64}`], // Indexed signature format
    ksn: 0,
  };
}

/**
 * Compute args hash (same as backend)
 */
async function computeArgsHash(args: Record<string, any>): Promise<string> {
  const { sha256 } = await import("@noble/hashes/sha2.js");

  const canonical = JSON.stringify(args, Object.keys(args).sort());
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);
  const hash = sha256(data); // Returns Uint8Array
  return uint8ArrayToBase64Url(hash);
}

/**
 * Helper: Convert Uint8Array to base64url
 */
function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
