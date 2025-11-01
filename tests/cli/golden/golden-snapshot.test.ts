/**
 * Golden Snapshot Tests
 *
 * These tests ensure that command output remains stable across changes.
 * They compare actual output against "golden" reference files stored in
 * tests/cli/golden/snapshots/.
 *
 * Why golden tests:
 * - Catch unintended changes to output format
 * - Ensure RFC8785 canonicalization remains consistent
 * - Validate that deterministic commands produce identical output
 * - Make breaking changes explicit and reviewable
 *
 * Updating snapshots:
 * - Review the diff carefully to ensure changes are intentional
 * - Run: GOLDEN_UPDATE=1 bun test tests/cli/golden/
 * - Commit updated snapshot files with explanation
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { $ } from "bun";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const SNAPSHOTS_DIR = join(__dirname, "snapshots");
const UPDATE_SNAPSHOTS = process.env.GOLDEN_UPDATE === "1";

// Ensure snapshots directory exists
if (!existsSync(SNAPSHOTS_DIR)) {
  mkdirSync(SNAPSHOTS_DIR, { recursive: true });
}

/**
 * Run CLI command and return output
 */
async function runCLI(args: string[]): Promise<string> {
  const cliArgs = ["run", "cli/index.ts", ...args];
  const env = { ...process.env, MERITS_VAULT_QUIET: "1" };

  const result = await $`bun ${cliArgs}`.env(env).text();
  return result.trim();
}

/**
 * Compare output against golden snapshot
 */
function expectMatchesGolden(testName: string, actual: string): void {
  const snapshotPath = join(SNAPSHOTS_DIR, `${testName}.json`);

  if (UPDATE_SNAPSHOTS) {
    // Update mode: write actual output as new golden snapshot
    writeFileSync(snapshotPath, actual + "\n", "utf-8");
    console.log(`✓ Updated golden snapshot: ${testName}`);
  } else {
    // Verify mode: compare actual output against stored snapshot
    if (!existsSync(snapshotPath)) {
      throw new Error(
        `Golden snapshot missing: ${testName}\n` +
        `Run: GOLDEN_UPDATE=1 bun test tests/cli/golden/ to create it`
      );
    }

    const expected = readFileSync(snapshotPath, "utf-8").trim();

    if (actual !== expected) {
      console.error("\n=== Golden Snapshot Mismatch ===");
      console.error(`Test: ${testName}`);
      console.error(`Snapshot: ${snapshotPath}`);
      console.error("\nExpected:");
      console.error(expected);
      console.error("\nActual:");
      console.error(actual);
      console.error("\n================================\n");
    }

    expect(actual).toBe(expected);
  }
}

