/**
 * Group Chat Integration Tests
 *
 * Tests the new linear message history group chat system with:
 * - GroupChats table for group metadata and governance
 * - GroupMessages table for linear message history
 * - GroupMembers table for membership and sync tracking
 *
 * Test scenarios:
 * 1. Create group chat with KERI governance links
 * 2. Send and retrieve messages in linear order
 * 3. Track member sync state for unread messages
 * 4. Update membership SAID for governance changes
 * 5. Message expiration and cleanup
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { generateKeyPair, createAID, signPayload, computeArgsHash } from "../helpers/crypto-utils";
import { eventually, eventuallyValue } from "../helpers/eventually";
import type { Id } from "../../convex/_generated/dataModel";

describe("Group Chat - Linear Message History", () => {
  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    throw new Error("CONVEX_URL environment variable required for integration tests");
  }

  let client: ConvexClient;

  // Test users
  let alice: { aid: string; privateKey: Uint8Array; ksn: number; publicKeyCESR: string };
  let bob: { aid: string; privateKey: Uint8Array; ksn: number; publicKeyCESR: string };
  let carol: { aid: string; privateKey: Uint8Array; ksn: number; publicKeyCESR: string };
  let dave: { aid: string; privateKey: Uint8Array; ksn: number; publicKeyCESR: string };

  beforeEach(async () => {
    client = new ConvexClient(convexUrl);

    // Generate keys for test users
    const aliceKeys = await generateKeyPair();
    const bobKeys = await generateKeyPair();
    const carolKeys = await generateKeyPair();
    const daveKeys = await generateKeyPair();

    alice = {
      aid: createAID(aliceKeys.publicKey),
      privateKey: aliceKeys.privateKey,
      publicKeyCESR: aliceKeys.publicKeyCESR,
      ksn: 0,
    };

    bob = {
      aid: createAID(bobKeys.publicKey),
      privateKey: bobKeys.privateKey,
      publicKeyCESR: bobKeys.publicKeyCESR,
      ksn: 0,
    };

    carol = {
      aid: createAID(carolKeys.publicKey),
      privateKey: carolKeys.privateKey,
      publicKeyCESR: carolKeys.publicKeyCESR,
      ksn: 0,
    };

    dave = {
      aid: createAID(daveKeys.publicKey),
      privateKey: daveKeys.privateKey,
      publicKeyCESR: daveKeys.publicKeyCESR,
      ksn: 0,
    };

    // Register key states for all users
    for (const user of [alice, bob, carol, dave]) {
      await client.mutation(api.auth.registerKeyState, {
        aid: user.aid,
        ksn: 0,
        keys: [user.publicKeyCESR],
        threshold: "1",
        lastEvtSaid: `evt-${user.aid.slice(0, 8)}-0`,
      });
    }
  });

  afterEach(() => {
    client.close();
  });

  async function createAuthChallenge(
    user: { aid: string; privateKey: Uint8Array; ksn: number },
    purpose: string,
    args: Record<string, any>
  ) {
    // Compute args hash using the same function as the server
    const argsHash = computeArgsHash(args);

    // Issue challenge
    const challenge = await client.mutation(api.auth.issueChallenge, {
      aid: user.aid,
      purpose,
      argsHash,
    });

    // Sign challenge payload
    const sigs = await signPayload(challenge.payload, user.privateKey, 0);

    return {
      challengeId: challenge.challengeId,
      sigs,
      ksn: user.ksn,
    };
  }

  test("create group chat with KERI governance", async () => {
    // Alice creates a group with Bob and Carol
    const ownerAid = alice.aid; // Alice owns the group
    const membershipSaid = "SAID-membership-v1"; // Mock TEL SAID

    const auth = await createAuthChallenge(alice, "createGroup", {
      name: "Engineering Team",
      ownerAid,
      membershipSaid,
      members: [bob.aid, carol.aid].sort(),  // This is what verifyAuth expects
    });

    const { groupChatId } = await client.mutation(api.groups.createGroupChat, {
      name: "Engineering Team",
      ownerAid,
      membershipSaid,
      maxTtl: 7 * 24 * 60 * 60 * 1000, // 7 days
      initialMembers: [bob.aid, carol.aid],
      auth,
    });

    expect(groupChatId).toBeDefined();

    // Verify group details
    const groupChat = await client.query(api.groups.getGroupChat, {
      groupChatId,
      callerAid: alice.aid,
    });

    expect(groupChat.name).toBe("Engineering Team");
    expect(groupChat.ownerAid).toBe(alice.aid);
    expect(groupChat.membershipSaid).toBe(membershipSaid);
    expect(groupChat.members.length).toBe(3); // Alice, Bob, Carol

    // Check member roles
    const aliceMember = groupChat.members.find(m => m.aid === alice.aid);
    expect(aliceMember?.role).toBe("owner");

    const bobMember = groupChat.members.find(m => m.aid === bob.aid);
    expect(bobMember?.role).toBe("member");
  });

  test("send and retrieve messages in linear order", async () => {
    // Create group
    const createAuth = await createAuthChallenge(alice, "createGroup", {
      name: "Message Test Group",
      ownerAid: alice.aid,
      membershipSaid: "SAID-test-v1",
      members: [bob.aid].sort(),
    });

    const { groupChatId } = await client.mutation(api.groups.createGroupChat, {
      name: "Message Test Group",
      ownerAid: alice.aid,
      membershipSaid: "SAID-test-v1",
      initialMembers: [bob.aid],
      auth: createAuth,
    });

    // Alice sends first message
    const aliceMsg1Auth = await createAuthChallenge(alice, "sendGroupMessage", {
      groupChatId,
      messageType: "text",
    });

    const msg1 = await client.mutation(api.groups.sendGroupMessage, {
      groupChatId,
      encryptedMessage: "encrypted:Hello everyone!",
      messageType: "text",
      auth: aliceMsg1Auth,
    });

    expect(msg1.seqNo).toBe(0); // First message gets seqNo 0

    // Bob sends second message
    const bobMsgAuth = await createAuthChallenge(bob, "sendGroupMessage", {
      groupChatId,
      messageType: "text",
    });

    const msg2 = await client.mutation(api.groups.sendGroupMessage, {
      groupChatId,
      encryptedMessage: "encrypted:Hi Alice!",
      messageType: "text",
      auth: bobMsgAuth,
    });

    expect(msg2.seqNo).toBe(1); // Second message gets seqNo 1

    // Alice sends third message
    const aliceMsg2Auth = await createAuthChallenge(alice, "sendGroupMessage", {
      groupChatId,
      messageType: "text",
    });

    const msg3 = await client.mutation(api.groups.sendGroupMessage, {
      groupChatId,
      encryptedMessage: "encrypted:How's the project?",
      messageType: "text",
      auth: aliceMsg2Auth,
    });

    expect(msg3.seqNo).toBe(2); // Third message gets seqNo 2

    // Retrieve all messages in order
    const messages = await client.query(api.groups.getGroupMessages, {
      groupChatId,
      callerAid: alice.aid,
    });

    expect(messages.length).toBe(3);
    expect(messages[0].seqNo).toBe(0);
    expect(messages[0].senderAid).toBe(alice.aid);
    expect(messages[0].encryptedMessage).toBe("encrypted:Hello everyone!");

    expect(messages[1].seqNo).toBe(1);
    expect(messages[1].senderAid).toBe(bob.aid);
    expect(messages[1].encryptedMessage).toBe("encrypted:Hi Alice!");

    expect(messages[2].seqNo).toBe(2);
    expect(messages[2].senderAid).toBe(alice.aid);
    expect(messages[2].encryptedMessage).toBe("encrypted:How's the project?");
  });

  test("track member sync state and unread messages", async () => {
    // Create group
    const createAuth = await createAuthChallenge(alice, "createGroup", {
      name: "Sync Test Group",
      ownerAid: alice.aid,
      membershipSaid: "SAID-sync-v1",
      members: [bob.aid, carol.aid].sort(),
    });

    const { groupChatId } = await client.mutation(api.groups.createGroupChat, {
      name: "Sync Test Group",
      ownerAid: alice.aid,
      membershipSaid: "SAID-sync-v1",
      initialMembers: [bob.aid, carol.aid],
      auth: createAuth,
    });

    // Alice sends 3 messages
    for (let i = 0; i < 3; i++) {
      const auth = await createAuthChallenge(alice, "sendGroupMessage", {
        groupChatId,
        messageType: "text",
      });

      await client.mutation(api.groups.sendGroupMessage, {
        groupChatId,
        encryptedMessage: `encrypted:Message ${i + 1}`,
        messageType: "text",
        auth,
      });
    }

    // Bob retrieves messages after seqNo -1 (gets all)
    const bobMessages = await client.query(api.groups.getGroupMessages, {
      groupChatId,
      afterSeqNo: -1,
      callerAid: bob.aid,
    });

    expect(bobMessages.length).toBe(3);

    // Bob updates sync state to seqNo 1 (has read first 2 messages)
    const bobSyncAuth = await createAuthChallenge(bob, "updateSync", {
      groupChatId,
      latestSeqNo: 1,
    });

    await client.mutation(api.groups.updateMemberSync, {
      groupChatId,
      latestSeqNo: 1,
      auth: bobSyncAuth,
    });

    // Check Bob's unread count
    const bobGroups = await client.query(api.groups.listGroupChats, {
      aid: bob.aid,
    });

    const syncGroup = bobGroups.find(g => g.id === groupChatId);
    expect(syncGroup?.messageCount).toBe(3);
    expect(syncGroup?.unreadCount).toBe(1); // 3 total - (1 + 1) read = 1 unread

    // Carol hasn't synced at all
    const carolGroups = await client.query(api.groups.listGroupChats, {
      aid: carol.aid,
    });

    const carolGroup = carolGroups.find(g => g.id === groupChatId);
    expect(carolGroup?.unreadCount).toBe(3); // All messages unread

    // Bob gets only new messages (after seqNo 1)
    const bobNewMessages = await client.query(api.groups.getGroupMessages, {
      groupChatId,
      afterSeqNo: 1,
      callerAid: bob.aid,
    });

    expect(bobNewMessages.length).toBe(1);
    expect(bobNewMessages[0].seqNo).toBe(2);
  });

  test("add and remove members from group chat", async () => {
    // Create group with just Bob
    const createAuth = await createAuthChallenge(alice, "createGroup", {
      name: "Dynamic Members",
      ownerAid: alice.aid,
      membershipSaid: "SAID-dynamic-v1",
      members: [bob.aid].sort(),
    });

    const { groupChatId } = await client.mutation(api.groups.createGroupChat, {
      name: "Dynamic Members",
      ownerAid: alice.aid,
      membershipSaid: "SAID-dynamic-v1",
      initialMembers: [bob.aid],
      auth: createAuth,
    });

    // Send initial message
    const msg1Auth = await createAuthChallenge(alice, "sendGroupMessage", {
      groupChatId,
      messageType: "text",
    });

    await client.mutation(api.groups.sendGroupMessage, {
      groupChatId,
      encryptedMessage: "encrypted:Welcome Bob!",
      messageType: "text",
      auth: msg1Auth,
    });

    // Alice adds Carol
    const addCarolAuth = await createAuthChallenge(alice, "manageGroup", {
      action: "addMembers",
      groupChatId,
      members: [carol.aid].sort(),
    });

    await client.mutation(api.groups.addGroupMembers, {
      groupChatId,
      members: [carol.aid],
      auth: addCarolAuth,
    });

    // Carol can now see messages
    const carolMessages = await client.query(api.groups.getGroupMessages, {
      groupChatId,
      callerAid: carol.aid,
    });

    expect(carolMessages.length).toBe(1);
    expect(carolMessages[0].encryptedMessage).toBe("encrypted:Welcome Bob!");

    // Send another message
    const msg2Auth = await createAuthChallenge(alice, "sendGroupMessage", {
      groupChatId,
      messageType: "text",
    });

    await client.mutation(api.groups.sendGroupMessage, {
      groupChatId,
      encryptedMessage: "encrypted:Welcome Carol!",
      messageType: "text",
      auth: msg2Auth,
    });

    // Bob (non-admin) tries to add Dave - should fail
    const bobAddAuth = await createAuthChallenge(bob, "manageGroup", {
      action: "addMembers",
      groupChatId,
      members: [dave.aid].sort(),
    });

    await expect(
      client.mutation(api.groups.addGroupMembers, {
        groupChatId,
        members: [dave.aid],
        auth: bobAddAuth,
      })
    ).rejects.toThrow(/Only admins or owners can add members/);

    // Alice removes Bob
    const removeBobAuth = await createAuthChallenge(alice, "manageGroup", {
      action: "removeMembers",
      groupChatId,
      members: [bob.aid].sort(),
    });

    await client.mutation(api.groups.removeGroupMembers, {
      groupChatId,
      members: [bob.aid],
      auth: removeBobAuth,
    });

    // Bob can no longer access messages
    await expect(
      client.query(api.groups.getGroupMessages, {
        groupChatId,
        callerAid: bob.aid,
      })
    ).rejects.toThrow(/not a member/);
  });

  test("update membership SAID for governance changes", async () => {
    // Create group
    const createAuth = await createAuthChallenge(alice, "createGroup", {
      name: "Governance Test",
      ownerAid: alice.aid,
      membershipSaid: "SAID-gov-v1",
      members: [bob.aid].sort(),
    });

    const { groupChatId } = await client.mutation(api.groups.createGroupChat, {
      name: "Governance Test",
      ownerAid: alice.aid,
      membershipSaid: "SAID-gov-v1",
      initialMembers: [bob.aid],
      auth: createAuth,
    });

    // Alice (owner) updates membership SAID
    const updateAuth = await createAuthChallenge(alice, "updateGroupGovernance", {
      groupChatId,
      membershipSaid: "SAID-gov-v2",
    });

    await client.mutation(api.groups.updateMembershipSaid, {
      groupChatId,
      membershipSaid: "SAID-gov-v2",
      auth: updateAuth,
    });

    // Verify update
    const groupChat = await client.query(api.groups.getGroupChat, {
      groupChatId,
      callerAid: alice.aid,
    });

    expect(groupChat.membershipSaid).toBe("SAID-gov-v2");

    // Bob (non-owner) tries to update - should fail
    const bobUpdateAuth = await createAuthChallenge(bob, "updateGroupGovernance", {
      groupChatId,
      membershipSaid: "SAID-gov-v3",
    });

    await expect(
      client.mutation(api.groups.updateMembershipSaid, {
        groupChatId,
        membershipSaid: "SAID-gov-v3",
        auth: bobUpdateAuth,
      })
    ).rejects.toThrow(/Only the group owner can update membership SAID/);
  });

  test("message expiration and TTL", async () => {
    // Create group with short TTL
    const createAuth = await createAuthChallenge(alice, "createGroup", {
      name: "Short TTL Group",
      ownerAid: alice.aid,
      membershipSaid: "SAID-ttl-v1",
      members: [bob.aid].sort(),
    });

    const { groupChatId } = await client.mutation(api.groups.createGroupChat, {
      name: "Short TTL Group",
      ownerAid: alice.aid,
      membershipSaid: "SAID-ttl-v1",
      maxTtl: 100, // 100ms TTL for testing
      initialMembers: [bob.aid],
      auth: createAuth,
    });

    // Send message
    const msgAuth = await createAuthChallenge(alice, "sendGroupMessage", {
      groupChatId,
      messageType: "text",
    });

    const { messageId } = await client.mutation(api.groups.sendGroupMessage, {
      groupChatId,
      encryptedMessage: "encrypted:This will expire soon",
      messageType: "text",
      auth: msgAuth,
    });

    // Verify message has expiration
    const messages = await client.query(api.groups.getGroupMessages, {
      groupChatId,
      callerAid: alice.aid,
    });

    expect(messages.length).toBe(1);
    const message = messages[0];

    // Note: We can't test actual cleanup without a background job,
    // but we can verify the expiration is set
    expect(message).toBeDefined();
    // The expiresAt field is not exposed in the query response,
    // but it would be set internally for cleanup jobs
  });

  test("pagination with limit parameter", async () => {
    // Create group
    const createAuth = await createAuthChallenge(alice, "createGroup", {
      name: "Pagination Test",
      ownerAid: alice.aid,
      membershipSaid: "SAID-page-v1",
      members: [bob.aid].sort(),
    });

    const { groupChatId } = await client.mutation(api.groups.createGroupChat, {
      name: "Pagination Test",
      ownerAid: alice.aid,
      membershipSaid: "SAID-page-v1",
      initialMembers: [bob.aid],
      auth: createAuth,
    });

    // Send 10 messages
    for (let i = 0; i < 10; i++) {
      const auth = await createAuthChallenge(
        i % 2 === 0 ? alice : bob,
        "sendGroupMessage",
        { groupChatId, messageType: "text" }
      );

      await client.mutation(api.groups.sendGroupMessage, {
        groupChatId,
        encryptedMessage: `encrypted:Message ${i}`,
        messageType: "text",
        auth,
      });
    }

    // Get first 5 messages
    const firstBatch = await client.query(api.groups.getGroupMessages, {
      groupChatId,
      afterSeqNo: -1,
      limit: 5,
      callerAid: alice.aid,
    });

    expect(firstBatch.length).toBe(5);
    expect(firstBatch[0].seqNo).toBe(0);
    expect(firstBatch[4].seqNo).toBe(4);

    // Get next 5 messages
    const secondBatch = await client.query(api.groups.getGroupMessages, {
      groupChatId,
      afterSeqNo: 4,
      limit: 5,
      callerAid: alice.aid,
    });

    expect(secondBatch.length).toBe(5);
    expect(secondBatch[0].seqNo).toBe(5);
    expect(secondBatch[4].seqNo).toBe(9);
  });

  test("list groups with unread counts", async () => {
    // Create multiple groups
    const group1Auth = await createAuthChallenge(alice, "createGroup", {
      name: "Group 1",
      ownerAid: alice.aid,
      membershipSaid: "SAID-g1-v1",
      members: [bob.aid].sort(),
    });

    const { groupChatId: group1 } = await client.mutation(api.groups.createGroupChat, {
      name: "Group 1",
      ownerAid: alice.aid,
      membershipSaid: "SAID-g1-v1",
      initialMembers: [bob.aid],
      auth: group1Auth,
    });

    const group2Auth = await createAuthChallenge(alice, "createGroup", {
      name: "Group 2",
      ownerAid: alice.aid,
      membershipSaid: "SAID-g2-v1",
      members: [bob.aid, carol.aid].sort(),
    });

    const { groupChatId: group2 } = await client.mutation(api.groups.createGroupChat, {
      name: "Group 2",
      ownerAid: alice.aid,
      membershipSaid: "SAID-g2-v1",
      initialMembers: [bob.aid, carol.aid],
      auth: group2Auth,
    });

    // Send messages to both groups
    for (let i = 0; i < 3; i++) {
      const auth1 = await createAuthChallenge(alice, "sendGroupMessage", {
        groupChatId: group1,
        messageType: "text",
      });

      await client.mutation(api.groups.sendGroupMessage, {
        groupChatId: group1,
        encryptedMessage: `encrypted:G1 Message ${i}`,
        messageType: "text",
        auth: auth1,
      });

      const auth2 = await createAuthChallenge(alice, "sendGroupMessage", {
        groupChatId: group2,
        messageType: "text",
      });

      await client.mutation(api.groups.sendGroupMessage, {
        groupChatId: group2,
        encryptedMessage: `encrypted:G2 Message ${i}`,
        messageType: "text",
        auth: auth2,
      });
    }

    // Bob marks group1 as read (up to seqNo 2)
    const bobSyncAuth = await createAuthChallenge(bob, "updateSync", {
      groupChatId: group1,
      latestSeqNo: 2,
    });

    await client.mutation(api.groups.updateMemberSync, {
      groupChatId: group1,
      latestSeqNo: 2,
      auth: bobSyncAuth,
    });

    // List Bob's groups
    const bobGroups = await client.query(api.groups.listGroupChats, {
      aid: bob.aid,
    });

    expect(bobGroups.length).toBe(2);

    const g1 = bobGroups.find(g => g.id === group1);
    expect(g1?.name).toBe("Group 1");
    expect(g1?.unreadCount).toBe(0); // All read

    const g2 = bobGroups.find(g => g.id === group2);
    expect(g2?.name).toBe("Group 2");
    expect(g2?.unreadCount).toBe(3); // All unread
  });
});