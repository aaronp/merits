# Group Encryption Integration Plan

**Status:** Backend Integration Required
**Created:** 2025-10-31
**Implementation:** [cli/lib/crypto-group.ts](../cli/lib/crypto-group.ts)

## Overview

This document outlines the integration plan for group encryption into the Merits CLI `send` and `unread` commands. The core cryptographic implementation is **complete and tested** ([crypto-group.ts](../cli/lib/crypto-group.ts) with 13 passing tests), but integration requires backend API support.

## Current State

### ✅ Completed: Core Cryptography

**Implementation:** [cli/lib/crypto-group.ts](../cli/lib/crypto-group.ts)

The group encryption system is production-ready with:
- Ed25519→X25519 key conversion (RFC 7748)
- X25519 ECDH for shared secret derivation
- HKDF-SHA256 for group key derivation (RFC 5869)
- AES-256-GCM authenticated encryption (NIST SP 800-38D)
- Ephemeral keys with memory clearing
- Full test coverage (13 tests, all passing)

**Security Properties:**
- ✅ Forward secrecy
- ✅ Authenticated encryption
- ✅ Per-recipient key isolation
- ✅ Memory safety (keys cleared after use)

### 🔄 In Progress: CLI Command Integration

**Commands to Update:**
- `send` - Needs group encryption for group messages
- `unread` - Needs group decryption for received group messages

**Blocker:** Backend API endpoints not yet available

---

## Backend Requirements

### 1. Group Management API

**Required Endpoints:**

#### `groups.getMembers(groupId: string)`
```typescript
// Query to fetch group membership
{
  groupId: string;
  members: Array<{
    aid: string;           // Member's AID
    publicKey: string;     // Member's Ed25519 public key (base64url)
    joinedAt: number;      // Timestamp
  }>;
  createdBy: string;       // Group creator's AID
  createdAt: number;
}
```

**Purpose:** Sender needs member list to encrypt group key for each recipient

**Security:** Should verify caller is a member before returning member list

---

#### `groups.sendGroupMessage()`
```typescript
// Mutation to send encrypted group message
{
  groupId: string;
  groupMessage: GroupMessage;  // Encrypted payload from crypto-group.ts
  auth: AuthProof;             // Session token-based auth
}

// Where GroupMessage is:
interface GroupMessage {
  encryptedContent: string;    // base64url - message encrypted with group key
  nonce: string;               // base64url - AES-GCM nonce (96 bits)
  encryptedKeys: Record<string, {
    encryptedKey: string;      // base64url - group key encrypted for this member
    nonce: string;             // base64url - AES-GCM nonce for this key encryption
  }>;
  senderAid: string;
  groupId: string;
  aad?: string;                // base64url - Additional Authenticated Data
}

// Returns:
{
  messageId: string;
  sentAt: number;
}
```

**Purpose:** Store encrypted group message for fanout to all members

**Backend Processing:**
1. Verify sender is group member
2. Store encrypted message
3. Create inbox entries for each recipient (using their AID from `encryptedKeys`)
4. Return confirmation

**Note:** Backend does NOT need to decrypt/re-encrypt. The group message already contains per-recipient encrypted keys.

---

### 2. Message Retrieval API

#### `messages.getUnread()` - Update Response Format

**Current Response:**
```typescript
{
  messages: Array<{
    id: string;
    from: string;
    to: string;
    ct: string;        // Ciphertext (base64)
    typ: string;
    createdAt: number;
  }>
}
```

**Required Update:**
```typescript
{
  messages: Array<{
    id: string;
    from: string;
    to: string;
    ct: string | GroupMessage;  // Either simple ct OR GroupMessage
    typ: string;                // "encrypted" | "group-encrypted"
    createdAt: number;

    // New fields for group messages:
    isGroupMessage?: boolean;
    groupId?: string;
    senderPublicKey?: string;   // Needed for decryption
  }>
}
```

**Purpose:** Client needs to distinguish group messages and have sender's public key for decryption

**Backend Changes:**
1. Add `typ: "group-encrypted"` for group messages
2. Include sender's public key in response (needed for ECDH)
3. Return full `GroupMessage` structure in `ct` field for group messages

---

### 3. Public Key Resolution

#### `identityRegistry.getPublicKey(aid: string)`
```typescript
// Query to fetch any user's current public key
{
  aid: string;
  publicKey: string;    // Ed25519 public key (base64url)
  ksn: number;          // Key sequence number
  updatedAt: number;
}
```

