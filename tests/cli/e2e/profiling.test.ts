/**
 * Message Sending Profiler
 *
 * Detailed profiling to identify performance bottlenecks in message sending.
 * Separates crypto operations from I/O operations to isolate the slowdown.
 *
 * Profiles:
 * - Pure crypto: signing, encryption, verification (no network)
 * - Direct messages: full breakdown of send pipeline
 * - Group messages: scaling analysis with encryption overhead
 *
 * Priority: P1 (performance debugging)
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ensureAdminInitialised, type AdminCredentials } from "../../helpers/admin-bootstrap";
import { runCliInProcess } from "../helpers/exec";
import { cleanTestDir, mkScenario } from "../helpers/workspace";
import * as ed from "@noble/ed25519";
import { sha256 } from "../../../core/crypto";

const PROFILE_TIMEOUT = 120000; // 2 minutes

interface ProfileResult {
  operation: string;
  samples: number;
  totalMs: number;
  averageMs: number;
  minMs: number;
  maxMs: number;
}

function profile(operation: string, timings: number[]): ProfileResult {
  if (timings.length === 0) {
    return { operation, samples: 0, totalMs: 0, averageMs: 0, minMs: 0, maxMs: 0 };
  }

  const total = timings.reduce((sum, t) => sum + t, 0);
  return {
    operation,
    samples: timings.length,
    totalMs: total,
    averageMs: total / timings.length,
    minMs: Math.min(...timings),
    maxMs: Math.max(...timings),
  };
}

function printProfile(result: ProfileResult) {
  console.log(`\n⚡ ${result.operation}`);
  console.log(`   Samples: ${result.samples}`);
  console.log(`   Average: ${result.averageMs.toFixed(3)}ms`);
  console.log(`   Min:     ${result.minMs.toFixed(3)}ms`);
  console.log(`   Max:     ${result.maxMs.toFixed(3)}ms`);
  console.log(`   Total:   ${result.totalMs.toFixed(3)}ms`);
}

describe("Message Sending Profiler", () => {
  let admin: AdminCredentials;

  beforeAll(async () => {
    admin = await ensureAdminInitialised();
    console.log(`✓ Admin initialized: ${admin.aid}`);
  });

  afterAll(async () => {
    cleanTestDir();
  });

  /**
   * Profile: Pure Crypto Operations (No I/O)
   *
   * Measures the raw performance of cryptographic operations
   * without any network or database overhead.
   */
  it("should profile pure crypto operations", async () => {
    console.log(`\n🔬 Profiling pure crypto operations (100 samples each)...`);

    const samples = 100;

    // Import libsodium for encryption operations
    const libsodiumModule = await import("libsodium-wrappers-sumo");
    const libsodium = libsodiumModule.default;
    await libsodium.ready;

    // 1. Key Generation
    const keyGenTimings: number[] = [];
    for (let i = 0; i < samples; i++) {
      const start = performance.now();
      ed.utils.randomSecretKey();
      const end = performance.now();
      keyGenTimings.push(end - start);
    }
    printProfile(profile("Ed25519 Key Generation", keyGenTimings));

    // 2. Signing
    const privateKey = ed.utils.randomSecretKey();
    const message = new TextEncoder().encode("Test message for signing");
    const signTimings: number[] = [];
    for (let i = 0; i < samples; i++) {
      const start = performance.now();
      await ed.signAsync(message, privateKey);
      const end = performance.now();
      signTimings.push(end - start);
    }
    printProfile(profile("Ed25519 Signature Generation", signTimings));

    // 3. Verification
    const publicKey = await ed.getPublicKeyAsync(privateKey);
    const signature = await ed.signAsync(message, privateKey);
    const verifyTimings: number[] = [];
    for (let i = 0; i < samples; i++) {
      const start = performance.now();
      await ed.verifyAsync(signature, message, publicKey);
      const end = performance.now();
      verifyTimings.push(end - start);
    }
    printProfile(profile("Ed25519 Signature Verification", verifyTimings));

    // 4. Sealed Box Encryption (X25519)
    const recipientKeypair = libsodium.crypto_box_keypair();
    const plaintext = new TextEncoder().encode("Test message for encryption");
    const encryptTimings: number[] = [];
    for (let i = 0; i < samples; i++) {
      const start = performance.now();
      libsodium.crypto_box_seal(plaintext, recipientKeypair.publicKey);
      const end = performance.now();
      encryptTimings.push(end - start);
    }
    printProfile(profile("X25519 Sealed Box Encryption", encryptTimings));

    // 5. Sealed Box Decryption
    const ciphertext = libsodium.crypto_box_seal(plaintext, recipientKeypair.publicKey);
    const decryptTimings: number[] = [];
    for (let i = 0; i < samples; i++) {
      const start = performance.now();
      libsodium.crypto_box_seal_open(ciphertext, recipientKeypair.publicKey, recipientKeypair.privateKey);
      const end = performance.now();
      decryptTimings.push(end - start);
    }
    printProfile(profile("X25519 Sealed Box Decryption", decryptTimings));

    // 6. SHA-256 Hashing
    const hashData = new TextEncoder().encode("Test data for hashing");
    const hashTimings: number[] = [];
    for (let i = 0; i < samples; i++) {
      const start = performance.now();
      sha256(hashData);
      const end = performance.now();
      hashTimings.push(end - start);
    }
    printProfile(profile("SHA-256 Hash", hashTimings));

    console.log(`\n📊 Crypto Summary:`);
    console.log(`   Sign:    ${profile("", signTimings).averageMs.toFixed(3)}ms`);
    console.log(`   Verify:  ${profile("", verifyTimings).averageMs.toFixed(3)}ms`);
    console.log(`   Encrypt: ${profile("", encryptTimings).averageMs.toFixed(3)}ms`);
    console.log(`   Decrypt: ${profile("", decryptTimings).averageMs.toFixed(3)}ms`);
    console.log(`   Hash:    ${profile("", hashTimings).averageMs.toFixed(3)}ms`);

    // Crypto should be fast (< 10ms each)
    expect(profile("", signTimings).averageMs).toBeLessThan(10);
    expect(profile("", verifyTimings).averageMs).toBeLessThan(10);
    expect(profile("", encryptTimings).averageMs).toBeLessThan(10);
  }, PROFILE_TIMEOUT);

  /**
   * Profile: Direct Message Send Pipeline
   *
   * Breaks down the complete direct message send into:
   * 1. Local crypto (encryption + signing)
   * 2. Network + Backend (transmission + storage + verification)
   */
  it("should profile direct message send pipeline", async () => {
    console.log(`\n🔬 Profiling direct message send pipeline...`);

    // Setup: Create two users
    const aliceDir = mkScenario("profile-alice-dm");
    const alice = await runCliInProcess(["incept"], { cwd: aliceDir.root });

    const bobDir = mkScenario("profile-bob-dm");
    const bob = await runCliInProcess(["incept"], { cwd: bobDir.root });

    // Promote both to user role
    await runCliInProcess(
      ["rbac", "users", "grant-role", alice.json.aid, "user", "--action-said", "profile/test"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );
    await runCliInProcess(
      ["rbac", "users", "grant-role", bob.json.aid, "user", "--action-said", "profile/test"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );

    // Profile: Send 10 messages with detailed timing
    const samples = 10;
    const totalTimings: number[] = [];
    const localCryptoTimings: number[] = [];
    const networkTimings: number[] = [];

    // Import crypto modules once (outside loop)
    const { base64UrlToUint8Array } = await import("../../../core/crypto");
    const { signMutationArgs } = await import("../../../core/signatures");
    const libsodiumModule = await import("libsodium-wrappers-sumo");
    const libsodium = libsodiumModule.default;
    await libsodium.ready;

    // Create client once and get Bob's public key once (outside loop)
    const { ConvexMeritsClient } = await import("../../../src/client/convex");
    const client = new ConvexMeritsClient(process.env.CONVEX_URL!);
    const bobKeyState = await client.identityRegistry.getPublicKey(bob.json.aid);
    const bobX25519Key = libsodium.crypto_sign_ed25519_pk_to_curve25519(
      Uint8Array.from(bobKeyState.publicKey)
    );
    const privateKeyBytes = base64UrlToUint8Array(alice.json.privateKey);

    console.log(`\n   Sending ${samples} messages with timing breakdown...`);

    for (let i = 0; i < samples; i++) {
      // Start total timer
      const totalStart = performance.now();

      // Measure local crypto (encryption + signing only)
      const cryptoStart = performance.now();

      // Encrypt message
      const messageBytes = new TextEncoder().encode(`Profile test ${i}`);
      const cipherBytes = libsodium.crypto_box_seal(messageBytes, bobX25519Key);
      const ct = Buffer.from(cipherBytes).toString("base64url");

      // Sign the request
      const sendArgs = {
        recpAid: bob.json.aid,
        ct,
        typ: "profile.test",
        ttl: 86400000,
        alg: "x25519-xsalsa20poly1305",
        ek: "",
      };
      const sig = await signMutationArgs(sendArgs, privateKeyBytes, alice.json.aid);

      const cryptoEnd = performance.now();
      localCryptoTimings.push(cryptoEnd - cryptoStart);

      // Measure network + backend
      const networkStart = performance.now();

      // Send the message using CLI (this includes network + backend)
      const result = await runCliInProcess(
        ["send", bob.json.aid, "--message", `Profile test ${i}`, "--typ", "profile.test"],
        { cwd: aliceDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(alice.json) } }
      );

      const networkEnd = performance.now();
      const totalEnd = performance.now();

      expect(result.code).toBe(0);

      // Note: Network timing from CLI includes crypto too, so we need to subtract
      // But CLI crypto might be slightly different, so we'll just measure CLI total
      const cliTotal = networkEnd - networkStart;
      totalTimings.push(totalEnd - totalStart);
      networkTimings.push(cliTotal);

      console.log(`   ${i + 1}/${samples}: Total=${(totalEnd - totalStart).toFixed(2)}ms, CLI=${cliTotal.toFixed(2)}ms, LocalCrypto=${(cryptoEnd - cryptoStart).toFixed(2)}ms`);
    }

    client.close();

    console.log(`\n📊 Direct Message Send Breakdown:`);
    printProfile(profile("Total Time (Profiling Overhead)", totalTimings));
    printProfile(profile("CLI Command Total (Crypto + Network + Backend)", networkTimings));
    printProfile(profile("Local Crypto Estimate (Key Fetch + Encrypt + Sign)", localCryptoTimings));

    // Calculate estimated network+backend by subtracting crypto from CLI total
    const estimatedBackendTimings = networkTimings.map((net, i) =>
      net - (localCryptoTimings[i] || 0)
    );
    printProfile(profile("Estimated Backend Time (Network + DB + Verification)", estimatedBackendTimings));

    console.log(`\n📈 Performance Analysis:`);
    const avgCrypto = profile("", localCryptoTimings).averageMs;
    const avgBackend = profile("", estimatedBackendTimings).averageMs;
    const avgTotal = profile("", networkTimings).averageMs;

    console.log(`   Local Crypto:  ${avgCrypto.toFixed(2)}ms (${(avgCrypto / avgTotal * 100).toFixed(1)}%)`);
    console.log(`   Backend + I/O: ${avgBackend.toFixed(2)}ms (${(avgBackend / avgTotal * 100).toFixed(1)}%)`);
    console.log(`   Total:         ${avgTotal.toFixed(2)}ms`);

    if (avgCrypto > avgTotal * 0.5) {
      console.log(`\n⚠️  WARNING: Crypto is ${(avgCrypto / avgTotal * 100).toFixed(1)}% of total time - bottleneck is local crypto`);
    } else {
      console.log(`\n⚠️  WARNING: Backend is ${(avgBackend / avgTotal * 100).toFixed(1)}% of total time - bottleneck is network/backend`);
    }
  }, PROFILE_TIMEOUT);

  /**
   * Profile: Group Message Encryption Overhead
   *
   * Measures how group message encryption time scales with group size.
   * Tests: 5, 10, 20 members
   */
  it("should profile group message encryption scaling", async () => {
    console.log(`\n🔬 Profiling group message encryption scaling...`);

    const { encryptForGroup } = await import("../../../cli/lib/crypto-group");
    const { base64UrlToUint8Array } = await import("../../../core/crypto");

    // Generate test keys for different group sizes
    const groupSizes = [5, 10, 20];
    const plaintext = "Test group message for encryption profiling";

    for (const size of groupSizes) {
      console.log(`\n   Testing ${size} members...`);

      // Generate member keys
      const members: Record<string, string> = {};
      for (let i = 0; i < size; i++) {
        const privateKey = ed.utils.randomSecretKey();
        const publicKey = await ed.getPublicKeyAsync(privateKey);
        const publicKeyB64 = Buffer.from(publicKey).toString("base64url");
        members[`member-${i}`] = `D${publicKeyB64}`;
      }

      // Generate sender key
      const senderPrivateKey = ed.utils.randomSecretKey();
      const senderPublicKey = await ed.getPublicKeyAsync(senderPrivateKey);
      const senderAid = `D${Buffer.from(senderPublicKey).toString("base64url")}`;

      // Profile group encryption
      const samples = 10;
      const timings: number[] = [];

      for (let i = 0; i < samples; i++) {
        const start = performance.now();

        await encryptForGroup(
          plaintext,
          members,
          senderPrivateKey,
          "test-group-id",
          senderAid
        );

        const end = performance.now();
        timings.push(end - start);
      }

      const result = profile(`Group Encryption (${size} members)`, timings);
      printProfile(result);

      const perMemberTime = result.averageMs / size;
      console.log(`   Per-member overhead: ${perMemberTime.toFixed(3)}ms`);
    }

    console.log(`\n📊 Group Encryption Scaling Analysis:`);
    console.log(`   Expected: Linear scaling with group size`);
    console.log(`   Target: < 10ms per member encryption`);
  }, PROFILE_TIMEOUT);

  /**
   * Profile: Complete Group Message Send
   *
   * Full breakdown of group message sending for a 10-member group
   */
  it("should profile complete group message send", async () => {
    console.log(`\n🔬 Profiling complete group message send (10 members)...`);

    // Create sender
    const senderDir = mkScenario("profile-sender-group");
    const sender = await runCliInProcess(["incept"], { cwd: senderDir.root });

    // Promote sender
    await runCliInProcess(
      ["rbac", "users", "grant-role", sender.json.aid, "user", "--action-said", "profile/test"],
      { env: { MERITS_CREDENTIALS: JSON.stringify(admin) } }
    );

    // Create group
    const createGroupResult = await runCliInProcess(
      ["group", "create", "profile-group"],
      { cwd: senderDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(sender.json) } }
    );
    expect(createGroupResult.code).toBe(0);
    const groupId = createGroupResult.json.groupId;

    // Create and add 10 members
    console.log(`   Creating 10 members...`);
    const memberCount = 10;
    for (let i = 0; i < memberCount; i++) {
      const memberDir = mkScenario(`profile-member-${i}`);
      const member = await runCliInProcess(["incept"], { cwd: memberDir.root });

      await runCliInProcess(
        ["group", "add", groupId, member.json.aid],
        { cwd: senderDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(sender.json) } }
      );
    }

    // Profile: Send 10 group messages
    const samples = 10;
    const totalTimings: number[] = [];

    console.log(`\n   Sending ${samples} group messages...`);

    for (let i = 0; i < samples; i++) {
      const start = performance.now();

      const result = await runCliInProcess(
        ["send", groupId, "--message", `Group profile test ${i}`, "--typ", "profile.test"],
        { cwd: senderDir.root, env: { MERITS_CREDENTIALS: JSON.stringify(sender.json) } }
      );

      const end = performance.now();

      expect(result.code).toBe(0);
      totalTimings.push(end - start);

      console.log(`   ${i + 1}/${samples}: ${(end - start).toFixed(2)}ms`);
    }

    printProfile(profile(`Group Message Send (${memberCount} members)`, totalTimings));

    const avgTime = profile("", totalTimings).averageMs;
    const perMemberEstimate = avgTime / memberCount;

    console.log(`\n📊 Group Message Analysis:`);
    console.log(`   Total average:        ${avgTime.toFixed(2)}ms`);
    console.log(`   Per-member estimate:  ${perMemberEstimate.toFixed(2)}ms`);
    console.log(`   Expected crypto:      ~${(memberCount * 5).toFixed(2)}ms (5ms per member)`);
    console.log(`   Backend overhead:     ~${(avgTime - memberCount * 5).toFixed(2)}ms`);
  }, PROFILE_TIMEOUT);
});
