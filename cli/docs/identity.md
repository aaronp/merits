# Identity Management in Merits CLI

A concise guide to how Merits manages KERI-based identities using OS-native credential storage.

---

## Overview

Merits uses **KERI (Key Event Receipt Infrastructure)** identities for cryptographic authentication. Each identity has:

- **AID** (Autonomic Identifier) - Derived from public key (format: `D<base64url>`)
- **Ed25519 keypair** - 32-byte private key + 32-byte public key
- **KSN** (Key Sequence Number) - Tracks key rotation state (starts at 0)
- **Metadata** - Public info (created date, registration status, etc.)

**Key Principle**: Private keys **never leave the vault**. All signing happens inside OS-native secure storage.

---

## Architecture

### Two-Layer Storage

```
┌─────────────────────────────────────────────────┐
│ OS Keychain (Secure Storage)                    │
│ - macOS: Keychain Access                        │
│ - Linux: Secret Service (libsecret)             │
│ - Windows: Credential Manager                   │
│                                                 │
│ Stores: Private keys ONLY                       │
│ Access: Protected by OS authentication          │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ ~/.merits/identities.json (0600 permissions)    │
│                                                 │
│ Stores: Public metadata                         │
│ {                                               │
│   "identities": {                               │
│     "alice": {                                  │
│       "aid": "D...",                            │
│       "ksn": 0,                                 │
│       "metadata": {                             │
│         "publicKey": <Uint8Array>,              │
│         "createdAt": 1234567890,                │
│         "registered": true,                     │
│         "registeredAt": 1234567899              │
│       }                                         │
│     }                                           │
│   }                                             │
│ }                                               │
└─────────────────────────────────────────────────┘
```

**Why this split?**
- Private keys get OS-level protection (hardware-backed on macOS/iOS)
- Metadata is fast to read (no OS auth prompt for every operation)
- Follows principle of least privilege

### Code References

- **Vault Interface**: [cli/lib/vault/MeritsVault.ts](../lib/vault/MeritsVault.ts)
- **OS Implementation**: [cli/lib/vault/OSKeychainVault.ts](../lib/vault/OSKeychainVault.ts)
- **Factory**: [cli/lib/vault/index.ts](../lib/vault/index.ts)

---

## Identity Lifecycle

### 1. Create Identity

```bash
merits identity new alice
```

**What happens:**