**Purpose:**
- Sender needs recipient public keys for encryption
- Receiver needs sender public key for decryption

**Security:** Public keys are public - no auth required

**Note:** This may already exist in current implementation, just needs verification

---

## CLI Integration Plan

### Phase 5.6: Integrate Group Encryption into `send`

**File:** [cli/commands/send.ts](../cli/commands/send.ts)

#### Changes Required

1. **Import group encryption:**
```typescript
import {
  encryptForGroup,
  ed25519PrivateKeyToX25519,
  type GroupMessage,
} from "../lib/crypto-group";
```

2. **Update `sendGroupMessage()` function:**

**Current flow (simplified):**
```typescript
// Uses placeholder encryption
const ct = await encryptMessage(plaintext, senderPublicKey);
```

**New flow:**
```typescript
// 1. Fetch group members from backend
const groupMembers = await ctx.client.groups.getMembers(groupId);

// 2. Build member public keys map
const memberPublicKeys: Record<string, string> = {};
for (const member of groupMembers.members) {
  memberPublicKeys[member.aid] = member.publicKey;
}

// 3. Get our private key from session
const ourPrivateKey = await loadPrivateKeyFromSession(opts.token);
const ourAid = session.aid;

// 4. Encrypt using group encryption
const groupMessage = await encryptForGroup(
  plaintext,
  memberPublicKeys,
  ourPrivateKey,
  groupId,
  ourAid
);

// 5. Send encrypted group message
const result = await ctx.client.groups.sendGroupMessage({
  groupId,
  groupMessage,
  auth,
});
```

3. **Add session token → private key helper:**
```typescript
async function loadPrivateKeyFromSession(tokenPath?: string): Promise<Uint8Array> {
  // Load session, validate it contains private key or keystore reference
  // Return Ed25519 private key bytes
  // This will need to be designed based on how keys are stored
}
```

**Challenges:**
- Need to define how private keys are accessed from session tokens
- May need keystore/vault integration
- Consider security of keeping private keys in memory

---

### Phase 5.7: Integrate Group Decryption into `unread`

**File:** [cli/commands/unread.ts](../cli/commands/unread.ts)

#### Changes Required

1. **Import group decryption:**
```typescript
import {
  decryptGroupMessage,
  ed25519PrivateKeyToX25519,
  type GroupMessage,
} from "../lib/crypto-group";
```

2. **Update message processing:**

**Current flow:**
```typescript
// Returns encrypted messages as-is
const messages = await ctx.client.messages.getUnread();
```

**New flow:**
```typescript
const messages = await ctx.client.messages.getUnread();

// Process each message
const processedMessages = await Promise.all(
  messages.map(async (msg) => {
    if (msg.typ === "group-encrypted" && msg.isGroupMessage) {
      try {
        // Decrypt group message
        const ourPrivateKey = await loadPrivateKeyFromSession(opts.token);
        const ourAid = session.aid;
        const senderPublicKey = msg.senderPublicKey;
        const groupMessage = msg.ct as GroupMessage;

        const plaintext = await decryptGroupMessage(
          groupMessage,
          ourPrivateKey,
          ourAid,
          senderPublicKey
        );

        return {
          ...msg,
          decryptedContent: plaintext,
          decryptionStatus: "success",
        };
      } catch (err) {
        // Decryption failed (e.g., not a recipient)
        return {
          ...msg,
          decryptionStatus: "failed",
          error: err.message,
        };
      }
    } else {
      // Regular message - handle as before
      return msg;
    }
  })
);
```

3. **Update output format:**
```typescript
// Pretty format shows decrypted content when available
if (format === "pretty") {
  console.log(JSON.stringify(processedMessages, null, 2));

  if (!opts.noBanner) {
    const decryptedCount = processedMessages.filter(
      m => m.decryptionStatus === "success"
    ).length;
    console.error(`\n✓ Retrieved ${messages.length} messages`);
    console.error(`  ${decryptedCount} group messages decrypted`);
  }
}
```

---

## Testing Strategy

### Unit Tests (Can Do Now)

Create integration tests that mock backend responses:

**File:** `tests/cli/integration/group-encryption.test.ts`

