/**
 * E2E Performance Tests
 *
 * Benchmarks messaging performance for:
 * - Direct messages (1-to-1)
 * - Group messages (1-to-many)
 * - Scaling up to 300 member groups
 *
 * Metrics tracked:
 * - Message send latency
 * - Message receive latency
 * - Group encryption overhead
 * - Scalability with group size
 *
 * Priority: P2 (performance validation)
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ensureAdminInitialised, type AdminCredentials } from "../../helpers/admin-bootstrap";
import { runCliInProcess } from "../helpers/exec";
import { cleanTestDir, mkScenario } from "../helpers/workspace";

// Performance tests need longer timeouts
const PERF_TEST_TIMEOUT = 300000; // 5 minutes
const LARGE_GROUP_TIMEOUT = 600000; // 10 minutes

interface PerformanceMetrics {
  operation: string;
  count: number;
  totalMs: number;
  averageMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

function calculateMetrics(operation: string, timings: number[]): PerformanceMetrics {
  if (timings.length === 0) {
    return {
      operation,
      count: 0,
      totalMs: 0,
      averageMs: 0,
      minMs: 0,
      maxMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
    };
  }

  const sorted = [...timings].sort((a, b) => a - b);
  const total = timings.reduce((sum, t) => sum + t, 0);

  const p50Index = Math.floor(sorted.length * 0.50);
  const p95Index = Math.floor(sorted.length * 0.95);
  const p99Index = Math.floor(sorted.length * 0.99);

  return {
    operation,
    count: timings.length,
    totalMs: total,
    averageMs: total / timings.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    p50Ms: sorted[p50Index],
    p95Ms: sorted[p95Index],
    p99Ms: sorted[p99Index],
  };
}

function printMetrics(metrics: PerformanceMetrics) {
  console.log(`\n📊 Performance Metrics: ${metrics.operation}`);
  console.log(`   Count:    ${metrics.count} operations`);
  console.log(`   Total:    ${metrics.totalMs.toFixed(2)}ms`);
  console.log(`   Average:  ${metrics.averageMs.toFixed(2)}ms`);
  console.log(`   Min:      ${metrics.minMs.toFixed(2)}ms`);
  console.log(`   Max:      ${metrics.maxMs.toFixed(2)}ms`);
  console.log(`   P50:      ${metrics.p50Ms.toFixed(2)}ms`);
  console.log(`   P95:      ${metrics.p95Ms.toFixed(2)}ms`);
  console.log(`   P99:      ${metrics.p99Ms.toFixed(2)}ms`);
}

describe("Performance Benchmarks", () => {
  let admin: AdminCredentials;

  beforeAll(async () => {
    admin = await ensureAdminInitialised();
    console.log(`✓ Admin initialized: ${admin.aid}`);
  });

  afterAll(async () => {
    cleanTestDir();
  });

  /**
   * Benchmark: Direct Message Send Performance
   *
   * Measures the time to send direct messages between two users.
   * Tests: 100 messages sent from Alice to Bob
   */
  it("should benchmark direct message send performance", async () => {
    const aliceDir = mkScenario("perf-alice-dm");
    const alice = await runCliInProcess(["incept"], { cwd: aliceDir.root });

    const bobDir = mkScenario("perf-bob-dm");
    const bob = await runCliInProcess(["incept"], { cwd: bobDir.root });

    // Promote both to user role so they can message each other
    await runCliInProcess(
      ["rbac", "users", "grant-role", alice.json.aid, "user", "--action-said", "perf/test"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );
    await runCliInProcess(
      ["rbac", "users", "grant-role", bob.json.aid, "user", "--action-said", "perf/test"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );

    const messageCount = 100;
    const sendTimings: number[] = [];

    console.log(`\n🚀 Sending ${messageCount} direct messages...`);

    for (let i = 0; i < messageCount; i++) {
      const start = performance.now();

      const result = await runCliInProcess(
        ["send", bob.json.aid, "--message", `Performance test message ${i}`, "--typ", "perf.test"],
        { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
      );

      const end = performance.now();

      expect(result.code).toBe(0);
      sendTimings.push(end - start);

      if ((i + 1) % 20 === 0) {
        console.log(`   Sent ${i + 1}/${messageCount} messages...`);
      }
    }

    const metrics = calculateMetrics("Direct Message Send", sendTimings);
    printMetrics(metrics);

    // Performance assertions
    expect(metrics.averageMs).toBeLessThan(5000); // Average under 5 seconds
    expect(metrics.p95Ms).toBeLessThan(10000); // P95 under 10 seconds
  }, PERF_TEST_TIMEOUT);

  /**
   * Benchmark: Direct Message Receive Performance
   *
   * Measures the time to query and retrieve unread messages.
   */
  it("should benchmark direct message receive performance", async () => {
    const aliceDir = mkScenario("perf-alice-recv");
    const alice = await runCliInProcess(["incept"], { cwd: aliceDir.root });

    const bobDir = mkScenario("perf-bob-recv");
    const bob = await runCliInProcess(["incept"], { cwd: bobDir.root });

    // Promote both to user role
    await runCliInProcess(
      ["rbac", "users", "grant-role", alice.json.aid, "user", "--action-said", "perf/test"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );
    await runCliInProcess(
      ["rbac", "users", "grant-role", bob.json.aid, "user", "--action-said", "perf/test"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );

    // Send 50 messages from Alice to Bob
    console.log(`\n📨 Preparing 50 messages for receive test...`);
    for (let i = 0; i < 50; i++) {
      await runCliInProcess(
        ["send", bob.json.aid, "--message", `Receive test message ${i}`, "--typ", "perf.test"],
        { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
      );
    }

    const queryCount = 100;
    const receiveTimings: number[] = [];

    console.log(`\n🚀 Querying unread messages ${queryCount} times...`);

    for (let i = 0; i < queryCount; i++) {
      const start = performance.now();

      const result = await runCliInProcess(
        ["unread"],
        { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) } }
      );

      const end = performance.now();

      expect(result.code).toBe(0);
      expect(result.json).toBeArray();
      receiveTimings.push(end - start);

      if ((i + 1) % 20 === 0) {
        console.log(`   Queried ${i + 1}/${queryCount} times...`);
      }
    }

    const metrics = calculateMetrics("Direct Message Receive (Unread Query)", receiveTimings);
    printMetrics(metrics);

    // Performance assertions
    expect(metrics.averageMs).toBeLessThan(3000); // Average under 3 seconds
    expect(metrics.p95Ms).toBeLessThan(5000); // P95 under 5 seconds
  }, PERF_TEST_TIMEOUT);

  /**
   * Benchmark: Group Message Performance - Small Groups (10 members)
   */
  it("should benchmark group message performance with 10 members", async () => {
    await benchmarkGroupMessaging(10, admin);
  }, PERF_TEST_TIMEOUT);

  /**
   * Benchmark: Group Message Performance - Medium Groups (50 members)
   */
  it("should benchmark group message performance with 50 members", async () => {
    await benchmarkGroupMessaging(50, admin);
  }, PERF_TEST_TIMEOUT);

  /**
   * Benchmark: Group Message Performance - Large Groups (100 members)
   */
  it("should benchmark group message performance with 100 members", async () => {
    await benchmarkGroupMessaging(100, admin);
  }, LARGE_GROUP_TIMEOUT);

  /**
   * Benchmark: Group Message Performance - Very Large Groups (300 members)
   */
  it("should benchmark group message performance with 300 members", async () => {
    await benchmarkGroupMessaging(300, admin);
  }, LARGE_GROUP_TIMEOUT);
});

/**
 * Helper function to benchmark group messaging at a specific scale
 */
async function benchmarkGroupMessaging(memberCount: number, admin: AdminCredentials) {
  console.log(`\n🏗️  Creating group with ${memberCount} members...`);

  // Create sender
  const senderDir = mkScenario(`perf-sender-${memberCount}`);
  const sender = await runCliInProcess(["incept"], { cwd: senderDir.root });

  // Promote sender to user role
  await runCliInProcess(
    ["rbac", "users", "grant-role", sender.json.aid, "user", "--action-said", "perf/test"],
    { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
  );

  // Create group
  const createGroupResult = await runCliInProcess(
    ["group", "create", `perf-group-${memberCount}`],
    { cwd: senderDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(sender.json) } }
  );
  expect(createGroupResult.code).toBe(0);
  const groupId = createGroupResult.json.groupId;

  // Create and add members to the group
  console.log(`   Creating ${memberCount} member accounts...`);
  const members = [];

  for (let i = 0; i < memberCount; i++) {
    const memberDir = mkScenario(`perf-member-${memberCount}-${i}`);
    const member = await runCliInProcess(["incept"], { cwd: memberDir.root });
    members.push({ dir: memberDir, creds: member.json });

    if ((i + 1) % 50 === 0 || (i + 1) === memberCount) {
      console.log(`   Created ${i + 1}/${memberCount} members...`);
    }
  }

  // Add members to group
  console.log(`   Adding ${memberCount} members to group...`);
  for (let i = 0; i < members.length; i++) {
    await runCliInProcess(
      ["group", "add", groupId, members[i].creds.aid],
      { cwd: senderDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(sender.json) } }
    );

    if ((i + 1) % 50 === 0 || (i + 1) === memberCount) {
      console.log(`   Added ${i + 1}/${memberCount} members...`);
    }
  }

  // Benchmark: Send group messages
  const sendCount = 10;
  const sendTimings: number[] = [];

  console.log(`\n🚀 Sending ${sendCount} group messages to ${memberCount} members...`);

  for (let i = 0; i < sendCount; i++) {
    const start = performance.now();

    const result = await runCliInProcess(
      ["send", groupId, "--message", `Group perf test ${i}`, "--typ", "perf.test"],
      { cwd: senderDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(sender.json) } }
    );

    const end = performance.now();

    expect(result.code).toBe(0);
    sendTimings.push(end - start);

    console.log(`   Sent ${i + 1}/${sendCount} messages (${(end - start).toFixed(2)}ms)...`);
  }

  const sendMetrics = calculateMetrics(
    `Group Message Send (${memberCount} members)`,
    sendTimings
  );
  printMetrics(sendMetrics);

  // Benchmark: Receive group messages
  const sampleSize = Math.min(10, memberCount); // Sample up to 10 members
  const receiveTimings: number[] = [];

  console.log(`\n📨 Querying unread messages for ${sampleSize} sample members...`);

  for (let i = 0; i < sampleSize; i++) {
    const start = performance.now();

    const result = await runCliInProcess(
      ["unread"],
      { cwd: members[i].dir.root, env: { MERITS_CREDENTIALS: JSON.stringify(members[i].creds) } }
    );

    const end = performance.now();

    expect(result.code).toBe(0);
    expect(result.json).toBeArray();
    expect(result.json.length).toBeGreaterThan(0); // Should have messages
    receiveTimings.push(end - start);

    console.log(`   Member ${i + 1}/${sampleSize} received ${result.json.length} messages (${(end - start).toFixed(2)}ms)`);
  }

  const receiveMetrics = calculateMetrics(
    `Group Message Receive (${memberCount} members)`,
    receiveTimings
  );
  printMetrics(receiveMetrics);

  // Performance assertions
  // Send performance scales with group size (allow more time for larger groups)
  const maxSendTime = 1000 + (memberCount * 50); // Base 1s + 50ms per member
  expect(sendMetrics.averageMs).toBeLessThan(maxSendTime);

  // Receive performance should be consistent regardless of group size
  expect(receiveMetrics.averageMs).toBeLessThan(5000);

  console.log(`\n✅ Group size ${memberCount}: Send avg ${sendMetrics.averageMs.toFixed(2)}ms, Receive avg ${receiveMetrics.averageMs.toFixed(2)}ms`);
}