1. Generate Ed25519 keypair using [@noble/ed25519](https://github.com/paulmillr/noble-ed25519)
2. Derive AID from public key: `AID = "D" + base64url(publicKey)`
3. Store private key in OS Keychain with service name `merits-cli`
4. Store metadata (AID, KSN=0, publicKey) in `~/.merits/identities.json`
5. Optionally register with backend

**Code**: [cli/commands/identity/new.ts](../commands/identity/new.ts)

**Key Operations:**
```typescript
// Generate keypair
const keys = await generateKeyPair(); // core/crypto.ts

// Derive AID
const aid = createAID(keys.publicKey); // core/crypto.ts

// Store in vault (private key goes to OS Keychain)
await vault.storeIdentity(name, {
  aid,
  privateKey: keys.privateKey,
  ksn: 0,
  metadata: {
    publicKey: keys.publicKey, // Store for later use
    createdAt: Date.now(),
    registered: false
  }
});
```

**Tests**: [tests/cli/unit/vault.test.ts](../../tests/cli/unit/vault.test.ts#L20)

---

### 2. Register with Backend

```bash
merits identity register alice
```

**What happens:**

1. Load identity metadata from vault (NO private key access)
2. Get public key from metadata: `vault.getPublicKey(name)`
3. Call backend API: `client.identityRegistry.registerIdentity({ aid, publicKey, ksn })`
4. Update metadata: `{ registered: true, registeredAt: Date.now() }`

**Code**: [cli/commands/identity/register.ts](../commands/identity/register.ts)

**Security Note**: Registration **never exports the private key**. The backend only needs the public key to verify future signatures.

**Tests**: [tests/integration/identity-auth-interface.test.ts](../../tests/integration/identity-auth-interface.test.ts)

---

### 3. Sign Operations (Auth Flow)

Every backend operation requires proof of identity:

```bash
merits send <recipient> --message "Hello"
```

**Auth Flow:**

```typescript
// 1. Issue challenge from backend
const challenge = await client.identityAuth.issueChallenge({
  aid: identity.aid,
  purpose: "send",
  args: { to, ctHash, ttlMs, alg, ek }
});

// 2. Canonicalize payload (deterministic JSON)
const data = canonicalizeToBytes(challenge.payloadToSign);

// 3. Sign with vault (private key NEVER leaves!)
const sigs = await vault.signIndexed(identityName, data);

// 4. Return proof
return {
  challengeId: challenge.challengeId,
  sigs,
  ksn: identity.ksn
};
```

**Key Implementation**: [cli/lib/getAuthProof.ts](../lib/getAuthProof.ts)

**How `vault.signIndexed()` works:**

1. Retrieve private key from OS Keychain (triggers OS auth if needed)
2. Sign data using Ed25519: `signature = sign(data, privateKey)`
3. Format as indexed signature: `"0-<base64url(signature)>"`
4. Private key is **immediately discarded** from memory
5. Return signature array

**Code**: [cli/lib/vault/OSKeychainVault.ts:180-203](../lib/vault/OSKeychainVault.ts#L180)

**Tests**: [tests/cli/unit/messaging-auth.test.ts](../../tests/cli/unit/messaging-auth.test.ts)

---

### 4. Export for Backup

```bash
merits identity export alice --output alice-backup.json
merits identity export alice --output alice-backup.json --include-key
```

**What exports:**

- **Default** (safe): AID, KSN, metadata (NO private key)
- **With `--include-key`** (dangerous): Everything including private key

**Format:**
```json
{
  "name": "alice",
  "aid": "DHytGsw0r-wYg0DSf_4l_D594hXtKH_e5-zMIdlM",
  "ksn": 0,
  "metadata": {
    "publicKey": { "0": 28, "1": 203, ... },
    "createdAt": 1703721234567,
    "registered": true
  },
  "privateKey": "..." // Only if --include-key
}
```

**Code**: [cli/commands/identity/export.ts](../commands/identity/export.ts)

**Security Warning**: The CLI warns loudly when using `--include-key`:
```
⚠️  WARNING: Exporting private key is DANGEROUS!
   - Anyone with this file can impersonate you
   - Store in encrypted backup only
   - Never share or commit to version control
```

**Tests**: [tests/cli/unit/vault.test.ts:74-87](../../tests/cli/unit/vault.test.ts#L74)

---

### 5. Import from Backup

```bash
merits identity import alice-backup.json
merits identity import alice-backup.json --register
```

**What happens:**

1. Parse backup JSON
2. Validate structure (AID, KSN, metadata)
3. Store in vault (if backup includes private key, it goes to OS Keychain)
4. Optionally register with backend

**Code**: [cli/commands/identity/import.ts](../commands/identity/import.ts)

---

### 6. Delete Identity

```bash
merits identity delete alice
merits identity delete alice --force  # Skip confirmation
```

**What happens:**

1. Show confirmation prompt (unless `--force`)
2. Delete private key from OS Keychain
3. Remove metadata from `~/.merits/identities.json`
4. Update default identity if deleted identity was default

**Code**: [cli/commands/identity/delete.ts](../commands/identity/delete.ts)

**Tests**: [tests/cli/unit/vault.test.ts:89-105](../../tests/cli/unit/vault.test.ts#L89)

---

## Security Model

### Private Key Protection

**Where private keys live:**
- **macOS**: Keychain Access (can be hardware-backed via Secure Enclave on newer Macs)
- **Linux**: Secret Service (backed by gnome-keyring or kwallet)
- **Windows**: Credential Manager

**Access control:**
- OS may prompt for system password on first access
- Subsequent access may use cached credentials (OS-dependent)
- Private keys are **never** written to disk in plaintext by Merits

### Operations That Access Private Keys

Only these vault operations touch private keys:

1. **`storeIdentity()`** - Write private key to OS Keychain
2. **`signIndexed()`** - Read private key, sign data, discard key
3. **`exportPrivateKey()`** - Read private key for backup (explicit opt-in)
4. **`deleteIdentity()`** - Delete private key from OS Keychain

**All other operations** (list, show, register, etc.) only read metadata.

### Threat Model

**Protected against:**
- ✅ Casual file system browsing (private keys not in plaintext files)
- ✅ Accidental git commits (no private keys in `~/.merits/`)
- ✅ Process memory dumps (keys loaded only during signing)
- ✅ Other applications (OS controls keychain access)

**NOT protected against:**
- ❌ Root/admin access to OS Keychain
- ❌ OS-level malware with keychain access
- ❌ Physical device access (if OS unlocked)
- ❌ User explicitly exporting private key (`--include-key`)

**Best practices:**
- Use full disk encryption
- Lock your computer when away
- Only export private keys to encrypted backup media
- Rotate keys if compromise suspected

---

## Key Rotation (Future)

**Status**: Interface defined, not yet implemented in CLI.

**Concept**: When a private key is compromised, create a new keypair while maintaining the same AID:

```typescript
// Proposed API (not yet implemented)
merits identity rotate alice
```

**What would happen:**

1. Generate new Ed25519 keypair
2. Increment KSN: `ksn = ksn + 1`
3. Sign rotation proof with old private key
4. Register new public key with backend: `identityRegistry.rotateKeys()`
5. Update vault with new keypair

**Code**: [src/client/types.ts:44-51](../../src/client/types.ts#L44) (interface only)

---

## Related Documentation

- **Phase 1 Plan**: [docs/cli-phase-1.md](../../docs/cli-phase-1.md) - Identity management design
- **Vault Tests**: [tests/cli/unit/vault.test.ts](../../tests/cli/unit/vault.test.ts) - Comprehensive vault test suite
- **Crypto Module**: [core/crypto.ts](../../core/crypto.ts) - Ed25519 operations
- **Backend Interface**: [core/interfaces/IdentityAuth.ts](../../core/interfaces/IdentityAuth.ts) - Challenge/response auth

---

## FAQ

### Why not store everything in OS Keychain?

OS Keychain access can trigger auth prompts. Separating metadata avoids prompting users for every `merits identity list` or similar read-only operation.

### Can I use hardware security keys (YubiKey, etc.)?

Not yet. This requires:
- PKCS#11 or FIDO2 integration
- Changes to vault interface
- Proposed for future milestone

### What happens if I lose my private key?

Your AID is cryptographically bound to your public key. If you lose the private key:
- You cannot sign new messages or proofs
- You cannot rotate to a new key
- You must create a new identity with a new AID

**This is why backup (`merits identity export --include-key`) is critical.**

### Can I use the same identity on multiple devices?

Yes, via export/import:

```bash
# Device 1
merits identity export alice --output alice.json --include-key

# Transfer alice.json securely (encrypted USB, password manager, etc.)

# Device 2
merits identity import alice.json
```

**Warning**: Both devices will share the same private key. If one device is compromised, rotate keys immediately.

### How does this compare to PGP/GPG?

**Similarities:**
- Ed25519 keypairs for signing
- Public key distribution
- Cryptographic identity

**Differences:**
- Merits AIDs are self-certifying (no certificate authority)
- KERI supports key rotation with continuity
- OS Keychain instead of GPG keyring
- Backend registration for discoverability

---

## Quick Reference

| Command | What It Does | Private Key Access |
|---------|-------------|-------------------|
| `identity new` | Create new identity | ✅ Write to keychain |
| `identity list` | List all identities | ❌ Metadata only |
| `identity show` | Show identity details | ❌ Metadata only |
| `identity register` | Register with backend | ❌ Uses public key from metadata |
| `identity set-default` | Set default identity | ❌ Metadata only |
| `identity export` | Export for backup | ⚠️ Only with `--include-key` |
| `identity import` | Import from backup | ✅ Write to keychain (if backup has key) |
| `identity delete` | Delete identity | ✅ Delete from keychain |
| `send` / `receive` / `ack` | Messaging | ✅ Sign via `signIndexed()` |

---

**Last Updated**: Phase 3 Complete (2025-01-27)
