# CLI → Backend Integration Handoff

**Status:** CLI Work Complete, Ready for Backend Integration
**Date:** 2025-11-01
**CLI Team:** All standalone work complete (60/60 tests passing)
**Backend Team:** API implementation required for final integration

---

## Executive Summary

The Merits CLI has completed **all work that can be done without backend dependencies**. We have:

✅ **60/60 tests passing** (40 E2E + 9 Golden + 11 Performance)
✅ **Production-ready group encryption** (X25519 ECDH + AES-256-GCM)
✅ **Complete utility commands** (encrypt, decrypt, verify-signature)
✅ **Performance verified** (100 members in <80ms)
✅ **Golden snapshot infrastructure** (regression prevention)
✅ **Comprehensive documentation** (integration plan, API specs, test suite)

**Next Critical Path:** Backend API implementation (Phases 5.6-5.7, 6)

---

## What's Complete ✅

### Phase 1-5: Core CLI Functionality (30 tests)
- ✅ Output format system (RFC8785 JSON canonicalization)
- ✅ Session token management
- ✅ Key generation and user management
- ✅ Messaging commands (with mock backend)
- ✅ **Complete group encryption cryptography** ([cli/lib/crypto-group.ts](../cli/lib/crypto-group.ts))

### Phase 7: Utility Commands (10 tests)
- ✅ `encrypt` - Standalone message encryption (X25519 ECDH + AES-256-GCM)
- ✅ `decrypt` - Standalone message decryption
- ✅ `verify-signature` - Ed25519 signature verification
- 🔄 `key-for` - Blocked by backend (needs `identityRegistry.getPublicKey()`)

### Phase 8: Enhanced Testing (20 tests)
- ✅ **Golden snapshot tests** (9 tests) - Regression prevention
- ✅ **Performance benchmarks** (11 tests) - Scaling verified
- ✅ **Error handling tests** - Covered in E2E suite

---

## What's Blocked 🔄

### Phase 5.6-5.7: Group Encryption Integration
**Status:** Crypto complete, CLI integration ready, **backend APIs needed**

**Required:**
1. Backend API: `groups.getMembers(groupId)`
2. Backend API: `groups.sendGroupMessage()`
3. Backend API: Update `messages.getUnread()` to support group messages
4. CLI integration: ~3-5 days (after backend ready)

**Impact:** Cannot encrypt/decrypt group messages in `send`/`unread` commands

---

### Phase 6: Allow-List Controls
**Status:** Backend schema and APIs needed

**Required:**
1. Backend schema: `allowLists` table
2. Backend API: `allowList.update()`, `denyList.update()`
3. CLI commands: ~2-3 days (after backend ready)

**Impact:** Cannot manage message allow/deny lists

---

## Backend Requirements (Priority Order)

### Priority 1️⃣: Group Messaging Core

#### API 1: `groups.getMembers(groupId)`

**Purpose:** Fetch group membership for encryption

**Request:**
```typescript
{
  groupId: string;
}
```

**Response:**
```typescript
{
  groupId: string;
  members: Array<{
    aid: string;           // Member's AID
    publicKey: string;     // Ed25519 public key (base64url)
    joinedAt: number;      // Timestamp
  }>;
  createdBy: string;       // Group creator's AID
  createdAt: number;
}
```

**Security:** Verify caller is a member before returning member list

**Usage:** CLI calls this before encrypting group messages to get member public keys

---

#### API 2: `groups.sendGroupMessage()`

**Purpose:** Store encrypted group message and fanout to members

**Request:**
```typescript
{
  groupId: string;
  groupMessage: GroupMessage;  // Already encrypted by CLI
  auth: AuthProof;             // Session token-based auth
}

// GroupMessage structure (from CLI):
interface GroupMessage {
  encryptedContent: string;    // base64url - message encrypted with ephemeral group key
  nonce: string;               // base64url - AES-GCM nonce (96 bits)
  encryptedKeys: Record<string, {  // Per-recipient encrypted keys
    encryptedKey: string;      // base64url - group key encrypted for this member
    nonce: string;             // base64url - AES-GCM nonce for key encryption
  }>;
  senderAid: string;
  groupId: string;
  aad?: string;                // base64url - Additional Authenticated Data
}
```

