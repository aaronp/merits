/**
 * Vault Tests
 *
 * Tests for OSKeychainVault implementation.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { OSKeychainVault } from "../../../cli/lib/vault/OSKeychainVault";
import { VaultError } from "../../../cli/lib/vault/MeritsVault";
import { generateKeyPair, createAID } from "../../../core/crypto";

describe("OSKeychainVault", () => {
  let tempDir: string;
  let vault: OSKeychainVault;

  beforeEach(() => {
    // Create temp directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "merits-vault-test-"));
    vault = new OSKeychainVault(tempDir);
  });

  afterEach(async () => {
    // Clean up identities from vault
    const identities = await vault.listIdentities();
    for (const name of identities) {
      try {
        await vault.deleteIdentity(name);
      } catch (err) {
        // Ignore errors during cleanup
      }
    }

    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("stores and retrieves identity", async () => {
    const keys = await generateKeyPair();
    const aid = createAID(keys.publicKey);

    await vault.storeIdentity("alice", {
      aid,
      privateKey: keys.privateKey,
      ksn: 0,
      metadata: { email: "alice@example.com" },
    });

    const identity = await vault.getIdentity("alice");

    expect(identity.aid).toBe(aid);
    expect(identity.ksn).toBe(0);
    expect(identity.metadata?.email).toBe("alice@example.com");
  });

  test("throws error if identity already exists", async () => {
    const keys = await generateKeyPair();
    const aid = createAID(keys.publicKey);

    await vault.storeIdentity("alice", {
      aid,
      privateKey: keys.privateKey,
      ksn: 0,
    });

    await expect(
      vault.storeIdentity("alice", {
        aid,
        privateKey: keys.privateKey,
        ksn: 0,
      })
    ).rejects.toThrow(VaultError);
  });

  test("throws error if identity not found", async () => {
    await expect(vault.getIdentity("nonexistent")).rejects.toThrow(VaultError);
  });

  test("lists all identities", async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    await vault.storeIdentity("alice", {
      aid: createAID(alice.publicKey),
      privateKey: alice.privateKey,
      ksn: 0,
    });

    await vault.storeIdentity("bob", {
      aid: createAID(bob.publicKey),
      privateKey: bob.privateKey,
      ksn: 0,
    });

    const identities = await vault.listIdentities();

    expect(identities).toContain("alice");
    expect(identities).toContain("bob");
    expect(identities.length).toBe(2);
  });

  test("signs data with indexed signature", async () => {
    const keys = await generateKeyPair();
    const aid = createAID(keys.publicKey);

    await vault.storeIdentity("alice", {
      aid,
      privateKey: keys.privateKey,
      ksn: 0,
    });

    const data = new TextEncoder().encode("test message");
    const sigs = await vault.signIndexed("alice", data);

    expect(sigs.length).toBe(1);
    expect(sigs[0].startsWith("0-")).toBe(true); // Indexed signature
  });

  test("exports private key", async () => {
    const keys = await generateKeyPair();
    const aid = createAID(keys.publicKey);

    await vault.storeIdentity("alice", {
      aid,
      privateKey: keys.privateKey,
      ksn: 0,
    });

    const exported = await vault.exportPrivateKey("alice");

    expect(exported).toEqual(keys.privateKey);
  });

  test("deletes identity", async () => {
    const keys = await generateKeyPair();
    const aid = createAID(keys.publicKey);

    await vault.storeIdentity("alice", {
      aid,
      privateKey: keys.privateKey,
      ksn: 0,
    });

    await vault.deleteIdentity("alice");

    const identities = await vault.listIdentities();
    expect(identities).not.toContain("alice");
  });

  test("throws error when deleting nonexistent identity", async () => {
    await expect(vault.deleteIdentity("nonexistent")).rejects.toThrow(
      VaultError
    );
  });

  test("metadata file has secure permissions", async () => {
    const keys = await generateKeyPair();
    const aid = createAID(keys.publicKey);

    await vault.storeIdentity("alice", {
      aid,
      privateKey: keys.privateKey,
      ksn: 0,
    });

    await vault.flush();

    const metadataPath = path.join(tempDir, "identities.json");
    const stats = fs.statSync(metadataPath);
    const mode = stats.mode & 0o777;

    expect(mode).toBe(0o600);
  });

  test("flushes metadata on demand", async () => {
    const keys = await generateKeyPair();
    const aid = createAID(keys.publicKey);

    await vault.storeIdentity("alice", {
      aid,
      privateKey: keys.privateKey,
      ksn: 0,
    });

    await vault.flush();

    const metadataPath = path.join(tempDir, "identities.json");
    expect(fs.existsSync(metadataPath)).toBe(true);

    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
    expect(metadata.identities.alice).toBeDefined();
    expect(metadata.identities.alice.aid).toBe(aid);
  });

  test("caches metadata to reduce file I/O", async () => {
    const keys = await generateKeyPair();
    const aid = createAID(keys.publicKey);

    await vault.storeIdentity("alice", {
      aid,
      privateKey: keys.privateKey,
      ksn: 0,
    });

    await vault.flush();

    // Read metadata file mtime
    const metadataPath = path.join(tempDir, "identities.json");
    const mtime1 = fs.statSync(metadataPath).mtimeMs;

    // Get identity multiple times (should use cache)
    await vault.getIdentity("alice");
    await vault.getIdentity("alice");
    await vault.getIdentity("alice");

    // Metadata file should not have been rewritten
    const mtime2 = fs.statSync(metadataPath).mtimeMs;
    expect(mtime1).toBe(mtime2);
  });

  test("handles metadata with no identities", async () => {
    const identities = await vault.listIdentities();
    expect(identities).toEqual([]);
  });

  test("decrypt throws placeholder error", async () => {
    const keys = await generateKeyPair();
    const aid = createAID(keys.publicKey);

    await vault.storeIdentity("alice", {
      aid,
      privateKey: keys.privateKey,
      ksn: 0,
    });

    await expect(
      vault.decrypt("alice", "encrypted-data")
    ).rejects.toThrow("not yet implemented");
  });
});
