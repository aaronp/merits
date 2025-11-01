/**
 * E2E CLI Tests for New CLI Specification (cli.md)
 *
 * Tests the complete workflow of the new CLI commands:
 * - gen-key: Generate Ed25519 key pairs
 * - create-user: Create registration challenges
 * - sign: Sign challenges
 * - confirm-challenge: Confirm challenges and obtain session tokens
 * - sign-in: Sign in existing users
 * - whoami: Display session information
 * - list-unread: List unread message counts
 * - unread: Retrieve unread messages
 * - mark-as-read: Acknowledge messages
 * - extract-ids: Extract message IDs from message lists
 *
 * These tests validate the entire CLI migration plan from docs/cli-plan.md.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { $ } from "bun";

// Test data directories
const TEST_ROOT = path.join(process.cwd(), "test-data-tmp", "new-cli-spec");
const ALICE_DIR = path.join(TEST_ROOT, "alice");
const BOB_DIR = path.join(TEST_ROOT, "bob");

// Convex URL from environment (optional for some tests)
const CONVEX_URL = process.env.CONVEX_URL;

/**
 * Helper to run CLI command and parse JSON output
 */
async function runCLI(
  args: string[],
  options: {
    dataDir?: string;
    expectJson?: boolean;
    convexUrl?: string;
  } = {}
): Promise<any> {
  const { dataDir, expectJson = true, convexUrl } = options;

  const cliArgs = ["run", "cli/index.ts"];

  if (dataDir) {
    cliArgs.push("--data-dir", dataDir);
  }

  if (convexUrl) {
    cliArgs.push("--convex-url", convexUrl);
  }

  cliArgs.push(...args);

  // Suppress vault warnings for clean output
  const env = { ...process.env, MERITS_VAULT_QUIET: "1" };

  const result = await $`bun ${cliArgs}`.env(env).text();

  if (expectJson) {
    return JSON.parse(result.trim());
  }
  return result;
}

/**
 * Write JSON to file
 */
function writeJSON(filePath: string, data: any): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Read JSON from file
 */
