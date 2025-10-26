# Merits CLI Design Plan (Updated Review Summary)

**Status**: ✅ Reviewed & Updated  
**Updated**: 2025‑10‑26

This document consolidates all design feedback, improvements, and the new **auth flow model** for `merits` CLI — based on the reviewed 2025‑01‑26 plan.

---

## 🔷 Overview

The Merits CLI is a secure, scriptable command-line interface for interacting with the **Merits message bus** — authenticating via KERI proofs, managing identities, and sending encrypted messages to peers or groups.

This version integrates:
- Refined **auth challenge reuse** model (batch + short-lived sessions)
- Improved **vault interface** for signing *and* decrypting
- Clarified **group roles**, **admin commands**, and **output semantics**
- Explicit **developer expectations** for per-command authentication
- Alignment with **Merits SDK (client)** capabilities

---

## 1️⃣ Architecture Overview (unchanged in structure)

```
merits/
├── cli/
│   ├── index.ts
│   ├── commands/
│   │   ├── init.ts
│   │   ├── identity.ts
│   │   ├── send.ts
│   │   ├── unread.ts
│   │   ├── watch.ts
│   │   ├── group.ts
│   │   └── admin.ts         # new namespace for onboarding + ACL
│   ├── lib/
│   │   ├── vault/           # pluggable key management
│   │   ├── client-factory.ts
│   │   ├── getAuthProof.ts  # new helper for challenge signing
│   │   ├── encryption.ts
│   │   ├── config.ts
│   │   ├── formatters.ts
│   │   └── interactive.ts
│   └── types.ts
├── core/
├── src/client.ts
└── package.json
```

---

## 2️⃣ Key Design Refinements

### 🔐 2.1 Authentication Flow (new model)

All Merits CLI operations authenticate using **KERI proof-of-control** challenges, now optimized to **avoid N+1 round-trips** for multi-step flows.

| Command Type | Auth Purpose | Optimization |
|---------------|--------------|---------------|
| `send` | `"send"` | Signed once per send operation |
| `unread` (no mark-read) | `"receive"` | Single proof for retrieval |
| `unread --mark-read=true` | `"receiveAndAck"` | One proof + one call (batch receive+ack) |
| `watch` | `"receive"` + short-lived session token | One proof; ack via reusable session token |
| `mark-read` | `"ack"` | Batch ack via reusable session token |
| `admin:*` | `"admin"` | Each command signs fresh proof (sensitive) |

---

### 🧩 2.2 Auth Flow Implementation

New shared helper: `getAuthProof()`

```ts
export async function getAuthProof({
  client,
  vault,
  identityName,
  purpose,
  args,
}: {
  client: MeritsClient;
  vault: MeritsVault;
  identityName: string;
  purpose: "send" | "receive" | "ack" | "receiveAndAck" | "admin";
  args?: Record<string, unknown>;
}) {
  const { challengeId, payloadToSign } = await client.identity.issueChallenge(
    IssueChallenge[purpose](args)
  );

  const data = encodeCanonical(payloadToSign);
  const sigs = await vault.signIndexed(identityName, data);
  const { ksn } = await vault.getIdentity(identityName);

  return { challengeId, sigs, ksn };
}
```

---

### ⚡ 2.3 Short-Lived Session Tokens (for watch + ack)

`watch` and `ack` commands now use temporary, purpose-scoped **session tokens**.

#### Example: watch flow
```ts
const { sessionToken } = await client.transport.openWatchSession({
  for: aliceAid,
  auth: await getAuthProof({
    client, vault, identityName: "alice", purpose: "receive"
  }),
});

await client.transport.subscribe({
  for: aliceAid,
  sessionToken,
  onMessage: async (msg) => {
    const ok = await router.dispatch(ctx, msg);
    if (ok) {
      await client.transport.ackBatch({
        messageIds: [msg.id],
        sessionToken
      });
    }
  }
});
```

**Token properties:**
```json
{
  "aid": "DHytG...",
  "purposes": ["ack"],
  "expiresAt": 1705329322000,
  "signature": "0-..."
}
```

**Security guarantees:**
- Token lifetime < 60s (configurable)
- Tied to AID + specific purposes
- Valid only on that server
- No “send” or “admin” privileges

---

### 📦 2.4 Vault Interface (expanded)

Vault now supports **indexed signatures** and **local decryption** — still keeping private keys inside secure storage.

```ts
interface MeritsVault {
  storeIdentity(name: string, identity: {...}): Promise<void>;
  getIdentity(name: string): Promise<{ aid: string; ksn: number }>;
  listIdentities(): Promise<string[]>;
  deleteIdentity(name: string): Promise<void>;

  /** Sign payload, return indexed KERI signatures */
  signIndexed(name: string, data: Uint8Array): Promise<string[]>;

  /** Decrypt ciphertext using local private key */
  decrypt(
    name: string,
    ct: string,
    opts?: { ek?: string; alg?: string }
  ): Promise<string>;
}
```

✅ Keeps key custody consistent  
✅ Enables plaintext output in `merits unread` / `merits watch`  
✅ Supports threshold multisig in the future

---

### 🧰 2.5 Auth Flow by Command (summary)

| Command | Purpose | Notes |
|----------|----------|-------|
| `id:create`, `id:list`, `id:export`, etc. | none | Local only |
| `send` | `"send"` | One signature per send |
| `unread` | `"receive"` | One signature; messages fetched |
| `unread --mark-read` | `"receiveAndAck"` | Combined call; one proof |
| `watch` | `"receive"` + token | Live session; reusable token for ack |
| `mark-read` | `"ack"` | Batch; session token ok |
| `group:*` | `"manageGroup"` | Use KERI proof of creator/owner |
| `admin:*` | `"admin"` | Fresh proof per command |

