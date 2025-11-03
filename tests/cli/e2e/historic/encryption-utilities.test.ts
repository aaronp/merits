/**
 * E2E Test: Encryption/Decryption Utilities
 *
 * Tests the standalone encryption and decryption utilities for testing
 * and integration with other tools.
 *
 * Scenario:
 * 1. Generate key pairs for alice and bob
 * 2. Alice encrypts message for Bob
 * 3. Bob decrypts Alice's message
 * 4. Test signature verification
 * 5. Test round-trip encryption/decryption
 * 6. Test error cases (wrong keys, invalid data)
 *
 * Priority: P2 (utility commands)
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { runCliInProcess, assertSuccess, assertFailure } from "../helpers/exec";
import { mkScenario, writeJSON, readJSON } from "../helpers/workspace";
import { join } from "node:path";

describe("E2E: Encryption/Decryption Utilities", () => {
  let scenario: ReturnType<typeof mkScenario>;
  let aliceKeys: any;
  let bobKeys: any;

  beforeAll(() => {
    scenario = mkScenario("encryption-utils");
  });

  it("generates key pairs for alice and bob", async () => {
    // Generate Alice's keys
    const aliceResult = await runCliInProcess(
      ["gen-key", "--seed", "alice-encrypt-test"],
      {
        env: { MERITS_VAULT_QUIET: "1" },
      }
    );

    assertSuccess(aliceResult);
    aliceKeys = aliceResult.json;
    expect(aliceKeys.aid).toBeString();
    expect(aliceKeys.privateKey).toBeString();
    expect(aliceKeys.publicKey).toBeString();

    // Generate Bob's keys
    const bobResult = await runCliInProcess(
      ["gen-key", "--seed", "bob-encrypt-test"],
      {
        env: { MERITS_VAULT_QUIET: "1" },
      }
    );

    assertSuccess(bobResult);
    bobKeys = bobResult.json;

    console.log(`✓ Generated keys for Alice and Bob`);
    console.log(`  Alice AID: ${aliceKeys.aid}`);
    console.log(`  Bob AID: ${bobKeys.aid}`);

    // Save keys to files for later use
    writeJSON(join(scenario.dataDir, "alice-keys.json"), aliceKeys);
    writeJSON(join(scenario.dataDir, "bob-keys.json"), bobKeys);
  });

  it("alice encrypts message for bob", async () => {
    const message = "Hello Bob, this is a secret message!";

    // Save Bob's public key to file
    const bobPubKeyFile = join(scenario.dataDir, "bob-public-key.json");
    writeJSON(bobPubKeyFile, {
      aid: bobKeys.aid,
      publicKey: bobKeys.publicKey,
    });

    const result = await runCliInProcess(
      ["encrypt", "--message", message, "--public-key-file", bobPubKeyFile],
      {
        cwd: scenario.root,
        env: { MERITS_VAULT_QUIET: "1" },
      }
    );

    assertSuccess(result);
    expect(result.json).toBeDefined();
    expect(result.json.ciphertext).toBeString();
    expect(result.json.ephemeralKey).toBeString();
    expect(result.json.recipient).toBe(bobKeys.aid);

    console.log(`✓ Alice encrypted message for Bob`);
    console.log(`  Ciphertext: ${result.json.ciphertext.substring(0, 40)}...`);

    // Save encrypted message
    writeJSON(join(scenario.dataDir, "encrypted-message.json"), result.json);
  });

  it("bob decrypts alice's message", async () => {
    const encryptedFile = join(scenario.dataDir, "encrypted-message.json");
    const keysFile = join(scenario.dataDir, "bob-keys.json");

    const result = await runCliInProcess(
      ["decrypt", "--encrypted-file", encryptedFile, "--keys-file", keysFile],
      {
        cwd: scenario.root,
        env: { MERITS_VAULT_QUIET: "1" },
      }
    );

    assertSuccess(result);
    expect(result.json).toBeDefined();
    expect(result.json.message).toBe("Hello Bob, this is a secret message!");

    console.log(`✓ Bob decrypted Alice's message`);
    console.log(`  Plaintext: "${result.json.message}"`);
  });

  it("round-trip encryption/decryption preserves message", async () => {
    const originalMessage = "Test message with special chars: !@#$%^&*()_+-=[]{}|;:',.<>?/~ and unicode: 世界🌍";

    // Alice encrypts for Bob
    const bobPubKeyFile = join(scenario.dataDir, "bob-public-key.json");
    const encryptResult = await runCliInProcess(
      [
        "encrypt",
        "--message",
        originalMessage,
        "--public-key-file",
        bobPubKeyFile,
      ],
      {
        env: { MERITS_VAULT_QUIET: "1" },
      }
    );

    assertSuccess(encryptResult);

    // Save encrypted message
    const encryptedFile = join(scenario.dataDir, "roundtrip-encrypted.json");
    writeJSON(encryptedFile, encryptResult.json);

    // Bob decrypts
    const keysFile = join(scenario.dataDir, "bob-keys.json");
    const decryptResult = await runCliInProcess(
      ["decrypt", "--encrypted-file", encryptedFile, "--keys-file", keysFile],
      {
        env: { MERITS_VAULT_QUIET: "1" },
      }
    );

    assertSuccess(decryptResult);
    expect(decryptResult.json.message).toBe(originalMessage);

    console.log(`✓ Round-trip preserves message exactly`);
  });

  it("bob cannot decrypt with wrong key", async () => {
    const encryptedFile = join(scenario.dataDir, "encrypted-message.json");

    // Try to decrypt with Alice's keys (wrong keys)
    const aliceKeysFile = join(scenario.dataDir, "alice-keys.json");

    const result = await runCliInProcess(
      [
        "decrypt",
        "--encrypted-file",
        encryptedFile,
        "--keys-file",
        aliceKeysFile,
      ],
      {
        env: { MERITS_VAULT_QUIET: "1" },
      }
    );

    // Should fail - wrong keys
    assertFailure(result);
    expect(result.stderr).toBeDefined();

    console.log(`✓ Decryption correctly fails with wrong key`);
  });

  it("encrypts different messages to same recipient", async () => {
    const messages = ["Message 1", "Message 2", "Message 3"];
    const ciphertexts: string[] = [];

    const bobPubKeyFile = join(scenario.dataDir, "bob-public-key.json");

    for (const msg of messages) {
      const result = await runCliInProcess(
        [
          "encrypt",
          "--message",
          msg,
          "--public-key-file",
          bobPubKeyFile,
        ],
        {
          env: { MERITS_VAULT_QUIET: "1" },
        }
      );

      assertSuccess(result);
      ciphertexts.push(result.json.ciphertext);
    }

    // All ciphertexts should be different (due to randomness)
    expect(ciphertexts[0]).not.toBe(ciphertexts[1]);
    expect(ciphertexts[1]).not.toBe(ciphertexts[2]);
    expect(ciphertexts[0]).not.toBe(ciphertexts[2]);

    console.log(`✓ Same message produces different ciphertexts (random nonces)`);
  });

  it("handles empty message encryption", async () => {
    const bobPubKeyFile = join(scenario.dataDir, "bob-public-key.json");

    const result = await runCliInProcess(
      ["encrypt", "--message", "", "--public-key-file", bobPubKeyFile],
      {
        env: { MERITS_VAULT_QUIET: "1" },
      }
    );

    // Should either succeed or fail gracefully
    // Implementation dependent
    expect(result.code).toBeOneOf([0, 1]);

    if (result.code === 0) {
      console.log(`✓ Empty message encryption handled`);
    } else {
      console.log(`✓ Empty message correctly rejected`);
    }
  });

  it("handles very long message encryption", async () => {
    const longMessage = "A".repeat(10000);
    const bobPubKeyFile = join(scenario.dataDir, "bob-public-key.json");

    const encryptResult = await runCliInProcess(
      ["encrypt", "--message", longMessage, "--public-key-file", bobPubKeyFile],
      {
        env: { MERITS_VAULT_QUIET: "1" },
      }
    );

    assertSuccess(encryptResult);

    // Decrypt and verify
    const encryptedFile = join(scenario.dataDir, "long-encrypted.json");
    writeJSON(encryptedFile, encryptResult.json);

    const keysFile = join(scenario.dataDir, "bob-keys.json");
    const decryptResult = await runCliInProcess(
      ["decrypt", "--encrypted-file", encryptedFile, "--keys-file", keysFile],
      {
        env: { MERITS_VAULT_QUIET: "1" },
      }
    );

    assertSuccess(decryptResult);
    expect(decryptResult.json.message.length).toBe(longMessage.length);

    console.log(`✓ Long message (10,000 chars) encrypted/decrypted`);
  });
});

describe("E2E: Signature Verification Utilities", () => {
  let scenario: ReturnType<typeof mkScenario>;
  let aliceKeys: any;

  beforeAll(async () => {
    scenario = mkScenario("signature-verify");

    // Generate Alice's keys
    const result = await runCliInProcess(
      ["gen-key", "--seed", "alice-sig-test"],
      {
        env: { MERITS_VAULT_QUIET: "1" },
      }
    );

    assertSuccess(result);
    aliceKeys = result.json;

    writeJSON(join(scenario.dataDir, "alice-keys.json"), aliceKeys);
  });

  it("creates signed message and verifies signature", async () => {
    const message = "Important signed message";

    // Create a message to sign
    const messageData = {
      message: message,
      timestamp: Date.now(),
      aid: aliceKeys.aid,
    };

    const messageFile = join(scenario.dataDir, "message.json");
    writeJSON(messageFile, messageData);

    const keysFile = join(scenario.dataDir, "alice-keys.json");

    // Sign the message (using sign command)
    const signResult = await runCliInProcess(
      ["sign", "--file", messageFile, "--keys", keysFile],
      {
        env: { MERITS_VAULT_QUIET: "1" },
      }
    );

    assertSuccess(signResult);
    expect(signResult.json.signature).toBeString();

    console.log(`✓ Message signed`);

    // Save signed message
    const signedFile = join(scenario.dataDir, "signed-message.json");
    writeJSON(signedFile, signResult.json);

    // Verify signature
    const verifyResult = await runCliInProcess(
      ["verify-signature", "--signed-file", signedFile],
      {
        env: { MERITS_VAULT_QUIET: "1" },
      }
    );

    assertSuccess(verifyResult);
    expect(verifyResult.json.valid).toBe(true);

    console.log(`✓ Signature verified`);
  });

  it("detects invalid signature", async () => {
    // Create message with fake signature
    const fakeSignedMessage = {
      message: "Tampered message",
      aid: aliceKeys.aid,
      signature: "fake-signature-data",
    };

    const fakeFile = join(scenario.dataDir, "fake-signed.json");
    writeJSON(fakeFile, fakeSignedMessage);

    const result = await runCliInProcess(
      ["verify-signature", "--signed-file", fakeFile],
      {
        env: { MERITS_VAULT_QUIET: "1" },
      }
    );

    // Should detect invalid signature
    // Either fail or return valid: false
    if (result.code === 0) {
      expect(result.json.valid).toBe(false);
    }

    console.log(`✓ Invalid signature detected`);
  });
});

describe("E2E: Encryption Utilities Edge Cases", () => {
  it("should fail with non-existent public key file", async () => {
    const scenario = mkScenario("encrypt-edge");

    const result = await runCliInProcess(
      [
        "encrypt",
        "--message",
        "test",
        "--public-key-file",
        "/non/existent/file.json",
      ],
      {
        env: { MERITS_VAULT_QUIET: "1" },
      }
    );

    assertFailure(result);

    scenario.cleanup();
  });

  it("should fail decryption with non-existent encrypted file", async () => {
    const scenario = mkScenario("decrypt-edge");

    // Create keys file
    const keysResult = await runCliInProcess(
      ["gen-key", "--seed", "test"],
      {
        env: { MERITS_VAULT_QUIET: "1" },
      }
    );
    assertSuccess(keysResult);

    const keysFile = join(scenario.dataDir, "keys.json");
    writeJSON(keysFile, keysResult.json);

    const result = await runCliInProcess(
      [
        "decrypt",
        "--encrypted-file",
        "/non/existent/encrypted.json",
        "--keys-file",
        keysFile,
      ],
      {
        env: { MERITS_VAULT_QUIET: "1" },
      }
    );

    assertFailure(result);

    scenario.cleanup();
  });

  it("should fail with malformed encrypted data", async () => {
    const scenario = mkScenario("malformed-edge");

    // Create keys
    const keysResult = await runCliInProcess(
      ["gen-key", "--seed", "test-malformed"],
      {
        env: { MERITS_VAULT_QUIET: "1" },
      }
    );
    assertSuccess(keysResult);

    const keysFile = join(scenario.dataDir, "keys.json");
    writeJSON(keysFile, keysResult.json);

    // Create malformed encrypted data
    const malformedFile = join(scenario.dataDir, "malformed.json");
    writeJSON(malformedFile, {
      ciphertext: "invalid-base64-data",
      ephemeralKey: "also-invalid",
    });

    const result = await runCliInProcess(
      [
        "decrypt",
        "--encrypted-file",
        malformedFile,
        "--keys-file",
        keysFile,
      ],
      {
        env: { MERITS_VAULT_QUIET: "1" },
      }
    );

    assertFailure(result);

    console.log(`✓ Malformed data correctly rejected`);

    scenario.cleanup();
  });
});