describe("Golden Snapshot Tests", () => {
  describe("gen-key Command", () => {
    test("gen-key with seed produces deterministic output", async () => {
      const output = await runCLI(["gen-key", "--seed", "golden-test-seed-1"]);
      expectMatchesGolden("gen-key-seed-1", output);
    });

    test("gen-key with different seed produces different output", async () => {
      const output = await runCLI(["gen-key", "--seed", "golden-test-seed-2"]);
      expectMatchesGolden("gen-key-seed-2", output);
    });

    test("gen-key format=pretty produces formatted output", async () => {
      const output = await runCLI([
        "gen-key",
        "--seed", "golden-test-pretty",
        "--format", "pretty"
      ]);
      expectMatchesGolden("gen-key-pretty", output);
    });
  });

  describe("encrypt Command", () => {
    let testKeysPath: string;

    beforeAll(async () => {
      // Generate deterministic keys for encryption tests
      const keys = await runCLI(["gen-key", "--seed", "golden-encrypt-keys"]);
      testKeysPath = ".merits/golden-test-keys.json";
      writeFileSync(testKeysPath, keys, "utf-8");
    });

    test("encrypt produces RFC8785 canonicalized JSON", async () => {
      // Note: encrypt uses random nonces, so we can't test exact output
      // Instead, we verify the structure and field ordering
      const output = await runCLI([
        "encrypt",
        "--message", "Golden test message",
        "--public-key-file", testKeysPath
      ]);

      const parsed = JSON.parse(output);

      // Verify field presence
      expect(parsed).toHaveProperty("ciphertext");
      expect(parsed).toHaveProperty("ephemeralPublicKey");
      expect(parsed).toHaveProperty("nonce");

      // Verify RFC8785 canonical ordering (alphabetical keys)
      const keys = Object.keys(parsed);
      const sortedKeys = [...keys].sort();
      expect(keys).toEqual(sortedKeys);

      // Verify no whitespace (canonical JSON has no spaces)
      expect(output).not.toContain(" ");
      expect(output).not.toContain("\n");
    });

    test("encrypt format=pretty produces formatted output", async () => {
      const output = await runCLI([
        "encrypt",
        "--message", "Pretty format test",
        "--public-key-file", testKeysPath,
        "--format", "pretty"
      ]);

      // Pretty format should have newlines and indentation
      expect(output).toContain("\n");
      expect(output).toContain("  "); // 2-space indentation

      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty("ciphertext");
      expect(parsed).toHaveProperty("ephemeralPublicKey");
      expect(parsed).toHaveProperty("nonce");
    });
  });

  describe("verify-signature Command", () => {
    let testKeysPath: string;
    let signedMessagePath: string;

    beforeAll(async () => {
      // Generate deterministic keys
      const keys = await runCLI(["gen-key", "--seed", "golden-verify-keys"]);
      testKeysPath = ".merits/golden-verify-keys.json";
      writeFileSync(testKeysPath, keys, "utf-8");

      // Create a signed message using the generated keys
      const { ed25519 } = await import("@noble/curves/ed25519.js");
      const keysData = JSON.parse(keys);

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

      function uint8ArrayToBase64Url(bytes: Uint8Array): string {
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      }

      const privateKeyBytes = base64UrlToUint8Array(keysData.privateKey);
      const message = "Golden signature verification test message";
      const messageBytes = new TextEncoder().encode(message);
      const signature = ed25519.sign(messageBytes, privateKeyBytes);

      const signedMessage = {
        message,
        signature: uint8ArrayToBase64Url(signature),
        publicKey: keysData.publicKey
      };

      signedMessagePath = ".merits/golden-signed-message.json";
      writeFileSync(signedMessagePath, JSON.stringify(signedMessage), "utf-8");
    });

    test("verify-signature produces deterministic output for valid signature", async () => {
      const output = await runCLI([
        "verify-signature",
        "--signed-file", signedMessagePath
      ]);
      expectMatchesGolden("verify-signature-valid", output);
    });

    test("verify-signature format=pretty produces formatted output", async () => {
      const output = await runCLI([
        "verify-signature",
        "--signed-file", signedMessagePath,
        "--format", "pretty"
      ]);
      expectMatchesGolden("verify-signature-pretty", output);
    });
  });

  describe("RFC8785 Canonicalization", () => {
    test("json format produces canonical output (no whitespace)", async () => {
      const output = await runCLI([
        "gen-key",
        "--seed", "canonicalization-test",
        "--format", "json"
      ]);

      // Canonical JSON has no spaces or newlines
      expect(output).not.toContain(" ");
      expect(output).not.toContain("\n");

      // Should be valid JSON
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty("privateKey");
      expect(parsed).toHaveProperty("publicKey");

      // Keys should be in alphabetical order (canonical)
      const keys = Object.keys(parsed);
      const sortedKeys = [...keys].sort();
      expect(keys).toEqual(sortedKeys);
    });

    test("pretty format produces formatted output (with whitespace)", async () => {
      const output = await runCLI([
        "gen-key",
        "--seed", "pretty-format-test",
        "--format", "pretty"
      ]);

      // Pretty format should have newlines and indentation
      expect(output).toContain("\n");
      expect(output).toContain("  ");

      // Should still be valid JSON
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty("privateKey");
      expect(parsed).toHaveProperty("publicKey");
    });
  });
});