```typescript
describe("Group Encryption Integration", () => {
  test("send encrypts for all group members", async () => {
    // Mock backend returning group members
    const mockBackend = {
      groups: {
        getMembers: jest.fn().mockResolvedValue({
          members: [
            { aid: "bob-aid", publicKey: bobPubKey },
            { aid: "carol-aid", publicKey: carolPubKey },
          ]
        })
      }
    };

    // Execute send command
    await sendMessage("group-123", {
      message: "Hello group",
      token: aliceToken,
      _ctx: { client: mockBackend }
    });

    // Verify encryption was called with correct members
    expect(mockBackend.groups.getMembers).toHaveBeenCalledWith("group-123");
  });

  test("unread decrypts group messages", async () => {
    // Mock backend returning encrypted group message
    const mockBackend = {
      messages: {
        getUnread: jest.fn().mockResolvedValue({
          messages: [{
            typ: "group-encrypted",
            isGroupMessage: true,
            ct: mockGroupMessage,
            senderPublicKey: alicePubKey,
          }]
        })
      }
    };

    // Execute unread command
    const result = await unread({
      token: bobToken,
      _ctx: { client: mockBackend }
    });

    // Verify decryption succeeded
    expect(result[0].decryptionStatus).toBe("success");
    expect(result[0].decryptedContent).toBe("Hello group");
  });
});
```

### E2E Tests (Requires Backend)

Once backend is ready, add to existing E2E test suite:

**File:** `tests/cli/e2e/new-cli-spec.test.ts`

```typescript
describe("Phase 5.6-5.7: Group Encryption Integration", () => {
  test("full group messaging workflow", async () => {
    // 1. Alice creates group
    const group = await runCLI([
      "create-group",
      "--name", "test-group",
      "--members", "bob-aid,carol-aid",
      "--token", aliceToken
    ]);

    // 2. Alice sends encrypted group message
    const sent = await runCLI([
      "send",
      "--to", group.groupId,
      "--message", "Secret group message",
      "--token", aliceToken
    ]);

    // 3. Bob retrieves and decrypts
    const bobMessages = await runCLI([
      "unread",
      "--token", bobToken
    ]);

    expect(bobMessages[0].decryptedContent).toBe("Secret group message");
    expect(bobMessages[0].groupId).toBe(group.groupId);

    // 4. Carol retrieves and decrypts
    const carolMessages = await runCLI([
      "unread",
      "--token", carolToken
    ]);

    expect(carolMessages[0].decryptedContent).toBe("Secret group message");
  });

  test("non-members cannot decrypt group messages", async () => {
    // Eve is not in the group
    const eveMessages = await runCLI([
      "unread",
      "--token", eveToken
    ]);

    const groupMsg = eveMessages.find(m => m.isGroupMessage);
    expect(groupMsg.decryptionStatus).toBe("failed");
    expect(groupMsg.error).toContain("No encrypted key found");
  });
});
```

---

## Security Considerations

### 1. Key Management

**Challenge:** How are Ed25519 private keys stored and accessed?

**Options:**

**A. Store in session token (simpler but less secure):**
```typescript
interface SessionToken {
  token: string;
  expiresAt: number;
  aid: string;
  privateKey: string;  // Ed25519 private key (base64url)
}
```
- ✅ Simple to implement
- ❌ Private key stored in session file
- ❌ Higher risk if session file is compromised

**B. Use separate keystore (more secure):**
```typescript
// Session token only references key
interface SessionToken {
  token: string;
  expiresAt: number;
  aid: string;
  keystoreId: string;  // References key in vault
}

// Separate encrypted keystore
const privateKey = await ctx.vault.getPrivateKey(session.keystoreId);
```
- ✅ Better separation of concerns
- ✅ Can use encrypted keystore
- ❌ More complex implementation

**Recommendation:** Use Option B for production, but Option A is acceptable for MVP.

---

### 2. Group Key Security

**Current Implementation (Good):**
- ✅ Group keys are ephemeral (generated per-message)
- ✅ Keys cleared from memory after encryption (`fill(0)`)
- ✅ No persistence of group keys
- ✅ Forward secrecy maintained

**Additional Considerations:**
- Backend should NOT store decrypted group keys
- Backend should NOT be able to decrypt group messages (zero-knowledge)
- Consider adding key rotation for long-lived groups (future enhancement)

---

### 3. Sender Verification

**Challenge:** How does receiver verify message authenticity?