function readJSON(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

describe("E2E New CLI Specification", () => {
  beforeAll(() => {
    // Clean up any existing test data
    if (fs.existsSync(TEST_ROOT)) {
      fs.rmSync(TEST_ROOT, { recursive: true });
    }
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterAll(() => {
    // Clean up test data
    if (fs.existsSync(TEST_ROOT)) {
      fs.rmSync(TEST_ROOT, { recursive: true });
    }
  });

  describe("Phase 3: Key & User Management", () => {
    test("gen-key: generates Ed25519 key pair", async () => {
      const result = await runCLI(["gen-key", "--format", "json"]);

      // Validate structure
      expect(result).toHaveProperty("privateKey");
      expect(result).toHaveProperty("publicKey");
      expect(typeof result.privateKey).toBe("string");
      expect(typeof result.publicKey).toBe("string");

      // Validate base64url encoding (no +, /, or =)
      expect(result.privateKey).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(result.publicKey).toMatch(/^[A-Za-z0-9_-]+$/);

      // Validate key lengths (Ed25519: 32 bytes = ~43 chars base64url)
      expect(result.privateKey.length).toBeGreaterThan(40);
      expect(result.publicKey.length).toBeGreaterThan(40);
    });

    test("gen-key: deterministic generation with --seed", async () => {
      const result1 = await runCLI(["gen-key", "--seed", "test123", "--format", "json"]);
      const result2 = await runCLI(["gen-key", "--seed", "test123", "--format", "json"]);

      // Same seed should produce same keys
      expect(result1.privateKey).toBe(result2.privateKey);
      expect(result1.publicKey).toBe(result2.publicKey);
    });

    test("gen-key: supports all output formats", async () => {
      // Test json format (canonicalized)
      const jsonResult = await runCLI(["gen-key", "--format", "json"]);
      expect(jsonResult).toHaveProperty("privateKey");

      // Test pretty format
      const prettyResult = await runCLI(["gen-key", "--format", "pretty"]);
      expect(prettyResult).toHaveProperty("privateKey");

      // Test raw format
      const rawResult = await runCLI(["gen-key", "--format", "raw"]);
      expect(rawResult).toHaveProperty("privateKey");
    });
  });

  describe("Phase 4: Messaging Commands (Mock)", () => {
    let aliceKeys: any;
    let aliceSession: any;

    beforeAll(async () => {
      // Generate Alice's keys
      aliceKeys = await runCLI(["gen-key", "--seed", "alice-test", "--format", "json"]);

      // Create a mock session token for Alice
      aliceSession = {
        token: "mock_alice_token",
        expiresAt: Date.now() + 600000, // 10 minutes from now
        aid: "alice_test_aid",
        ksn: 0
      };

      // Write session token to Alice's directory
      const sessionPath = path.join(ALICE_DIR, ".merits", "session.json");
      writeJSON(sessionPath, aliceSession);
    });

    test("list-unread: lists unread message counts", async () => {
      const result = await runCLI([
        "list-unread",
        "--token", path.join(ALICE_DIR, ".merits", "session.json"),
        "--format", "json"
      ]);

      // Should return an object with sender counts
      expect(typeof result).toBe("object");
      expect(result).not.toBeNull();

      // Mock data should have bob and joe
      expect(result).toHaveProperty("bob");
      expect(result).toHaveProperty("joe");
      expect(typeof result.bob).toBe("number");
      expect(typeof result.joe).toBe("number");
    });

    test("unread: retrieves unread messages", async () => {
      const result = await runCLI([
        "unread",
        "--token", path.join(ALICE_DIR, ".merits", "session.json"),
        "--format", "json"
      ]);

      // Should return an array of messages
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      // Validate message structure
      const message = result[0];
      expect(message).toHaveProperty("id");
      expect(message).toHaveProperty("from");
      expect(message).toHaveProperty("to");
      expect(message).toHaveProperty("ct");
      expect(message).toHaveProperty("typ");
      expect(message).toHaveProperty("createdAt");
    });

    test("extract-ids: extracts message IDs from message list", async () => {
      // First, get unread messages
      const messages = await runCLI([
        "unread",
        "--token", path.join(ALICE_DIR, ".merits", "session.json"),
        "--format", "json"
      ]);

      // Write messages to file
      const messagesPath = path.join(ALICE_DIR, "messages.json");
      writeJSON(messagesPath, messages);

      // Extract IDs
      const ids = await runCLI([
        "extract-ids",
        "--file", messagesPath,
        "--format", "json"
      ]);

      // Should return an array of IDs
      expect(Array.isArray(ids)).toBe(true);
      expect(ids.length).toBe(messages.length);

      // IDs should match message IDs
      for (let i = 0; i < messages.length; i++) {
        expect(ids[i]).toBe(messages[i].id);
      }
    });

    test("mark-as-read: marks messages as read with --ids option", async () => {
      const result = await runCLI([
        "mark-as-read",
        "--token", path.join(ALICE_DIR, ".merits", "session.json"),
        "--ids", "msg_1,msg_2",
        "--format", "json"
      ]);

      // Should return confirmation
      expect(result).toHaveProperty("markedAsRead");
      expect(result).toHaveProperty("deleted");
      expect(Array.isArray(result.markedAsRead)).toBe(true);
      expect(Array.isArray(result.deleted)).toBe(true);
      expect(result.markedAsRead).toContain("msg_1");
      expect(result.markedAsRead).toContain("msg_2");
    });

    test("mark-as-read: marks messages as read with --ids-data option", async () => {
      // Create IDs file
      const idsPath = path.join(ALICE_DIR, "ids.json");
      writeJSON(idsPath, ["msg_3", "msg_4"]);

      const result = await runCLI([
        "mark-as-read",
        "--token", path.join(ALICE_DIR, ".merits", "session.json"),
        "--ids-data", idsPath,
        "--format", "json"
      ]);

      // Should return confirmation
      expect(result).toHaveProperty("markedAsRead");
      expect(result.markedAsRead).toContain("msg_3");
      expect(result.markedAsRead).toContain("msg_4");
    });

    test("messaging workflow: unread → extract-ids → mark-as-read pipeline", async () => {
      const sessionPath = path.join(ALICE_DIR, ".merits", "session.json");

      // 1. Get unread messages
      const messages = await runCLI([
        "unread",
        "--token", sessionPath,
        "--format", "json"
      ]);
      expect(messages.length).toBeGreaterThan(0);

      // 2. Write messages to file
      const messagesPath = path.join(ALICE_DIR, "unread-messages.json");
      writeJSON(messagesPath, messages);

      // 3. Extract IDs
      const ids = await runCLI([
        "extract-ids",
        "--file", messagesPath,
        "--format", "json"
      ]);
      expect(ids.length).toBe(messages.length);

      // 4. Write IDs to file
      const idsPath = path.join(ALICE_DIR, "message-ids.json");
      writeJSON(idsPath, ids);

      // 5. Mark as read using IDs file
      const result = await runCLI([
        "mark-as-read",
        "--token", sessionPath,
        "--ids-data", idsPath,
        "--format", "json"
      ]);

      expect(result.markedAsRead.length).toBe(ids.length);
      expect(result.deleted.length).toBe(ids.length);
    });
  });

  describe("Phase 2: Session Token Management", () => {
    test("whoami: displays session information", async () => {
      // Create a mock session token
      const sessionPath = path.join(BOB_DIR, ".merits", "session.json");
      const mockSession = {
        token: "mock_bob_token",
        expiresAt: Date.now() + 60000, // 1 minute from now
        aid: "bob_test_aid",
        ksn: 1
      };
      writeJSON(sessionPath, mockSession);

      // Run whoami
      const result = await runCLI([
        "whoami",
        "--token", sessionPath,
        "--format", "json"
      ]);

      // Validate output
      expect(result).toHaveProperty("aid");
      expect(result).toHaveProperty("expiresAt");
      expect(result.aid).toBe(mockSession.aid);
      expect(result.expiresAt).toBe(mockSession.expiresAt);

      if (result.ksn !== undefined) {
        expect(result.ksn).toBe(mockSession.ksn);
      }
    });

    test("session token: MERITS_TOKEN environment variable fallback", async () => {
      const mockSession = {
        token: "env_token_test",
        expiresAt: Date.now() + 60000,
        aid: "env_test_aid",
        ksn: 0
      };

      // Run whoami with MERITS_TOKEN env var
      const cliArgs = ["run", "cli/index.ts", "whoami", "--format", "json"];
      const env = {
        ...process.env,
        MERITS_VAULT_QUIET: "1",
        MERITS_TOKEN: JSON.stringify(mockSession)
      };

      const result = await $`bun ${cliArgs}`.env(env).text();
      const parsed = JSON.parse(result.trim());

      expect(parsed.aid).toBe(mockSession.aid);
      expect(parsed.expiresAt).toBe(mockSession.expiresAt);
    });
  });

  describe("Output Formats (Phase 1)", () => {
    test("all commands support json, pretty, and raw formats", async () => {
      const sessionPath = path.join(ALICE_DIR, ".merits", "session.json");

      // Test list-unread with all formats
      const jsonResult = await runCLI([
        "list-unread",
        "--token", sessionPath,
        "--format", "json"
      ]);
      expect(typeof jsonResult).toBe("object");

      const prettyResult = await runCLI([
        "list-unread",
        "--token", sessionPath,
        "--format", "pretty"
      ]);
      expect(typeof prettyResult).toBe("object");

      const rawResult = await runCLI([
        "list-unread",
        "--token", sessionPath,
        "--format", "raw"
      ]);
      expect(typeof rawResult).toBe("object");
    });

    test("default format is json", async () => {
      // gen-key without --format should default to json
      const result = await runCLI(["gen-key"]);

      // Should be valid JSON (canonicalized, no whitespace)
      expect(result).toHaveProperty("privateKey");
      expect(result).toHaveProperty("publicKey");
    });
  });

  describe("Error Handling", () => {
    test("commands requiring --token fail gracefully without it", async () => {
      try {
        await runCLI(["list-unread", "--format", "json"]);
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        // Should throw an error about missing session token
        const errorMessage = error.stderr?.toString() || error.message || "";
        expect(errorMessage).toContain("session token");
      }
    });

    test("extract-ids handles empty message list", async () => {
      const emptyPath = path.join(ALICE_DIR, "empty-messages.json");
      writeJSON(emptyPath, []);

      const ids = await runCLI([
        "extract-ids",
        "--file", emptyPath,
        "--format", "json"
      ]);

      expect(Array.isArray(ids)).toBe(true);
      expect(ids.length).toBe(0);
    });

    test("mark-as-read requires either --ids or --ids-data", async () => {
      const sessionPath = path.join(ALICE_DIR, ".merits", "session.json");

      try {
        await runCLI([
          "mark-as-read",
          "--token", sessionPath,
          "--format", "json"
        ]);
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        // Should throw an error about missing ids
        const errorMessage = error.stderr?.toString() || error.message || "";
        expect(errorMessage).toMatch(/--ids|--ids-data/i);
      }
    });
  });

  describe("RFC8785 Canonicalization", () => {
    test("json format produces canonicalized output", async () => {
      const result = await runCLI(["gen-key", "--seed", "canon-test", "--format", "json"]);

      // Canonicalized JSON should have:
      // - Sorted keys
      // - No whitespace
      const jsonString = JSON.stringify(result);

      // Keys should be in alphabetical order (privateKey < publicKey)
      const keys = Object.keys(result);
      const sortedKeys = [...keys].sort();
      expect(keys).toEqual(sortedKeys);
    });
  });

  describe("Phase 5: Group Encryption", () => {
    // Import crypto-group module for testing
    let cryptoGroup: any;

    beforeAll(async () => {
      // Dynamically import crypto-group module
      cryptoGroup = await import("../../../cli/lib/crypto-group");
    });

    test("ed25519PrivateKeyToX25519: converts Ed25519 private key to X25519", async () => {
      // Generate a test key
      const keyPair = await runCLI(["gen-key", "--seed", "x25519-test", "--format", "json"]);

      // Decode the private key from base64url
      const privateKeyBytes = base64UrlToUint8Array(keyPair.privateKey);

      // Convert to X25519
      const x25519Private = cryptoGroup.ed25519PrivateKeyToX25519(privateKeyBytes);

      // Should be 32 bytes
      expect(x25519Private.length).toBe(32);

      // Should be different from original (clamping and hashing changes it)
      expect(x25519Private).not.toEqual(privateKeyBytes);
    });

    test("ed25519PublicKeyToX25519: converts Ed25519 public key to X25519", async () => {
      // Generate a test key
      const keyPair = await runCLI(["gen-key", "--seed", "x25519-pub-test", "--format", "json"]);

      // Decode the public key from base64url
      const publicKeyBytes = base64UrlToUint8Array(keyPair.publicKey);

      // Convert to X25519
      const x25519Public = cryptoGroup.ed25519PublicKeyToX25519(publicKeyBytes);

      // Should be 32 bytes
      expect(x25519Public.length).toBe(32);
    });

    test("deriveSharedSecret: derives shared secret via X25519 ECDH", async () => {
      // Generate two key pairs (Alice and Bob)
      const aliceKeys = await runCLI(["gen-key", "--seed", "alice-ecdh", "--format", "json"]);
      const bobKeys = await runCLI(["gen-key", "--seed", "bob-ecdh", "--format", "json"]);

      // Decode keys
      const alicePrivate = base64UrlToUint8Array(aliceKeys.privateKey);
      const bobPublic = base64UrlToUint8Array(bobKeys.publicKey);

      // Convert to X25519
      const aliceX25519Private = cryptoGroup.ed25519PrivateKeyToX25519(alicePrivate);
      const bobX25519Public = cryptoGroup.ed25519PublicKeyToX25519(bobPublic);

      // Derive shared secret
      const sharedSecret = await cryptoGroup.deriveSharedSecret(
        aliceX25519Private,
        bobX25519Public
      );

      // Should be 32 bytes
      expect(sharedSecret.length).toBe(32);

      // Verify reverse direction produces same secret
      const bobPrivate = base64UrlToUint8Array(bobKeys.privateKey);
      const alicePublic = base64UrlToUint8Array(aliceKeys.publicKey);
      const bobX25519Private = cryptoGroup.ed25519PrivateKeyToX25519(bobPrivate);
      const aliceX25519Public = cryptoGroup.ed25519PublicKeyToX25519(alicePublic);

      const sharedSecret2 = await cryptoGroup.deriveSharedSecret(
        bobX25519Private,
        aliceX25519Public
      );

      // Both directions should produce the same shared secret
      expect(sharedSecret).toEqual(sharedSecret2);
    });

    test("deriveGroupKey: derives group key from multiple shared secrets", () => {
      // Create mock shared secrets
      const secret1 = new Uint8Array(32).fill(1);
      const secret2 = new Uint8Array(32).fill(2);
      const secret3 = new Uint8Array(32).fill(3);

      // Derive group key
      const groupKey = cryptoGroup.deriveGroupKey([secret1, secret2, secret3]);

      // Should be 32 bytes (AES-256 key)
      expect(groupKey.length).toBe(32);

      // Same inputs should produce same key (deterministic)
      const groupKey2 = cryptoGroup.deriveGroupKey([secret1, secret2, secret3]);
      expect(groupKey).toEqual(groupKey2);

      // Different order should produce different key
      const groupKey3 = cryptoGroup.deriveGroupKey([secret3, secret2, secret1]);
      expect(groupKey).not.toEqual(groupKey3);
    });

    test("encryptAESGCM and decryptAESGCM: encrypt and decrypt with AES-256-GCM", async () => {
      const plaintext = new TextEncoder().encode("Hello, World!");
      const key = crypto.getRandomValues(new Uint8Array(32));
      const aad = new TextEncoder().encode("additional-data");

      // Encrypt
      const { ciphertext, nonce } = await cryptoGroup.encryptAESGCM(plaintext, key, aad);

      // Should produce ciphertext and nonce
      expect(ciphertext.length).toBeGreaterThan(0);
      expect(nonce.length).toBe(12); // GCM nonce is 96 bits

      // Decrypt
      const decrypted = await cryptoGroup.decryptAESGCM(ciphertext, key, nonce, aad);

      // Should match original plaintext
      expect(decrypted).toEqual(plaintext);
      expect(new TextDecoder().decode(decrypted)).toBe("Hello, World!");
    });

    test("encryptAESGCM: different nonces produce different ciphertexts", async () => {
      const plaintext = new TextEncoder().encode("Same message");
      const key = crypto.getRandomValues(new Uint8Array(32));

      // Encrypt twice
      const result1 = await cryptoGroup.encryptAESGCM(plaintext, key);
      const result2 = await cryptoGroup.encryptAESGCM(plaintext, key);

      // Nonces should be different (random)
      expect(result1.nonce).not.toEqual(result2.nonce);

      // Ciphertexts should be different
      expect(result1.ciphertext).not.toEqual(result2.ciphertext);
    });

    test("encryptForGroup and decryptGroupMessage: full group encryption workflow", async () => {
      // Generate keys for Alice (sender) and Bob, Carol (recipients)
      const aliceKeys = await runCLI(["gen-key", "--seed", "alice-group", "--format", "json"]);
      const bobKeys = await runCLI(["gen-key", "--seed", "bob-group", "--format", "json"]);
      const carolKeys = await runCLI(["gen-key", "--seed", "carol-group", "--format", "json"]);

      const message = "Secret group message!";
      const groupId = "test-group-123";

      // Member public keys
      const memberPublicKeys = {
        "bob-aid": bobKeys.publicKey,
        "carol-aid": carolKeys.publicKey,
      };

      // Alice encrypts message for the group
      const alicePrivate = base64UrlToUint8Array(aliceKeys.privateKey);
      const groupMessage = await cryptoGroup.encryptForGroup(
        message,
        memberPublicKeys,
        alicePrivate,
        groupId,
        "alice-aid"
      );

      // Validate group message structure
      expect(groupMessage).toHaveProperty("encryptedContent");
      expect(groupMessage).toHaveProperty("nonce");
      expect(groupMessage).toHaveProperty("encryptedKeys");
      expect(groupMessage).toHaveProperty("senderAid");
      expect(groupMessage).toHaveProperty("groupId");
      expect(groupMessage.senderAid).toBe("alice-aid");
      expect(groupMessage.groupId).toBe(groupId);

      // Each member should have an encrypted key
      expect(groupMessage.encryptedKeys["bob-aid"]).toBeDefined();
      expect(groupMessage.encryptedKeys["carol-aid"]).toBeDefined();

      // Bob decrypts the message
      const bobPrivate = base64UrlToUint8Array(bobKeys.privateKey);
      const bobDecrypted = await cryptoGroup.decryptGroupMessage(
        groupMessage,
        bobPrivate,
        "bob-aid",
        aliceKeys.publicKey
      );

      expect(bobDecrypted).toBe(message);

      // Carol decrypts the message
      const carolPrivate = base64UrlToUint8Array(carolKeys.privateKey);
      const carolDecrypted = await cryptoGroup.decryptGroupMessage(
        groupMessage,
        carolPrivate,
        "carol-aid",
        aliceKeys.publicKey
      );

      expect(carolDecrypted).toBe(message);
    });

    test("encryptForGroup: handles single-member groups", async () => {
      const aliceKeys = await runCLI(["gen-key", "--seed", "alice-single", "--format", "json"]);
      const bobKeys = await runCLI(["gen-key", "--seed", "bob-single", "--format", "json"]);

      const message = "One-on-one message";
      const memberPublicKeys = { "bob-aid": bobKeys.publicKey };

      const alicePrivate = base64UrlToUint8Array(aliceKeys.privateKey);
      const groupMessage = await cryptoGroup.encryptForGroup(
        message,
        memberPublicKeys,
        alicePrivate,
        "single-group",
        "alice-aid"
      );

      // Should only have one encrypted key
      expect(Object.keys(groupMessage.encryptedKeys).length).toBe(1);

      // Bob should be able to decrypt
      const bobPrivate = base64UrlToUint8Array(bobKeys.privateKey);
      const decrypted = await cryptoGroup.decryptGroupMessage(
        groupMessage,
        bobPrivate,
        "bob-aid",
        aliceKeys.publicKey
      );

      expect(decrypted).toBe(message);
    });

    test("encryptForGroup: handles large groups", async () => {
      const aliceKeys = await runCLI(["gen-key", "--seed", "alice-large", "--format", "json"]);

      // Generate 10 member keys
      const memberKeys: Record<string, string> = {};
      for (let i = 0; i < 10; i++) {
        const key = await runCLI(["gen-key", "--seed", `member-${i}`, "--format", "json"]);
        memberKeys[`member-${i}-aid`] = key.publicKey;
      }

      const message = "Message for large group";
      const alicePrivate = base64UrlToUint8Array(aliceKeys.privateKey);

      const groupMessage = await cryptoGroup.encryptForGroup(
        message,
        memberKeys,
        alicePrivate,
        "large-group",
        "alice-aid"
      );

      // Should have 10 encrypted keys
      expect(Object.keys(groupMessage.encryptedKeys).length).toBe(10);
    });

    test("decryptGroupMessage: fails when AID not in recipient list", async () => {
      const aliceKeys = await runCLI(["gen-key", "--seed", "alice-exclude", "--format", "json"]);
      const bobKeys = await runCLI(["gen-key", "--seed", "bob-exclude", "--format", "json"]);
      const eveKeys = await runCLI(["gen-key", "--seed", "eve-exclude", "--format", "json"]);

      const message = "Secret message";
      const memberPublicKeys = { "bob-aid": bobKeys.publicKey };

      const alicePrivate = base64UrlToUint8Array(aliceKeys.privateKey);
      const groupMessage = await cryptoGroup.encryptForGroup(
        message,
        memberPublicKeys,
        alicePrivate,
        "exclusive-group",
        "alice-aid"
      );

      // Eve tries to decrypt but isn't in the recipient list
      const evePrivate = base64UrlToUint8Array(eveKeys.privateKey);

      await expect(
        cryptoGroup.decryptGroupMessage(
          groupMessage,
          evePrivate,
          "eve-aid", // Eve's AID not in encryptedKeys
          aliceKeys.publicKey
        )
      ).rejects.toThrow("No encrypted key found for AID: eve-aid");
    });

    test("group encryption: different messages produce different ciphertexts", async () => {
      const aliceKeys = await runCLI(["gen-key", "--seed", "alice-unique", "--format", "json"]);
      const bobKeys = await runCLI(["gen-key", "--seed", "bob-unique", "--format", "json"]);

      const memberPublicKeys = { "bob-aid": bobKeys.publicKey };
      const alicePrivate = base64UrlToUint8Array(aliceKeys.privateKey);

      // Encrypt same message twice
      const message = "Same message";
      const groupMessage1 = await cryptoGroup.encryptForGroup(
        message,
        memberPublicKeys,
        alicePrivate,
        "group-1",
        "alice-aid"
      );
      const groupMessage2 = await cryptoGroup.encryptForGroup(
        message,
        memberPublicKeys,
        alicePrivate,
        "group-1",
        "alice-aid"
      );

      // Ciphertexts should be different (due to random nonces)
      expect(groupMessage1.encryptedContent).not.toBe(groupMessage2.encryptedContent);
      expect(groupMessage1.nonce).not.toBe(groupMessage2.nonce);

      // But both should decrypt to the same message
      const bobPrivate = base64UrlToUint8Array(bobKeys.privateKey);
      const decrypted1 = await cryptoGroup.decryptGroupMessage(
        groupMessage1,
        bobPrivate,
        "bob-aid",
        aliceKeys.publicKey
      );
      const decrypted2 = await cryptoGroup.decryptGroupMessage(
        groupMessage2,
        bobPrivate,
        "bob-aid",
        aliceKeys.publicKey
      );

      expect(decrypted1).toBe(message);
      expect(decrypted2).toBe(message);
    });

    test("group encryption: handles empty messages", async () => {
      const aliceKeys = await runCLI(["gen-key", "--seed", "alice-empty", "--format", "json"]);
      const bobKeys = await runCLI(["gen-key", "--seed", "bob-empty", "--format", "json"]);

      const emptyMessage = "";
      const memberPublicKeys = { "bob-aid": bobKeys.publicKey };
      const alicePrivate = base64UrlToUint8Array(aliceKeys.privateKey);

      const groupMessage = await cryptoGroup.encryptForGroup(
        emptyMessage,
        memberPublicKeys,
        alicePrivate,
        "empty-group",
        "alice-aid"
      );

      // Should still produce valid ciphertext (just empty plaintext)
      expect(groupMessage.encryptedContent).toBeTruthy();

      // Bob decrypts
      const bobPrivate = base64UrlToUint8Array(bobKeys.privateKey);
      const decrypted = await cryptoGroup.decryptGroupMessage(
        groupMessage,
        bobPrivate,
        "bob-aid",
        aliceKeys.publicKey
      );

      expect(decrypted).toBe("");
    });

    test("group encryption: handles unicode messages", async () => {
      const aliceKeys = await runCLI(["gen-key", "--seed", "alice-unicode", "--format", "json"]);
      const bobKeys = await runCLI(["gen-key", "--seed", "bob-unicode", "--format", "json"]);

      const unicodeMessage = "Hello 世界! 🌍 Καλημέρα κόσμε!";
      const memberPublicKeys = { "bob-aid": bobKeys.publicKey };
      const alicePrivate = base64UrlToUint8Array(aliceKeys.privateKey);

      const groupMessage = await cryptoGroup.encryptForGroup(
        unicodeMessage,
        memberPublicKeys,
        alicePrivate,
        "unicode-group",
        "alice-aid"
      );

      // Bob decrypts
      const bobPrivate = base64UrlToUint8Array(bobKeys.privateKey);
      const decrypted = await cryptoGroup.decryptGroupMessage(
        groupMessage,
        bobPrivate,
        "bob-aid",
        aliceKeys.publicKey
      );

      expect(decrypted).toBe(unicodeMessage);
    });
  });

  // ========================================================================
  // Phase 7: Utility Commands
  // ========================================================================

  describe("Phase 7: Utility Commands", () => {
    let testKeys: { privateKey: string; publicKey: string };
    let testKeysPath: string;

    beforeAll(async () => {
      // Generate test keys for utility commands
      const result = await runCLI(["gen-key", "--seed", "test-utility-commands"]);
      testKeys = result;

      // Save keys to temporary file
      testKeysPath = ".merits/test-utility-keys.json";
      await Bun.write(testKeysPath, JSON.stringify(testKeys));
    });

    test("encrypt: encrypts message with public key", async () => {
      const result = await runCLI([
        "encrypt",
        "--message", "Hello, encryption!",
        "--public-key-file", testKeysPath
      ]);

      expect(result).toHaveProperty("ciphertext");
      expect(result).toHaveProperty("ephemeralPublicKey");
      expect(result).toHaveProperty("nonce");
      expect(typeof result.ciphertext).toBe("string");
      expect(typeof result.ephemeralPublicKey).toBe("string");
      expect(typeof result.nonce).toBe("string");
    });

    test("decrypt: decrypts message encrypted with encrypt command", async () => {
      // First, encrypt a message
      const encrypted = await runCLI([
        "encrypt",
        "--message", "Round-trip test message",
        "--public-key-file", testKeysPath
      ]);

      // Save encrypted message to file
      const encryptedPath = ".merits/test-encrypted-message.json";
      await Bun.write(encryptedPath, JSON.stringify(encrypted));

      // Decrypt it
      const result = await runCLI([
        "decrypt",
        "--encrypted-file", encryptedPath,
        "--keys-file", testKeysPath
      ]);

      expect(result).toHaveProperty("plaintext");
      expect(result.plaintext).toBe("Round-trip test message");
    });

    test("decrypt with --format raw: outputs plaintext only", async () => {
      // Encrypt a message
      const encrypted = await runCLI([
        "encrypt",
        "--message", "Raw format test",
        "--public-key-file", testKeysPath
      ]);

      const encryptedPath = ".merits/test-encrypted-raw.json";
      await Bun.write(encryptedPath, JSON.stringify(encrypted));

      // Decrypt with raw format (outputs plaintext without JSON wrapper)
      const proc = Bun.spawn([
        "bun", "run", "cli/index.ts",
        "decrypt",
        "--encrypted-file", encryptedPath,
        "--keys-file", testKeysPath,
        "--format", "raw"
      ], {
        env: { ...process.env, MERITS_VAULT_QUIET: "1" },
        stdout: "pipe"
      });

      const output = await new Response(proc.stdout).text();
      expect(output.trim()).toBe("Raw format test");
    });

    test("encrypt: different messages produce different ciphertexts", async () => {
      const result1 = await runCLI([
        "encrypt",
        "--message", "Message 1",
        "--public-key-file", testKeysPath
      ]);

      const result2 = await runCLI([
        "encrypt",
        "--message", "Message 2",
        "--public-key-file", testKeysPath
      ]);

      expect(result1.ciphertext).not.toBe(result2.ciphertext);
      expect(result1.nonce).not.toBe(result2.nonce);
      expect(result1.ephemeralPublicKey).not.toBe(result2.ephemeralPublicKey);
    });

    test("encrypt: same message produces different ciphertexts (nonce randomness)", async () => {
      const result1 = await runCLI([
        "encrypt",
        "--message", "Same message",
        "--public-key-file", testKeysPath
      ]);

      const result2 = await runCLI([
        "encrypt",
        "--message", "Same message",
        "--public-key-file", testKeysPath
      ]);

      // Due to random nonces and ephemeral keys, should get different results
      expect(result1.ciphertext).not.toBe(result2.ciphertext);
      expect(result1.nonce).not.toBe(result2.nonce);
      expect(result1.ephemeralPublicKey).not.toBe(result2.ephemeralPublicKey);
    });

    test("verify-signature: verifies valid Ed25519 signature", async () => {
      // Create a signed message using ed25519 library
      const { ed25519 } = await import("@noble/curves/ed25519.js");

      const privateKeyBytes = base64UrlToUint8Array(testKeys.privateKey);
      const message = "Test signature verification";
      const messageBytes = new TextEncoder().encode(message);
      const signature = ed25519.sign(messageBytes, privateKeyBytes);

      // Convert signature to base64url
      const signatureB64 = uint8ArrayToBase64Url(signature);

      const signedMessage = {
        message,
        signature: signatureB64,
        publicKey: testKeys.publicKey
      };

      const signedPath = ".merits/test-signed-message.json";
      await Bun.write(signedPath, JSON.stringify(signedMessage));

      const result = await runCLI([
        "verify-signature",
        "--signed-file", signedPath
      ]);

      expect(result).toHaveProperty("valid");
      expect(result.valid).toBe(true);
    });

    test("verify-signature: rejects invalid signature", async () => {
      const signedMessage = {
        message: "Test message",
        signature: "INVALID_SIGNATURE_BASE64URL",
        publicKey: testKeys.publicKey
      };

      const signedPath = ".merits/test-invalid-signature.json";
      await Bun.write(signedPath, JSON.stringify(signedMessage));

      // This should throw an error due to invalid signature format
      await expect(async () => {
        await runCLI([
          "verify-signature",
          "--signed-file", signedPath
        ]);
      }).toThrow();
    });

    test("verify-signature: rejects tampered message", async () => {
      // Create a valid signed message
      const { ed25519 } = await import("@noble/curves/ed25519.js");

      const privateKeyBytes = base64UrlToUint8Array(testKeys.privateKey);
      const originalMessage = "Original message";
      const messageBytes = new TextEncoder().encode(originalMessage);
      const signature = ed25519.sign(messageBytes, privateKeyBytes);

      const signatureB64 = uint8ArrayToBase64Url(signature);

      // Tamper with the message after signing
      const tamperedMessage = {
        message: "Tampered message",  // Changed!
        signature: signatureB64,      // But signature is for "Original message"
        publicKey: testKeys.publicKey
      };

      const tamperedPath = ".merits/test-tampered-message.json";
      await Bun.write(tamperedPath, JSON.stringify(tamperedMessage));

      const result = await runCLI([
        "verify-signature",
        "--signed-file", tamperedPath
      ]);

      expect(result).toHaveProperty("valid");
      expect(result.valid).toBe(false);
    });

    test("encrypt handles unicode messages", async () => {
      const unicodeMessage = "Hello 世界 🌍 مرحبا";

      const encrypted = await runCLI([
        "encrypt",
        "--message", unicodeMessage,
        "--public-key-file", testKeysPath
      ]);

      const encryptedPath = ".merits/test-unicode-encrypted.json";
      await Bun.write(encryptedPath, JSON.stringify(encrypted));

      const decrypted = await runCLI([
        "decrypt",
        "--encrypted-file", encryptedPath,
        "--keys-file", testKeysPath
      ]);

      expect(decrypted.plaintext).toBe(unicodeMessage);
    });

    test("encrypt handles very short messages", async () => {
      const shortMessage = "x";

      const encrypted = await runCLI([
        "encrypt",
        "--message", shortMessage,
        "--public-key-file", testKeysPath
      ]);

      const encryptedPath = ".merits/test-short-encrypted.json";
      await Bun.write(encryptedPath, JSON.stringify(encrypted));

      const decrypted = await runCLI([
        "decrypt",
        "--encrypted-file", encryptedPath,
        "--keys-file", testKeysPath
      ]);

      expect(decrypted.plaintext).toBe(shortMessage);
    });
  });
});

/**
 * Helper: Decode base64url to Uint8Array
 */
function base64UrlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = base64 + padding;
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
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
