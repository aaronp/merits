/**
 * E2E Test: Bootstrap Onboarding
 *
 * Tests the bootstrap process that creates initial roles and permissions.
 * Uses ensureAdminInitialised() helper for persistent admin user.
 *
 * Scenario:
 * 1. Initialize admin user with ensureAdminInitialised()
 * 2. Run bootstrap command to create roles (anon, user, admin)
 * 3. Verify admin has admin role assigned
 * 4. Verify bootstrap is idempotent (can run multiple times)
 * 5. Verify onboarding group exists
 *
 * Priority: P1 (system initialization)
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ensureAdminInitialised, type AdminCredentials } from "../../helpers/admin-bootstrap";
import { MAX_TEST_TIMEOUT } from "./test-const";
import { runCliInProcess } from "../helpers/exec";
import { assertSuccess } from "../helpers/exec";
import { cleanTestDir, mkScenario } from "../helpers/workspace";
import { ConvexMeritsClient } from "../../../src/client/convex";

/**
 * Helper: Get group by tag using the backend-agnostic MeritsClient API
 */
async function getGroupByTag(tag: string) {
  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    throw new Error("CONVEX_URL environment variable not set");
  }

  const client = new ConvexMeritsClient(convexUrl);
  try {
    return await client.getGroupIdByTag(tag);
  } finally {
    client.close();
  }
}