**Response:**
```typescript
{
  messageId: string;
  sentAt: number;
}
```

**Backend Processing:**
1. Verify sender is group member
2. Store encrypted `GroupMessage` (do NOT decrypt it!)
3. Create inbox entry for each recipient AID (from `encryptedKeys`)
4. Return confirmation

**IMPORTANT:** Backend stores the encrypted message as-is. No decryption required or allowed (zero-knowledge design).

---

### Priority 2️⃣: Message Retrieval Updates

#### API 3: Update `messages.getUnread()`

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

**Required Changes:**
```typescript
{
  messages: Array<{
    id: string;
    from: string;
    to: string;
    ct: string | GroupMessage;  // ← Can now be GroupMessage object
    typ: string;                // ← "encrypted" | "group-encrypted"
    createdAt: number;

    // New fields for group messages:
    isGroupMessage?: boolean;      // ← true for group messages
    groupId?: string;              // ← group ID
    senderPublicKey?: string;      // ← Ed25519 public key (base64url) - needed for decryption
  }>
}
```

**Changes:**
1. Add `typ: "group-encrypted"` for group messages
2. Include `senderPublicKey` field (CLI needs this for ECDH decryption)
3. Return full `GroupMessage` object in `ct` field for group messages
4. Add `isGroupMessage` flag for easy filtering

---

### Priority 3️⃣: Public Key Lookup

#### API 4: `identityRegistry.getPublicKey(aid)`

**Purpose:** Fetch any user's public key for encryption

**Request:**
```typescript
{
  aid: string;
}
```

**Response:**
```typescript
{
  aid: string;
  publicKey: string;    // Ed25519 public key (base64url)
  ksn: number;          // Key sequence number
  updatedAt: number;
}
```

**Security:** Public keys are public - no auth required

**Note:** This may already exist in current implementation. Verify it works and returns Ed25519 public keys in base64url format.

---

## Group Encryption Cryptography (Already Implemented)