---

### 🧱 2.6 Admin Namespace (new)

Adds `merits admin:*` commands for controlled environments:

| Command | Description |
|----------|--------------|
| `admin:promote` | Promote user AID to tier (known/verified) |
| `admin:rate-limit` | Adjust rate limits |
| `admin:stats` | Show usage stats |
| `admin:whoami` | Inspect admin roles and privileges |

---

### 👥 2.7 Group Roles Clarification

Group roles (`owner`, `admin`, `member`) shown in CLI are *derived* from group policy and backend data.  
They are **semantic hints**, not enforced cryptographic roles (unless backend policy enforces them).

> Note: The CLI displays roles for usability. Enforcement depends on the active backend’s policy rules.

---

### 💬 2.8 Identity & Naming

All CLI flags `--from <ID>` or `--to <ID>` accept:
- **Nickname** (local identity alias, e.g. `alice`)
- **Full AID** (`DHytGsw0r-wYg0...`)
- **Group ID** (`#team:123abc`)

Auto-detection resolves priority:
1. Local identity
2. Remote AID
3. Group ID

---

## 3️⃣ CLI Behavior Adjustments

### 📬 `merits unread`

**Before:**  
N+1 round-trips (1 challenge for receive + N for per-message ack)

**Now:**  
Single `receiveAndAck` operation with one KERI proof.

```bash
merits unread --mark-read=true
```

→ Executes:
```ts
const { messages } = await client.transport.receiveAndAck({
  for: aliceAid,
  auth: getAuthProof({ purpose: "receiveAndAck" })
});
```

**Docs note:**
> Fetches unread messages and atomically marks them read in one authenticated call. No additional signing or network calls per message.

---

### 🔁 `merits watch`

**Before:**  
Per-message challenge

**Now:**  
One initial proof, short-lived session token reused for acks.

Docs note:
> Opens a live, authenticated session for incoming messages.  
> Reuses a short-lived session token for efficient, continuous acks — no repeated signing.

---

### 🔑 `merits mark-read`

Can now **batch ack** using same session token:
```ts
await client.transport.ackBatch({
  messageIds,
  sessionToken,
});
```

---

### 🔎 `merits id:register`

Clarified documentation:
> Registers this identity’s current key state with the Merits backend so others can encrypt messages to you and verify your signatures.  
> This must be done once before sending or receiving.

---

## 4️⃣ Vault Terminology Consistency

All references now use **“vault”**, not “keystore”.

| Term | Use |
|------|-----|
| Vault | Secure credential store abstraction |
| OSKeychainVault | macOS/Windows/Linux secure storage |
| EncryptedFileVault | PBKDF2 + AES fallback (for headless) |

---

## 5️⃣ Optional Enhancements

### ✴ Filtering Improvements

Allow:
```bash
merits watch --typ ops.notification.v1
```
Filters messages by type for operations / alerting pipelines.

### 🪶 CLI Output

Decrypts ciphertexts via `vault.decrypt()` for human-readable logs.

---

## 6️⃣ Testing Strategy (updates)

### Unit Tests
- `getAuthProof()` helper
- Vault `signIndexed` and `decrypt`
- Token expiry and scope validation

### Integration Tests
- End-to-end `receiveAndAck` flow
- `watch` session token reuse
- Batch acks via session token
- Admin `promote` + `rate-limit`

### Example
```typescript
test("receive and mark-read with single proof", async () => {
  const { stdout } = await runCLI(["unread", "--mark-read=true"]);
  expect(stdout).toContain("✓ Messages retrieved and marked read");
});
```

---

## 7️⃣ Security Posture Summary

| Layer | Guarantee | Enforcement |
|--------|------------|-------------|
| KERI Auth | Proves control of AID | Always signed by vault |
| Vault | Private keys never leave store | Native keychain or AES-256 |
| Session Tokens | Scoped & short-lived | Server-enforced expiry |
| CLI Config | Local-only (~/.merits/config.json) | No secrets persisted |
| Admin Ops | Always fresh proof | No session reuse |

---

## 8️⃣ Deliverables Summary

| Phase | Deliverable | Milestone |
|--------|--------------|------------|
| Phase 1 | Vault + Config + Formatters | CLI boots, secure vault ready |
| Phase 2 | Identity Lifecycle | Full id: commands |
| Phase 3 | Messaging | send, unread, mark-read |
| Phase 4 | Streaming + Groups | watch + group:* |
| Phase 5 | Admin + Interactive | admin:* + TUI |
| Phase 6 | Publish + Docs | npm release |

---

## ✅ Key Architectural Wins

- 🔐 **Vault-based custody:** private keys never leave secure storage  
- 🧩 **Indexed signatures:** future multisig compatibility  
- ⚡ **Single-proof receiveAndAck:** no redundant network calls  
- 🔄 **Session token reuse:** efficient continuous message handling  
- 🧭 **Explicit auth purposes:** `"send"`, `"receive"`, `"ack"`, `"admin"`  
- 🧱 **Extensible CLI:** new namespaces for admin, groups, policies  
- 📜 **Clean UX:** text/json/compact outputs, piping-friendly  
- 🧠 **Security-conscious:** purpose-scoped tokens, zero plaintext persistence  

---

**Final Status:**  
✅ **Planning Complete — Ready for Phase 1 Implementation**  
This version integrates all review feedback, the new **auth optimization flow**, and alignment with the Merits SDK vision.