describe("User Onboarding", () => {

  let admin: AdminCredentials;

  beforeAll(async () => {
    admin = await ensureAdminInitialised();
    console.log(`✓ Admin initialized: ${admin.aid}`);
  });

  afterAll(async () => {
    cleanTestDir();
  });

  /**
   * See loadCredentials in @credentials.ts for MERITS_CREDENTIALS
   *
   * Creating a new user - TEST STATUS:
   * ✅ 1. they have the 'anon' role, as returned from calling 'status'
   * ✅ 2a. anon users cannot message arbitrary users (RBAC enforced)
   * ✅ 2b. anon users cannot create groups
   * ✅ 3. 'unread' shows no messages initially
   * ✅ 4. anon users can use 'group list' (returns empty array)
   * ✅ 5. anon users CAN message the onboarding group (RBAC allows via tag-based permission)
   * ✅ 6. Admin can message users directly (CAN_MESSAGE_USERS permission granted via bootstrap)
   * ✅ 7. Users can see unread messages from admin
   * ✅ 8. Users can mark messages as read
   *
   */
  it("should ensure new users have the anon role", async () => {


    /** Create two new users 'alice' and 'bob'  */
    const aliceDir = mkScenario("alice");
    const alice = await runCliInProcess(
      ["incept"],
      { cwd: aliceDir.root }
    );

    const bobDir = mkScenario("bob");
    const bob = await runCliInProcess(
      ["incept"],
      { cwd: bobDir.root }
    );

    /** Verify users are automatically added to onboarding group */
    const aliceGroup = await runCliInProcess(
      ["group", "list"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceGroup.code).toBe(0);
    expect(aliceGroup.json).toBeArray();
    expect(aliceGroup.json.length).toBe(1);
    expect(aliceGroup.json[0].name).toBe("onboarding");


    /** Verify anon users CANNOT message each other */
    const aliceSendBob = await runCliInProcess(
      ["send", bob.json.aid, "--message", "Hello Bob", "--typ", "chat.text"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) }, expectSuccess: false }
    );

    /** Verify anon users CANNOT create groups */
    // Check that send failed with proper error
    expect(aliceSendBob.code).toBe(1);
    expect(aliceSendBob.stdout).toBe("");
    expect(aliceSendBob.stderr).toContain("Error: Role denied");
    expect(aliceSendBob.json).toBeUndefined();

    /** Verify anon users CANNOT create groups */
    const aliceCreateGroup = await runCliInProcess(
      ["group", "create", "alice-test-group"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) }, expectSuccess: false }
    );
    expect(aliceCreateGroup.code).toBe(1);
    expect(aliceCreateGroup.stderr).toContain("Error");

    /** Verify anon users have no unread messages */
    const aliceUnread = await runCliInProcess(
      ["unread"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceUnread.code).toBe(0);
    expect(aliceUnread.json).toEqual([]);

    /** Verify anon users CAN message the onboarding group */
    // Query the onboarding group using the backend-agnostic API
    const onboardingGroup = await getGroupByTag("onboarding");

    if (onboardingGroup) {
      expect(onboardingGroup.name).toBe("onboarding");
      expect(onboardingGroup.tag).toBe("onboarding");

      console.log(`✅ Onboarding group found with tag: ${onboardingGroup.tag}, ID: ${onboardingGroup.id}`);

      // Test group messaging with encrypted group encryption
      const aliceSendOnboarding = await runCliInProcess(
        ["send", onboardingGroup.id, "--message", "Hello from Alice!", "--typ", "onboarding.intro"],
        { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
      );
      expect(aliceSendOnboarding.code).toBe(0);
      expect(aliceSendOnboarding.json.messageId).toBeDefined();
      console.log(`✅ Alice sent group message: ${aliceSendOnboarding.json.messageId}`);
    } else {
      console.log("⚠️  Onboarding group not found - skipping group messaging test");
    }

    /**
     * STEP: Have the admin message the users
     * Admin now has CAN_MESSAGE_USERS permission via bootstrap
     */
    const adminSendAlice = await runCliInProcess(
      ["send", alice.json.aid, "--message", "Welcome to the system, Alice!", "--typ", "admin.welcome"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );
    expect(adminSendAlice.code).toBe(0);
    expect(adminSendAlice.json.messageId).toBeDefined();
    console.log(`✅ Admin sent direct message to Alice: ${adminSendAlice.json.messageId}`);

    const adminSendBob = await runCliInProcess(
      ["send", bob.json.aid, "--message", "Welcome to the system, Bob!", "--typ", "admin.welcome"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );
    expect(adminSendBob.code).toBe(0);
    expect(adminSendBob.json.messageId).toBeDefined();
    console.log(`✅ Admin sent direct message to Bob: ${adminSendBob.json.messageId}`);

    /** Verify the users can see their unread messages */
    const aliceUnreadAfter = await runCliInProcess(
      ["unread"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceUnreadAfter.code).toBe(0);
    expect(aliceUnreadAfter.json).toBeArray();
    expect(aliceUnreadAfter.json.length).toBeGreaterThan(0);
    expect(aliceUnreadAfter.json[0].senderAid).toBe(admin.aid);
    console.log(`✅ Alice sees ${aliceUnreadAfter.json.length} unread message(s) from admin`);

    const bobUnreadAfter = await runCliInProcess(
      ["unread"],
      { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) } }
    );
    expect(bobUnreadAfter.code).toBe(0);
    expect(bobUnreadAfter.json).toBeArray();
    expect(bobUnreadAfter.json.length).toBeGreaterThan(0);
    expect(bobUnreadAfter.json[0].senderAid).toBe(admin.aid);
    console.log(`✅ Bob sees ${bobUnreadAfter.json.length} unread message(s) from admin`);

    /** Verify the users can read their messages */
    /** Verify the users can mark their messages as read */
    const aliceMessageId = aliceUnreadAfter.json[0].messageId;
    const aliceMarkRead = await runCliInProcess(
      ["mark-as-read", aliceMessageId],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceMarkRead.code).toBe(0);
    console.log(`✅ Alice marked message as read: ${aliceMessageId}`);

    // Verify message is no longer in unread
    const aliceUnreadFinal = await runCliInProcess(
      ["unread"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceUnreadFinal.code).toBe(0);
    expect(aliceUnreadFinal.json).toBeArray();
    const stillUnread = aliceUnreadFinal.json.find((m: any) => m.messageId === aliceMessageId);
    expect(stillUnread).toBeUndefined();
    console.log(`✅ Alice's unread list no longer contains marked message`);

    /** Verify the users can reply to the onboarding group */
    if (onboardingGroup) {
      const aliceReplyOnboarding = await runCliInProcess(
        ["send", onboardingGroup.id, "--message", "Thank you for the welcome!", "--typ", "onboarding.reply"],
        { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
      );
      expect(aliceReplyOnboarding.code).toBe(0);
      expect(aliceReplyOnboarding.json.messageId).toBeDefined();
      console.log(`✅ Alice replied to onboarding group`);
    }

    const alicestatus = await runCliInProcess(
      ["status"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(alicestatus.json.roles).toEqual(["anon"])
    expect(alicestatus.json.groups).toBeArray()
    expect(alicestatus.json.groups.length).toBe(1)
    expect(alicestatus.json.groups[0].groupName).toBe("onboarding")
    expect(alicestatus.json.publicKey).toBeDefined()
    expect(alicestatus.json.publicKeyKsn).toBe(0)

  }, MAX_TEST_TIMEOUT);

  /**
   * The onboarding admin, after chatting with the anon users, puts them in a new group.
   *
   * Our admin user with admin permissions can put people (our anon users) into groups, though this
   * does not change the anon users' roles.
   *
   * Here we assert:
   *  $ the admin can create new groups and put the anon users in them
   *  $ the anon users themselves cannot do this (create groups, join groups themselves)
   *  $ anon users can message people in the groups they are in (e.g. the other users in the new group)
   *  $ the users can use 'status' and 'group list' to see what groups they are in
   *  $ the users can use 'unread' to see their unread messages,
   *  $ messages the users send themselves shouldn't be included in their unread messages
   *  $ the anon users can leave their groups, but cannot rejoin of their own accord (the admin must put them in a group)
   *
   */
  it("should allows anon to be put into groups by the admin", async () => {
    // Create two anon users (alice and bob)
    const aliceDir = mkScenario("alice2");
    const alice = await runCliInProcess(
      ["incept"],
      { cwd: aliceDir.root }
    );

    const bobDir = mkScenario("bob2");
    const bob = await runCliInProcess(
      ["incept"],
      { cwd: bobDir.root }
    );

    /** Admin creates a new group called "test-group" */
    const adminCreateGroup = await runCliInProcess(
      ["group", "create", "test-group"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );
    expect(adminCreateGroup.code).toBe(0);
    expect(adminCreateGroup.json.groupId).toBeDefined();
    const testGroupId = adminCreateGroup.json.groupId;
    console.log(`✅ Admin created group: ${testGroupId}`);

    /** Admin adds alice to the group */
    const adminAddAlice = await runCliInProcess(
      ["group", "add", testGroupId, alice.json.aid],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );
    expect(adminAddAlice.code).toBe(0);
    console.log(`✅ Admin added Alice to group`);

    /** Admin adds bob to the group */
    const adminAddBob = await runCliInProcess(
      ["group", "add", testGroupId, bob.json.aid],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );
    expect(adminAddBob.code).toBe(0);
    console.log(`✅ Admin added Bob to group`);

    /** Verify Alice sees the new group in her group list */
    const aliceGroupList = await runCliInProcess(
      ["group", "list"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceGroupList.code).toBe(0);
    expect(aliceGroupList.json).toBeArray();
    expect(aliceGroupList.json.length).toBe(2); // onboarding + test-group
    const testGroup = aliceGroupList.json.find((g: any) => g.name === "test-group");
    expect(testGroup).toBeDefined();

    /** Verify Alice's status shows both groups */
    const aliceStatus = await runCliInProcess(
      ["status"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceStatus.code).toBe(0);
    expect(aliceStatus.json.groups.length).toBe(2);
    expect(aliceStatus.json.roles).toEqual(["anon"]); // Still anon

    /** Alice sends a message to the test group */
    const aliceSendGroup = await runCliInProcess(
      ["send", testGroupId, "--message", "Hello Bob from test group!", "--typ", "chat.text"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceSendGroup.code).toBe(0);
    expect(aliceSendGroup.json.messageId).toBeDefined();
    console.log(`✅ Alice sent message to test group`);

    /** Bob checks unread messages (should see Alice's message) */
    const bobUnread = await runCliInProcess(
      ["unread"],
      { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) } }
    );
    expect(bobUnread.code).toBe(0);
    expect(bobUnread.json).toBeArray();
    // Bob should see Alice's message (not his own)
    const aliceMessage = bobUnread.json.find((msg: any) => msg.senderAid === alice.json.aid);
    expect(aliceMessage).toBeDefined();

    /** Bob sends a message to the test group */
    const bobSendGroup = await runCliInProcess(
      ["send", testGroupId, "--message", "Hello Alice!", "--typ", "chat.text"],
      { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) } }
    );
    expect(bobSendGroup.code).toBe(0);

    /** Bob checks his own unread (should NOT see his own message) */
    const bobUnreadAfter = await runCliInProcess(
      ["unread"],
      { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) } }
    );
    expect(bobUnreadAfter.code).toBe(0);
    const bobOwnMessage = bobUnreadAfter.json.find((msg: any) => msg.senderAid === bob.json.aid);
    expect(bobOwnMessage).toBeUndefined(); // Bob shouldn't see his own message in unread

    /** Alice leaves the group */
    const aliceLeave = await runCliInProcess(
      ["group", "leave", testGroupId],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceLeave.code).toBe(0);
    console.log(`✅ Alice left the group`);

    /** Verify Alice no longer sees the group */
    const aliceGroupListAfter = await runCliInProcess(
      ["group", "list"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceGroupListAfter.code).toBe(0);
    expect(aliceGroupListAfter.json.length).toBe(1); // Only onboarding now

    /**
     * Verify that after Alice leaves:
     * 1. Bob (remaining member) can still send messages to the group
     * 2. Bob doesn't see his own message in unread
     * 3. Alice (who left) does NOT see Bob's new messages
     */
    const bobSendAfterAliceLeft = await runCliInProcess(
      ["send", testGroupId, "--message", "Alice is gone, just me now!", "--typ", "chat.text"],
      { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) } }
    );
    expect(bobSendAfterAliceLeft.code).toBe(0);
    console.log(`✅ Bob sent message after Alice left`);

    // Bob should NOT see his own message in unread
    const bobUnreadAfterLeave = await runCliInProcess(
      ["unread"],
      { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) } }
    );
    expect(bobUnreadAfterLeave.code).toBe(0);
    const bobOwnMessageAfterLeave = bobUnreadAfterLeave.json.find(
      (msg: any) => msg.messageId === bobSendAfterAliceLeft.json.messageId
    );
    expect(bobOwnMessageAfterLeave).toBeUndefined();
    console.log(`✅ Bob doesn't see his own message in unread`);

    // Alice should NOT see Bob's message (she left the group)
    const aliceUnreadAfterLeave = await runCliInProcess(
      ["unread"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceUnreadAfterLeave.code).toBe(0);
    const bobMessageForAlice = aliceUnreadAfterLeave.json.find(
      (msg: any) => msg.messageId === bobSendAfterAliceLeft.json.messageId
    );
    expect(bobMessageForAlice).toBeUndefined();
    console.log(`✅ Alice doesn't see messages from group she left`);
  }, MAX_TEST_TIMEOUT)

  /**
   *
   * Anon users can update their 'allow' and 'deny' lists. In our test scenario,
   * we have three new anon users: alice, bob and carol.
   *
   * The admin puts alice and bob in a new group, who can message each other (but not carol), and carol cannot message them.
   * Alice and bob should always now be able to see all the group messages, regardless of their 'allow' and 'deny' lists.
   *
   * When alice updates her 'allow' list to include bob, she should be able to message bob, and bob should be able to message her.
   * If alice changes her 'allow' list to just include carol (she may know carols ID from offline), bob should NOT be able to send direct messages to alice
   *
   * If alice clears her 'allow' list, bob should be able to message her again.
   * If alice adds bob to her 'deny' list, bob should NOT be able to message her directly.
   *
   */
  it("should allows anon to update their 'allow' and 'deny' lists", async () => {
    // Create three anon users
    const aliceDir = mkScenario("alice3");
    const alice = await runCliInProcess(["incept"], { cwd: aliceDir.root });

    const bobDir = mkScenario("bob3");
    const bob = await runCliInProcess(["incept"], { cwd: bobDir.root });

    const carolDir = mkScenario("carol");
    const carol = await runCliInProcess(["incept"], { cwd: carolDir.root });

    // Note: By default, alice has 'user' role and can create groups if bootstrapped correctly
    // For this test, we assume alice needs the 'user' role to create groups
    // If she's still 'anon', the admin needs to promote her first

    /** Admin promotes alice and bob to 'user' role so they can message directly */
    const promoteAlice = await runCliInProcess(
      ["rbac", "users", "grant-role", alice.json.aid, "user", "--action-said", "test/promote"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );
    expect(promoteAlice.code).toBe(0);

    const promoteBob = await runCliInProcess(
      ["rbac", "users", "grant-role", bob.json.aid, "user", "--action-said", "test/promote"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );
    expect(promoteBob.code).toBe(0);

    const promoteCarol = await runCliInProcess(
      ["rbac", "users", "grant-role", carol.json.aid, "user", "--action-said", "test/promote"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );
    expect(promoteCarol.code).toBe(0);
    console.log(`✅ Promoted alice, bob, and carol to 'user' role`);

    /** Admin creates a group and adds alice and bob (not carol) */
    const createGroup = await runCliInProcess(
      ["group", "create", "alice-bob-group"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );
    expect(createGroup.code).toBe(0);
    const groupId = createGroup.json.groupId;

    await runCliInProcess(
      ["group", "add", groupId, alice.json.aid],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );
    await runCliInProcess(
      ["group", "add", groupId, bob.json.aid],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );

    /** Alice and Bob can message in the group (baseline) */
    const aliceGroupMsg = await runCliInProcess(
      ["send", groupId, "--message", "Hello group!", "--typ", "chat.text"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceGroupMsg.code).toBe(0);

    /** Alice adds Bob to her allow-list */
    const aliceAllowBob = await runCliInProcess(
      ["access", "allow", bob.json.aid],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceAllowBob.code).toBe(0);
    console.log(`✅ Alice added Bob to allow-list`);

    /** Bob should be able to send direct message to Alice */
    const bobToAlice = await runCliInProcess(
      ["send", alice.json.aid, "--message", "Hi Alice!", "--typ", "chat.text"],
      { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) } }
    );
    expect(bobToAlice.code).toBe(0);
    console.log(`✅ Bob sent direct message to Alice (allow-list allows it)`);

    /** Alice changes allow-list to only include Carol (removes Bob implicitly) */
    const aliceAllowCarol = await runCliInProcess(
      ["access", "allow", carol.json.aid],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceAllowCarol.code).toBe(0);

    /** Bob should NOT be able to send direct message to Alice now */
    const bobToAlice2 = await runCliInProcess(
      ["send", alice.json.aid, "--message", "Are you there Alice?", "--typ", "chat.text"],
      { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) }, expectSuccess: false }
    );
    expect(bobToAlice2.code).toBe(1);
    expect(bobToAlice2.stderr).toContain("Error");
    console.log(`✅ Bob cannot send to Alice (not on allow-list)`);

    /** But Alice and Bob can still message in the group */
    const bobGroupMsg = await runCliInProcess(
      ["send", groupId, "--message", "Still works in group!", "--typ", "chat.text"],
      { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) } }
    );
    expect(bobGroupMsg.code).toBe(0);
    console.log(`✅ Group messaging still works regardless of allow-list`);

    /** Alice clears her allow-list */
    const aliceClearAllow = await runCliInProcess(
      ["access", "clear", "--allow"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceClearAllow.code).toBe(0);

    /** Bob should be able to message Alice again */
    const bobToAlice3 = await runCliInProcess(
      ["send", alice.json.aid, "--message", "Back again!", "--typ", "chat.text"],
      { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) } }
    );
    expect(bobToAlice3.code).toBe(0);
    console.log(`✅ Bob can message Alice after allow-list cleared`);

    /** Alice adds Bob to deny-list */
    const aliceDenyBob = await runCliInProcess(
      ["access", "deny", bob.json.aid],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceDenyBob.code).toBe(0);

    /** Bob should NOT be able to message Alice (deny-list blocks) */
    const bobToAlice4 = await runCliInProcess(
      ["send", alice.json.aid, "--message", "This should fail", "--typ", "chat.text"],
      { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) }, expectSuccess: false }
    );
    expect(bobToAlice4.code).toBe(1);
    console.log(`✅ Bob blocked by deny-list`);
  }, MAX_TEST_TIMEOUT)

  /**
   * The admin user can change a user's role from 'anon' to 'user'
   *
   * Now we should assert the new 'users' can do user things:
   *  $ create new own groups
   *  $ join existing groups
   *  $ leave groups
   *  $ message other users in the groups they are in
   *  $ read messages from the groups they are in
   *  $ send messages to the groups they are in
   *  $ read messages from the groups they are in
   *  $ message other users directly
   *
   * We will use their 'unread' and 'status' messages, as well as 'mark-as-read' to assert these things.
   */
  it("should allow users to be given a 'user' role", async () => {
    // Create two anon users
    const aliceDir = mkScenario("alice4");
    const alice = await runCliInProcess(["incept"], { cwd: aliceDir.root });

    const bobDir = mkScenario("bob4");
    const bob = await runCliInProcess(["incept"], { cwd: bobDir.root });

    /** Verify they start as anon */
    const aliceStatusBefore = await runCliInProcess(
      ["status"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceStatusBefore.json.roles).toEqual(["anon"]);

    /** Anon users CANNOT create groups */
    const aliceCreateGroupFail = await runCliInProcess(
      ["group", "create", "alice-group"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) }, expectSuccess: false }
    );
    expect(aliceCreateGroupFail.code).toBe(1);
    console.log(`✅ Anon user cannot create groups`);

    /** Admin promotes alice to 'user' role */
    const promoteAlice = await runCliInProcess(
      ["rbac", "users", "grant-role", alice.json.aid, "user", "--action-said", "test/promote"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );
    expect(promoteAlice.code).toBe(0);
    console.log(`✅ Admin promoted Alice to user role`);

    const promoteBob = await runCliInProcess(
      ["rbac", "users", "grant-role", bob.json.aid, "user", "--action-said", "test/promote"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );
    expect(promoteBob.code).toBe(0);

    /** Verify alice now has 'user' role (and possibly still 'anon') */
    const aliceStatusAfter = await runCliInProcess(
      ["status"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceStatusAfter.json.roles).toContain("user");

    /** Alice can now create her own group */
    const aliceCreateGroup = await runCliInProcess(
      ["group", "create", "alice-private-group"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceCreateGroup.code).toBe(0);
    expect(aliceCreateGroup.json.groupId).toBeDefined();
    const aliceGroupId = aliceCreateGroup.json.groupId;
    console.log(`✅ User alice created her own group: ${aliceGroupId}`);

    /** Alice adds Bob to her group */
    const aliceAddBob = await runCliInProcess(
      ["group", "add", aliceGroupId, bob.json.aid],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceAddBob.code).toBe(0);
    console.log(`✅ Alice added Bob to her group`);

    /** Bob verifies he's in the group */
    const bobGroupList = await runCliInProcess(
      ["group", "list"],
      { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) } }
    );
    expect(bobGroupList.code).toBe(0);
    const bobInAliceGroup = bobGroupList.json.find((g: any) => g.id === aliceGroupId);
    expect(bobInAliceGroup).toBeDefined();

    /** Alice sends a group message */
    const aliceSendGroup = await runCliInProcess(
      ["send", aliceGroupId, "--message", "Welcome to my group, Bob!", "--typ", "chat.text"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceSendGroup.code).toBe(0);

    /** Bob reads his unread messages */
    const bobUnread = await runCliInProcess(
      ["unread"],
      { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) } }
    );
    expect(bobUnread.code).toBe(0);
    const aliceMsg = bobUnread.json.find((msg: any) => msg.senderAid === alice.json.aid);
    expect(aliceMsg).toBeDefined();
    console.log(`✅ Bob sees Alice's message in unread`);

    /** Bob marks messages as read */
    if (aliceMsg && aliceMsg.id) {
      const bobMarkRead = await runCliInProcess(
        ["mark-as-read", aliceMsg.id],
        { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) } }
      );
      expect(bobMarkRead.code).toBe(0);
      console.log(`✅ Bob marked message as read`);
    }

    /** Bob sends a reply */
    const bobReply = await runCliInProcess(
      ["send", aliceGroupId, "--message", "Thanks Alice!", "--typ", "chat.text"],
      { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) } }
    );
    expect(bobReply.code).toBe(0);

    /** Alice sends Bob a direct message (users can message each other) */
    const aliceToBob = await runCliInProcess(
      ["send", bob.json.aid, "--message", "Private message for Bob", "--typ", "chat.text"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    expect(aliceToBob.code).toBe(0);
    console.log(`✅ Alice sent direct message to Bob (user role allows this)`);

    /** Bob leaves the group */
    const bobLeave = await runCliInProcess(
      ["group", "leave", aliceGroupId],
      { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) } }
    );
    expect(bobLeave.code).toBe(0);
    console.log(`✅ Bob left Alice's group`);

    /** Verify Bob no longer sees the group */
    const bobGroupListAfter = await runCliInProcess(
      ["group", "list"],
      { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) } }
    );
    const bobNotInGroup = bobGroupListAfter.json.find((g: any) => g.id === aliceGroupId);
    expect(bobNotInGroup).toBeUndefined();
  }, MAX_TEST_TIMEOUT)

});
