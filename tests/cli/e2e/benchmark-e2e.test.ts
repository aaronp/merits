/**
 * End-to-End Messaging Benchmark
 *
 * Measures pure message send/receive round-trip performance,
 * isolating connection overhead from actual messaging latency.
 *
 * This test:
 * 1. Establishes connections and authenticates ONCE (setup)
 * 2. Warms up the connection (sends 5 warmup messages)
 * 3. Benchmarks pure messaging round-trip (send + receive)
 * 4. Measures both direct and group messaging
 *
 * Key Metrics:
 * - Send latency: Time to encrypt + sign + transmit
 * - Receive latency: Time to query + decrypt
 * - Round-trip latency: Time from send start to message received
 *
 * Priority: P1 (performance debugging)
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ensureAdminInitialised, type AdminCredentials } from "../../helpers/admin-bootstrap";
import { runCliInProcess } from "../helpers/exec";
import { cleanTestDir, mkScenario } from "../helpers/workspace";

const BENCHMARK_TIMEOUT = 180000; // 3 minutes

interface BenchmarkMetrics {
  operation: string;
  samples: number;
  totalMs: number;
  averageMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

function calculateMetrics(operation: string, timings: number[]): BenchmarkMetrics {
  if (timings.length === 0) {
    return {
      operation,
      samples: 0,
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
    samples: timings.length,
    totalMs: total,
    averageMs: total / timings.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    p50Ms: sorted[p50Index],
    p95Ms: sorted[p95Index],
    p99Ms: sorted[p99Index],
  };
}

function printMetrics(metrics: BenchmarkMetrics) {
  console.log(`\n📊 ${metrics.operation}`);
  console.log(`   Samples:  ${metrics.samples}`);
  console.log(`   Average:  ${metrics.averageMs.toFixed(2)}ms`);
  console.log(`   Min:      ${metrics.minMs.toFixed(2)}ms`);
  console.log(`   Max:      ${metrics.maxMs.toFixed(2)}ms`);
  console.log(`   P50:      ${metrics.p50Ms.toFixed(2)}ms`);
  console.log(`   P95:      ${metrics.p95Ms.toFixed(2)}ms`);
  console.log(`   P99:      ${metrics.p99Ms.toFixed(2)}ms`);
}

describe("End-to-End Messaging Benchmark", () => {
  let admin: AdminCredentials;

  beforeAll(async () => {
    admin = await ensureAdminInitialised();
    console.log(`✓ Admin initialized: ${admin.aid}`);
  });

  afterAll(async () => {
    cleanTestDir();
  });

  /**
   * Benchmark: Direct Message Send Round-Trip
   *
   * Measures time from message send to message appearing in recipient's unread list.
   * Excludes initial connection setup and authentication.
   */
  it("should benchmark direct message send round-trip (excluding connection)", async () => {
    console.log(`\n🎯 Benchmarking direct message round-trip...`);

    // SETUP PHASE (not measured)
    console.log(`\n📋 Setup: Creating users and establishing connections...`);
    const aliceDir = mkScenario("e2e-alice");
    const alice = await runCliInProcess(["incept"], { cwd: aliceDir.root });

    const bobDir = mkScenario("e2e-bob");
    const bob = await runCliInProcess(["incept"], { cwd: bobDir.root });

    // Promote both to user role
    await runCliInProcess(
      ["rbac", "users", "grant-role", alice.json.aid, "user", "--action-said", "e2e/test"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );
    await runCliInProcess(
      ["rbac", "users", "grant-role", bob.json.aid, "user", "--action-said", "e2e/test"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );

    // WARMUP PHASE (not measured)
    console.log(`\n🔥 Warmup: Sending 5 warmup messages to establish connection...`);
    for (let i = 0; i < 5; i++) {
      await runCliInProcess(
        ["send", bob.json.aid, "--message", `Warmup ${i}`, "--typ", "e2e.warmup"],
        { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
      );
    }

    // Clear warmup messages
    await runCliInProcess(
      ["unread"],
      { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) } }
    );

    // BENCHMARK PHASE (measured)
    console.log(`\n⏱️  Benchmark: Measuring 20 message round-trips...`);
    const samples = 20;
    const sendTimings: number[] = [];
    const receiveTimings: number[] = [];
    const roundTripTimings: number[] = [];

    for (let i = 0; i < samples; i++) {
      const roundTripStart = performance.now();

      // Send message
      const sendStart = performance.now();
      const sendResult = await runCliInProcess(
        ["send", bob.json.aid, "--message", `Benchmark ${i}`, "--typ", "e2e.test"],
        { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
      );
      const sendEnd = performance.now();

      expect(sendResult.code).toBe(0);
      const messageId = sendResult.json.messageId;
      sendTimings.push(sendEnd - sendStart);

      // Receive message
      const receiveStart = performance.now();
      const receiveResult = await runCliInProcess(
        ["unread"],
        { cwd: bobDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(bob.json) } }
      );
      const receiveEnd = performance.now();

      expect(receiveResult.code).toBe(0);
      expect(receiveResult.json.messages).toBeArray();

      // Verify message was received
      const receivedMessage = receiveResult.json.messages.find(
        (m: any) => m.id === messageId
      );
      expect(receivedMessage).toBeDefined();

      const roundTripEnd = performance.now();

      receiveTimings.push(receiveEnd - receiveStart);
      roundTripTimings.push(roundTripEnd - roundTripStart);

      if ((i + 1) % 5 === 0) {
        console.log(`   Completed ${i + 1}/${samples} round-trips...`);
      }
    }

    // RESULTS
    console.log(`\n📈 Direct Message Round-Trip Results:`);

    const sendMetrics = calculateMetrics("Send Operation", sendTimings);
    printMetrics(sendMetrics);

    const receiveMetrics = calculateMetrics("Receive Operation", receiveTimings);
    printMetrics(receiveMetrics);

    const roundTripMetrics = calculateMetrics("Full Round-Trip", roundTripTimings);
    printMetrics(roundTripMetrics);

    // Analysis
    console.log(`\n🔍 Performance Analysis:`);
    console.log(`   Send overhead:     ${sendMetrics.averageMs.toFixed(2)}ms (${(sendMetrics.averageMs / roundTripMetrics.averageMs * 100).toFixed(1)}%)`);
    console.log(`   Receive overhead:  ${receiveMetrics.averageMs.toFixed(2)}ms (${(receiveMetrics.averageMs / roundTripMetrics.averageMs * 100).toFixed(1)}%)`);
    console.log(`   Total round-trip:  ${roundTripMetrics.averageMs.toFixed(2)}ms`);

    // Performance assertions
    expect(roundTripMetrics.averageMs).toBeLessThan(10000); // Average under 10 seconds
    expect(roundTripMetrics.p95Ms).toBeLessThan(15000); // P95 under 15 seconds

    console.log(`\n✅ Direct messaging benchmark complete`);
  }, BENCHMARK_TIMEOUT);

  /**
   * Benchmark: Group Message Send Round-Trip
   *
   * Measures time from group message send to messages appearing in members' unread lists.
   * Tests with a 10-member group.
   */
  it("should benchmark group message send round-trip (excluding connection)", async () => {
    console.log(`\n🎯 Benchmarking group message round-trip...`);

    // SETUP PHASE (not measured)
    console.log(`\n📋 Setup: Creating group with 10 members...`);
    const senderDir = mkScenario("e2e-group-sender");
    const sender = await runCliInProcess(["incept"], { cwd: senderDir.root });

    // Promote sender
    await runCliInProcess(
      ["rbac", "users", "grant-role", sender.json.aid, "user", "--action-said", "e2e/test"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );

    // Create group
    const createGroupResult = await runCliInProcess(
      ["group", "create", "e2e-benchmark-group"],
      { cwd: senderDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(sender.json) } }
    );
    expect(createGroupResult.code).toBe(0);
    const groupId = createGroupResult.json.groupId;

    // Create and add 10 members
    const members = [];
    for (let i = 0; i < 10; i++) {
      const memberDir = mkScenario(`e2e-group-member-${i}`);
      const member = await runCliInProcess(["incept"], { cwd: memberDir.root });
      members.push({ dir: memberDir, creds: member.json });

      await runCliInProcess(
        ["group", "add", groupId, member.json.aid],
        { cwd: senderDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(sender.json) } }
      );
    }

    // WARMUP PHASE (not measured)
    console.log(`\n🔥 Warmup: Sending 5 warmup group messages...`);
    for (let i = 0; i < 5; i++) {
      await runCliInProcess(
        ["send", groupId, "--message", `Warmup ${i}`, "--typ", "e2e.warmup"],
        { cwd: senderDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(sender.json) } }
      );
    }

    // Clear warmup messages
    for (const member of members) {
      await runCliInProcess(
        ["unread"],
        { cwd: member.dir.root, env: { MERITS_CREDENTIALS: JSON.stringify(member.creds) } }
      );
    }

    // BENCHMARK PHASE (measured)
    console.log(`\n⏱️  Benchmark: Measuring 15 group message round-trips...`);
    const samples = 15;
    const sendTimings: number[] = [];
    const receiveTimings: number[] = [];
    const roundTripTimings: number[] = [];

    for (let i = 0; i < samples; i++) {
      const roundTripStart = performance.now();

      // Send group message
      const sendStart = performance.now();
      const sendResult = await runCliInProcess(
        ["send", groupId, "--message", `Group benchmark ${i}`, "--typ", "e2e.test"],
        { cwd: senderDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(sender.json) } }
      );
      const sendEnd = performance.now();

      expect(sendResult.code).toBe(0);
      const messageId = sendResult.json.messageId;
      sendTimings.push(sendEnd - sendStart);

      // Sample 3 members for receive timing
      const memberSampleSize = 3;
      const memberReceiveTimings: number[] = [];

      for (let j = 0; j < memberSampleSize; j++) {
        const receiveStart = performance.now();
        const receiveResult = await runCliInProcess(
          ["unread"],
          { cwd: members[j].dir.root, env: { MERITS_CREDENTIALS: JSON.stringify(members[j].creds) } }
        );
        const receiveEnd = performance.now();

        expect(receiveResult.code).toBe(0);
        expect(receiveResult.json.messages).toBeArray();

        // Verify message was received
        const receivedMessage = receiveResult.json.messages.find(
          (m: any) => m.id === messageId
        );
        expect(receivedMessage).toBeDefined();

        memberReceiveTimings.push(receiveEnd - receiveStart);
      }

      const avgReceiveTime = memberReceiveTimings.reduce((sum, t) => sum + t, 0) / memberReceiveTimings.length;
      receiveTimings.push(avgReceiveTime);

      const roundTripEnd = performance.now();
      roundTripTimings.push(roundTripEnd - roundTripStart);

      if ((i + 1) % 5 === 0) {
        console.log(`   Completed ${i + 1}/${samples} round-trips...`);
      }
    }

    // RESULTS
    console.log(`\n📈 Group Message Round-Trip Results (10 members):`);

    const sendMetrics = calculateMetrics("Send Operation", sendTimings);
    printMetrics(sendMetrics);

    const receiveMetrics = calculateMetrics("Receive Operation (avg of 3 members)", receiveTimings);
    printMetrics(receiveMetrics);

    const roundTripMetrics = calculateMetrics("Full Round-Trip", roundTripTimings);
    printMetrics(roundTripMetrics);

    // Analysis
    console.log(`\n🔍 Performance Analysis:`);
    console.log(`   Send overhead:     ${sendMetrics.averageMs.toFixed(2)}ms (${(sendMetrics.averageMs / roundTripMetrics.averageMs * 100).toFixed(1)}%)`);
    console.log(`   Receive overhead:  ${receiveMetrics.averageMs.toFixed(2)}ms (${(receiveMetrics.averageMs / roundTripMetrics.averageMs * 100).toFixed(1)}%)`);
    console.log(`   Total round-trip:  ${roundTripMetrics.averageMs.toFixed(2)}ms`);

    // Performance assertions
    expect(roundTripMetrics.averageMs).toBeLessThan(15000); // Average under 15 seconds
    expect(roundTripMetrics.p95Ms).toBeLessThan(20000); // P95 under 20 seconds

    console.log(`\n✅ Group messaging benchmark complete`);
  }, BENCHMARK_TIMEOUT);

  /**
   * Benchmark: Connection Overhead
   *
   * Measures the overhead of establishing connection + first message
   * vs subsequent messages on warm connection.
   */
  it("should measure connection overhead (cold vs warm)", async () => {
    console.log(`\n🎯 Measuring connection overhead...`);

    const aliceDir = mkScenario("e2e-conn-alice");
    const alice = await runCliInProcess(["incept"], { cwd: aliceDir.root });

    const bobDir = mkScenario("e2e-conn-bob");
    const bob = await runCliInProcess(["incept"], { cwd: bobDir.root });

    // Promote both
    await runCliInProcess(
      ["rbac", "users", "grant-role", alice.json.aid, "user", "--action-said", "e2e/test"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );
    await runCliInProcess(
      ["rbac", "users", "grant-role", bob.json.aid, "user", "--action-said", "e2e/test"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );

    // Measure cold start (first message after setup)
    console.log(`\n❄️  Measuring cold start (first message)...`);
    const coldStart = performance.now();
    const coldResult = await runCliInProcess(
      ["send", bob.json.aid, "--message", "Cold start", "--typ", "e2e.test"],
      { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
    );
    const coldEnd = performance.now();
    const coldTime = coldEnd - coldStart;

    expect(coldResult.code).toBe(0);
    console.log(`   Cold start time: ${coldTime.toFixed(2)}ms`);

    // Measure warm connection (subsequent messages)
    console.log(`\n🔥 Measuring warm connection (10 subsequent messages)...`);
    const warmTimings: number[] = [];

    for (let i = 0; i < 10; i++) {
      const warmStart = performance.now();
      const warmResult = await runCliInProcess(
        ["send", bob.json.aid, "--message", `Warm ${i}`, "--typ", "e2e.test"],
        { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
      );
      const warmEnd = performance.now();

      expect(warmResult.code).toBe(0);
      warmTimings.push(warmEnd - warmStart);
    }

    const avgWarmTime = warmTimings.reduce((sum, t) => sum + t, 0) / warmTimings.length;
    const connectionOverhead = coldTime - avgWarmTime;

    console.log(`\n📊 Connection Overhead Results:`);
    console.log(`   Cold start:         ${coldTime.toFixed(2)}ms`);
    console.log(`   Warm average:       ${avgWarmTime.toFixed(2)}ms`);
    console.log(`   Connection overhead: ${connectionOverhead.toFixed(2)}ms (${(connectionOverhead / coldTime * 100).toFixed(1)}%)`);

    // Verify connection overhead is reasonable
    expect(connectionOverhead).toBeGreaterThan(0);
    expect(connectionOverhead).toBeLessThan(coldTime); // Connection overhead should be less than total time

    console.log(`\n✅ Connection overhead measurement complete`);
  }, BENCHMARK_TIMEOUT);
});