**File:** [cli/lib/crypto-group.ts](../cli/lib/crypto-group.ts)
**Tests:** [tests/cli/e2e/new-cli-spec.test.ts#L455-L841](../tests/cli/e2e/new-cli-spec.test.ts#L455-L841)
**Status:** ✅ Production-ready (13/13 tests passing)

**Cryptographic Primitives:**
- **Ed25519→X25519 conversion:** RFC 7748
- **X25519 ECDH:** Diffie-Hellman key exchange
- **HKDF-SHA256:** Key derivation (RFC 5869)
- **AES-256-GCM:** Authenticated encryption (NIST SP 800-38D)

**Security Properties:**
- ✅ Forward secrecy (ephemeral keys per message)
- ✅ Authenticated encryption (AES-GCM)
- ✅ Per-recipient key isolation
- ✅ Memory safety (keys cleared after use)
- ✅ Zero-knowledge (backend cannot decrypt)

**Performance:** (verified with 11 performance tests)
- 5 members: 3ms
- 10 members: 8ms
- 25 members: 19ms
- 50 members: 40ms
- **100 members: 79ms** (well under target of 2000ms)
- Decryption: <1ms for all group sizes
- **Scaling:** Linear at ~0.76ms per member

---

## CLI Integration Plan (Ready to Execute)

Once backend APIs are available, CLI integration takes **3-5 days**:

### Day 1-2: Update `send` Command
**File:** [cli/commands/send.ts](../cli/commands/send.ts)

**Changes:**
1. Import group encryption functions from `crypto-group.ts`
2. Call `groups.getMembers(groupId)` to fetch member public keys
3. Call `encryptForGroup()` to encrypt message
4. Call `groups.sendGroupMessage()` to send encrypted message
5. Add error handling for encryption failures

**Code already designed:** See [GROUP-ENCRYPTION-INTEGRATION.md](GROUP-ENCRYPTION-INTEGRATION.md) lines 180-248

---

### Day 2-3: Update `unread` Command
**File:** [cli/commands/unread.ts](../cli/commands/unread.ts)

**Changes:**
1. Import group decryption functions from `crypto-group.ts`
2. Detect group messages (`typ === "group-encrypted"`)
3. Call `decryptGroupMessage()` to decrypt
4. Handle decryption failures gracefully
5. Update output format to show decrypted content

**Code already designed:** See [GROUP-ENCRYPTION-INTEGRATION.md](GROUP-ENCRYPTION-INTEGRATION.md) lines 250-333

---

### Day 4-5: Testing & Validation
1. Unit tests with mocked backend (can start now)
2. E2E tests with real backend
3. Performance testing with large groups
4. Security audit of key handling

---

## Testing Strategy

### Tests Ready to Run (Mocked Backend)
**File:** `tests/cli/integration/group-encryption.test.ts` (to be created)

Mock backend responses to test:
- ✅ Encryption for all group members
- ✅ Decryption of received group messages
- ✅ Error handling (non-members, missing keys, etc.)

**Estimated:** 1 day to write, can start immediately

---

### Tests Blocked by Backend
**File:** [tests/cli/e2e/new-cli-spec.test.ts](../tests/cli/e2e/new-cli-spec.test.ts)

E2E tests for:
- Full group messaging workflow (create group → send → receive → decrypt)
- Multi-member scenarios (Alice sends, Bob & Carol receive)
- Access control (Eve cannot decrypt)
- Large groups (100+ members)

**Estimated:** 2 days to write, needs backend ready

---

## Timeline & Dependencies

```
Week 1-2: Backend API Development
├─ Day 1-3: Implement groups.getMembers()
├─ Day 3-5: Implement groups.sendGroupMessage()
├─ Day 5-7: Update messages.getUnread()
├─ Day 8-10: Testing & deployment

Week 3: CLI Integration
├─ Day 1-2: Update send.ts
├─ Day 2-3: Update unread.ts
├─ Day 4-5: Integration testing

Week 4: Validation & Deployment
├─ Day 1-2: E2E testing
├─ Day 3-4: Performance testing
├─ Day 5: Documentation & deployment
```

**Critical Path:** Backend APIs → CLI integration → Testing

**Total Duration:** 3-4 weeks

---

## Documentation Resources

### For Backend Team
1. **[GROUP-ENCRYPTION-INTEGRATION.md](GROUP-ENCRYPTION-INTEGRATION.md)** - Comprehensive integration plan
   - Detailed API specifications
   - Security considerations
   - Testing strategies
   - Open questions & decisions

2. **[cli/lib/crypto-group.ts](../cli/lib/crypto-group.ts)** - Crypto implementation
   - 433 lines of production-ready code
   - Fully documented functions
   - References to RFC specs

3. **[tests/cli/e2e/new-cli-spec.test.ts](../tests/cli/e2e/new-cli-spec.test.ts)** - Test examples
   - Lines 455-841: Group encryption tests
   - Shows expected message formats
   - Demonstrates API usage patterns

### For CLI Team
1. **[IMPLEMENTATION-ROADMAP.md](IMPLEMENTATION-ROADMAP.md)** - Current status & roadmap
2. **[CLI-PROGRESS-SUMMARY.md](CLI-PROGRESS-SUMMARY.md)** - Detailed completion status
3. **[cli-plan.md](cli-plan.md)** - Phase-by-phase plan

---

## Open Questions & Decisions

### 1. Key Storage Strategy
**Question:** Where should Ed25519 private keys be stored?

**Options:**
- **A. Session token file** (simpler, less secure)
  - ✅ Easy to implement
  - ❌ Private key in session file

- **B. Separate encrypted vault** (more secure, recommended)
  - ✅ Better security
  - ✅ Proper key management
  - ❌ More complex

**Recommendation:** Use Option A for MVP, plan migration to Option B for production

---

### 2. Message Signatures
**Question:** Should group messages include Ed25519 signatures for non-repudiation?

**Tradeoffs:**
- ✅ Prevents sender denial
- ✅ Protects against backend tampering
- ❌ Adds complexity and message size
- ❌ May not be needed if backend is trusted

**Recommendation:** Defer to Phase 6, implement basic encryption first

---

### 3. Group Key Rotation
**Question:** Should we support key rotation for long-lived groups?

**Tradeoffs:**
- ✅ Better long-term security
- ✅ Useful for member changes
- ❌ Adds complexity (key version tracking)
- ❌ Performance overhead

**Recommendation:** Defer to future enhancement, current design already provides forward secrecy

---

## Contact & Coordination

### CLI Team Status
- ✅ All standalone work complete
- ✅ Integration code designed and ready
- ✅ Ready to integrate immediately when backend is available
- ⏸️ Waiting for backend API implementation

### Backend Team Next Steps
1. **Review** [GROUP-ENCRYPTION-INTEGRATION.md](GROUP-ENCRYPTION-INTEGRATION.md)
2. **Implement** APIs in priority order (1-4 above)
3. **Provide** test environment for CLI integration
4. **Coordinate** on API contracts and testing schedule

### Communication
- **Weekly syncs** on backend API progress
- **Shared test environment** once backend is ready
- **Coordinated testing** for integration validation

---

## Success Metrics

### Current Achievement
- ✅ 60/60 tests passing (40 E2E + 9 Golden + 11 Performance)
- ✅ 7/9 phases complete (Phases 1-5, 7 partial, 8 complete)
- ✅ Production-ready group encryption
- ✅ Performance benchmarks established
- ✅ Zero known bugs

### Target After Backend Integration
- [ ] 70+ tests (add ~10 integration tests)
- [ ] 9/9 phases complete
- [ ] Full group messaging workflow working end-to-end
- [ ] Allow-list controls implemented
- [ ] Production deployment ready

---

## Appendix: Quick Reference

### GroupMessage Structure
```typescript
interface GroupMessage {
  encryptedContent: string;    // base64url - message encrypted with group key
  nonce: string;               // base64url - AES-GCM nonce (96 bits)
  encryptedKeys: Record<string, {
    encryptedKey: string;      // base64url - group key encrypted for this member
    nonce: string;             // base64url - nonce for key encryption
  }>;
  senderAid: string;           // Sender's AID
  groupId: string;             // Group identifier
  aad?: string;                // base64url - Additional Authenticated Data
}
```

### Example Encrypted Group Message
```json
{
  "encryptedContent": "rK8zX2n...",
  "nonce": "fD8Qw1e...",
  "encryptedKeys": {
    "alice-aid": {
      "encryptedKey": "g9YxV3m...",
      "nonce": "hJ4Kz2p..."
    },
    "bob-aid": {
      "encryptedKey": "p2MwQ7n...",
      "nonce": "sL6Tx4r..."
    }
  },
  "senderAid": "alice-aid",
  "groupId": "group-123",
  "aad": "Z3JvdXAt..."
}
```

### Key Files to Review
1. [cli/lib/crypto-group.ts](../cli/lib/crypto-group.ts) - Core crypto implementation
2. [GROUP-ENCRYPTION-INTEGRATION.md](GROUP-ENCRYPTION-INTEGRATION.md) - Integration plan
3. [tests/cli/e2e/new-cli-spec.test.ts](../tests/cli/e2e/new-cli-spec.test.ts) - Test examples

---

**Status:** CLI Ready, Waiting for Backend
**Last Updated:** 2025-11-01
**Next Milestone:** Backend API Implementation (3-4 weeks)