**Current Design:**
- GroupMessage includes `senderAid` field
- Backend provides `senderPublicKey` in message metadata
- Receiver uses sender's public key for ECDH

**Enhancement (Future):**
Consider adding signature to GroupMessage:
```typescript
interface GroupMessage {
  // ... existing fields
  signature?: string;  // Ed25519 signature of encryptedContent + groupId + senderAid
}
```

This would provide:
- ✅ Non-repudiation (sender cannot deny sending)
- ✅ Protection against backend tampering
- ❌ Adds complexity and message size

---

## Implementation Checklist

### Backend Work (Required First)

- [ ] Add `groups.getMembers()` query
- [ ] Add `groups.sendGroupMessage()` mutation
- [ ] Update `messages.getUnread()` response format
  - [ ] Add `isGroupMessage` flag
  - [ ] Add `senderPublicKey` field
  - [ ] Support `GroupMessage` type in `ct` field
- [ ] Verify `identityRegistry.getPublicKey()` exists and works
- [ ] Add database schema for group messages
- [ ] Implement message fanout (one GroupMessage → inbox entry per member)

### CLI Work (Can Do After Backend)

- [ ] Update `send.ts`:
  - [ ] Add group member fetching
  - [ ] Integrate `encryptForGroup()`
  - [ ] Add private key loading from session
  - [ ] Handle encryption errors gracefully
- [ ] Update `unread.ts`:
  - [ ] Detect group messages
  - [ ] Integrate `decryptGroupMessage()`
  - [ ] Handle decryption failures
  - [ ] Update output format
- [ ] Add integration tests with mocked backend
- [ ] Update CLI documentation
- [ ] Add error messages for common issues

### Testing (After Both)

- [ ] Unit tests with mocked backend
- [ ] E2E tests with real backend
- [ ] Performance testing (large groups, many messages)
- [ ] Security audit of key handling

---

## Timeline Estimate

**Assuming backend team has capacity:**

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Backend API development | 1-2 weeks | Database schema, API design review |
| CLI integration | 3-5 days | Backend APIs complete |
| Testing | 3-5 days | CLI integration complete |
| Documentation | 2-3 days | All features complete |
| **Total** | **3-4 weeks** | Sequential dependencies |

**Critical Path:**
1. Backend APIs (longest pole)
2. CLI integration
3. Testing
4. Documentation

---

## Open Questions

1. **Key Storage:** Where should Ed25519 private keys be stored?
   - Session token? (simpler, less secure)
   - Separate vault? (more secure, more complex)
   - Hardware security module? (most secure, requires infrastructure)

2. **Backward Compatibility:** How to handle mixed clients?
   - Old clients can't decrypt group messages
   - Should backend maintain both encryption schemes during transition?
   - Migration strategy?

3. **Group Key Rotation:** Should we support key rotation for groups?
   - Useful for long-lived groups
   - Adds complexity (need to track key versions)
   - Can defer to later phase

4. **Message Signing:** Should group messages include signatures?
   - Provides non-repudiation
   - Protects against tampering
   - Adds overhead (signature per message)

5. **Performance:** How to optimize for large groups?
   - Current implementation encrypts group key for each member
   - N=100 members → 100 encrypted keys per message
   - Consider: key-wrapping, batching, or hierarchical keys

---

## References

### Specifications
- RFC 7748: X25519 key exchange
- RFC 5869: HKDF key derivation
- NIST SP 800-38D: AES-GCM

### Implementation
- [cli/lib/crypto-group.ts](../cli/lib/crypto-group.ts) - Core implementation
- [tests/cli/e2e/new-cli-spec.test.ts](../tests/cli/e2e/new-cli-spec.test.ts) - Test suite
- [docs/cli-plan.md](./cli-plan.md) - Overall migration plan

### Dependencies
- `@noble/curves@2.0.1` - X25519/Ed25519 operations
- `@noble/hashes@2.0.1` - HKDF-SHA256
- Web Crypto API - AES-256-GCM encryption

---

## Contact

**Questions about this integration?**
- Review existing tests: [tests/cli/e2e/new-cli-spec.test.ts#L455-L841](../tests/cli/e2e/new-cli-spec.test.ts#L455-L841)
- Check implementation: [cli/lib/crypto-group.ts](../cli/lib/crypto-group.ts)
- See progress summary: [CLI-PROGRESS-SUMMARY.md](./CLI-PROGRESS-SUMMARY.md)
