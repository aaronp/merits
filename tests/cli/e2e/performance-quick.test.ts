/**
 * Quick Performance Tests
 *
 * Faster performance tests suitable for CI/CD pipelines.
 * Uses smaller sample sizes while still validating performance characteristics.
 *
 * For comprehensive benchmarks, use performance.test.ts
 *
 * Priority: P2 (performance validation)
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ensureAdminInitialised, type AdminCredentials } from "../../helpers/admin-bootstrap";
import { runCliInProcess } from "../helpers/exec";
import { cleanTestDir, mkScenario } from "../helpers/workspace";

const QUICK_TEST_TIMEOUT = 120000; // 2 minutes

describe("Quick Performance Checks", () => {
  let admin: AdminCredentials;

  beforeAll(async () => {
    admin = await ensureAdminInitialised();
    console.log(`✓ Admin initialized: ${admin.aid}`);
  });

  afterAll(async () => {
    cleanTestDir();
  });

  /**
   * Quick check: Direct message send performance
   * Sends 10 messages and validates average latency
   */
  it("should send direct messages with acceptable latency", async () => {
    console.log(`\n🚀 Quick test: Sending 10 direct messages...`);

    const aliceDir = mkScenario("quick-alice");
    const alice = await runCliInProcess(["incept"], { cwd: aliceDir.root });

    const bobDir = mkScenario("quick-bob");
    const bob = await runCliInProcess(["incept"], { cwd: bobDir.root });

    // Promote both to user role
    await runCliInProcess(
      ["rbac", "users", "grant-role", alice.json.aid, "user", "--action-said", "quick/test"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );
    await runCliInProcess(
      ["rbac", "users", "grant-role", bob.json.aid, "user", "--action-said", "quick/test"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );

    const timings: number[] = [];

    for (let i = 0; i < 10; i++) {
      const start = performance.now();

      const result = await runCliInProcess(
        ["send", bob.json.aid, "--message", `Quick test ${i}`, "--typ", "quick.test"],
        { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
      );

      const end = performance.now();
      const elapsed = end - start;

      expect(result.code).toBe(0);
      timings.push(elapsed);

      console.log(`   Message ${i + 1}/10: ${elapsed.toFixed(2)}ms`);
    }

    const average = timings.reduce((sum, t) => sum + t, 0) / timings.length;
    const max = Math.max(...timings);

    console.log(`\n📊 Results:`);
    console.log(`   Average: ${average.toFixed(2)}ms`);
    console.log(`   Max:     ${max.toFixed(2)}ms`);

    // Quick performance check - more lenient than full benchmark
    expect(average).toBeLessThan(10000); // Average under 10 seconds
    console.log(`✅ Performance acceptable (avg ${average.toFixed(2)}ms < 10000ms)`);
  }, QUICK_TEST_TIMEOUT);

  /**
   * Quick check: Group message performance with 5 members
   */
  it("should send group messages with acceptable latency", async () => {
    console.log(`\n🚀 Quick test: Group message with 5 members...`);

    const senderDir = mkScenario("quick-sender");
    const sender = await runCliInProcess(["incept"], { cwd: senderDir.root });

    // Promote sender
    await runCliInProcess(
      ["rbac", "users", "grant-role", sender.json.aid, "user", "--action-said", "quick/test"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );

    // Create group
    const createGroupResult = await runCliInProcess(
      ["group", "create", "quick-test-group"],
      { cwd: senderDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(sender.json) } }
    );
    expect(createGroupResult.code).toBe(0);
    const groupId = createGroupResult.json.groupId;

    // Create and add 5 members
    console.log(`   Creating 5 members...`);
    for (let i = 0; i < 5; i++) {
      const memberDir = mkScenario(`quick-member-${i}`);
      const member = await runCliInProcess(["incept"], { cwd: memberDir.root });

      await runCliInProcess(
        ["group", "add", groupId, member.json.aid],
        { cwd: senderDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(sender.json) } }
      );
    }

    // Send 5 group messages
    console.log(`   Sending 5 group messages...`);
    const timings: number[] = [];

    for (let i = 0; i < 5; i++) {
      const start = performance.now();

      const result = await runCliInProcess(
        ["send", groupId, "--message", `Quick group test ${i}`, "--typ", "quick.test"],
        { cwd: senderDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(sender.json) } }
      );

      const end = performance.now();
      const elapsed = end - start;

      expect(result.code).toBe(0);
      timings.push(elapsed);

      console.log(`   Message ${i + 1}/5: ${elapsed.toFixed(2)}ms`);
    }

    const average = timings.reduce((sum, t) => sum + t, 0) / timings.length;
    const max = Math.max(...timings);

    console.log(`\n📊 Results:`);
    console.log(`   Average: ${average.toFixed(2)}ms`);
    console.log(`   Max:     ${max.toFixed(2)}ms`);

    // Quick performance check
    expect(average).toBeLessThan(15000); // Average under 15 seconds for small group
    console.log(`✅ Performance acceptable (avg ${average.toFixed(2)}ms < 15000ms)`);
  }, QUICK_TEST_TIMEOUT);

  /**
   * Quick check: Unread message query performance
   */
  it("should query unread messages with acceptable latency", async () => {
    console.log(`\n🚀 Quick test: Unread message queries...`);

    const aliceDir = mkScenario("quick-alice-unread");
    const alice = await runCliInProcess(["incept"], { cwd: aliceDir.root });

    const bobDir = mkScenario("quick-bob-unread");
    const bob = await runCliInProcess(["incept"], { cwd: bobDir.root });

    // Promote both
    await runCliInProcess(
      ["rbac", "users", "grant-role", alice.json.aid, "user", "--action-said", "quick/test"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );
    await runCliInProcess(
      ["rbac", "users", "grant-role", bob.json.aid, "user", "--action-said", "quick/test"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );

    // Send 10 messages from Alice to Bob
    console.log(`   Sending 10 messages...`);
    for (let i = 0; i < 10; i++) {
      await runCliInProcess(
        ["send", bob.json.aid, "--message", `Test ${i}`, "--typ", "quick.test"],
        { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
      );
    }

    // Query unread 10 times
    console.log(`   Querying unread 10 times...`);
    const timings: number[] = [];

    for (let i = 0; i < 10; i++) {
      const start = performance.now();

      const result = await runCliInProcess(
        ["unread"],
        { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) } }
      );

      const end = performance.now();
      const elapsed = end - start;

      expect(result.code).toBe(0);
      expect(result.json).toBeArray();
      timings.push(elapsed);

      console.log(`   Query ${i + 1}/10: ${elapsed.toFixed(2)}ms (${result.json.length} messages)`);
    }

    const average = timings.reduce((sum, t) => sum + t, 0) / timings.length;
    const max = Math.max(...timings);

    console.log(`\n📊 Results:`);
    console.log(`   Average: ${average.toFixed(2)}ms`);
    console.log(`   Max:     ${max.toFixed(2)}ms`);

    // Quick performance check
    expect(average).toBeLessThan(5000); // Average under 5 seconds
    console.log(`✅ Performance acceptable (avg ${average.toFixed(2)}ms < 5000ms)`);
  }, QUICK_TEST_TIMEOUT);
});
