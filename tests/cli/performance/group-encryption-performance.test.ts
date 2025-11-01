/**
 * Group Encryption Performance Tests
 *
 * These tests measure the performance of group encryption operations
 * with varying numbers of members to ensure the system scales appropriately.
 *
 * Performance targets:
 * - Small groups (1-10 members): < 100ms
 * - Medium groups (10-50 members): < 500ms
 * - Large groups (50-100 members): < 2000ms
 *
 * These benchmarks help detect performance regressions and ensure
 * the crypto operations remain efficient as group sizes grow.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { $ } from "bun";

describe("Group Encryption Performance", () => {
  let cryptoGroup: any;

  beforeAll(async () => {
    cryptoGroup = await import("../../../cli/lib/crypto-group");
  });

  /**
   * Generate test keys for N members
   */
  async function generateMemberKeys(count: number): Promise<{
    members: Record<string, string>;
    privateKeys: Record<string, Uint8Array>;
  }> {
    const { ed25519 } = await import("@noble/curves/ed25519.js");

    const members: Record<string, string> = {};
    const privateKeys: Record<string, Uint8Array> = {};

    for (let i = 0; i < count; i++) {
      const aid = `member-${i}`;
      const privateKey = ed25519.utils.randomSecretKey();
      const publicKey = ed25519.getPublicKey(privateKey);

      members[aid] = uint8ArrayToBase64Url(publicKey);
      privateKeys[aid] = privateKey;
    }

    return { members, privateKeys };
  }

  /**
   * Helper: Encode Uint8Array to base64url
   */
  function uint8ArrayToBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  describe("Encryption Performance", () => {
    test("encrypts for 5 members in < 100ms", async () => {
      const { members, privateKeys } = await generateMemberKeys(5);
      const message = "Performance test message";
      const groupId = "perf-test-group";
      const senderAid = "member-0";

      const start = Date.now();

      const encrypted = await cryptoGroup.encryptForGroup(
        message,
        members,
        privateKeys[senderAid],
        groupId,
        senderAid
      );

      const duration = Date.now() - start;

      console.log(`5 members: ${duration}ms`);
      expect(duration).toBeLessThan(100);
      expect(encrypted).toHaveProperty("encryptedContent");
      expect(encrypted).toHaveProperty("encryptedKeys");
      expect(Object.keys(encrypted.encryptedKeys).length).toBe(5);
    });

    test("encrypts for 10 members in < 200ms", async () => {
      const { members, privateKeys } = await generateMemberKeys(10);
      const message = "Performance test message";
      const groupId = "perf-test-group";
      const senderAid = "member-0";

      const start = Date.now();

      const encrypted = await cryptoGroup.encryptForGroup(
        message,
        members,
        privateKeys[senderAid],
        groupId,
        senderAid
      );

      const duration = Date.now() - start;

      console.log(`10 members: ${duration}ms`);
      expect(duration).toBeLessThan(200);
      expect(Object.keys(encrypted.encryptedKeys).length).toBe(10);
    });

    test("encrypts for 25 members in < 500ms", async () => {
      const { members, privateKeys } = await generateMemberKeys(25);
      const message = "Performance test message";
      const groupId = "perf-test-group";
      const senderAid = "member-0";

      const start = Date.now();

      const encrypted = await cryptoGroup.encryptForGroup(
        message,
        members,
        privateKeys[senderAid],
        groupId,
        senderAid
      );

      const duration = Date.now() - start;

      console.log(`25 members: ${duration}ms`);
      expect(duration).toBeLessThan(500);
      expect(Object.keys(encrypted.encryptedKeys).length).toBe(25);
    });

    test("encrypts for 50 members in < 1000ms", async () => {
      const { members, privateKeys } = await generateMemberKeys(50);
      const message = "Performance test message";
      const groupId = "perf-test-group";
      const senderAid = "member-0";

      const start = Date.now();

      const encrypted = await cryptoGroup.encryptForGroup(
        message,
        members,
        privateKeys[senderAid],
        groupId,
        senderAid
      );

      const duration = Date.now() - start;

      console.log(`50 members: ${duration}ms`);
      expect(duration).toBeLessThan(1000);
      expect(Object.keys(encrypted.encryptedKeys).length).toBe(50);
    });

    test("encrypts for 100 members in < 2000ms", async () => {
      const { members, privateKeys } = await generateMemberKeys(100);
      const message = "Performance test message";
      const groupId = "perf-test-group";
      const senderAid = "member-0";

      const start = Date.now();

      const encrypted = await cryptoGroup.encryptForGroup(
        message,
        members,
        privateKeys[senderAid],
        groupId,
        senderAid
      );

      const duration = Date.now() - start;

      console.log(`100 members: ${duration}ms`);
      expect(duration).toBeLessThan(2000);
      expect(Object.keys(encrypted.encryptedKeys).length).toBe(100);
    });
  });

  describe("Decryption Performance", () => {
    test("decrypts message from 50-member group in < 100ms", async () => {
      const { members, privateKeys } = await generateMemberKeys(50);
      const message = "Performance test message";
      const groupId = "perf-test-group";
      const senderAid = "member-0";

      // Encrypt first
      const encrypted = await cryptoGroup.encryptForGroup(
        message,
        members,
        privateKeys[senderAid],
        groupId,
        senderAid
      );

      // Now time decryption for member-10
      const recipientAid = "member-10";
      const senderPublicKey = members[senderAid];

      const start = Date.now();

      const decrypted = await cryptoGroup.decryptGroupMessage(
        encrypted,
        privateKeys[recipientAid],
        recipientAid,
        senderPublicKey
      );

      const duration = Date.now() - start;

      console.log(`Decrypt from 50-member group: ${duration}ms`);
      expect(duration).toBeLessThan(100);
      expect(decrypted).toBe(message);
    });

    test("decrypts message from 100-member group in < 100ms", async () => {
      const { members, privateKeys } = await generateMemberKeys(100);
      const message = "Performance test message";
      const groupId = "perf-test-group";
      const senderAid = "member-0";

      // Encrypt first
      const encrypted = await cryptoGroup.encryptForGroup(
        message,
        members,
        privateKeys[senderAid],
        groupId,
        senderAid
      );

      // Now time decryption for member-50
      const recipientAid = "member-50";
      const senderPublicKey = members[senderAid];

      const start = Date.now();

      const decrypted = await cryptoGroup.decryptGroupMessage(
        encrypted,
        privateKeys[recipientAid],
        recipientAid,
        senderPublicKey
      );

      const duration = Date.now() - start;

      console.log(`Decrypt from 100-member group: ${duration}ms`);
      expect(duration).toBeLessThan(100);
      expect(decrypted).toBe(message);
    });
  });

  describe("Large Message Performance", () => {
    test("encrypts 1KB message for 25 members in < 500ms", async () => {
      const { members, privateKeys } = await generateMemberKeys(25);
      const message = "x".repeat(1024); // 1KB message
      const groupId = "perf-test-group";
      const senderAid = "member-0";

      const start = Date.now();

      const encrypted = await cryptoGroup.encryptForGroup(
        message,
        members,
        privateKeys[senderAid],
        groupId,
        senderAid
      );

      const duration = Date.now() - start;

      console.log(`1KB message, 25 members: ${duration}ms`);
      expect(duration).toBeLessThan(500);
    });

    test("encrypts 10KB message for 25 members in < 500ms", async () => {
      const { members, privateKeys } = await generateMemberKeys(25);
      const message = "x".repeat(10 * 1024); // 10KB message
      const groupId = "perf-test-group";
      const senderAid = "member-0";

      const start = Date.now();

      const encrypted = await cryptoGroup.encryptForGroup(
        message,
        members,
        privateKeys[senderAid],
        groupId,
        senderAid
      );

      const duration = Date.now() - start;

      console.log(`10KB message, 25 members: ${duration}ms`);
      expect(duration).toBeLessThan(500);
    });

    test("encrypts 100KB message for 25 members in < 1000ms", async () => {
      const { members, privateKeys } = await generateMemberKeys(25);
      const message = "x".repeat(100 * 1024); // 100KB message
      const groupId = "perf-test-group";
      const senderAid = "member-0";

      const start = Date.now();

      const encrypted = await cryptoGroup.encryptForGroup(
        message,
        members,
        privateKeys[senderAid],
        groupId,
        senderAid
      );

      const duration = Date.now() - start;

      console.log(`100KB message, 25 members: ${duration}ms`);
      expect(duration).toBeLessThan(1000);
    });
  });

  describe("Scalability Analysis", () => {
    test("encryption time scales linearly with group size", async () => {
      const sizes = [5, 10, 25, 50];
      const timings: Array<{ size: number; duration: number }> = [];

      for (const size of sizes) {
        const { members, privateKeys } = await generateMemberKeys(size);
        const message = "Scalability test message";
        const groupId = "scalability-test-group";
        const senderAid = "member-0";

        const start = Date.now();

        await cryptoGroup.encryptForGroup(
          message,
          members,
          privateKeys[senderAid],
          groupId,
          senderAid
        );

        const duration = Date.now() - start;
        timings.push({ size, duration });
      }

      console.log("\nScalability Analysis:");
      timings.forEach(({ size, duration }) => {
        console.log(`  ${size} members: ${duration}ms (${(duration / size).toFixed(2)}ms per member)`);
      });

      // Verify roughly linear scaling
      // Time per member should be relatively constant
      const timePerMember = timings.map(t => t.duration / t.size);
      const avgTimePerMember = timePerMember.reduce((a, b) => a + b, 0) / timePerMember.length;

      timePerMember.forEach((time, i) => {
        const variance = Math.abs(time - avgTimePerMember) / avgTimePerMember;
        console.log(`  Size ${timings[i].size}: ${variance.toFixed(2)} variance from average`);
        // Allow up to 50% variance (accounts for overhead, caching, etc.)
        expect(variance).toBeLessThan(0.5);
      });
    });
  });
});
